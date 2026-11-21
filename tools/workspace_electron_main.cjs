const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.env.SOMNUS_WORKSPACE_FIXTURE_ROOT,fixture=process.env.SOMNUS_WORKSPACE_FIXTURE_DIR;
const {registerWorkspaceTerminal}=require(path.join(root,'electron/workspace-terminal.cjs'));
const {registerWorkspaceFiles}=require(path.join(root,'electron/workspace-files.cjs'));
app.disableHardwareAcceleration();app.setPath('userData',path.join(fixture,'isolated-profile'));app.on('window-all-closed',()=>{});
const mark=value=>require('node:fs').writeFileSync(path.join(fixture,'workspace-progress.txt'),value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{let window,server;const report={passed:false,realElectron:true,realNodePty:true};try{
 mark('waiting-app');await app.whenReady();mark('app-ready');const directory=path.join(fixture,'synthetic-workspace');await fs.mkdir(directory,{recursive:true});
 server=http.createServer((_req,res)=>res.end('<html><title>Synthetic workspace fixture</title></html>'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 window=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'electron/project-preload.cjs'),contextIsolation:true,nodeIntegration:false}});
 const options={ipcMain,window,origin,workflow:{target:async(_p,_tool,_source,_signal,cid)=>{if(!['cid-a','cid-b'].includes(cid))throw Object.assign(Error('wrong owner'),{scopeInvalid:true});return{root:directory};}}};
 const terminal=registerWorkspaceTerminal({...options,resourcesPath:path.join(root,'dist/electron/win-unpacked/resources')});registerWorkspaceFiles(options);await window.loadURL(origin+'/');mark('window-ready');
 const run=code=>Promise.race([window.webContents.executeJavaScript(code),new Promise((_,reject)=>setTimeout(()=>reject(Error('Renderer call timed out')),12000).unref())]);
 const shells=await run('window.somnusWorkspaceTerminal.shells()');for(const id of ['powershell','cmd'])assert(shells.some(shell=>shell.id===id));
 const ids=[];for(const shell of ['powershell','cmd']){const id=await run(`window.somnusWorkspaceTerminal.start('p',0,'cid-a',80,24,${JSON.stringify(shell)})`);ids.push(id);}
 await pause(1000);let pids=ids.map(id=>terminal.terminals.get(id).process.pid);
 mark('started-shells');
 const commands=["Write-Output ('SYNTHETIC-'+'PS-RESULT')\r","set SYNTHETIC_PART=CMD-RESULT\r\necho SYNTHETIC-%SYNTHETIC_PART%\r\n"];
 for(let i=0;i<2;i++)await run(`window.somnusWorkspaceTerminal.write(${JSON.stringify(ids[i])},${JSON.stringify(commands[i])},'cid-a')`);
 let outputs;for(let i=0;i<100;i++){outputs=await Promise.all(ids.map(id=>run(`window.somnusWorkspaceTerminal.snapshot(${JSON.stringify(id)},'cid-a')`)));if(outputs[0].output.includes('SYNTHETIC-PS-RESULT')&&outputs[1].output.includes('SYNTHETIC-CMD-RESULT'))break;await pause(100);}
 pids=ids.map(id=>terminal.terminals.get(id).process.pid);assert(pids.every(pid=>pid>0));assert.notEqual(pids[0],pids[1]);assert(outputs[0].output.includes('SYNTHETIC-PS-RESULT'));assert(outputs[1].output.includes('SYNTHETIC-CMD-RESULT'));
 mark('outputs-ready');await window.loadURL(origin+'/detached');await window.loadURL(origin+'/');const list=await run("window.somnusWorkspaceTerminal.list('p',0,'cid-a')");assert.equal(list.length,2);assert.deepEqual(ids.map(id=>terminal.terminals.get(id).process.pid),pids);assert.equal((await run("window.somnusWorkspaceTerminal.list('p',0,'cid-b')")).length,0);
 const denied=await run(`window.somnusWorkspaceTerminal.write(${JSON.stringify(ids[0])},'NO','cid-b').then(()=>false,()=>true)`);assert(denied);
 const watch=await run("window.somnusWorkspaceFiles.watch({projectId:'p',source:'source_1',conversationId:'cid-a'})");await run('window.syntheticChanges=[];window.somnusWorkspaceFiles.onChange(event=>window.syntheticChanges.push(event));undefined');
 await fs.writeFile(path.join(directory,'synthetic.txt'),'SYNTHETIC');let changes=[];for(let i=0;i<40;i++){changes=await run('window.syntheticChanges');if(changes.some(event=>event.paths.includes('synthetic.txt')))break;await pause(100);}assert(changes.some(event=>event.paths.includes('synthetic.txt')));await run(`window.somnusWorkspaceFiles.unwatch(${JSON.stringify(watch.id)},'cid-a')`);
 report.shells=['powershell','cmd'];report.separateProcesses=true;report.navigationRetainedProcesses=true;report.wrongConversationRejected=true;report.actualFileWatch=true;report.passed=true;
 }catch(error){report.error=error.stack;}finally{if(window&&!window.isDestroyed())window.destroy();server?.close();await fs.writeFile(path.join(fixture,'workspace-report.json'),JSON.stringify(report,null,2));await pause(300);process.exit(report.passed?0:1);}})();
