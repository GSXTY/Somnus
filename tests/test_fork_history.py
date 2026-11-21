import base64,hashlib,json,unittest
from pathlib import Path
from ai_assistant.service import AssistantService
from ai_assistant.runtime_tasks import TaskError
from tests import test_runtime_sessions as fixtures
AGENT=fixtures.AGENT

class ForkHistoryTests(unittest.TestCase):
    setUp=fixtures.NativeSessionTests.setUp
    finish=fixtures.NativeSessionTests.finish
    def reserve(self):
        self.service.bind_native_session(self.cid,dict(turn_id=self.tid,owner_id=fixtures.OWNER,session_id='session-synthetic-parent',start_seq=4,last_seq=20,assistant_event_seq=19,children=[dict(session_id='session-long-child',parent_session_id='session-synthetic-parent',source_seq=0,last_seq=20000)]))
        self.finish()
        return self.service.reserve_native_fork(self.cid,dict(turn_id=self.tid,at_seq=15000,child_session_id='session-long-child'))
    def page(self,rid,index,records,done=False):
        return self.service.append_native_fork_history(rid,dict(source_session_id='session-long-child',page_index=index,records=records,done=done))
    def commit(self,reserved):
        return self.service.commit_native_fork(reserved['reservation_id'],dict(session_id='session-long-fork',source_session_id='session-long-child',at_seq=15000,history_archive=True))
    def test_large_reverse_pages_emoji_fragments_restart_and_source_delete(self):
        reserved=self.reserve();rid=reserved['reservation_id']
        records=[dict(seq=i+1,role='user' if i%2==0 else 'assistant',content=f'消息{i} 😀'+('x'*3072)) for i in range(240)]
        long='😀汉'*20000
        parts=[long[i:i+4000] for i in range(0,len(long),4000)]
        records.extend(dict(seq=1000,part=i,role='assistant',content=part,final=i==len(parts)-1) for i,part in enumerate(parts))
        chunks=[records[i:i+3] for i in range(0,len(records),3)]
        for index,chunk in enumerate(reversed(chunks)):
            ack=self.page(rid,index,chunk);self.assertTrue(ack['accepted'])
            self.assertFalse(self.page(rid,index,list(chunk))['accepted'])
        self.page(rid,len(chunks),[],True)
        result=self.commit(reserved);target=result['conversation']['id']
        self.assertEqual(self.service.get(target)['messages'],[])
        inherited=result['conversation']['inherited_history']
        self.assertGreater(inherited['byte_count'],512*1024);self.assertGreater(inherited['fragment_count'],100)
        self.service=AssistantService(self.path,self.service.config)
        self.service.delete(self.cid)
        cursor=None;received=[]
        while True:
            page=self.service.inherited_native_history(target,cursor,7);received.extend(page['records'])
            if not page['has_more']:break
            cursor=page['next_cursor']
        expected=sorted(records,key=lambda row:(row['seq'],row.get('part',0)))
        text=''.join(row['content'] for row in received)
        self.assertEqual(text,''.join(row['content'] for row in expected))
        self.assertEqual(hashlib.sha256(text.encode()).hexdigest(),inherited['content_sha256'])
        self.assertEqual(''.join(row['content'] for row in received if row['seq']==1000),long)
        self.assertTrue(received[-1]['final'])
    def test_order_unicode_and_incomplete_upload_never_expose_half_conversation(self):
        reserved=self.reserve();rid=reserved['reservation_id'];fragment=dict(seq=1,role='assistant',content='😀',part=0,final=False)
        with self.assertRaises(TaskError):self.page(rid,1,[fragment])
        with self.assertRaises(TaskError):self.page(rid,0,[dict(fragment,content='\ud800')])
        self.page(rid,0,[fragment])
        with self.assertRaises(TaskError):self.page(rid,0,[dict(fragment,content='different')])
        with self.assertRaises(TaskError):self.page(rid,1,[],True)
        with self.assertRaises(TaskError):self.commit(reserved)
        with self.service.db() as db:self.assertIsNone(db.execute('SELECT id FROM conversations WHERE id=?',(reserved['conversation_id'],)).fetchone())
        self.page(rid,1,[dict(seq=1,part=1,role='assistant',content='尾',final=True)],True)
        target=self.commit(reserved)['conversation']['id']
        for cursor in ('%%%','x'*513,base64.urlsafe_b64encode(json.dumps([rid,2**100,0]).encode()).decode(),base64.urlsafe_b64encode(json.dumps(['foreign',1,0]).encode()).decode()):
            with self.assertRaises(TaskError):self.service.inherited_native_history(target,cursor)
    def test_abort_cleans_only_staging_and_scope_changes_reject(self):
        reserved=self.reserve();rid=reserved['reservation_id'];self.page(rid,0,[dict(seq=1,role='assistant',content='Kept private')])
        self.service.abort_native_fork(rid,{})
        with self.service.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM native_fork_history_records WHERE reservation_id=?',(rid,)).fetchone()[0],0)
        self.assertEqual(self.service.get(self.cid)['messages'][-1]['content'],'Synthetic answer')
