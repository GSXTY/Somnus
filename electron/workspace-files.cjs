const fs=require('node:fs');
const {realpath}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {trustWorkbench}=require('./project-folders.cjs');
const {DIFF_TOOL}=require('./acp-project-workflow.cjs');
const {isScopeInvalid}=require('./runtime/workspace-scope.cjs');
const PREFIX='somnus-workspace-files:';
function registerWorkspaceFiles({ipcMain,window,origin,workflow,watch=fs.watch}) {
  const entries=new Map(),channels=[],contents=window.webContents;
  const send=value=>{try{trustWorkbench({sender:contents,senderFrame:contents.mainFrame},window,origin);if(!contents.isDestroyed())contents.send(PREFIX+'change',value);}catch{}};
  const stop=id=>{const entry=entries.get(id);if(!entry)return;entries.delete(id);clearTimeout(entry.timer);entry.watcher?.close();};
  const handle=(name,fn)=>{const channel=PREFIX+name;channels.push(channel);ipcMain.handle(channel,(event,...args)=>{trustWorkbench(event,window,origin);return fn(event,...args);});};
  async function verify(entry) {
    if(entry.verification) return entry.verification;
    entry.verification=(async()=>{
      try {
        const target=await workflow.target(entry.projectId,DIFF_TOOL,{source:'source_'+(entry.sourceIndex+1)},AbortSignal.timeout(7000),entry.conversationId);
        if((await realpath(target.root)).toLowerCase()!==entry.root.toLowerCase()) throw Object.assign(Error('文件目录授权已改变。'),{scopeInvalid:true});
        if(entry.unavailable){entry.unavailable=false;entry.rescan=true;send({id:entry.id,conversationId:entry.conversationId,kind:'changed',paths:[],rescan:true});}
        return true;
      }catch(error){
        entry.unavailable=true;
        send({id:entry.id,conversationId:entry.conversationId,kind:isScopeInvalid(error)?'scope-changed':'unavailable',paths:[],rescan:true});
        if(isScopeInvalid(error))stop(entry.id);
        throw error;
      }finally{entry.verification=undefined;}
    })();
    return entry.verification;
  }
  async function flush(entry) {
    entry.timer=undefined;
    if(!entries.has(entry.id))return;
    try{await verify(entry);}catch{return;}
    if(!entries.has(entry.id))return;
    const paths=[...entry.paths];entry.paths.clear();
    send({id:entry.id,conversationId:entry.conversationId,kind:'changed',paths,rescan:entry.rescan});entry.rescan=false;
  }
  handle('watch',async(event,input)=>{
    if(input&&input.source!==undefined){if(input.sourceIndex!==undefined||typeof input.source!=='string'||!/^source_([1-9]\d?)$/.test(input.source))throw Error('请选择有效项目来源。');input={...input,sourceIndex:Number(input.source.slice(7))-1};}
    if(!input||typeof input.conversationId!=='string'||!Number.isInteger(input.sourceIndex)||input.sourceIndex<0||input.sourceIndex>99)throw Error('请选择有效会话与项目来源。');
    const target=await workflow.target(input.projectId,DIFF_TOOL,{source:'source_'+(input.sourceIndex+1)},AbortSignal.timeout(7000),input.conversationId),root=await realpath(target.root);
    trustWorkbench(event,window,origin);
    const prior=[...entries.values()].find(entry=>entry.projectId===input.projectId&&entry.sourceIndex===input.sourceIndex&&entry.conversationId===input.conversationId&&entry.root.toLowerCase()===root.toLowerCase());
    if(prior)return {id:prior.id};if(entries.size>=16)throw Error('实时文件观察数量已达上限。');
    const entry={id:randomUUID(),projectId:input.projectId,sourceIndex:input.sourceIndex,conversationId:input.conversationId,root,paths:new Set(),rescan:false};
    entry.watcher=watch(root,{recursive:true},(_kind,name)=>{const relative=name?.toString();if(relative&&relative.split(/[\\/]/).some(part=>['.git','node_modules','__pycache__','.cache'].includes(part)))return;if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>part==='..')||/[\x00-\x1f]/.test(relative))entry.rescan=true;else if(entry.paths.size<200)entry.paths.add(relative.replace(/\\/g,'/').slice(0,2048));else entry.rescan=true;if(!entry.timer)entry.timer=setTimeout(()=>void flush(entry),250);});
    entry.watcher.on('error',()=>{send({id:entry.id,conversationId:entry.conversationId,kind:'unavailable',paths:[],rescan:true});stop(entry.id);});entries.set(entry.id,entry);return {id:entry.id};
  });
  handle('unwatch',(_event,id,cid)=>{const entry=entries.get(id);if(entry&&entry.conversationId!==cid)throw Error('文件观察不属于当前会话。');stop(id);});
  const timer=setInterval(()=>{for(const entry of entries.values())void verify(entry).catch(()=>{});},5000);timer.unref();
  window.once('closed',()=>{clearInterval(timer);for(const id of entries.keys())stop(id);for(const channel of channels)ipcMain.removeHandler(channel);});
  return {entries};
}
module.exports={registerWorkspaceFiles};
