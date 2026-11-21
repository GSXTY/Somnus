const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, rm, mkdir, copyFile, realpath, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { AcpAgents } = require('./acp-agents.cjs');
const { groupHistory, rememberReply } = require('./acp-group-history.cjs');

test('group history sends only unseen completed pairs and changed summaries', () => {
  const state = {};
  const pair = (question, answer) => [{role:'user',content:question},{role:'assistant',content:answer}];
  const first = pair('earlier','old answer');
  assert.match(groupHistory(state,{history:first,history_summary:'checkpoint'}), /old answer/);
  assert.equal(groupHistory(state,{history:first,history_summary:'checkpoint'}), '');
  rememberReply(state, 'mine-reply');
  const own = pair('mine','my completed answer'); own[1].message_id='mine-reply';
  const next = [...first,...own,...pair('other member','new sibling answer')];
  const addition = groupHistory(state,{history:next,history_summary:'checkpoint'});
  assert.match(addition,/new sibling answer/);
  assert.doesNotMatch(addition,/old answer|my completed answer|checkpoint/);
  assert.match(groupHistory(state,{history:next,history_summary:'new checkpoint'}),/new checkpoint/);
  const sameAnswer = pair('different question','my completed answer');sameAnswer[1].message_id='other-agent-reply';
  assert.match(groupHistory(state,{history:[...next,...sameAnswer],history_summary:'new checkpoint'}),/different question/);
  const sameBoth = pair('mine','my completed answer');sameBoth[1].message_id='another-agent-same-both';
  assert.match(groupHistory(state,{history:[...next,...sameBoth],history_summary:'new checkpoint'}),/my completed answer/);
});

test('group connections warm, persist, isolate conversations, recover after idle exit and release', {skip:process.platform!=='win32'}, async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'somnus-keepalive-'));
  const manager=new AcpAgents(path.join(dir,'agents.json'),'test',dir,undefined,{prepare:async turn=>({text:'task '+turn.turnId,images:[],history:[]})});
  const children=[];
  const connect=manager.connect.bind(manager);
  manager.connect=async(...args)=>{const result=await connect(...args);children.push(result.current.connection);return result;};
  t.after(async()=>{manager.close();await Promise.all(children.map(child=>child.exited));await rm(dir,{recursive:true,force:true,maxRetries:5});});
  const a=await manager.save({name:'A',executable:process.execPath,args:[path.join(__dirname,'test-fixtures','acp-test-agent.cjs')]});
  const b=await manager.save({name:'B',executable:process.execPath,args:[path.join(__dirname,'test-fixtures','acp-test-agent.cjs')]});
  const states=await manager.warmConversation({conversationId:'chat',agentIds:[a.id,b.id]});
  assert.equal(states.length,2);assert.ok(states.every(row=>row.state==='ready'));
  const key='chat\0'+a.id, warm=manager.conversations.get(key);
  assert.equal(warm.sessionId,null);
  const send=(chat,agent,id)=>manager.promptConversation({conversationId:chat,agentId:agent.id,turnId:id,groupMember:true},()=>{});
  await send('chat',a,'first');
  assert.equal(manager.conversations.get(key),warm);
  await send('chat',a,'second');
  assert.equal(manager.conversations.get(key),warm);
  assert.equal(children.length,2);
  assert.equal(warm.idle._idleTimeout,30*60_000);
  await send('different-chat',a,'separate');
  assert.notEqual(manager.conversations.get('different-chat\0'+a.id),warm);
  warm.connection.stop();await warm.connection.exited;
  assert.equal(manager.connectionStates({conversationId:'chat'}).find(row=>row.agentId===a.id).state,'disconnected');
  await send('chat',a,'recovered');
  const recovered=manager.conversations.get(key);assert.notEqual(recovered,warm);
  manager.releaseConversationAgent({conversationId:'chat',agentId:a.id});
  assert.equal(recovered.connection.failure.message,'外部 Agent 连接已关闭。');
  assert.equal(manager.conversations.has(key),false);
  assert.ok(!manager.connectionStates({conversationId:'chat'}).some(row=>row.agentId===a.id));
  assert.ok(manager.conversations.has('chat\0'+b.id));
});

test('persistent group MCP and approval callbacks belong to each new authorized turn', {skip:process.platform!=='win32',timeout:15000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'somnus-keepalive-tools-'));
  const resources=path.join(dir,'resources');
  const runtime=path.join(resources,'agents','codex');
  const adapter=path.join(runtime,'node_modules','@agentclientprotocol','codex-acp');
  const script=path.join(adapter,'dist','index.js');
  await mkdir(path.dirname(script),{recursive:true});
  const executable=path.join(runtime,'node.exe');
  await copyFile(process.execPath,executable);
  await copyFile(path.join(__dirname,'test-fixtures','acp-concurrent-agent.cjs'),script);
  await writeFile(path.join(adapter,'package.json'),JSON.stringify({name:'@agentclientprotocol/codex-acp',bin:{'codex-acp':'dist/index.js'}}));
  await writeFile(path.join(path.dirname(script),'expected-home'),path.join(dir,'codex-home'));
  const calls=[];
  const client={prepare:async turn=>({text:'conversation=chat',images:[],permission_mode:'workspace_write',project:{available:true,files:[{source:'source_1',path:'concurrent.txt'}]},tools:[{name:'test_project_tool',inputSchema:{type:'object'}}]}),
    file:async()=>({content:'chat',sha256:createHash('sha256').update('chat').digest('hex')}),
    tool:async(turn)=>{calls.push(turn.turnId);return {content:[{type:'text',text:'chat'}],isError:false};}};
  const manager=new AcpAgents(path.join(dir,'agents.json'),'test',resources,undefined,client);
  const children=[];const connect=manager.connect.bind(manager);
  manager.connect=async(...args)=>{const result=await connect(...args);children.push(result.current.connection);return result;};
  t.after(async()=>{manager.close();await Promise.all(children.map(child=>child.exited));await rm(dir,{recursive:true,force:true,maxRetries:5});});
  const profile=await manager.save({name:'Tools',executable,args:[await realpath(script)]});
  const approvals=[];
  const send=turnId=>manager.promptConversation({conversationId:'chat',agentId:profile.id,turnId,groupMember:true},event=>{
    if(event.acpPermission){approvals.push([turnId,event.acpPermission.requestId]);queueMicrotask(()=>manager.respondPermission('chat',event.acpPermission.requestId,'allow',turnId));}
  });
  const first=await send('first');assert.equal(first.stopReason,'end_turn');
  const current=manager.conversations.get('chat\0'+profile.id);
  const second=await send('second');assert.equal(second.stopReason,'end_turn');
  assert.equal(manager.conversations.get('chat\0'+profile.id),current);
  assert.equal(children.length,1);
  assert.deepEqual(calls,['first','second']);assert.equal(approvals.length,2);
  assert.notEqual(approvals[0][1],approvals[1][1]);
  assert.throws(()=>manager.respondPermission('chat',approvals[0][1],'allow','second'),/已结束/);
});


test('more than four members queue for warmup and startup retry never repeats a submitted prompt', {skip:process.platform!=='win32',timeout:12000},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'somnus-warm-queue-'));
 let instruction='ordinary';
 const manager=new AcpAgents(path.join(dir,'agents.json'),'test',dir,undefined,{prepare:async()=>({text:instruction,images:[],history:[]})});
 const children=[];const connect=manager.connect.bind(manager);
 manager.connect=async(...args)=>{const result=await connect(...args);children.push(result.current.connection);return result;};
 t.after(async()=>{manager.close();await Promise.all(children.map(child=>child.exited));await rm(dir,{recursive:true,force:true,maxRetries:5});});
 const fixture=path.join(dir,'fixture.cjs');
 await writeFile(fixture,(await readFile(path.join(__dirname,'test-fixtures','acp-test-agent.cjs'),'utf8')).replace("const text = params.prompt[0].text;", "const text = params.prompt[0].text; if(text.startsWith('break-transport'))process.exit(0);"));
 const profiles=[];for(let i=0;i<6;i++)profiles.push(await manager.save({name:'Member '+i,executable:process.execPath,args:[fixture]}));
 const states=await manager.warmConversation({conversationId:'queue',agentIds:profiles.map(p=>p.id)});
 assert.equal(states.length,6);assert.ok(states.every(row=>row.state==='ready'));
 assert.equal(manager.warming.size,0);assert.equal(manager.warmRunning.size,0);
 const start=manager.startSession.bind(manager);let first=true;
 manager.startSession=async current=>{await start(current);if(first){first=false;const error=new Error('synthetic startup transport loss');current.connection.stop(error);throw error;}};
 const send=id=>manager.promptConversation({conversationId:'queue',agentId:profiles[0].id,turnId:id,groupMember:true},()=>{});
 const before=children.length;assert.equal((await send('retry-before-submit')).stopReason,'end_turn');
 assert.equal(children.length,before+1); // warmed process was lost, exactly one replacement
 instruction='break-transport';const sent=children.length;
 await assert.rejects(send('lost-after-submit'),/外部 Agent 已退出/);
 assert.equal(children.length,sent); // do not automatically execute the task a second time
});
