import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from event_detection.event_store import EventStore, LocalSqliteStore


class RecordListTests(unittest.TestCase):
    def test_opened_record_survives_restart(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'events.sqlite3'
            store = EventStore(path)
            store.remember_record(dict(file_id='a' * 64, name='one.csv', raw_duration=120.5, rows=1205))
            reopened = EventStore(path).records()
            self.assertEqual(len(reopened), 1)
            item = reopened[0]
            self.assertEqual(item['id'], 'a' * 64)
            self.assertEqual(item['name'], 'one.csv')
            self.assertEqual(item['duration_seconds'], 120.5)
            self.assertEqual(item['sample_count'], 1205)
            self.assertEqual(item['scan_count'], 0)
            self.assertEqual(item['candidate_count'], 0)

    def test_reopen_updates_name_without_duplicating(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'events.sqlite3'
            store = EventStore(path)
            store.remember_record(dict(file_id='b' * 64, name='old.csv', raw_duration=10, rows=100))
            store.remember_record(dict(file_id='b' * 64, name='new.csv', raw_duration=20, rows=200))
            rows = EventStore(path).records()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['name'], 'new.csv')
            self.assertEqual(rows[0]['duration_seconds'], 20)

    def test_legacy_database_backfills_names_from_scan_snapshots(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'events.sqlite3'
            store = EventStore(path)
            meta = dict(file_id='c' * 64, name='legacy.csv', raw_duration=60, rows=600, start=0, end=60,
                        display_duration=60, channels=['流量'], channel_units={'流量': 'L/min'})
            store.write(meta, 0, [], scan=dict(scan_start=0, scan_end=60,
                                              settings=dict(profile='engineering', version='test')))
            with closing(sqlite3.connect(path)) as db, db:
                db.execute('DELETE FROM record_meta')
            rows = LocalSqliteStore(path).records()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['name'], 'legacy.csv')
            self.assertEqual(rows[0]['scan_count'], 1)
            self.assertEqual(rows[0]['candidate_count'], 0)


if __name__ == '__main__':
    unittest.main()
