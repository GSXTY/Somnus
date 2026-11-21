import unittest
from pathlib import Path
from ai_assistant.service import AssistantService
from ai_assistant.native_child_links import child_step_id
from tests import test_runtime_tasks_api as api_fixtures
from fastapi.testclient import TestClient


class ChildConversationLinkApiTests(unittest.TestCase):
    setUp=api_fixtures.RuntimeTasksApiTests.setUp
    def test_native_read_only_lookup_survives_origin_and_backend_restart(self):
        owner='child_link_api_owner_synthetic'
        with self.service.db() as db:
            db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(self.turn,))
            db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(self.turn,))
        claim=self.client.post(self.path+'/state',headers=self.native,json=dict(agent_id=self.agent,owner_id=owner,sequence=1,status='running')).json()
        base='/api/assistant/conversations/'+self.cid
        bound=self.client.post(base+'/native-sessions',headers=self.native,json=dict(turn_id=self.turn,owner_id=owner,session_id='session-api-parent',start_seq=0,last_seq=10,assistant_event_seq=9,children=[dict(session_id='session-api-child',parent_session_id='session-api-parent',source_seq=0,last_seq=6)]))
        self.assertEqual(bound.status_code,200,bound.text)
        self.client.post(self.path+'/finish',headers=self.native,json=dict(agent_id=self.agent,owner_id=owner,finish_receipt=claim['finish_receipt'],content='Synthetic answer',status='complete'))
        params=dict(turn_id=self.turn,child_id=child_step_id('session-api-child'))
        url=base+'/child-conversations'
        self.assertEqual(self.client.get(url,params=params,headers=self.headers).status_code,403)
        self.assertEqual(self.client.get(url,params=params,headers=self.native).json()['status'],'none')
        reserved=self.client.post(base+'/native-forks',headers=self.native,json=dict(turn_id=self.turn,at_seq=5,child_session_id='session-api-child')).json()
        committed=self.client.post('/api/assistant/native-forks/'+reserved['reservation_id']+'/commit',headers=self.native,json=dict(session_id='session-api-child-fork',source_session_id='session-api-child',at_seq=5,display_history=[]))
        self.assertEqual(committed.status_code,200,committed.text)
        target=committed.json()['conversation']['id']
        self.client.app.state.assistant_service=AssistantService(Path(self.temp.name)/'assistant.sqlite3',self.service.config)
        self.assertEqual(self.client.get(url,params=params,headers={**self.native,'Origin':'http://untrusted.invalid'}).status_code,403)
        other_origin=TestClient(self.client.app,base_url='http://127.0.0.1:19877',client=('127.0.0.1',30001));self.addCleanup(other_origin.close)
        result=other_origin.get(url,params=params,headers=self.native)
        self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['conversation_id'],target)
        self.assertEqual(self.client.put(url,headers=self.native,json=dict(turn_id=self.turn,child_id=params['child_id'],conversation_id='f'*32)).status_code,405)
