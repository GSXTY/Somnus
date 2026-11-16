import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from ai_assistant import execution_trace
from ai_assistant.service import AssistantService


class ExecutionTraceTests(unittest.TestCase):
    def test_old_trace_schema_preserves_history_and_records_a_failure_reason(self):
        with closing(sqlite3.connect(':memory:')) as db:
            db.row_factory = sqlite3.Row
            execution_trace.initialize(db)
            db.execute('ALTER TABLE execution_trace DROP COLUMN failure_reason')
            old_id = execution_trace.start(db, 'chat', 'turn', 'tool', 'query_database')
            db.execute("UPDATE execution_trace SET status='failed' WHERE id=?", (old_id,))
            execution_trace.initialize(db)
            new_id = execution_trace.start(db, 'chat', 'turn', 'tool', 'query_database')
            execution_trace.finish(db, new_id, 'failed', failure_reason='查询的字段不存在。')
            rows = dict(db.execute('SELECT id, failure_reason FROM execution_trace'))
            self.assertEqual(rows, {old_id: None, new_id: '查询的字段不存在。'})

    def test_scoped_trace_survives_restart_and_projects_only_allowed_metadata(self):
        with tempfile.TemporaryDirectory(dir='.') as directory:
            path = Path(directory) / 'assistant.sqlite3'
            service = AssistantService(path)
            cid = service.create()['id']
            other_cid = service.create()['id']
            turn_id = 'trace-turn'
            details = {
                'usage': {'input_tokens': 12, 'output_tokens': 8, 'cached_input_tokens': 4, 'api_key': 'private'},
                'execution': {
                    'steps': [{'id': 'secret', 'title': 'private command', 'kind': 'execute', 'status': 'completed'}],
                    'approvals': [{'id': 'approved-test', 'kind': 'test', 'status': 'approved', 'at': 100,
                                   'private': 'private arguments'}],
                },
            }
            with service.db() as db:
                db.execute('''INSERT INTO messages(id,conversation_id,role,content,status,created_at,reply_meta)
                              VALUES(?,?,'assistant','private result','complete',90,?)''',
                           (turn_id, cid, json.dumps(details)))
                event_id = execution_trace.start(db, cid, turn_id, 'tool', 'query_database')
                execution_trace.finish(db, event_id, 'completed')
                interrupted_id = execution_trace.start(db, cid, turn_id, 'tool', 'list_database_schema')
                execution_trace.start(db, other_cid, turn_id, 'tool', 'other tool')

            reopened = AssistantService(path)
            events = reopened.conversation_trace(cid)['events']
            by_id = {event['id']: event for event in events}
            self.assertEqual(len(events), 5)
            self.assertEqual(by_id[event_id]['status'], 'completed')
            self.assertEqual(by_id[interrupted_id]['status'], 'interrupted')
            self.assertEqual(by_id[f'{turn_id}:approval:0']['status'], 'approved')
            self.assertEqual(by_id[f'{turn_id}:usage']['usage']['cached_input_tokens'], 4)
            self.assertNotIn('private', json.dumps(events))
            self.assertNotIn('other tool', json.dumps(events))


if __name__ == '__main__':
    unittest.main()
