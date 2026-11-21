import hmac
import os
from pathlib import Path
import tempfile
from threading import Event
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantError, AssistantService, Config, NATIVE_DSH_TRANSPORT


class AgentModesTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'assistant.sqlite3'
        self.config = Config('https://synthetic.invalid/v1', 'synthetic-model', 'synthetic-key')
        self.service = AssistantService(self.path, self.config)
        self.cid = self.service.create()['id']

    def message(self, cid, *, transport='acp', mid='a' * 32):
        with self.service.db() as db:
            db.execute('''INSERT INTO messages(id,conversation_id,role,content,status,created_at,attachments,transport)
                          VALUES(?,?,'assistant','synthetic reply','complete',1,'[]',?)''', (mid, cid, transport))

    def test_mode_is_nullable_persistent_and_independent_of_permissions(self):
        self.assertIsNone(self.service.get(self.cid)['conversation']['agent_mode'])
        self.assertEqual(self.service.agent_mode(self.cid), dict(conversation_id=self.cid, agent_mode=None, locked=False))
        self.service.set_permission(self.cid, 'workspace_direct')
        self.service.set_agent_mode(self.cid, 'ptc')
        reloaded = AssistantService(self.path, self.config)
        self.assertEqual(reloaded.get(self.cid)['conversation']['agent_mode'], 'ptc')
        self.assertEqual(reloaded.permission(self.cid), 'workspace_direct')
        self.assertEqual(reloaded.conversations()[0]['agent_mode'], 'ptc')
        self.assertEqual(reloaded.session_index()['conversations'][0]['agent_mode'], 'ptc')
        reloaded.set_agent_mode(self.cid, None)
        self.assertIsNone(reloaded.agent_mode(self.cid)['agent_mode'])

    def test_native_history_locks_legacy_mode_but_external_history_does_not(self):
        self.message(self.cid)
        self.service.set_agent_mode(self.cid, 'minimal')
        self.message(self.cid, transport=NATIVE_DSH_TRANSPORT, mid='b' * 32)
        self.assertTrue(self.service.agent_mode(self.cid)['locked'])
        with self.assertRaises(AssistantError) as caught:
            self.service.set_agent_mode(self.cid, 'creator')
        self.assertEqual(caught.exception.code, 'agent_mode_locked')
        self.assertEqual(self.service.set_agent_mode(self.cid, 'minimal')['agent_mode'], 'minimal')
        legacy = self.service.create()['id']
        self.message(legacy, transport=NATIVE_DSH_TRANSPORT, mid='c' * 32)
        self.assertIsNone(self.service.agent_mode(legacy)['agent_mode'])
        self.assertTrue(self.service.agent_mode(legacy)['locked'])
        self.assertEqual(len(self.service.get(self.cid)['messages']), 2)

    def test_busy_archived_and_invalid_selections_never_replace_mode(self):
        self.service.set_agent_mode(self.cid, 'standard')
        for field in ('active', 'mcp_approvals', 'delegations'):
            pending = getattr(self.service, field)
            pending[self.cid] = Event() if field == 'active' else {}
            try:
                with self.assertRaises(AssistantError):
                    self.service.set_agent_mode(self.cid, 'ptc')
            finally:
                pending.pop(self.cid)
        with self.service.db() as db:
            db.execute('UPDATE conversations SET archived=1 WHERE id=?', (self.cid,))
        self.assertTrue(self.service.agent_mode(self.cid)['locked'])
        with self.assertRaises(AssistantError):
            self.service.set_agent_mode(self.cid, 'ptc')
        for value in ('', ' x', 'x\n', '../x', [], 1, True, 'a' * 129):
            with self.subTest(value=value), self.assertRaises(AssistantError):
                self.service.create(agent_mode=value)
        self.assertEqual(self.service.get(self.cid)['conversation']['agent_mode'], 'standard')
        with self.assertRaises(AssistantError) as caught:
            self.service.agent_mode('0' * 32)
        self.assertEqual(caught.exception.status, 404)

    def test_prepare_projects_mode_and_branch_keeps_selected_mode(self):
        self.service.set_agent_mode(self.cid, 'ptc')
        agent = '21922344-de22-4c5f-87f5-8b58633c37a9'
        started = self.service.begin_external_turn(self.cid, 'synthetic task', agent, 'Codex', 'synthetic-model')
        prepared = self.service.prepare_external_turn(self.cid, started['turn_id'], agent)
        self.assertEqual(prepared['agent_mode'], 'ptc')
        self.service.finish_external_turn(self.cid, started['turn_id'], 'synthetic reply', 'complete')
        branch = self.service.branch(self.cid, started['turn_id'])
        self.assertEqual(branch['agent_mode'], 'ptc')
        self.assertEqual(len(self.service.get(self.cid)['messages']), 2)

    def test_old_database_migrates_repeatedly_without_relabeling_history(self):
        self.message(self.cid, transport=NATIVE_DSH_TRANSPORT)
        with self.service.db() as db:
            db.execute('ALTER TABLE conversations DROP COLUMN agent_mode')
        for _ in range(2):
            service = AssistantService(self.path, self.config)
            loaded = service.get(self.cid)
            self.assertIsNone(loaded['conversation']['agent_mode'])
            self.assertEqual(loaded['messages'][0]['content'], 'synthetic reply')
            self.assertTrue(service.agent_mode(self.cid)['locked'])

    def test_pending_proposals_prevent_changes_without_touching_files(self):
        with self.service.db() as db:
            db.execute("""INSERT INTO project_file_proposals
                (id,conversation_id,workspace_id,root_path,root_identity,path,file_identity,original_hash,
                 old_content,new_content,status,created_at)
                VALUES('fixture',?,'fixture','fixture','fixture','hello.c','fixture','fixture','','synthetic','pending',1)""",
                (self.cid,))
        self.assertTrue(self.service.agent_mode(self.cid)['locked'])
        with self.assertRaises(AssistantError):
            self.service.set_agent_mode(self.cid, 'ptc')
        self.assertIsNone(self.service.get(self.cid)['conversation']['agent_mode'])

    def test_native_api_protects_changes_and_validates_body(self):
        app = FastAPI()
        app.state.assistant_service = self.service
        app.state.session_mode = 'shared'
        token = 'b' * 64
        with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': token, 'SHARE_MODE': ''}), \
                patch('ai_assistant.project_access.sys.platform', 'win32'):
            app.include_router(create_router())
        origin = 'http://127.0.0.1:9876'
        cookie = hmac.digest(token.encode(), b'vvman-project-browser-session', 'sha256').hex()
        desktop = {'origin': origin, 'cookie': 'respiratory_desktop=' + cookie}
        native = {'X-Data-Agent-Native': token}
        with TestClient(app, base_url=origin, client=('127.0.0.1', 30000)) as client:
            endpoint = '/api/assistant/conversations/' + self.cid + '/agent-mode'
            self.assertEqual(client.post(endpoint, json={'agent_mode': 'ptc'}, headers=desktop).status_code, 403)
            self.assertEqual(client.get(endpoint, headers=native).json()['agent_mode'], None)
            self.assertEqual(client.post(endpoint, json={'agent_mode': 'ptc'}, headers=native).json()['agent_mode'], 'ptc')
            self.assertEqual(client.post(endpoint, json={'agent_mode': 'minimal', 'permission_mode': 'full'}, headers=native).status_code, 400)
            self.assertEqual(client.post('/api/assistant/conversations', json={'agent_mode': 'ptc'}, headers=desktop).status_code, 403)
            created = client.post('/api/assistant/conversations', json={'agent_mode': 'minimal'}, headers=native)
            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.json()['conversation']['agent_mode'], 'minimal')


if __name__ == '__main__':
    unittest.main()
