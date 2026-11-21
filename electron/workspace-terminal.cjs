const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { lstat, realpath } = require('node:fs/promises');
const { trustWorkbench } = require('./project-folders.cjs');
const { DIFF_TOOL } = require('./acp-project-workflow.cjs');
const { isScopeInvalid } = require('./runtime/workspace-scope.cjs');
const PREFIX = 'somnus-workspace-terminal:';
const MAX_TERMINALS = 4, MAX_OUTPUT = 1024 * 1024;
function loadPty(resourcesPath) {
  if (resourcesPath) {
    for(const candidate of [path.join(resourcesPath,'app.asar.unpacked','node_modules','node-pty'),path.join(resourcesPath,'app.asar','dsh','node_modules','node-pty')]) {
      try { return require(candidate); }
      catch(error) { if(error.code!=='MODULE_NOT_FOUND')throw error; }
    }
  }
  return require('node-pty');
}
function dimensions(cols, rows) {
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols < 2 || cols > 500 || rows < 2 || rows > 300) throw Error('终端尺寸无效。');
  return { cols, rows };
}
async function installedShells(environment = process.env) {
  const windows = environment.SystemRoot || 'C:\\Windows';
  const candidates = [
    {id:'powershell',label:'Windows PowerShell',file:path.win32.join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe'),args:['-NoLogo']},
    {id:'cmd',label:'Command Prompt',file:path.win32.join(windows,'System32','cmd.exe'),args:['/D']},
    ...[environment.ProgramFiles,environment['ProgramFiles(x86)']].filter(Boolean).map(root=>({id:'pwsh',label:'PowerShell 7',file:path.win32.join(root,'PowerShell','7','pwsh.exe'),args:['-NoLogo']})),
    ...[environment.ProgramFiles,environment['ProgramFiles(x86)'],environment.LOCALAPPDATA&&path.win32.join(environment.LOCALAPPDATA,'Programs')].filter(Boolean).map(root=>({id:'git-bash',label:'Git Bash',file:path.win32.join(root,'Git','bin','bash.exe'),args:['--login','-i']})),
  ];
  const result = new Map();
  for (const candidate of candidates) {
    try { const info=await lstat(candidate.file); if(info.isFile()&&!info.isSymbolicLink()&&!result.has(candidate.id))result.set(candidate.id,{...candidate,file:await realpath(candidate.file)}); } catch {}
  }
  return [...result.values()];
}
function registerWorkspaceTerminal({ipcMain,window,origin,workflow,resourcesPath,dshStartup,pty=()=>loadPty(resourcesPath),shells=installedShells}) {
  const terminals=new Map(),pending=new Set(),channels=[],contents=window.webContents;
  const notify=(event,...args)=>{try{trustWorkbench({sender:contents,senderFrame:contents.mainFrame},window,origin);if(!contents.isDestroyed())contents.send(PREFIX+event,...args);}catch{}};
  const handle=(name,listener)=>{const channel=PREFIX+name;channels.push(channel);ipcMain.handle(channel,(event,...args)=>{trustWorkbench(event,window,origin);return listener(event,...args);});};
  const view=row=>({id:row.id,projectId:row.projectId,sourceIndex:row.sourceIndex,conversationId:row.conversationId,shellId:row.shellId,label:row.label,state:row.state,...(row.exitCode===undefined?{}:{exitCode:row.exitCode}),output:row.state==='scope-changed'?'':row.output,offsetStart:row.state==='scope-changed'?row.offset:row.offset-row.output.length,offsetEnd:row.offset});
  function stop(id) {const row=terminals.get(id);if(!row)return;terminals.delete(id);row.data?.dispose();row.exit?.dispose();try{row.process.kill();}catch{}}
  async function verify(row,cid) {
    if(typeof cid !== 'string' || cid !== row.conversationId) throw Error('此终端不属于当前会话。');
    if(row.state === 'scope-changed') throw Error('终端原目录的授权已变化，请重新打开。');
    if(row.verification) return row.verification;
    row.verification = (async () => {
      try {
        const target = await workflow.target(row.projectId,DIFF_TOOL,{source:'source_'+(row.sourceIndex+1)},AbortSignal.timeout(7000),row.conversationId);
        const actual = await realpath(target.root);
        if(actual.toLowerCase() !== row.root.toLowerCase()) throw Object.assign(Error('终端保存目录已变化。'), {scopeInvalid:true});
        if(row.state === 'disconnected') { row.state = row.exitCode === undefined ? 'running' : 'exited'; notify('state', row.id, row.state); }
        return row;
      } catch(error) {
        if(isScopeInvalid(error)) { row.state='scope-changed'; try { row.process.kill(); } catch {} }
        else row.state='disconnected';
        notify('state', row.id, row.state);
        throw error;
      } finally { row.verification=undefined; }
    })();
    return row.verification;
  }
  handle('shells',async()=> (await shells()).map(({id,label})=>({id,label})));
  handle('start',async(event,projectId,sourceIndex,conversationId,cols,rows,shellId='powershell')=>{
    if(typeof conversationId!=='string'||!conversationId)throw Error('请选择有效的会话。');
    const size=dimensions(cols,rows);
    if(!Number.isInteger(sourceIndex)||sourceIndex<0||sourceIndex>99)throw Error('请选择有效项目来源。');
    if(pending.size+terminals.size>=MAX_TERMINALS)throw Error('请先关闭一个项目终端。');
    const controller=new AbortController();pending.add(controller);
    try{
      const target=await workflow.target(projectId,DIFF_TOOL,{source:'source_'+(sourceIndex+1)},controller.signal,conversationId);
      const root=await realpath(target.root),selected=(await shells()).find(shell=>shell.id===shellId);
      if(!selected)throw Error('所选Shell尚未安装或不可用。');
      const startup=['powershell','pwsh'].includes(shellId)?await dshStartup?.().catch(()=>null):null;
      controller.signal.throwIfAborted();trustWorkbench(event,window,origin);
      const process=pty().spawn(selected.file,[...selected.args,...(startup?.args||[])],{name:'xterm-256color',...size,cwd:root,env:{...global.process.env,...startup?.env,TERM:'xterm-256color'}});
      const row={id:randomUUID(),projectId,sourceIndex,conversationId,root,shellId,label:selected.label,process,state:'running',output:'',offset:0};terminals.set(row.id,row);
      row.data=process.onData(data=>{if(row.state==='scope-changed')return;row.offset+=data.length;row.output=(row.output+data).slice(-MAX_OUTPUT);notify('data',row.id,data,row.offset);});
      row.exit=process.onExit(({exitCode})=>{row.state=['scope-changed','disconnected'].includes(row.state)?row.state:'exited';row.exitCode=exitCode;row.data?.dispose();row.exit?.dispose();notify('exit',row.id,exitCode);});
      return row.id;
    }finally{pending.delete(controller);}
  });
  handle('list',async(_event,projectId,sourceIndex,cid)=>{const result=[];for(const row of terminals.values())if(row.projectId===projectId&&row.sourceIndex===sourceIndex&&row.conversationId===cid){try{await verify(row,cid);}catch{}result.push({...view(row),output:''});}return result;});
  handle('snapshot',async(_event,id,cid)=>{const row=terminals.get(id);if(!row)return null;await verify(row,cid);return view(row);});
  handle('write',async(_event,id,data,cid)=>{if(typeof data!=='string'||data.length>256*1024)throw Error('终端输入过长。');const row=terminals.get(id);if(!row)return;await verify(row,cid);if(row.state!=='running')throw Error('此终端已退出。');row.process.write(data);});
  handle('resize',async(_event,id,cols,rows,cid)=>{const size=dimensions(cols,rows),row=terminals.get(id);if(!row)return;await verify(row,cid);if(row.state==='running')row.process.resize(size.cols,size.rows);});
  handle('stop',(_event,id,cid)=>{const row=terminals.get(id);if(row&&(typeof cid!=='string'||cid!==row.conversationId))throw Error('此终端不属于当前会话。');stop(id);});
  const timer=setInterval(()=>{for(const row of terminals.values())if(['running','disconnected'].includes(row.state))void verify(row,row.conversationId).catch(()=>{});},5000);timer.unref();
  window.once('closed',()=>{clearInterval(timer);for(const controller of pending)controller.abort();for(const id of terminals.keys())stop(id);for(const channel of channels)ipcMain.removeHandler(channel);});
  return {terminals};
}
module.exports={registerWorkspaceTerminal,installedShells,dimensions,loadPty};
