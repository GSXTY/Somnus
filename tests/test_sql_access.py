import tempfile
import unittest
from pathlib import Path

from agent_core.sql_access import SqlAccessError, SqlSettings, guard, run, schema
from agent_core.sql_agent import extract_sql
from tools.seed_analytics_demo import seed


class GuardTests(unittest.TestCase):
    def settings(self, **overrides):
        base = dict(url='sqlite:///unused.db', max_rows=50, timeout_seconds=5.0)
        base.update(overrides)
        return SqlSettings(**base)

    def test_only_select_is_allowed(self):
        settings = self.settings()
        for bad in ('delete from users', 'update users set a=1', 'drop table users',
                    'select 1; select 2', 'select * from users -- comment',
                    'select * from users into outfile "/tmp/x"', 'with x as (select 1) delete from users'):
            with self.assertRaises(SqlAccessError, msg=bad):
                guard(bad, settings)

    def test_limit_is_added_and_existing_limit_kept(self):
        settings = self.settings()
        self.assertTrue(guard('select * from users', settings).endswith('LIMIT 50'))
        self.assertNotIn('LIMIT 50', guard('select * from users limit 5', settings))

    def test_table_allowlist_blocks_unknown_tables(self):
        settings = self.settings(allowed_tables=('users',))
        self.assertTrue(guard('select user_id from users', settings))
        with self.assertRaises(SqlAccessError):
            guard('select * from daily_usage', settings)

    def test_cte_is_allowed(self):
        self.assertTrue(guard('WITH t AS (SELECT 1 AS a) SELECT a FROM t', self.settings()))


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = seed(Path(self.temp.name) / 'demo.sqlite3', users=6, days=5)
        self.settings = SqlSettings(url=f'sqlite:///{self.path.as_posix()}', max_rows=3, timeout_seconds=5.0,
                                    audit_path=Path(self.temp.name) / 'audit.jsonl')

    def test_schema_lists_tables_and_columns(self):
        tables = {item['table']: [c['name'] for c in item['columns']] for item in schema(self.settings)}
        self.assertIn('users', tables)
        self.assertIn('daily_usage', tables)
        self.assertIn('user_id', tables['users'])

    def test_query_returns_rows_and_truncates(self):
        result = run('select user_id from users order by user_id', self.settings)
        self.assertEqual(result['columns'], ['user_id'])
        self.assertEqual(len(result['rows']), 3)
        self.assertTrue(result['truncated'])
        self.assertTrue((Path(self.temp.name) / 'audit.jsonl').is_file())

    def test_write_attempt_is_rejected_before_connecting(self):
        with self.assertRaises(SqlAccessError):
            run('delete from users', self.settings)

    def test_missing_database_is_reported(self):
        settings = SqlSettings(url=f'sqlite:///{(Path(self.temp.name) / "missing.db").as_posix()}')
        with self.assertRaises(SqlAccessError):
            run('select 1', settings)


class PromptExtractionTests(unittest.TestCase):
    def test_extracts_fenced_sql(self):
        self.assertEqual(extract_sql('```sql\nSELECT 1\n```'), 'SELECT 1')

    def test_extracts_plain_sql(self):
        self.assertEqual(extract_sql('  SELECT 2  '), 'SELECT 2')

    def test_empty_is_rejected(self):
        with self.assertRaises(SqlAccessError):
            extract_sql('   ')


if __name__ == '__main__':
    unittest.main()
