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
