import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTaskState, snapshotCanAdvance, taskIsActive, taskLabel, taskMessageStatus, validTaskSnapshot } from '../src/runtime/runtimeTaskModel.mjs';
const row = (id, status, created_at = 1) => ({ id, conversation_id: 'chat', agent_id: 'codex', revision: 1, status, created_at, parent_task_id: null });
const snap = (tasks, cursor = 1, epoch = 'first') => ({ tasks, cursor, epoch });
test('one conversation summary excludes child counts and old failures after a newer successful task', () => {
 const tasks = [row('old', 'failed', 1), row('new', 'completed', 2), { ...row('child', 'running', 3), parent_task_id: 'new' }];
 assert.equal(conversationTaskState(tasks, 'chat').status, 'completed');
 assert.equal(conversationTaskState(tasks, 'chat').attention_count, 0);
 assert.equal(conversationTaskState(tasks, 'chat').active_count, 0);
});
test('waiting approval is active attention while disconnected is attention without a running spinner', () => {
 const waiting = conversationTaskState([row('one','running'), row('two','waiting_approval',2)], 'chat');
 assert.equal(waiting.active_count, 2); assert.equal(waiting.status,'waiting_approval');
 const disconnected = row('lost','disconnected');
 assert.equal(taskIsActive(disconnected),false); assert.equal(conversationTaskState([disconnected],'chat').attention_count,1);
 assert.match(taskLabel(disconnected),/状态待确认/);
});
test('offline snapshots keep last evidence but never claim live execution or successful completion', () => {
 const task = row('active','running');
 assert.equal(taskIsActive(task,false),false); assert.equal(taskMessageStatus(task,false),'error');
 assert.match(taskLabel(task,false),/不可确认/);
 const state=conversationTaskState([task],'chat',false); assert.equal(state.active_count,0); assert.equal(state.status,'disconnected');
});
test('server restart may replace an epoch; stale revisions and terminal revival in the same epoch are rejected', () => {
 const previous=snap([row('one','running')],5);
 assert.equal(snapshotCanAdvance(previous,snap([{...row('one','interrupted'),revision:2}],1,'second')),true);
 assert.equal(snapshotCanAdvance(previous,snap([{...row('one','running'),revision:0}],6)),false);
 assert.equal(snapshotCanAdvance(previous,snap([row('one','completed')],6)),false);
 assert.equal(snapshotCanAdvance(snap([row('one','completed')]),snap([{...row('one','running'),revision:2}],2)),false);
 assert.equal(snapshotCanAdvance(snap([row('one','disconnected')]),snap([{...row('one','running'),revision:2}],2)),true);
});
test('invalid or fabricated task statuses cannot become a trusted snapshot', () => {
 assert.equal(Boolean(validTaskSnapshot(snap([row('one','imaginary')]))),false);
 assert.equal(Boolean(validTaskSnapshot({...snap([]),cursor:-1})),false);
 assert.equal(Boolean(validTaskSnapshot(snap([row('one','interrupted')]))),true);
});
