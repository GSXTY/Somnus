import unittest
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
import os
from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService
from tests import test_runtime_tasks_api as fixtures

class ForkHistoryApiTests(unittest.TestCase):
    setUp=fixtures.RuntimeTasksApiTests.setUp
    def test_staged_history_and_preferences_real_api_restart_and_foreign_profile(self):
        owner='archive_api_synthetic_owner'
        with self.service.db() as db:
            db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(self.turn,));db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(self.turn,))
        claim=self.client.post(self.path+'/state',headers=self.native,json=dict(agent_id=self.agent,owner_id=owner,sequence=1,status='running')).json()
        base='/api/assistant/conversations/'+self.cid
        self.client.post(base+'/native-sessions',headers=self.native,json=dict(turn_id=self.turn,owner_id=owner,session_id='session-api-root',start_seq=0,last_seq=10,assistant_event_seq=9,children=[dict(session_id='session-api-history-child',parent_session_id='session-api-root',source_seq=0,last_seq=7)]))
        self.client.post(self.path+'/finish',headers=self.native,json=dict(agent_id=self.agent,owner_id=owner,finish_receipt=claim['finish_receipt'],content='Synthetic answer',status='complete'))
        reserved=self.client.post(base+'/native-forks',headers=self.native,json=dict(turn_id=self.turn,at_seq=6,child_session_id='session-api-history-child')).json()
        rid=reserved['reservation_id'];pages='/api/assistant/native-forks/'+rid+'/history/pages'
        self.assertEqual(self.client.post(pages,headers=self.headers,json={}).status_code,403)
        data=dict(source_session_id='session-api-history-child',page_index=0,records=[dict(seq=1,role='user',content='Inherited 😀')],done=True)
        self.assertEqual(self.client.post(pages,headers=self.native,json=data).status_code,200)
        commit=self.client.post('/api/assistant/native-forks/'+rid+'/commit',headers=self.native,json=dict(session_id='session-api-history-fork',source_session_id='session-api-history-child',at_seq=6,history_archive=True))
        self.assertEqual(commit.status_code,200,commit.text);cid=commit.json()['conversation']['id']
        path='/api/assistant/conversations/'+cid+'/inherited-history'
        self.client.app.state.assistant_service=AssistantService(Path(self.temp.name)/'assistant.sqlite3',self.service.config)
        response=self.client.get(path,headers=self.native)
        self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['records'][0]['content'],'Inherited 😀')
        self.assertNotIn('root_path',response.json()['history']);self.assertNotIn('api_key',str(response.json()['history']))
        self.assertEqual(self.client.get(path,headers=self.headers).status_code,403)
        self.assertEqual(self.client.get(path,headers={'X-Data-Agent-Native':'foreign'}).status_code,403)
        self.assertEqual(self.client.get(path+'?after=%%%bad',headers=self.native).status_code,400)
        prefs='/api/assistant/conversations/'+cid+'/native-preferences'
        read=self.client.get(prefs,headers=self.native);self.assertEqual(read.json()['revision'],0)
        saved=self.client.put(prefs,headers=self.native,json=dict(revision=0,provider_model_id=None,skill_ids=[]))
        self.assertEqual(saved.status_code,200,saved.text);self.assertEqual(saved.json()['revision'],1)
