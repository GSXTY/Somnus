
"""Parallel group tasks keep independent state and completed conversation history."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService, Config


class GroupConversationTests(unittest.TestCase):
    def test_parallel_member_turns_preserve_context_ownership_and_cancel_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = AssistantService(root / 'assistant.sqlite3', Config('', '', ''))
            workspace = service.create_workspace('测试项目')
            project = root / 'project'
            project.mkdir()
            (project / 'notes.txt').write_text('synthetic project note', encoding='utf-8')
            service.update_workspace(workspace['id'], {'root_path': str(project)})
            cid = service.create('并行测试', workspace['id'])['id']
            codex = 'c2b9600e-3dc6-4c38-92b9-8506e5ae64c3'
            dsh = '1f86b1d1-737b-42cc-9378-c9f4845ddca8'
            service.set_conversation_agent(cid, codex, True)
            service.set_conversation_agent(cid, dsh, True)

            app = FastAPI()
            app.state.session_mode = 'shared'
            app.state.assistant_service = service
            token = 'c' * 64
            with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': token, 'SHARE_MODE': '0'}), \
                    patch('ai_assistant.project_access.sys.platform', 'win32'):
                app.include_router(create_router())
            with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 45001), headers={
                'X-Data-Agent-Native': token, 'X-Data-Agent-Local': '1',
            }) as client:
                base = f'/api/assistant/conversations/{cid}'
                turns = base + '/external-turns'

                def reserve(agent_id, name, content, **overrides):
                    return client.post(turns, json=dict({
                        'agent_id': agent_id, 'agent_name': name, 'content': content,
                        'member_only': True, 'group_parallel': True,
                    }, **overrides))

                first = reserve(codex, 'Codex', '第一个任务')
                second = reserve(dsh, 'DSH', '第二个任务')
                self.assertEqual((first.status_code, second.status_code), (201, 201))
                a, b = first.json()['turn_id'], second.json()['turn_id']
                self.assertNotEqual(a, b)
                self.assertEqual(second.json()['user_message']['reply_meta']['group_turn_id'], b)
                self.assertEqual(second.json()['user_message']['reply_meta']['provider_name'], 'DSH')
                self.assertTrue(client.get(base).json()['conversation']['running'])
                self.assertEqual(reserve(codex, 'Codex', '重复任务').status_code, 409)
                self.assertEqual(reserve(dsh, 'DSH', '串行任务', group_parallel=False).status_code, 409)
                self.assertEqual(client.post(base + '/permission', json={'mode': 'workspace_write'}).status_code, 409)
                self.assertEqual(client.post(base + '/organize', json={'archived': True}).status_code, 409)
                self.assertEqual(client.post(base + '/agent-members', json={'agent_id': codex, 'added': False}).status_code, 409)

                self.assertEqual(client.post(f'{turns}/{a}/prepare', json={'agent_id': dsh}).status_code, 409)
                for turn_id, agent_id in ((a, codex), (b, dsh)):
                    read = client.post(f'{turns}/{turn_id}/project-file', json={
                        'agent_id': agent_id, 'action': 'read', 'source': 'source_1', 'path': 'notes.txt',
                    })
                    self.assertEqual(read.status_code, 200)
                    self.assertEqual(read.json()['content'], 'synthetic project note')
                self.assertEqual(client.post(f'{turns}/{b}/cancel', json={'agent_id': codex}).status_code, 409)
                self.assertEqual(client.post(f'{turns}/{a}/finish', json={
                    'content': 'Codex 完成', 'status': 'complete',
                }).status_code, 200)
                current = client.get(base).json()
                self.assertTrue(current['conversation']['running'])
                self.assertEqual([row['status'] for row in current['messages'] if row['role'] == 'assistant'],
                                 ['complete', 'streaming'])
                prepared = client.post(f'{turns}/{b}/prepare', json={'agent_id': dsh})
                self.assertEqual(prepared.status_code, 200)
                self.assertEqual(prepared.json()['history'], [])
                self.assertIsNone(prepared.json()['history_predecessor'])

                third = reserve(codex, 'Codex', '第三个任务')
                self.assertEqual(third.status_code, 201)
                c = third.json()['turn_id']
                prepared = client.post(f'{turns}/{c}/prepare', json={'agent_id': codex}).json()
                self.assertEqual([message['content'] for message in prepared['history']],
                                 ['第一个任务', 'Codex 完成'])
                result = client.post(f'{turns}/{b}/cancel', json={'agent_id': dsh}).json()
                self.assertTrue(result['cancelled'])
                self.assertEqual(result['message']['status'], 'cancelled')
                self.assertTrue(result['conversation']['running'])
                self.assertEqual(client.post(f'{turns}/{c}/finish', json={
                    'content': 'Codex 第二条完成', 'status': 'complete',
                }).status_code, 200)
                self.assertFalse(client.get(base).json()['conversation']['running'])
                self.assertEqual(client.post(base + '/permission', json={'mode': 'workspace_write'}).status_code, 200)


if __name__ == '__main__':
    unittest.main()

