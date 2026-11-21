// UI integration using the actual plugin registry/schema/settings handlers and isolated synthetic RPC/storage.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pluginExtensions}=require('../electron/acp-dsh-plugin-pages.cjs');
const {createDshPluginSettings}=require('../electron/acp-dsh-plugin-settings.cjs');
module.exports=async function({ctx,origin,cid,projectId,shots,headers}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'somnus-ui-bundle-')),id='@fixture/somnus-expanded-ui';
 const settingsFile=path.join(folder,'settings.json');
 const doc={version:1,title:'扩展验收卡片',blocks:[{type:'status',label:'本机验证',state:'success',detail:'由真实插件注册表读取'},{type:'table',columns:[{key:'item',label:'项目'},{key:'count',label:'数量'}],rows:[{item:'示例',count:'2'}]},{type:'chart',chartType:'line',labels:['周一','周二'],series:[{label:'活跃',values:[2,4]}]},{type:'form',fields:[{key:'title',label:'验收标题',kind:'string',value:'声明默认值'},{key:'enabled',label:'启用验收',kind:'boolean',value:false}],submitActionId:'save'}],actions:[{type:'save-own-settings',id:'save',label:'保存插件设置',sectionId:'expanded',revision:0}]};
 const manifest={name:id,version:'1.0.0',dsh:{somnus:{extensions:[['settings.general.item','扩展验收设置'],['sidebar.right.pane.tab','扩展验收侧栏'],['conversation.chat.turnTail','扩展验收结果']].map(([slot,title],i)=>({id:'slot'+i,title,label:title,slot,renderer:'declarative',document:doc}))}}};
 fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify(manifest));
 fs.writeFileSync(settingsFile,JSON.stringify({revision:1,value:{title:'真实已保存标题',enabled:true,apiKey:'never-expose-this'}}));
 const schema={uid:1,refs:{1:{type:'object',dict:{title:2,enabled:3,apiKey:2}},2:{type:'string'},3:{type:'boolean'}}};
 const namespace=()=>({...JSON.parse(fs.readFileSync(settingsFile,'utf8')),ns:'expanded',autoGenerate:true,schema,secrets:[{path:['apiKey']}]});
 const market={appVersion:'0.3.0-beta.9',webProfile:async()=>({bundles:[id]}),settings:async()=>({}),community:{installed:async()=>JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8')),packageRoot:async()=>folder},account:{request:async(_server,method,args)=>{
  if(method==='pluginInventory/list')return{entries:[{entryId:'include:expanded',moduleName:id,fiberPhase:'active',enabled:true}]};
  if(method==='settings/describe')return{writable:true,namespaces:[namespace()]};
  assert.equal(method,'settings/mutate');const saved=namespace();if(args.expectedRevision!==saved.revision)throw Error('revision conflict');for(const op of args.ops)saved.value[op.path[0]]=op.value;saved.revision++;fs.writeFileSync(settingsFile,JSON.stringify({revision:saved.revision,value:saved.value}));return saved;
 }}};
 const rows=await pluginExtensions(market);assert.equal(rows.filter(row=>row.compatibility==='ready').length,3);assert(rows.every(row=>row.sourceSlot));
 const config=createDshPluginSettings(market);
 await ctx.exposeFunction('expandedPluginSettings',async({kind,...input})=>kind==='read'?config.read(input.id,input.source,()=>{}):config.save(input.id,input.source,input.sectionId,input.revision,input.edits,()=>{}));
 const modelResponse=await ctx.request.post(origin+'/api/assistant/models',{headers,data:{name:'Expanded Provider',model:'fixture-model',base_url:'https://example.invalid/v1',api_key:'synthetic-test-key',vision_enabled:true,reasoning_efforts:[]}});assert(modelResponse.ok(),await modelResponse.text());const model=(await modelResponse.json()).provider;
 const skillResponse=await ctx.request.post(origin+'/api/assistant/skills/import',{headers:{...headers,'Content-Type':'application/octet-stream','X-Filename':'SKILL.md'},data:Buffer.from('---\nname: expanded-ui-skill\ndescription: isolated UI acceptance skill\n---\nUse only synthetic evidence.\n')});assert(skillResponse.ok(),await skillResponse.text());const skill=(await skillResponse.json()).skill;
 if(!skill.enabled){const response=await ctx.request.patch(origin+'/api/assistant/skills/'+skill.id,{headers,data:{enabled:true}});assert(response.ok());}
 await ctx.exposeFunction('expandedSend',async input=>{const response=await ctx.request.post(origin+'/api/assistant/conversations/'+input.conversationId+'/external-turns/'+input.turnId+'/finish',{headers,data:{content:'扩展侧栏已处理',status:'complete'}});assert(response.ok(),await response.text());return{text:'扩展侧栏已处理',stopReason:'end_turn'};});
 const p=await ctx.newPage();const errors=[];p.on('pageerror',error=>{errors.push(error.message);console.error('expanded pageerror:',error.message);});
 let fileGeneration=0;
 await p.route('**/api/assistant/conversations/*/workspace-files*',route=>route.fulfill({json:{folders:[{source:'source_1',label:'目录一'},{source:'source_2',label:'目录二'}],source:'source_2',folder:'',entries:[{name:fileGeneration?'generated.c':'initial.c',path:fileGeneration?'generated.c':'initial.c',kind:'file'}]}}));
 await p.goto(origin);
 await p.evaluate(({id,rows})=>{
   const bridge=window.vvmanAcp,installed=bridge.dshInstalledPlugins;
   bridge.dshInstalledPlugins=async()=>({plugins:[...(await installed()).plugins,{id,name:id,source:'community',enabled:true,available:true,version:'1.0.0',description:'Isolated actual plugin fixture'}]});
   bridge.dshPluginSettings=(id,source)=>window.expandedPluginSettings({kind:'read',id,source});
   bridge.saveDshPluginSettings=(id,source,sectionId,revision,edits)=>window.expandedPluginSettings({kind:'save',id,source,sectionId,revision,edits});
   const extensions=window.somnusDshPluginPage.extensions;
   window.somnusDshPluginPage.extensions=async()=>[...(await extensions()),...rows];
   window.vvmanProjects??={};
 },{id,rows});
 const shot=async name=>{await p.waitForTimeout(450);await p.screenshot({path:shots+'platform-expanded-'+name+'.png'});};
 await p.getByRole('button',{name:'插件',exact:true}).click();
 let card=p.getByRole('article',{name:'扩展验收卡片',exact:true}).first();
 await card.getByRole('textbox',{name:'验收标题'}).waitFor();await p.waitForTimeout(100);
 assert.equal(await card.getByRole('textbox',{name:'验收标题'}).inputValue(),'真实已保存标题');
 assert(!await card.textContent().then(text=>text.includes('never-expose-this')));
 await card.getByRole('textbox',{name:'验收标题'}).fill('UI 已保存');await card.getByRole('button',{name:'保存插件设置'}).click();await card.getByText('插件设置已保存。',{exact:true}).waitFor();assert.equal(namespace().value.title,'UI 已保存');
 await shot('plugin-settings-light');
 await p.getByRole('button',{name:'主页',exact:true}).click();await p.getByRole('button',{name:'插件',exact:true}).click();card=p.getByRole('article',{name:'扩展验收卡片',exact:true}).first();await card.getByRole('textbox',{name:'验收标题'}).waitFor();await p.waitForTimeout(100);assert.equal(await card.getByRole('textbox',{name:'验收标题'}).inputValue(),'UI 已保存');
 await card.getByRole('textbox',{name:'验收标题'}).fill('冲突不得覆盖');const concurrent=namespace();concurrent.revision++;concurrent.value.title='另一个窗口保存';fs.writeFileSync(settingsFile,JSON.stringify({revision:concurrent.revision,value:concurrent.value}));await card.getByRole('button',{name:'保存插件设置'}).click();await card.getByText(/已更新|未保存/).waitFor();assert.equal(namespace().value.title,'另一个窗口保存');assert.equal(await card.getByRole('textbox',{name:'验收标题'}).inputValue(),'冲突不得覆盖');
 await shot('plugin-settings-conflict');
 await p.getByRole('button',{name:'Group fixture UI chat',exact:true}).first().click();
 await p.evaluate(()=>{
   const original=window.somnusNativeDshChat.childConversation;
   window.somnusNativeDshChat.childConversation=async input=>{const value=await original(input);return{...value,continuation:{...value.continuation,agentId:'fbbce833-544a-42a1-8579-cba2a817383e'}};};
   window.somnusNativeDshChat.promptConversation=input=>window.expandedSend(input);
   window.somnusDocuments={list:async()=>({folder:'',configured:true,entries:[{kind:'file',name:'private-note.txt',path:'private-note.txt'}]}),readFile:async()=>({name:'private-note.txt',mimeType:'text/plain',size:12,dataBase64:btoa('private text')})};
 });
 const openChild=async()=>{const execution=p.locator('details.assistant-execution').first();if(!await execution.evaluate(element=>element.open))await execution.locator(':scope > summary').click();const operation=p.locator('details.assistant-execution-operation').first();if(!await operation.evaluate(element=>element.open))await operation.locator(':scope > summary').click();await p.getByRole('button',{name:'查看子任务',exact:true}).click();return p.getByRole('dialog',{name:'合成审阅任务',exact:true});};
 let child=await openChild();await child.getByRole('textbox',{name:'给独立子会话发消息'}).waitFor();
 await child.getByRole('button',{name:'选择模型和推理强度'}).click();await p.getByRole('dialog',{name:'选择模型',exact:true}).getByRole('button').filter({hasText:'fixture-model'}).first().click();
 await child.getByRole('button',{name:'为此消息选择 Skills'}).click();await p.getByRole('menuitem',{name:'expanded-ui-skill',exact:true}).click();await child.getByRole('textbox',{name:'给独立子会话发消息'}).click();
 const chooserPromise=p.waitForEvent('filechooser');await child.getByRole('button',{name:'添加图片或文件',exact:true}).click();await (await chooserPromise).setFiles({name:'side-note.txt',mimeType:'text/plain',buffer:Buffer.from('isolated document')});await child.getByText('side-note.txt',{exact:true}).waitFor();
 await child.getByRole('button',{name:'私人文档',exact:true}).click();await p.getByRole('dialog',{name:'从个人文档选择文件',exact:true}).getByRole('button',{name:/private-note.txt/}).click();await child.getByText('private-note.txt',{exact:true}).waitFor();
 await child.getByRole('textbox',{name:'给独立子会话发消息'}).evaluate(element=>{const transfer=new DataTransfer();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGMUq8xigAEmOAsvBwAxUgEBrXwlLAAAAABJRU5ErkJggg=='),char=>char.charCodeAt(0));transfer.items.add(new File([bytes],'clipboard.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:transfer}));});await child.getByRole('img',{name:'clipboard.png',exact:true}).waitFor();
 await child.getByRole('region',{name:'独立子会话'}).evaluate(element=>{const transfer=new DataTransfer();transfer.items.add(new File(['dragged evidence'],'dropped-note.txt',{type:'text/plain'}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));});await child.getByText('dropped-note.txt',{exact:true}).waitFor();
 await child.getByRole('textbox',{name:'给独立子会话发消息'}).fill('校验实际附件和独立模型路由');await shot('child-rich-composer');
 await child.getByRole('button',{name:'关闭',exact:true}).first().click();child=await openChild();await child.getByText('side-note.txt',{exact:true}).waitFor();assert.equal(await child.getByRole('textbox',{name:'给独立子会话发消息'}).inputValue(),'校验实际附件和独立模型路由');await child.getByRole('img',{name:'clipboard.png'}).waitFor();
 const reserves=[];p.on('request',request=>{if(request.method()==='POST'&&/\/external-turns$/.test(new URL(request.url()).pathname))reserves.push(request.postDataJSON());});
 await child.getByRole('button',{name:'发送',exact:true}).click();await child.getByText('扩展侧栏已处理',{exact:true}).waitFor().catch(async error=>{console.error('expanded side send:',await child.textContent(),'reserves',reserves);await shot('child-send-error');throw error;});assert.equal(reserves.length,1);assert.equal(reserves[0].provider_model_id,model.id);assert.equal(reserves[0].skill_ids[0],skill.id);assert.equal(reserves[0].file_ids.length,3);assert.equal(reserves[0].attachments.length,1);
 await child.getByRole('button',{name:'关闭',exact:true}).first().click();
 await p.getByRole('button',{name:'工作区',exact:true}).click();
 const panel=p.getByRole('complementary',{name:'会话工作区'});
 await p.getByRole('tab',{name:'插件',exact:true}).click();
 await p.getByRole('region',{name:'插件侧栏扩展'}).getByRole('textbox',{name:'验收标题'}).waitFor();await shot('plugin-sidebar-wide');
 await p.setViewportSize({width:1040,height:800});await shot('plugin-sidebar-compact');
 // Deterministic bridge exercises real tab/snapshot/offset/watch consumers; actual PTY and watch drivers are tested separately.
 await p.evaluate(()=>{
   window.expandedTerminalCalls=[];window.expandedTerminals=[];window.expandedTerminalData=[];window.expandedTerminalExit=[];window.expandedWatches=[];
   const visible=(project,index,cid)=>window.expandedTerminals.filter(row=>row.project===project&&row.source===index&&row.cid===cid);
   window.somnusWorkspaceTerminal={shells:async()=>[{id:'powershell',label:'Windows PowerShell'},{id:'cmd',label:'Command Prompt'}],list:async(project,index,cid)=>visible(project,index,cid).map(row=>({...row,output:''})),snapshot:async(id,cid)=>{const row=window.expandedTerminals.find(row=>row.id===id&&row.cid===cid);if(!row)throw Error('Wrong owner');return row;},start:async(project,source,cid,cols,rows,shellId)=>{const id='terminal-'+(window.expandedTerminalCalls.filter(row=>row.kind==='start').length+1);window.expandedTerminalCalls.push({kind:'start',source,cid,shellId});window.expandedTerminals.push({id,project,source,cid,shellId,label:shellId,state:'running',output:'ready 🙂',offsetStart:0,offsetEnd:8});return id;},write:async(id,data,cid)=>{const row=window.expandedTerminals.find(row=>row.id===id&&row.cid===cid);if(!row)throw Error('Wrong owner');row.output+=data;row.offsetEnd=row.output.length;window.expandedTerminalCalls.push({kind:'write',id,cid,data});window.expandedTerminalData.forEach(listener=>listener(id,data,row.offsetEnd));},resize:async()=>{},stop:async(id,cid)=>{window.expandedTerminalCalls.push({kind:'stop',id,cid});window.expandedTerminals=window.expandedTerminals.filter(row=>row.id!==id||row.cid!==cid);},onData:listener=>{window.expandedTerminalData.push(listener);return()=>window.expandedTerminalData=window.expandedTerminalData.filter(item=>item!==listener);},onExit:listener=>{window.expandedTerminalExit.push(listener);return()=>window.expandedTerminalExit=window.expandedTerminalExit.filter(item=>item!==listener);}};
   window.somnusWorkspaceFiles={watch:async input=>{window.expandedWatches.push(input);return{id:'watch-fixture'};},unwatch:async()=>{},onChange:listener=>{window.expandedWatchListener=listener;return()=>{window.expandedWatchListener=undefined;};}};
 });
 await p.getByRole('tab',{name:'终端',exact:true}).click();await p.getByRole('button',{name:'新建终端',exact:true}).click().catch(async error=>{console.error('terminal UI errors',errors,'body',await p.locator('.workspace-panel-content').textContent());await shot('terminal-error');throw error;});await p.getByRole('tab',{name:/powershell 1/}).waitFor();await p.getByRole('button',{name:'新建终端',exact:true}).click().catch(async error=>{console.error('terminal second errors',errors,'body',await p.locator('body').textContent());await shot('terminal-error');throw error;});await p.getByRole('tab',{name:/powershell 2/}).waitFor();
 const starts=await p.evaluate(()=>window.expandedTerminalCalls.filter(row=>row.kind==='start'));assert.equal(starts.length,2);assert(starts.every(row=>row.source===1));
 await p.locator('.xterm-helper-textarea').click();await p.keyboard.type('echo synthetic');assert((await p.evaluate(()=>window.expandedTerminalCalls)).some(row=>row.kind==='write'&&row.id==='terminal-2'));
 await shot('terminal-tabs');await p.getByRole('tab',{name:'文件',exact:true}).click();await p.getByRole('status').filter({hasText:'实时监听已连接'}).waitFor();assert.equal(await p.evaluate(()=>window.expandedWatches.at(-1).source),'source_2');fileGeneration++;await p.evaluate(()=>{const watch=window.expandedWatches.at(-1);window.expandedWatchListener({id:'watch-fixture',conversationId:watch.conversationId,kind:'changed',paths:['generated.c'],rescan:false});});await p.locator('.workspace-panel-files button[title="generated.c"]').waitFor().catch(async error=>{console.error('watchdebug',await p.evaluate(()=>window.expandedWatches),'cid',cid,'panel',await p.locator('.workspace-panel-content').textContent());await shot('watch-error');throw error;});await shot('files-live-watch');
 await p.getByRole('tab',{name:'终端',exact:true}).click();assert.equal((await p.evaluate(()=>window.expandedTerminalCalls.filter(row=>row.kind==='start'))).length,2);await p.getByRole('button',{name:'关闭终端 2',exact:true}).click();assert.equal((await p.evaluate(()=>window.expandedTerminalCalls.filter(row=>row.kind==='stop'))).length,1);
 assert.deepEqual(errors,[]);await p.close();if(path.dirname(folder)!==path.resolve(os.tmpdir())||!path.basename(folder).startsWith('somnus-ui-bundle-'))throw Error('Unexpected test directory');fs.rmSync(folder,{recursive:true,force:true});
 console.log('PASS expanded plugin actual registry/settings save/reopen/conflict; table/chart/form/sidebar; terminal tabs owner/sources; live watch metadata; compact/wide UI.');
};
