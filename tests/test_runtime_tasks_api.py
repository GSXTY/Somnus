from pathlib import Path
import hashlib,hmac,json,os,tempfile,unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService,Config

class RuntimeTasksApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        service=AssistantService(Path(self.temp.name)/'assistant.sqlite3',Config('http://synthetic.invalid/v1','synthetic','synthetic-key'))
        self.service=service;self.cid=service.create()['id'];self.agent='11111111-1111-4111-8111-111111111111'
        self.turn=service.begin_external_turn(self.cid,'Synthetic request',self.agent,'Synthetic agent')['turn_id']
        app=FastAPI();app.state.session_mode='shared';app.state.assistant_service=service
        token='b'*64
        with patch.dict(os.environ,{'RESPIRATORY_VIEWER_PROJECT_TOKEN':token,'SHARE_MODE':''}),patch('ai_assistant.project_access.sys.platform','win32'):
            app.include_router(create_router())
        origin='http://127.0.0.1:9876';cookie=hmac.digest(token.encode(),b'vvman-project-browser-session','sha256').hex()
        self.headers={'origin':origin,'cookie':'respiratory_desktop='+cookie};self.native={'X-Data-Agent-Native':token}
        self.client=TestClient(app,base_url=origin,client=('127.0.0.1',30000));self.addCleanup(self.client.close)
        self.path=f'/api/assistant/conversations/{self.cid}/runtime-tasks/{self.turn}'
    def test_native_mutation_scope_and_idempotent_owner_finish(self):
        body=dict(agent_id=self.agent,owner_id='api_owner_fixture_12345',sequence=1,status='connecting')
        self.assertEqual(self.client.post(self.path+'/state',headers=self.headers,json=body).status_code,403)
        response=self.client.post(self.path+'/state',headers=self.native,json=body);self.assertEqual(response.status_code,200,response.text);claim=response.json()
        view=self.client.get('/api/assistant/runtime-tasks',headers=self.headers).json();self.assertEqual(view['tasks'][0]['id'],self.turn);self.assertNotIn(claim['finish_receipt'],json.dumps(view))
        bad=self.client.post(self.path+'/state',headers=self.native,json={**body,'sequence':2,'status':'unknown_future_status'});self.assertEqual(bad.status_code,400)
        finish=dict(agent_id=self.agent,owner_id=body['owner_id'],finish_receipt=claim['finish_receipt'],status='complete',content='Synthetic result')
        result=self.client.post(self.path+'/finish',headers=self.native,json=finish);self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['task']['status'],'completed')
        result=self.client.post(self.path+'/finish',headers=self.native,json={**finish,'content':'do not overwrite'});self.assertEqual(result.json()['message']['content'],'Synthetic result')
        closed=self.client.post(self.path+'/state',headers=self.native,json={**body,'sequence':3});self.assertEqual(closed.status_code,409);self.assertEqual(closed.json()['error']['code'],'runtime_task_closed');self.assertIn('epoch',closed.json())
        self.assertEqual(self.client.get('/api/assistant/runtime-tasks?after=invalid',headers=self.headers).status_code,400)
        self.assertEqual(self.client.get('/api/assistant/runtime-tasks').status_code,403)
