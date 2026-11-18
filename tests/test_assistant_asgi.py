import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService, Config

class AssistantASGITests(unittest.TestCase):
    def test_branch_copies_history_through_completed_reply_without_permissions_or_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            app = FastAPI()
            service = AssistantService(Path(directory) / 'assistant.sqlite3', Config('', '', ''))
            app.state.assistant_service = service
            app.include_router(create_router())
            workspace = service.create_workspace('分支测试')
            source = service.create('原会话', workspace['id'])['id']
            other = service.create('别的会话')['id']
            service.set_permission(source, 'workspace_write')
            rows = [
                ('1' * 32, source, 'user', '问题一', 'complete', '[{"name":"sample.png"}]', None),
                ('2' * 32, source, 'assistant', '回答一', 'complete', '[]',
                 '{"model":"test","elapsed_ms":12,"delegation":{"id":"action"},"recommendations":[{"id":"action"}]}'),
                ('3' * 32, source, 'user', '问题二', 'complete', '[]', None),
                ('4' * 32, source, 'assistant', '回答二', 'streaming', '[]', None),
                ('5' * 32, other, 'assistant', '不属于这个会话', 'complete', '[]', None),
            ]
            with service.db() as db:
                db.executemany('''INSERT INTO messages(id,conversation_id,role,content,status,attachments,reply_meta,created_at)
                                  VALUES(?,?,?,?,?,?,?,100)''', rows)
            with TestClient(app) as client:
                base = '/api/assistant/conversations'
                for disallowed in ('1' * 32, '4' * 32, '5' * 32):
                    self.assertEqual(client.post(f'{base}/{source}/branch', json={'message_id': disallowed}).status_code, 404)
                self.assertEqual(client.post(f'{base}/{source}/branch', json={'message_id': 'bad'}).status_code, 400)
                response = client.post(f'{base}/{source}/branch', json={'message_id': '2' * 32})
                self.assertEqual(response.status_code, 201)
                branch = response.json()['conversation']
                self.assertEqual(branch['title'], '原会话（分支）')
                self.assertEqual(branch['permission_mode'], 'read_only')
                self.assertEqual(branch['message_count'], 2)
                self.assertEqual({item['id'] for item in service.conversations(workspace['id'])}, {branch['id'], source})
                history = client.get(f"{base}/{branch['id']}").json()['messages']
                self.assertEqual([entry['content'] for entry in history], ['问题一', '回答一'])
                self.assertTrue(all(entry['id'] != original[0] for entry, original in zip(history, rows)))
                self.assertEqual(history[0]['attachments'], [{'name': 'sample.png'}])
                self.assertEqual(history[1]['reply_meta'], {'model': 'test', 'elapsed_ms': 12})
                self.assertEqual(len(client.get(f'{base}/{source}').json()['messages']), 4)

    def test_projects_keep_workspace_ids_and_existing_conversations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'assistant.sqlite3'
            service = AssistantService(path, Config('', '', ''))
            custom = service.create_workspace('研发项目')
            existing = service.create('既有会话', custom['id'])
            default = service.create('默认项目会话')
            app = FastAPI()
            app.state.assistant_service = AssistantService(path, Config('', '', ''))
            app.include_router(create_router())
            with TestClient(app) as client:
                base = '/api/assistant'
                projects = client.get(base + '/workspaces').json()['workspaces']
                self.assertEqual([(item['id'], item['name'], item['conversation_count']) for item in projects],
                                 [('default', '默认项目', 1), (custom['id'], '研发项目', 1)])
                for project, session in (('default', default), (custom['id'], existing)):
                    response = client.get(base + '/conversations', params={'workspace': project})
                    self.assertEqual(response.json()['conversations'], [session])

    def test_title_is_persisted_and_sent_in_start_event(self):
        class Upstream(io.BytesIO):
            headers = {'Content-Type': 'text/event-stream'}

        with tempfile.TemporaryDirectory() as directory:
            app = FastAPI()
            app.state.assistant_service = AssistantService(
                Path(directory) / 'assistant.sqlite3', Config('http://localhost/v1', 'fake', 'fake'))
            app.include_router(create_router())
            with TestClient(app) as client:
                base = '/api/assistant/conversations'
                self.assertEqual(client.post(base, json={'title': None}).status_code, 400)
                permissions = {}
                for payload, expected in (({}, '检查 趋势'), ({'title': '新会话'}, '新会话')):
                    with self.subTest(payload=payload):
                        created = client.post(base, json=payload).json()['conversation']
                        self.assertEqual(created['title'], '新会话')
                        self.assertEqual(created['permission_mode'], 'read_only')
                        path = f"{base}/{created['id']}"
                        mode = 'read_only' if payload else 'workspace_write'
                        if not payload:
                            changed = client.post(path + '/permission', json={'mode': mode})
                            self.assertEqual(changed.json()['permission_mode'], mode)
                        permissions[created['id']] = mode
                        upstream = Upstream(b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
                        with patch('ai_assistant.service.urlopen', return_value=upstream):
                            response = client.post(path + '/messages', json={'content': '检查\n趋势'})
                        self.assertEqual(response.status_code, 200)
                        event, data, *_ = response.text.splitlines()
                        self.assertEqual(event, 'event: start')
                        start = json.loads(data.removeprefix('data: '))['conversation']
                        self.assertEqual((start['title'], start['permission_mode']), (expected, mode))
                        history = client.get(path).json()['conversation']
                        self.assertEqual((history['title'], history['permission_mode']), (expected, mode))
                rows = client.get(base).json()['conversations']
                self.assertEqual({row['id']: row['permission_mode'] for row in rows}, permissions)

    def test_local_history_delete_and_unconfigured(self):
        with tempfile.TemporaryDirectory() as directory:
            app = FastAPI()
            app.state.assistant_service = AssistantService(Path(directory)/'assistant.sqlite3', Config('', '', ''))
            app.include_router(create_router())
            with TestClient(app) as client:
                self.assertFalse(client.get('/api/assistant/status').json()['configured'])
                cid = client.post('/api/assistant/conversations', json={'title':'ASGI'}).json()['conversation']['id']
                self.assertEqual(client.post(f'/api/assistant/conversations/{cid}/messages',json={'content':'test'}).status_code,503)
                self.assertEqual(client.get(f'/api/assistant/conversations/{cid}').json()['messages'],[])
                self.assertEqual(client.post(f'/api/assistant/conversations/{cid}/rename',json={'title':'renamed'}).json()['conversation']['title'],'renamed')
                self.assertTrue(client.post(f'/api/assistant/conversations/{cid}/delete',json={}).json()['deleted'])
                self.assertEqual(client.get(f'/api/assistant/conversations/{cid}').status_code,404)
                self.assertEqual(client.post('/api/assistant/conversations',content='[]').status_code,400)

    def test_streaming_and_provider_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            app = FastAPI()
            services = {key: AssistantService(Path(directory)/(key+'.sqlite3'),Config('http://localhost/v1','fake','fake')) for key in ('a','b')}
            app.state.assistant_service_for_request = lambda request: services[request.headers.get('x-test-owner','a')]
            app.include_router(create_router())
            service=services['a']
            def stream(cid,user,assistant,cancel):
                try:
                    yield 'start', {'user_message':user,'assistant_message':assistant.copy()}
                    assistant['content']='synthetic response'
                    assistant['status']='complete'
                    yield 'done', {'message':assistant.copy()}
                finally:
                    service.save(cid,assistant)
                    service.release(cid,cancel)
            service.stream=stream
            with TestClient(app) as client:
                cid=client.post('/api/assistant/conversations',json={}).json()['conversation']['id']
                self.assertEqual(client.get(f'/api/assistant/conversations/{cid}',headers={'x-test-owner':'b'}).status_code,404)
                response=client.post(f'/api/assistant/conversations/{cid}/messages',json={'content':'test'})
                self.assertIn('text/event-stream',response.headers['content-type'])
                self.assertIn('event: done',response.text)
                self.assertNotIn(cid,service.active)
                self.assertEqual(service.get(cid)['messages'][-1]['status'],'complete')

if __name__=='__main__': unittest.main()
