import json
import tempfile
import unittest
from pathlib import Path

from ai_assistant import execution_trace
from ai_assistant.service import AssistantService


class ExecutionTraceTests(unittest.TestCase):
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
