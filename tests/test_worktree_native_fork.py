import hashlib,subprocess,tempfile,unittest
from pathlib import Path
from ai_assistant.service import AssistantService,Config
from ai_assistant.runtime_tasks import TaskError
from ai_assistant.permissions import READ_ONLY
AGENT='11111111-1111-4111-8111-111111111111';OWNER='worktree_owner_synthetic_12345'

class WorktreeNativeForkTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.home=Path(self.temp.name)
        self.base=self.home/'repo';self.base.mkdir();self.git('init');self.git('config','user.email','synthetic@example.invalid');self.git('config','user.name','Synthetic')
        (self.base/'tracked.txt').write_text('committed',encoding='utf-8');self.git('add','tracked.txt');self.git('commit','-m','synthetic')
        self.service=AssistantService(self.home/'assistant.sqlite3',Config('http://synthetic.invalid/v1','synthetic','synthetic-key'))
        self.wid=self.service.create_workspace('Git synthetic',str(self.base))['id'];self.cid=self.service.create(workspace=self.wid)['id']
        target=self.service.worktree_target(self.cid,'source_1');name=self.cid+'-'+'a'*16
        self.tree=Path(target['worktrees_path'])/name;self.tree.parent.mkdir()
        self.git('worktree','add','-b','vvman/'+name,str(self.tree))
        commit=self.git('rev-parse','HEAD').strip();self.service.bind_worktree(self.cid,'source_1',target['root_key'],str(self.tree),'vvman/'+name,commit)
        (self.tree/'tracked.txt').write_text('dirty change',encoding='utf-8');(self.tree/'untracked.txt').write_text('untracked 😀',encoding='utf-8')
        self.hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.tree.iterdir() if p.is_file()}
        self.tid=self.service.begin_external_turn(self.cid,'Synthetic worktree task',AGENT,'Somnus')['turn_id']
        with self.service.db() as db:db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(self.tid,))
        receipt=self.service.publish_runtime_task(self.cid,self.tid,dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))['finish_receipt']
        self.service.bind_native_session(self.cid,dict(turn_id=self.tid,owner_id=OWNER,session_id='session-worktree-parent',start_seq=0,last_seq=5,assistant_event_seq=4))
        self.service.finish_runtime_task(self.cid,self.tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,status='complete',content='Synthetic'))
    def git(self,*args):return subprocess.check_output(['git','-C',str(self.base),*args],stderr=subprocess.STDOUT,text=True)
    def test_explicit_shared_reference_preserves_dirty_tree_and_owner_lifetime(self):
        with self.assertRaises(TaskError):self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=4))
        reserved=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=4,worktree_policy='share-current'))
        result=self.service.commit_native_fork(reserved['reservation_id'],dict(session_id='session-worktree-fork',source_session_id='session-worktree-parent',at_seq=4))
        cid=result['conversation']['id'];info=result['conversation']['worktree']
        self.assertTrue(info['shared']);self.assertEqual(info['owner_conversation_id'],self.cid);self.assertEqual(result['conversation']['permission_mode'],READ_ONLY)
        with self.service.db() as db:self.assertEqual(self.service._conversation_roots(db,cid,self.wid)['source_1'][0],str(self.tree.resolve()))
        self.service.delete(self.cid)
        with self.service.db() as db:self.assertEqual(self.service._conversation_roots(db,cid,self.wid)['source_1'][0],str(self.tree.resolve()))
        self.assertEqual(self.hashes,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.tree.iterdir() if p.is_file()})
        self.assertIn('tracked.txt',self.git('-C',str(self.tree),'status','--porcelain'))
    def test_source_binding_replacement_does_not_fall_back_to_main_repo(self):
        reserved=self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=4,worktree_policy='share-current'))
        with self.service.db() as db:db.execute("UPDATE conversation_worktrees SET root_identity='replaced' WHERE conversation_id=?",(self.cid,))
        with self.assertRaises(TaskError):self.service.commit_native_fork(reserved['reservation_id'],dict(session_id='session-rejected',source_session_id='session-worktree-parent',at_seq=4))
        with self.service.db() as db:self.assertIsNone(db.execute('SELECT id FROM conversations WHERE id=?',(reserved['conversation_id'],)).fetchone())
