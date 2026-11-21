const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {EventEmitter}=require('node:events');
const {registerWorkspaceTerminal}=require('../workspace-terminal.cjs');const {registerWorkspaceFiles}=require('../workspace-files.cjs');
function harness(){const window=new EventEmitter(),handlers=new Map(),messages=[];window.webContents={mainFrame:{url:'http://127.0.0.1:8999/'},isDestroyed:()=>false,send:(...args)=>messages.push(args)};return{window,handlers,messages,ipcMain:{handle:(id,fn)=>handlers.set(id,fn),removeHandler:id=>handlers.delete(id)},event:{sender:window.webContents,senderFrame:window.webContents.mainFrame}};}
test('terminal isolates cid, keeps navigation process, coalesces validation, revokes actual changed scopes',async()=>{
 const h=harness(),root=await fs.mkdtemp(path.join(os.tmpdir(),'somnus-terminal-unit-'));let failure,calls=0,kills=0,writes=[],release;
 const workflow={target:async()=>{calls++;if(release)await release;if(failure)throw failure;return{root};}},process={onData:()=>({dispose(){}}),onExit:()=>({dispose(){}}),write:value=>writes.push(value),resize(){},kill(){kills++;}};
 const service=registerWorkspaceTerminal({...h,origin:'http://127.0.0.1:8999',workflow,pty:()=>({spawn:()=>process}),shells:async()=>[{id:'cmd',label:'cmd',file:'synthetic',args:[]}]});
 const call=(name,...args)=>h.handlers.get('somnus-workspace-terminal:'+name)(h.event,...args);
 try{
 const id=await call('start','project',0,'cid',80,24,'cmd');
 await assert.rejects(call('write',id,'bad'),/不属于/);await assert.rejects(call('write',id,'bad','other'),/不属于/);assert.equal(writes.length,0);
 h.window.emit('did-start-navigation');assert.equal(kills,0);
 release=new Promise(resolve=>{setTimeout(resolve,15)});calls=0;await Promise.all([call('snapshot',id,'cid'),call('write',id,'ok','cid')]);assert.equal(calls,1);release=null;
 failure=Object.assign(Error('offline'),{code:'ECONNREFUSED'});await assert.rejects(call('write',id,'blocked','cid'));assert.equal(service.terminals.get(id).state,'disconnected');assert.equal(kills,0);
 failure=null;await call('write',id,'back','cid');assert.equal(service.terminals.get(id).state,'running');
 failure=Object.assign(Error('deleted'),{scopeInvalid:true});await assert.rejects(call('snapshot',id,'cid'));assert.equal(kills,1);assert.equal(service.terminals.get(id).state,'scope-changed');
 }finally{h.window.emit('closed');await fs.rmdir(root);}
});
test('file watches accept exact source string and independent cid subscriptions',async()=>{
 const h=harness(),root=await fs.mkdtemp(path.join(os.tmpdir(),'somnus-watch-unit-'));let watched=[],closed=0;
 const service=registerWorkspaceFiles({...h,origin:'http://127.0.0.1:8999',workflow:{target:async()=>({root})},watch:(_root,_options,callback)=>{const watcher=new EventEmitter();watcher.close=()=>closed++;watched.push(callback);return watcher;}});
 const call=(name,...args)=>h.handlers.get('somnus-workspace-files:'+name)(h.event,...args);
 try{
 const a=await call('watch',{projectId:'p',conversationId:'a',source:'source_2'}),b=await call('watch',{projectId:'p',conversationId:'b',source:'source_2'});assert.notEqual(a.id,b.id);
 await assert.rejects(call('watch',{projectId:'p',conversationId:'a',source:'source_2',sourceIndex:1}));
 assert.throws(()=>call('unwatch',a.id,'b'),/不属于/);call('unwatch',a.id,'a');assert.equal(service.entries.size,1);assert.equal(closed,1);
 watched[1]('change','.git/index');await new Promise(resolve=>setTimeout(resolve,300));assert.equal(h.messages.length,0);
 watched[1]('change','hello.txt');for(let i=0;i<40&&!h.messages.length;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(h.messages.at(-1)[1].conversationId,'b');assert.deepEqual(h.messages.at(-1)[1].paths,['hello.txt']);
 }finally{h.window.emit('closed');await fs.rmdir(root);}
});
