import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentActivityPanel, useAgentConnections } from '../src/configuration/AgentActivityPanel';
import '../src/chat/assistant.css';
const members = ['codex', 'dsh', 'claude'];
const agents = [{id:'codex',name:'Codex'},{id:'dsh',name:'DeepSeek Harness 官方 ACP'},{id:'claude',name:'Claude Code'}];
const states = [{conversationId:'fixture',agentId:'codex',state:'ready'},{conversationId:'fixture',agentId:'dsh',state:'running'},{conversationId:'fixture',agentId:'claude',state:'error',error:'合成连接失败'}];
const calls:string[]=[];(window as any).fixtureCalls=calls;
(window as any).vvmanAcp = { discoverModels:async()=>({}),promptConversation:async()=>({}),cancelConversation:async()=>{},resetConversation:async()=>{}, connectionStates:async()=>states as any,warmConversation:async(input)=>{calls.push('warm:'+input.conversationId+':'+input.agentIds.join(','));return states as any;},releaseConversationAgent:async()=>{} };
window.somnusNativeDshChat = { subagentDetail:async()=>({title:'检查输入数据',status:'in_progress',messages:[{role:'assistant',text:'正在读取合成输入，尚未完成。'}],truncated:false}) } as any;
const messages:any[] = [
{id:'u1',role:'user',content:'请核对文件并报告结果',status:'complete'},
{id:'c1',role:'assistant',content:'核对完成',status:'complete',reply_meta:{transport:'acp',provider_name:'Codex',elapsed_ms:8000}},
{id:'u2',role:'user',content:'请分析合成任务',status:'complete'},
{id:'d1',role:'assistant',content:'',status:'streaming',reply_meta:{transport:'acp',provider_name:'DeepSeek Harness 官方 ACP'}},
{id:'u3',role:'user',content:'请启动子任务',status:'complete'},
{id:'s1',role:'assistant',content:'',status:'streaming',reply_meta:{transport:'dsh-native',provider_name:'Somnus'}},
{id:'f1',role:'assistant',content:'',status:'error',reply_meta:{transport:'acp',provider_name:'Claude Code',elapsed_ms:4000}},
];
const lanes:any[]=[{messageId:'d1',agentId:'dsh',name:'DeepSeek Harness 官方 ACP',startedAt:Date.now()-8000,stage:'working',approval:true,execution:{steps:[{id:'tool1',kind:'tool',title:'等待写入权限',status:'in_progress'}],plan:[]}},
{messageId:'s1',name:'Somnus',startedAt:Date.now()-9000,stage:'working',execution:{steps:[{id:'child1',kind:'subagent',title:'检查输入数据',status:'in_progress'},{id:'child2',kind:'subagent',title:'编写摘要',status:'completed',duration_ms:3200}],plan:[]}}];
function Fixture(){ const [show,setShow]=useState(true);const [cid,setCid]=useState('fixture');const connections=useAgentConnections(cid,members);return <><button id="toggle" onClick={()=>setShow(!show)}>导航切换</button><button id="switch" onClick={()=>setCid(cid==='fixture'?'other':'fixture')}>切换会话</button><div className="assistant-layout" style={{height:'calc(100vh - 40px)',display:'flex'}}><main style={{flex:1,minWidth:0,padding:24}}><h2>Somnus</h2><p>聊天内容</p><p id="jump">尚未定位</p></main>{show&&<AgentActivityPanel conversationId={cid} members={members} available={agents} connections={connections} messages={messages} lanes={lanes} onJump={id=>{document.querySelector('#jump')!.textContent='已定位 '+id;}} onClose={()=>setShow(false)}/>}</div></>}
const style=document.createElement('style');style.textContent=':root{--shell-line:#dce8e4;--shell-muted:#81928f;--shell-bg:#f1f7f5;--shell-accent:#176c61;--shell-surface:#fff;}body{margin:0;color:#173831;font-family:Arial,sans-serif;}';document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture/>);
