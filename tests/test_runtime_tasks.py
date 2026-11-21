import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from ai_assistant.service import AssistantService, Config
from ai_assistant import runtime_tasks

AGENT='11111111-1111-4111-8111-111111111111'
OWNER='owner_fixture_0123456789'

class RuntimeTasksTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'assistant.sqlite3'
        self.service=AssistantService(self.path,Config('http://synthetic.invalid/v1','synthetic','synthetic-key'))
        self.cid=self.service.create()['id']
    def begin(self,cid=None):
        return self.service.begin_external_turn(cid or self.cid,'Synthetic request',AGENT,'Synthetic ACP')['turn_id']
    def publish(self,tid,seq=1,**extra):
        return self.service.publish_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id=OWNER,sequence=seq,**extra))
    def finish(self,tid,receipt,content='Synthetic result',**extra):
        return self.service.finish_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,content=content,status='complete',**extra))
    def test_owner_sequence_heartbeat_and_terminal_finish_are_scoped(self):
        tid=self.begin(); first=self.publish(tid,status='connecting'); receipt=first['finish_receipt']
        snapshot=self.service.runtime_task_snapshot(self.cid); cursor=snapshot['cursor'];self.assertEqual(snapshot['tasks'][0]['user_message_id'],self.service.get(self.cid)['messages'][0]['id'])
        self.publish(tid,2,heartbeat=True)
        self.assertEqual(self.service.runtime_task_snapshot(self.cid, cursor)['events'],[])
        self.assertFalse(self.publish(tid,1,status='running')['accepted'])
        with self.assertRaises(runtime_tasks.TaskError): self.service.publish_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id='other_owner_fixture_123',sequence=1,status='running'))
        other=self.service.create()['id']
        with self.assertRaises(runtime_tasks.TaskError):self.service.publish_runtime_task(other,tid,dict(agent_id=AGENT,owner_id=OWNER,sequence=3,status='running'))
        self.publish(tid,3,status='running',progress={'title':'api_key=private-value'})
        self.assertNotIn('private-value',json.dumps(self.service.runtime_task_snapshot(self.cid)))
        result=self.finish(tid,receipt);self.assertEqual(result['task']['status'],'completed');self.assertFalse(result['conversation']['running'])
        self.assertEqual(self.finish(tid,receipt,'Overwrite attempt')['message']['content'],'Synthetic result')
        with self.assertRaises(runtime_tasks.TaskError): self.publish(tid,4,status='running')
    def test_disconnect_is_not_completion_and_can_be_reconfirmed(self):
        tid=self.begin();self.publish(tid,status='running')
        with self.service.db() as db:db.execute('UPDATE runtime_tasks SET lease_until=? WHERE id=?',(time.time()-1,tid))
        with self.assertRaises(runtime_tasks.TaskError): self.service.publish_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id='different_owner_0123456789',sequence=1,status='running'))
        snapshot=self.service.runtime_task_snapshot(self.cid);self.assertEqual(snapshot['tasks'][0]['status'],'disconnected');self.assertTrue(snapshot['tasks'][0]['can_cancel'])
        conversation=self.service.get(self.cid)['conversation'];self.assertFalse(conversation['running']);self.assertEqual(conversation['runtime_status'],'disconnected')
        self.publish(tid,2,status='running');self.assertTrue(self.service.get(self.cid)['conversation']['running'])
    def test_restart_interrupts_but_receipted_result_can_arrive_late_without_execution(self):
        tid=self.begin();receipt=self.publish(tid,status='running')['finish_receipt']
        previous_epoch=self.service.runtime_epoch
        self.service=AssistantService(self.path, self.service.config)
        self.assertNotEqual(previous_epoch,self.service.runtime_epoch)
        self.assertEqual(self.service.runtime_task_snapshot(self.cid)['tasks'][0]['status'],'interrupted')
        with self.assertRaises(runtime_tasks.TaskError):self.publish(tid,2,status='running')
        with self.assertRaises(runtime_tasks.TaskError):self.finish(tid,'invalid_receipt')
        result=self.finish(tid,receipt)
        self.assertEqual(result['task']['status'],'completed');self.assertTrue(result['task']['received_late']);self.assertTrue(result['message']['reply_meta']['received_late']);self.assertFalse(self.service._conversation_active(self.cid))
    def test_cancelled_result_cannot_be_overwritten_after_restart(self):
        tid=self.begin();receipt=self.publish(tid,status='running')['finish_receipt'];self.service.cancel(self.cid)
        self.service.finish_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,content='Cancelled partial',status='cancelled'))
        self.service=AssistantService(self.path,self.service.config)
        result=self.finish(tid,receipt)
        self.assertEqual(result['task']['status'],'cancelled');self.assertNotEqual(result['message']['content'],'Synthetic result')
    def test_live_children_and_history_survive_without_guessing_agent_assignment(self):
        tid=self.begin();receipt=self.publish(tid,status='running',children=[dict(id='child-one',title='Synthetic child',status='in_progress')])['finish_receipt']
        child=next(row for row in self.service.runtime_task_snapshot(self.cid)['tasks'] if row['parent_task_id'])
        self.assertEqual(child['message_id'],tid);self.assertEqual(child['parent_task_id'],tid);self.assertEqual(child['status'],'running')
        self.finish(tid,receipt,execution={'steps':[dict(id='child-one',title='Synthetic child',kind='subagent',status='completed')]})
        child=next(row for row in self.service.runtime_task_snapshot(self.cid)['tasks'] if row['parent_task_id']);self.assertEqual(child['status'],'completed')
        self.service=AssistantService(self.path,self.service.config);self.assertEqual(len(self.service.runtime_task_snapshot(self.cid)['tasks']),2)
    def test_claim_receipt_retry_abandon_and_late_partial_are_safe(self):
        tid=self.begin();first=self.publish(tid,status='connecting')
        self.assertEqual(first['finish_receipt'],self.publish(tid,status='connecting')['finish_receipt'])
        result=self.service.abandon_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id=OWNER))
        self.assertEqual(result['task']['status'],'failed');self.assertFalse(self.service._conversation_active(self.cid))
        tid=self.begin();receipt=self.publish(tid,status='running')['finish_receipt']
        with self.assertRaises(runtime_tasks.TaskError):self.service.abandon_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id=OWNER))
        self.service=AssistantService(self.path,self.service.config)
        result=self.service.finish_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,content='Actual partial result',status='error',interrupted=True))
        self.assertEqual(result['task']['status'],'interrupted');self.assertTrue(result['message']['reply_meta']['received_late']);self.assertEqual(result['message']['content'],'Actual partial result')
        self.assertNotIn(receipt,json.dumps(self.service.runtime_task_snapshot(self.cid)))

    def test_legacy_error_and_cancel_intent_do_not_steal_real_completed_result(self):
        tid=self.begin();receipt=self.publish(tid,status='running')['finish_receipt']
        pending=self.service.finish_external_turn(self.cid,tid,'Renderer lost connection','error')
        self.assertTrue(pending['persistence_pending']);self.assertEqual(pending['message']['status'],'streaming')
        self.assertTrue(self.service.cancel(self.cid))
        self.assertEqual(self.service.runtime_task_snapshot(self.cid)['tasks'][0]['status'],'cancelling')
        result=self.finish(tid,receipt,usage={'input_tokens':10,'output_tokens':5},execution={'steps':[dict(id='step',title='Read synthetic data',kind='read',status='completed')]})
        again=self.service.finish_external_turn(self.cid,tid,'','cancelled')
        self.assertEqual(again['message'],result['message']);self.assertEqual(again['message']['status'],'complete')
        self.assertEqual(again['message']['reply_meta']['usage']['input_tokens'],10)
        self.assertEqual(again['message']['reply_meta']['execution']['steps'][0]['title'],'Read synthetic data')
        self.assertFalse(self.service.runtime_receipts)

    def test_event_retention_reset_child_cycles_and_real_durations(self):
        tid=self.begin();receipt=self.publish(tid,status='running')['finish_receipt']
        with self.assertRaises(runtime_tasks.TaskError):self.publish(tid,2,children=[dict(id='a',parent_id='b',title='A',status='pending'),dict(id='b',parent_id='a',title='B',status='pending')])
        self.publish(tid,2,children=[dict(id='child',title='Child',status='completed',duration_ms=1250)])
        child=next(item for item in self.service.runtime_task_snapshot(self.cid)['tasks'] if item['parent_task_id']);self.assertEqual(child['duration_ms'],1250)
        with self.service.db() as db:
            with patch.object(runtime_tasks,'EVENT_RETENTION',5):
                for index in range(130):runtime_tasks._record(db,tid)
        result=self.service.runtime_task_snapshot(self.cid,0);self.assertTrue(result['reset']);self.assertTrue(result['tasks'])
        current=self.service.runtime_task_snapshot(self.cid)
        same=self.service.runtime_task_snapshot(self.cid,current['cursor'],self.service.runtime_epoch)
        self.assertTrue(same['unchanged']);self.assertEqual(same['tasks'],[])
        self.assertFalse(self.service.runtime_task_snapshot(self.cid,current['cursor'],'old-epoch')['unchanged'])

    def test_public_title_is_single_line_bounded_and_redacted(self):
        value = runtime_tasks.safe_title('Read data\napi_key="private-key" password:secret-value https://example.invalid/mcp/private-path Bearer private-token')
        for secret in ('private-key','secret-value','private-path','private-token','\n'):
            self.assertNotIn(secret,value)
        self.assertLessEqual(len(runtime_tasks.safe_title('x'*500)),160)

    def test_reservation_and_ledger_fail_atomically(self):
        with patch.object(runtime_tasks,'reserve',side_effect=OSError('synthetic database failure')):
            with self.assertRaises(OSError):self.begin()
        self.assertFalse(self.service._conversation_active(self.cid));self.assertEqual(self.service.get(self.cid)['messages'],[])
    def test_global_scope_hides_deleted_conversations_and_invalid_publish_rolls_back(self):
        tid=self.begin();self.publish(tid,status='running')
        before=self.service.runtime_task_snapshot(self.cid)
        with self.assertRaises(runtime_tasks.TaskError):self.publish(tid,2,status='waiting_approval',children=[dict(id='../escape',title='bad',status='running')])
        after=self.service.runtime_task_snapshot(self.cid);self.assertEqual(after['tasks'][0]['status'],'running');self.assertEqual(after['cursor'],before['cursor'])
        receipt=self.service.runtime_receipts[(tid,OWNER)]
        self.service.cancel(self.cid)
        self.service.finish_runtime_task(self.cid,tid,dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,status='cancelled',content=''))
        self.service.delete(self.cid)
        self.assertEqual(self.service.runtime_task_snapshot()['tasks'],[])

if __name__=='__main__':unittest.main()
