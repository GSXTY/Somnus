from tests.test_runtime_tasks_api import RuntimeTasksApiTests


class NativeSessionApiTests(RuntimeTasksApiTests):
    def test_native_fork_api_requires_proof_and_preserves_binding(self):
        owner='api_native_owner_synthetic_123'
        with self.service.db() as db:
            db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(self.turn,))
            db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(self.turn,))
        claim=self.client.post(self.path+'/state',headers=self.native,json=dict(agent_id=self.agent,owner_id=owner,sequence=1,status='running')).json()
        base=f'/api/assistant/conversations/{self.cid}'
        body=dict(turn_id=self.turn,owner_id=owner,session_id='session-api-parent',start_seq=1,last_seq=10,assistant_event_seq=9)
        self.assertEqual(self.client.post(base+'/native-sessions',headers=self.headers,json=body).status_code,403)
        bound=self.client.post(base+'/native-sessions',headers=self.native,json=body)
        self.assertEqual(bound.status_code,200,bound.text)
        authorized=self.client.post(base+'/native-history/authorize',headers=self.native,json={'turn_id':self.turn})
        self.assertEqual(authorized.status_code,200,authorized.text)
        self.assertEqual(authorized.json()['last_seq'],10)
        self.client.post(self.path+'/finish',headers=self.native,json=dict(agent_id=self.agent,owner_id=owner,finish_receipt=claim['finish_receipt'],status='complete',content='API native answer'))
        reserved=self.client.post(base+'/native-forks',headers=self.native,json={'turn_id':self.turn,'at_seq':9})
        self.assertEqual(reserved.status_code,200,reserved.text)
        value=reserved.json()
        committed=self.client.post('/api/assistant/native-forks/'+value['reservation_id']+'/commit',headers=self.native,json=dict(session_id='session-api-child',source_session_id='session-api-parent',at_seq=9))
        self.assertEqual(committed.status_code,200,committed.text)
        self.assertEqual(committed.json()['conversation']['permission_mode'],'read_only')
        mapped=self.client.get('/api/assistant/conversations/'+value['conversation_id']+'/native-sessions',params={'agent_id':self.agent},headers=self.native)
        self.assertEqual(mapped.json()['runtime_session_id'],'session-api-child')
