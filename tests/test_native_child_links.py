from pathlib import Path
import unittest
from ai_assistant.service import AssistantService
from ai_assistant.runtime_tasks import TaskError
from ai_assistant.native_child_links import child_step_id
from tests import test_runtime_sessions as session_fixtures
AGENT=session_fixtures.AGENT
OWNER=session_fixtures.OWNER


class ChildConversationLinksTests(unittest.TestCase):
    setUp=session_fixtures.NativeSessionTests.setUp
    bind=session_fixtures.NativeSessionTests.bind
    finish=session_fixtures.NativeSessionTests.finish

    def source(self):
        _,_,context=self.service._turn_entry(self.cid,self.tid)
        context['provider_model_id']='m_original_route'
        self.bind(children=[dict(session_id='session-child',parent_session_id='session-synthetic-parent',source_seq=0,last_seq=8)])
        self.finish()
        return child_step_id('session-child')

    def fork(self):
        reserve=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=7,child_session_id='session-child'))
        result=self.service.commit_native_fork(reserve['reservation_id'],dict(session_id='session-real-child-fork',source_session_id='session-child',at_seq=7,display_history=[dict(role='assistant',content='Actual child output')]))
        return result['conversation']['id']

    def test_durable_lookup_uses_proven_fork_and_original_route_not_browser_storage(self):
        child=self.source()
        self.assertEqual(self.service.native_child_conversation(self.cid,self.tid,child)['status'],'none')
        target=self.fork()
        result=self.service.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(result['status'],'linked');self.assertEqual(result['conversation_id'],target)
        self.assertTrue(result['can_send']);self.assertEqual(result['continuation']['providerModelId'],'m_original_route')
        restarted=AssistantService(self.path,self.service.config)
        restored=restarted.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(restored['conversation_id'],target)
        self.assertEqual(restored['continuation'],result['continuation'])
        with restarted.db() as db:
            before=db.execute('SELECT count(*) FROM conversations').fetchone()[0]
        reused=restarted.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=7,child_session_id='session-child'))
        self.assertTrue(reused['existing']);self.assertEqual(reused['conversation_id'],target)
        with restarted.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM conversations').fetchone()[0],before)

    def test_pending_reservation_blocks_double_fork_without_creating_a_conversation(self):
        child=self.source()
        reserved=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=7,child_session_id='session-child'))
        self.assertEqual(self.service.native_child_conversation(self.cid,self.tid,child)['status'],'pending')
        with self.assertRaises(TaskError) as raised:
            self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=7,child_session_id='session-child'))
        self.assertEqual(raised.exception.code,'native_child_fork_pending')
        self.service.abort_native_fork(reserved['reservation_id'],{})
        self.assertEqual(self.service.native_child_conversation(self.cid,self.tid,child)['status'],'none')

    def test_deleted_archived_and_scope_changes_are_explicit_never_recreate(self):
        child=self.source();target=self.fork()
        self.service.organize_conversation(target,{'archived':True})
        result=self.service.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(result['status'],'archived');self.assertFalse(result['can_send'])
        self.service.organize_conversation(target,{'archived':False})
        self.service.organize_conversation(self.cid,{'archived':True})
        self.assertEqual(self.service.native_child_conversation(self.cid,self.tid,child)['status'],'source_archived')
        self.service.organize_conversation(self.cid,{'archived':False})
        newroot=Path(self.temp.name)/'changed-root';newroot.mkdir()
        self.service.update_workspace(self.wid,{'root_path':str(newroot)})
        result=self.service.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(result['status'],'source_scope_changed');self.assertEqual(result['conversation_id'],target)
        with self.assertRaises(TaskError):self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=7,child_session_id='session-child'))
        self.service.update_workspace(self.wid,{'root_path':str(self.root)})
        self.service.delete(target)
        result=self.service.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(result['status'],'deleted');self.assertFalse(result['can_open']);self.assertFalse(result['can_send'])
        with self.service.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM messages WHERE conversation_id=?',(target,)).fetchone()[0],1)

    def test_forged_target_or_other_parent_never_becomes_an_association(self):
        child=self.source();target=self.fork();other=self.service.create()['id']
        with self.assertRaises(TaskError):self.service.native_child_conversation(other,self.tid,child)
        with self.assertRaises(TaskError):self.service.native_child_conversation(self.cid,self.tid,other)
        with self.service.db() as db:db.execute('UPDATE native_session_owners SET conversation_id=? WHERE session_id=?',(other,'session-real-child-fork'))
        result=self.service.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(result['status'],'unverified');self.assertNotIn('conversation_id',result)

    def test_root_message_forks_remain_independent_not_child_links(self):
        self.source()
        first=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=19))
        second=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=19))
        self.assertNotEqual(first['reservation_id'],second['reservation_id'])
        self.assertEqual(self.service.native_child_conversation(self.cid,self.tid,'session-child')['status'],'none')

    def test_target_scope_or_deleted_source_never_falls_back_to_another_branch(self):
        child=self.source();target=self.fork()
        alternate=Path(self.temp.name)/'target-project';alternate.mkdir()
        wid=self.service.create_workspace('Target moved project',str(alternate))['id']
        with self.service.db() as db:db.execute('UPDATE conversations SET workspace_id=? WHERE id=?',(wid,target))
        result=self.service.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(result['status'],'target_scope_changed');self.assertEqual(result['conversation_id'],target)
        self.assertTrue(result['can_open']);self.assertFalse(result['can_send'])
        self.service.delete(self.cid)
        result=self.service.native_child_conversation(self.cid,self.tid,child)
        self.assertEqual(result['status'],'source_deleted');self.assertEqual(result['conversation_id'],target)
        self.assertEqual(self.service.get(target)['messages'][0]['content'],'Actual child output')
