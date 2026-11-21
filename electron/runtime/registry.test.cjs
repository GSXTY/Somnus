const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeRegistry } = require('./registry.cjs');
const { capabilities } = require('./contracts.cjs');
const CID = 'a'.repeat(32), AGENT = '11111111-1111-4111-8111-111111111111';
const input = id => ({ conversationId: CID, turnId: id.repeat(32), agentId: AGENT, groupMember: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('actual dispatch persists attributed results without renderer, reuses no request, and records real progress', async () => {
  const states = [], finished = [], calls = [];
  const client = { runtimeTaskState: async (route, body) => { states.push({ route, body }); return { accepted: true, finish_receipt: 'f'.repeat(64), epoch: 'epoch', task: { status: body.status || 'running' } }; },
    finishRuntimeTask: async (route, body) => { finished.push({ route, body }); return { message: {} }; } };
  const pending = new Map();
  const acp = { promptConversation: async (value, emit) => { calls.push(value.turnId); emit({ ...value, acpStage: 'working', acpTool: { id: 'step', title: 'read', kind: 'read', status: 'in_progress' } });
      await new Promise(resolve => pending.set(value.turnId, resolve));
      emit({ ...value, acpTool: { id: 'step', title: 'read', kind: 'read', status: 'completed' }, text: value.turnId[0] });
      return { text: value.turnId[0], stopReason: 'end_turn', modelName: 'Synthetic', usage: { input_tokens: 2, output_tokens: 1 } }; }, cancelConversation() {} };
  const registry = new RuntimeRegistry({ acp, projectClient: client, heartbeatMs: 20 });
  const a = registry.run('acp', 'prompt', input('b'), undefined, () => { throw Error('renderer gone'); });
  const b = registry.run('acp', 'prompt', input('c'), undefined, () => {});
  await sleep(35); pending.get('c'.repeat(32))(); await b; pending.get('b'.repeat(32))(); await a;
  assert.deepEqual(calls, ['b'.repeat(32), 'c'.repeat(32)]);
  assert.equal(finished.length, 2);
  assert.deepEqual(finished.map(row => [row.route.taskId, row.body.content]), [['c'.repeat(32), 'c'], ['b'.repeat(32), 'b']]);
  assert(finished.every(row => row.body.status === 'complete' && row.body.execution.steps[0].status === 'completed' && row.body.usage.output_tokens === 1));
  for (const taskId of calls) { const seq = states.filter(row => row.route.taskId === taskId).map(row => row.body.sequence); assert.deepEqual(seq, [...seq].sort((a,b)=>a-b)); }
  assert.equal(registry.tasks.size, 0);
});

test('active task approval survives a new renderer; wrong routes cannot act and cancel is precise', async () => {
  const finished = [], approved = [], cancelled = []; let emit, done;
  const acp = { promptConversation: async (value, update) => { emit = update; await new Promise(resolve => { done = resolve; }); return { text: '', stopReason: 'cancelled' }; },
    respondPermission: (cid, id, option, turnId) => approved.push({ cid, id, option, turnId }),
    cancelConversation: (cid, turnId) => { cancelled.push(turnId); done(); } };
  const registry = new RuntimeRegistry({ acp, projectClient: { runtimeTaskState: async () => ({ epoch: 'epoch', finish_receipt: 'f'.repeat(64), accepted: true, task: { status: 'running' } }), finishRuntimeTask: async (route, body) => finished.push(body) } });
  const promise = registry.run('acp', 'prompt', input('b'), undefined, () => {}); await sleep(5);
  emit({ conversationId: CID, agentId: AGENT, turnId: 'b'.repeat(32), acpPermission: { requestId: 'permission', kind: 'mcp', title: 'Synthetic request', options: [] } });
  const route = { conversationId: CID, taskId: 'b'.repeat(32), agentId: AGENT, runtime: 'acp' };
  assert.equal(registry.interactions(route).permission.requestId, 'permission');
  assert.throws(() => registry.interactions({ ...route, agentId: 'wrong' }), /不属于/);
  registry.respondPermission(route, 'permission', 'allow_once');
  assert.equal(approved[0].turnId, route.taskId);
  await registry.cancelTask(route); await promise;
  assert.deepEqual(cancelled, [route.taskId]); assert.equal(finished[0].status, 'cancelled');
  assert.equal(finished[0].execution.approvals[0].status, 'approved');
  assert.throws(() => registry.interactions(route), /已结束/);
});

test('backend restart interrupts and cancels the live Agent without replay or terminal overwrite', async () => {
  let done, calls = 0, epoch = 'before', terminal = 0, cancelled = 0;
  const acp = { promptConversation: async () => { calls++; await new Promise(resolve => { done = resolve; }); return { text: 'partial', stopReason: 'cancelled' }; }, cancelConversation: () => { cancelled++; done(); } };
  const registry = new RuntimeRegistry({ acp, heartbeatMs: 10, projectClient: { runtimeTaskState: async () => ({ accepted: true, finish_receipt: 'f'.repeat(64), epoch, task: { status: 'running' } }), finishRuntimeTask: async (_route, body) => { terminal++; assert.equal(body.status, 'error'); assert.equal(body.interrupted, true); } } });
  const promise = registry.run('acp', 'prompt', input('d'), undefined, () => {}); await sleep(5); epoch = 'after';
  await assert.rejects(promise, /已中断/); assert.equal(calls, 1); assert.equal(cancelled, 1); assert.equal(terminal, 1);
});

test('capabilities distinguish platform guarantees from negotiated and unknown Agent features', () => {
  assert.equal(capabilities({ runtime: 'acp' }).capabilities.agentModes, 'unsupported');
  assert.equal(capabilities({ runtime: 'acp' }).capabilities.images, 'negotiated');
  assert.equal(capabilities({ runtime: 'acp' }).capabilities.subagents, 'unknown');
  assert.equal(capabilities({ runtime: 'dsh-native' }).identity, 'Somnus');
  assert.equal(capabilities({ runtime: 'dsh-native' }).capabilities.resume, 'unsupported');
});

 test('claim acknowledgement loss does not replay work; exhausted claim abandons before execution', async () => {
  let claims=0, invokes=0, abandoned=0;
  const client={runtimeTaskState:async(_r,b)=>{claims++;if(claims<3)throw Error('lost acknowledgement');return {epoch:'e',finish_receipt:'f'.repeat(64),task:{status:b.status}};},finishRuntimeTask:async()=>{},abandonRuntimeTask:async()=>{abandoned++;}};
  const acp={promptConversation:async()=>{invokes++;return {text:'done',stopReason:'end_turn'};}};
  const registry=new RuntimeRegistry({acp,projectClient:client});await registry.run('acp','prompt',input('e'));assert.equal(invokes,1);assert.equal(abandoned,0);
  client.runtimeTaskState=async()=>{throw Error('offline');};await assert.rejects(registry.run('acp','prompt',input('f')),/offline/);assert.equal(invokes,1);assert.equal(abandoned,1);registry.close();
 });
 test('temporary finish outage returns successful fact and retries persistence without invoking Agent',async()=>{
  let available=false,invokes=0,saved=0;
  const registry=new RuntimeRegistry({acp:{promptConversation:async()=>{invokes++;return {text:'actual success',stopReason:'end_turn'};}},projectClient:{runtimeTaskState:async()=>({epoch:'e',finish_receipt:'f'.repeat(64),task:{status:'running'}}),finishRuntimeTask:async(_r,b)=>{if(!available)throw Error('offline');assert.equal(b.status,'complete');assert.equal(b.content,'actual success');saved++;}}});
  const result=await registry.run('acp','prompt',input('1'));assert.equal(result.stopReason,'end_turn');assert.equal(result.persistencePending,true);assert.equal((await registry.outbox.list()).length,1);available=true;await registry.recover();assert.equal(saved,1);assert.equal(invokes,1);assert.equal((await registry.outbox.list()).length,0);registry.close();
 });
 test('settled task cannot cancel its successor while result persistence is pending',async()=>{
  let finish,done,cancels=0;
  const registry=new RuntimeRegistry({native:{prompt:async(i)=>i.turnId==='2'.repeat(32)?{text:'done',stopReason:'end_turn'}:new Promise(r=>{done=r;}),cancel:()=>{cancels++;done({stopReason:'cancelled'});}},projectClient:{runtimeTaskState:async()=>({epoch:'e',finish_receipt:'f'.repeat(64),task:{status:'running'}}),finishRuntimeTask:async(r)=>{if(r.taskId==='2'.repeat(32))await new Promise(resolve=>{finish=resolve;});}}});
  const first=registry.run('dsh-native','prompt',input('2'));await sleep(5);const second=registry.run('dsh-native','prompt',input('3'));await sleep(5);await assert.rejects(registry.cancel('dsh-native',CID,'2'.repeat(32)),/已结束/);assert.equal(cancels,0);finish();assert.equal((await first).stopReason,'end_turn');await registry.cancelTask({conversationId:CID,taskId:'3'.repeat(32),agentId:AGENT,runtime:'dsh-native'});await second;registry.close();
 });

test('backend user cancellation is an intent, not a service restart or a false successful result',async()=>{
 let calls=0,cancel,finished,requested=false;
 const registry=new RuntimeRegistry({heartbeatMs:10,acp:{promptConversation:async()=>{calls++;return new Promise(resolve=>{cancel=()=>resolve({stopReason:'cancelled',text:''});});},cancelConversation:()=>cancel()},projectClient:{runtimeTaskState:async()=>{if(requested)throw Object.assign(Error('cancel requested'),{code:'runtime_task_cancel_requested'});return {epoch:'e',finish_receipt:'f'.repeat(64),task:{status:'running'}};},finishRuntimeTask:async(_r,b)=>{finished=b;}}});
 const promise=registry.run('acp','prompt',input('4'));await sleep(5);requested=true;const result=await promise;assert.equal(result.stopReason,'cancelled');assert.equal(finished.status,'cancelled');assert.equal(finished.interrupted,undefined);assert.equal(calls,1);registry.close();
});
test('window shutdown revokes the host ownership validator and cancels the actual execution',async()=>{
 let validate,release,cancelled=0;
 const registry=new RuntimeRegistry({native:{prompt:async(_i,guard)=>{validate=guard;await new Promise(r=>{release=r;});guard();return {stopReason:'end_turn'};},cancel:()=>{cancelled++;release();}},projectClient:{runtimeTaskState:async()=>({epoch:'e',finish_receipt:'f'.repeat(64),task:{status:'running'}}),finishRuntimeTask:async()=>{}}});
 const promise=registry.run('dsh-native','prompt',input('5'));await sleep(5);validate();registry.close();assert.throws(validate,/执行授权/);await assert.rejects(promise,/执行授权/);assert.equal(cancelled,1);
});

test('approval history follows advertised option kind rather than an arbitrary ACP option identifier',async()=>{
 let emit,done,saved;const registry=new RuntimeRegistry({acp:{promptConversation:async(_i,update)=>{emit=update;await new Promise(resolve=>{done=resolve;});return {text:'done',stopReason:'end_turn'};},respondPermission:()=>done()},projectClient:{runtimeTaskState:async()=>({epoch:'e',finish_receipt:'f'.repeat(64),task:{status:'running'}}),finishRuntimeTask:async(_r,b)=>{saved=b;}}});
 const promise=registry.run('acp','prompt',input('6'));await sleep(5);emit({acpPermission:{requestId:'custom-request',kind:'native_tool',options:[{id:'approve-42',kind:'allow_always'},{id:'deny-91',kind:'reject_once'}]}});registry.respondPermission({conversationId:CID,taskId:'6'.repeat(32),agentId:AGENT,runtime:'acp'},'custom-request','approve-42');await promise;assert.equal(saved.execution.approvals[0].status,'approved');assert.equal(saved.execution.approvals[0].kind,'native_tool');registry.close();
});

test('live idle and connection health are persisted as canonical progress without fake tool calls',async()=>{
 let emit,done;const states=[];const registry=new RuntimeRegistry({acp:{promptConversation:async(_input,notify)=>{emit=notify;await new Promise(resolve=>{done=resolve;});return {text:'done',stopReason:'end_turn'};}},projectClient:{runtimeTaskState:async(_r,b)=>{states.push(b);return {epoch:'e',finish_receipt:'f'.repeat(64),task:{status:b.status}};},finishRuntimeTask:async()=>{}}});const running=registry.run('acp','prompt',input('7'));await sleep(5);emit({acpDiagnostic:{code:'idle',message:'任务暂未产生新活动'}});await sleep(110);assert(states.some(row=>row.progress?.title==='任务暂未产生新活动'));emit({acpDiagnostic:{code:'disconnected',message:'正在确认连接'}});await sleep(110);assert(states.some(row=>row.status==='disconnected'));emit({acpDiagnostic:{code:'reconnected',message:'连接已恢复'}});await sleep(110);assert.equal(states.at(-1).status,'running');done();await running;registry.close();
});
