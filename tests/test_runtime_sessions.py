import json
from pathlib import Path
import tempfile
import unittest
from ai_assistant.service import AssistantService, Config
from ai_assistant.runtime_tasks import TaskError
from ai_assistant.permissions import READ_ONLY

AGENT='11111111-1111-4111-8111-111111111111'
OWNER='native_owner_synthetic_12345'


class NativeSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'assistant.sqlite3'
        self.service=AssistantService(self.path,Config('http://synthetic.invalid/v1','synthetic','synthetic-key'))
        self.root=Path(self.temp.name)/'project'; self.root.mkdir()
        self.wid=self.service.create_workspace('Synthetic project',str(self.root))['id']
        self.cid=self.service.create(workspace=self.wid)['id']
        self.tid=self.service.begin_external_turn(self.cid,'Synthetic question',AGENT,'Somnus')['turn_id']
        with self.service.db() as db:
            db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(self.tid,))
            db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(self.tid,))
        self.receipt=self.service.publish_runtime_task(self.cid,self.tid,dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))['finish_receipt']

    def bind(self,**extra):
        return self.service.bind_native_session(self.cid,dict(turn_id=self.tid,owner_id=OWNER,session_id='session-synthetic-parent',start_seq=4,last_seq=20,assistant_event_seq=19,**extra))

    def finish(self):
        self.service.finish_runtime_task(self.cid,self.tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=self.receipt,status='complete',content='Synthetic answer'))

    def test_binding_is_owned_scoped_monotonic_and_persistent(self):
        self.bind()
        view=self.service.native_history_authorize(self.cid,{'turn_id':self.tid})
        self.assertEqual((view['start_seq'],view['last_seq'],view['assistant_event_seq']),(4,20,19))
        self.assertEqual(view['runtime_session_id'],'session-synthetic-parent')
        wrong=dict(turn_id=self.tid,owner_id='wrong-owner',session_id='session-other',last_seq=20)
        with self.assertRaises(TaskError): self.service.bind_native_session(self.cid,wrong)
        with self.assertRaises(TaskError): self.service.native_history_authorize(self.service.create()['id'],{'turn_id':self.tid})
        self.finish()
        restarted=AssistantService(self.path,self.service.config)
        self.assertEqual(restarted.native_history_authorize(self.cid,{'turn_id':self.tid})['runtime_session_id'],'session-synthetic-parent')

    def test_fork_reserve_commit_is_atomic_idempotent_and_has_no_old_authorization(self):
        self.bind(); self.finish()
        reserve=self.service.reserve_native_fork(self.cid,{'turn_id':self.tid,'at_seq':19})
        child=reserve['conversation_id']
        with self.assertRaises(Exception): self.service.get(child)
        body=dict(session_id='session-synthetic-fork',source_session_id=reserve['source_session_id'],at_seq=19)
        result=self.service.commit_native_fork(reserve['reservation_id'],body)
        self.assertEqual(result['conversation']['id'],child)
        self.assertEqual(result['conversation']['permission_mode'],READ_ONLY)
        self.assertFalse(self.service._conversation_active(child))
        self.assertEqual(self.service.commit_native_fork(reserve['reservation_id'],body),result)
        self.assertEqual(self.service.native_session_mapping(child,AGENT)['runtime_session_id'],'session-synthetic-fork')
        self.assertEqual([m['content'] for m in self.service.get(child)['messages']],['Synthetic question','Synthetic answer'])
        with self.assertRaises(TaskError): self.service.commit_native_fork(reserve['reservation_id'],dict(body,session_id='different-fork'))
        new=self.service.begin_external_turn(child,'Continue explicitly',AGENT,'Somnus')
        prepared=self.service.prepare_external_turn(child,new['turn_id'],AGENT)
        self.assertEqual(prepared['runtime_session_id'],'session-synthetic-fork')
        self.assertEqual(prepared['permission_mode'],READ_ONLY)

    def test_abort_or_failed_commit_leaves_no_visible_conversation(self):
        self.bind(); self.finish()
        with self.assertRaises(TaskError): self.service.reserve_native_fork(self.cid,{'turn_id':self.tid,'at_seq':18})
        reserve=self.service.reserve_native_fork(self.cid,{'turn_id':self.tid,'at_seq':19})
        self.service.abort_native_fork(reserve['reservation_id'],{})
        with self.assertRaises(TaskError): self.service.commit_native_fork(reserve['reservation_id'],dict(session_id='session-child',source_session_id=reserve['source_session_id'],at_seq=19))
        with self.service.db() as db:
            self.assertIsNone(db.execute('SELECT id FROM conversations WHERE id=?',(reserve['conversation_id'],)).fetchone())

    def test_default_local_lineage_is_preserved_without_arbitrary_paths(self):
        local=self.service.create()['id']
        tid=self.service.begin_external_turn(local,'Local synthetic',AGENT,'Somnus')['turn_id']
        with self.service.db() as db:
            db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(tid,))
            db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(tid,))
        receipt=self.service.publish_runtime_task(local,tid,dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))['finish_receipt']
        self.service.bind_native_session(local,dict(turn_id=tid,owner_id=OWNER,session_id='session-local-parent',start_seq=0,last_seq=6,assistant_event_seq=5))
        self.service.finish_runtime_task(local,tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,status='complete',content='Local answer'))
        reserve=self.service.reserve_native_fork(local,dict(turn_id=tid,at_seq=5))
        result=self.service.commit_native_fork(reserve['reservation_id'],dict(session_id='session-local-child',source_session_id='session-local-parent',at_seq=5))
        self.assertEqual(result['local_origin_cid'],local)
        self.assertEqual(self.service.native_session_mapping(result['conversation']['id'],AGENT)['local_origin_cid'],local)
        self.assertEqual(result['continuation']['agentId'],AGENT)

    def test_fork_transaction_rolls_back_on_mapping_insert_failure(self):
        self.bind();self.finish()
        reserve=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=19))
        with self.service.db() as db:
            db.execute("CREATE TRIGGER reject_fork_mapping BEFORE INSERT ON native_sessions WHEN new.session_id='session-failure' BEGIN SELECT RAISE(ABORT,'synthetic transaction failure'); END")
        with self.assertRaises(Exception):
            self.service.commit_native_fork(reserve['reservation_id'],dict(session_id='session-failure',source_session_id=reserve['source_session_id'],at_seq=19))
        with self.service.db() as db:
            self.assertIsNone(db.execute('SELECT id FROM conversations WHERE id=?',(reserve['conversation_id'],)).fetchone())
            self.assertEqual(db.execute('SELECT state FROM native_fork_reservations WHERE id=?',(reserve['reservation_id'],)).fetchone()['state'],'reserved')

    def test_finish_history_is_atomic_and_late_metadata_never_replays(self):
        self.bind()
        history=dict(session_id='session-synthetic-parent',start_seq=4,last_seq=25,assistant_event_seq=19,
                     children=[dict(session_id='session-child',parent_session_id='session-synthetic-parent',source_seq=1,last_seq=8)])
        body=dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=self.receipt,status='complete',content='Answer with reliable history',native_history=history)
        result=self.service.finish_runtime_task(self.cid,self.tid,body)
        authorized=self.service.native_history_authorize(self.cid,dict(turn_id=self.tid,child_session_id='session-child'))
        self.assertEqual(authorized['last_seq'],25)
        self.assertFalse(authorized['can_stop'])
        self.assertEqual(len(authorized['children']),1)
        with self.service.db() as db: db.execute("UPDATE conversations SET agent_mode='creator' WHERE id=?",(self.cid,))
        childfork=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=7,child_session_id='session-child'))
        forked=self.service.commit_native_fork(childfork['reservation_id'],dict(session_id='session-child-fork',source_session_id='session-child',at_seq=7,display_history=[dict(role='user',content='Actual child prompt'),dict(role='assistant',content='Actual child reply')]))
        self.assertEqual([m['content'] for m in self.service.get(forked['conversation']['id'])['messages']],['Actual child prompt','Actual child reply'])
        self.assertIsNone(forked['conversation']['agent_mode'])
        self.assertEqual(self.service.get(self.cid)['conversation']['agent_mode'],'creator')
        with self.assertRaises(TaskError):self.service.native_history_authorize(self.cid,dict(turn_id=self.tid,child_session_id='foreign-child'))
        self.assertEqual(self.service.finish_runtime_task(self.cid,self.tid,body)['message'],result['message'])

    def test_invalid_final_history_rolls_back_message_and_task(self):
        self.bind()
        body=dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=self.receipt,status='complete',content='Do not store',native_history=dict(session_id='different-session',start_seq=4,last_seq=20))
        with self.assertRaises(TaskError):self.service.finish_runtime_task(self.cid,self.tid,body)
        self.assertEqual(self.service.get(self.cid)['messages'][-1]['status'],'streaming')
        self.assertEqual(self.service.runtime_task_snapshot(self.cid)['tasks'][0]['status'],'running')

    def test_historical_fork_uses_selected_turn_route_not_latest_provider(self):
        _,_,context=self.service._turn_entry(self.cid,self.tid)
        context['provider_model_id']='route-first'
        self.bind();self.finish()
        newer=self.service.begin_external_turn(self.cid,'Newer request',AGENT,'Somnus')['turn_id']
        with self.service.db() as db:
            db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(newer,))
            db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(newer,))
        receipt=self.service.publish_runtime_task(self.cid,newer,dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))['finish_receipt']
        _,_,context=self.service._turn_entry(self.cid,newer);context['provider_model_id']='route-second'
        self.service.bind_native_session(self.cid,dict(turn_id=newer,owner_id=OWNER,session_id='session-synthetic-parent',start_seq=21,last_seq=30,assistant_event_seq=29))
        self.service.finish_runtime_task(self.cid,newer,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,status='complete',content='Newer answer'))
        reservation=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=19))
        result=self.service.commit_native_fork(reservation['reservation_id'],dict(session_id='session-historical-fork',source_session_id='session-synthetic-parent',at_seq=19))
        self.assertEqual(result['continuation']['providerModelId'],'route-first')

    def test_scope_rotation_preserves_history_and_late_owner_cannot_restore_old_head(self):
        self.bind();self.finish()
        original_scope=self.service.native_session_mapping(self.cid,AGENT)['runtime_session_id']
        self.service.update_workspace(self.wid,{'name':'Renamed project','pinned':True})
        (self.root/'changed.txt').write_text('Normal user file change',encoding='utf-8')
        self.assertEqual(self.service.native_session_mapping(self.cid,AGENT)['runtime_session_id'],original_scope)
        newer_root=Path(self.temp.name)/'second-root';newer_root.mkdir()
        self.service.update_workspace(self.wid,{'root_path':str(newer_root)})
        self.assertIsNone(self.service.native_session_mapping(self.cid,AGENT)['runtime_session_id'])
        with self.assertRaises(TaskError):self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=19))
        message_only=self.service.branch(self.cid,self.tid)
        self.assertTrue(message_only['id'])
        new=self.service.begin_external_turn(self.cid,'Explicit new scope',AGENT,'Somnus')['turn_id']
        with self.service.db() as db:
            db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(new,))
            db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(new,))
        claim=self.service.publish_runtime_task(self.cid,new,dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))
        self.service.bind_native_session(self.cid,dict(turn_id=new,owner_id=OWNER,session_id='session-new-scope',start_seq=0,last_seq=8,assistant_event_seq=7))
        self.service.finish_runtime_task(self.cid,new,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=claim['finish_receipt'],status='complete',content='New scope answer'))
        self.service.finish_runtime_task(self.cid,self.tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=self.receipt,status='complete',content='Cannot replace original',native_history=dict(session_id='session-synthetic-parent',start_seq=4,last_seq=21,assistant_event_seq=19)))
        self.assertEqual(self.service.native_session_mapping(self.cid,AGENT)['runtime_session_id'],'session-new-scope')
        with self.service.db() as db:
            self.assertEqual(db.execute('SELECT last_seq FROM native_turn_history WHERE turn_id=?',(self.tid,)).fetchone()['last_seq'],21)
        self.service.update_workspace(self.wid,{'root_path':str(self.root)})
        self.assertIsNone(self.service.native_session_mapping(self.cid,AGENT)['runtime_session_id'])
        restored=self.service.begin_external_turn(self.cid,'Explicit return',AGENT,'Somnus')['turn_id']
        with self.service.db() as db:db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(restored,))
        self.service.publish_runtime_task(self.cid,restored,dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))
        self.service.bind_native_session(self.cid,dict(turn_id=restored,owner_id=OWNER,session_id='session-synthetic-parent',start_seq=22,last_seq=30,assistant_event_seq=29))
        self.assertEqual(self.service.native_session_mapping(self.cid,AGENT)['runtime_session_id'],'session-synthetic-parent')
        self.assertEqual(self.service.permission(self.cid),READ_ONLY)

    def test_child_session_ownership_survives_head_rotation_and_restart(self):
        self.bind()
        self.service.bind_native_session(self.cid,dict(turn_id=self.tid,owner_id=OWNER,session_id='session-synthetic-parent',start_seq=4,last_seq=20,assistant_event_seq=19,children=[dict(session_id='session-owned-child',parent_session_id='session-synthetic-parent',source_seq=0,last_seq=4)]))
        self.finish()
        restarted=AssistantService(self.path,self.service.config)
        other=restarted.create(workspace=self.wid)['id']
        turn=restarted.begin_external_turn(other,'Other task',AGENT,'Somnus')['turn_id']
        with restarted.db() as db:db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(turn,))
        restarted.publish_runtime_task(other,turn,dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))
        with self.assertRaises(TaskError):restarted.bind_native_session(other,dict(turn_id=turn,owner_id=OWNER,session_id='session-owned-child',start_seq=0,last_seq=4))
