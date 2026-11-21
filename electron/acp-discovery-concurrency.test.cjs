const assert = require('node:assert/strict');
const {mkdtemp,rm,readFile,writeFile}=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {setTimeout:delay}=require('node:timers/promises');
const test=require('node:test');
const {AcpAgents}=require(process.env.SOMNUS_ACP_TEST_MODULE || path.join(__dirname,'acp-agents.cjs'));
test('catalog discovery does not lock two group members; failed preparation releases slot', {timeout:20000},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'somnus-discovery-'));
 let fail=false;
 const agents=new AcpAgents(path.join(dir,'agents.json'),'1.0',dir,undefined,{prepare:async()=>{if(fail)throw Error('synthetic preparation failure');return {text:'cancel me',images:[]};}});
 const connections=[];
 t.after(async()=>{agents.close();await Promise.all(connections.map(c=>c.exited));await rm(dir,{recursive:true,force:true,maxRetries:5});});
 const fixture=path.join(dir,'fixture.cjs');
 await writeFile(fixture,(await readFile(path.join(__dirname,'test-fixtures','acp-test-agent.cjs'),'utf8')).replace("if (text === 'cancel me') break;", "if (text.startsWith('cancel me')) break;"));
 const a=await agents.save({name:'Fixture Codex',executable:process.execPath,args:[fixture,'--modern-models']});
 const b=await agents.save({name:'Fixture DSH',executable:process.execPath,args:[fixture,'--modern-models']});
 const connect=agents.connect.bind(agents);
 let entered,release;
 const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 agents.connect=async(profile,owner)=>{if(!owner.signal){entered();await gate;}const out=await connect(profile,owner);connections.push(out.current.connection);return out;};
 const discovery=agents.discoverModels(a.id); discovery.catch(()=>{});
 await ready;
 const send=(agent,id)=>agents.promptConversation({conversationId:'same-chat',agentId:agent.id,turnId:id,text:'cancel me',groupMember:true},()=>{});
 const one=send(a,'first'),two=send(b,'second');one.catch(()=>{});two.catch(()=>{});
 try{
  for(let i=0;i<150 && (agents.turns.size!==2 || ![...agents.turns.values()].every(v=>v.promptActive));i++)await delay(20);
  assert.equal(agents.turns.size,2);
  assert.ok([...agents.turns.values()].every(v=>v.promptActive));
  const turns=[...agents.turns.values()];assert.notEqual(turns[0].current.connection,turns[1].current.connection);
 }finally{release();agents.cancelConversation('same-chat','first');agents.cancelConversation('same-chat','second');await Promise.allSettled([one,two]);}
 assert.equal((await discovery).models.length,2);
 assert.equal(agents.turns.size,0);
 fail=true;await assert.rejects(send(a,'failed'),/synthetic preparation failure/);assert.equal(agents.turns.size,0);
 fail=false;const retry=send(a,'retry');retry.catch(()=>{});
 for(let i=0;i<150 && !agents.findConversationTurn('same-chat','retry')?.promptActive;i++)await delay(20);
 assert.ok(agents.findConversationTurn('same-chat','retry')?.promptActive);
 agents.cancelConversation('same-chat','retry');assert.equal((await retry).stopReason,'cancelled');assert.equal(agents.turns.size,0);
});


