const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pluginExtensions}=require('../acp-dsh-plugin-pages.cjs');const {createDshPluginSettings}=require('../acp-dsh-plugin-settings.cjs');
test('actual temporary bundle maps upstream slots and own settings persist through validated form writes',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'somnus-plugin-expanded-')),id='@fixture/expanded';
 try{
 const document={version:1,title:'Synthetic plugin',blocks:[{type:'table',columns:[{key:'result',label:'Result'}],rows:[{result:'Synthetic'}]},{type:'chart',chartType:'bar',labels:['A'],series:[{label:'Count',values:[1]}]},{type:'status',label:'Tool',state:'success'},{type:'form',fields:[{key:'enabled',label:'Enabled',kind:'boolean',value:false}],submitActionId:'save'}],actions:[{type:'save-own-settings',id:'save',label:'Save',sectionId:'expanded',revision:1}]};
 const manifest={name:id,dsh:{somnus:{extensions:[{id:'form',slot:'settings.section',renderer:'declarative',document},{id:'side',slot:'sidebar.right.pane.tab',renderer:'declarative',document},{id:'card',slot:'conversation.chat.turnTail',renderer:'declarative',document},{id:'raw',slot:'conversation.composer',renderer:'react'}]}}};
 await fs.writeFile(path.join(directory,'package.json'),JSON.stringify(manifest));await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify({revision:1,value:{enabled:false}}));
 const read=async()=>JSON.parse(await fs.readFile(path.join(directory,'settings.json'),'utf8'));
 const schema={uid:1,refs:{1:{type:'object',dict:{enabled:2}},2:{type:'boolean'}}};
 const describe=async()=>({...await read(),ns:'expanded',schema,autoGenerate:true,secrets:[]});
 const market={webProfile:async()=>({bundles:[id]}),community:{installed:async()=>JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8')),packageRoot:async()=>directory},settings:async()=>({}),account:{request:async(_server,method,args)=>{
 if(method==='pluginInventory/list')return{entries:[{entryId:'include:expanded',moduleName:id,enabled:true,fiberPhase:'active'}]};
 if(method==='settings/describe')return{writable:true,namespaces:[await describe()]};
 assert.equal(method,'settings/mutate');assert.equal(args.ns,'expanded');const current=await read();assert.equal(args.expectedRevision,current.revision);for(const operation of args.ops)current.value[operation.path[0]]=operation.value;current.revision++;await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify(current));return describe();
 }}};
 const extensions=await pluginExtensions(market,id);assert.equal(extensions.filter(row=>row.compatibility==='ready').length,3);assert(extensions.every(row=>row.compatibilitySummary.status==='partial'));assert(extensions.find(row=>row.slot==='chat-card').document.blocks.some(block=>block.type==='form'));
 const api=createDshPluginSettings(market);await api.save(id,'community','expanded',1,[{key:'enabled',value:true}],()=>{});
 const reopened=await createDshPluginSettings(market).read(id,'community',()=>{});assert.equal(reopened.sections[0].revision,2);assert.equal(reopened.sections[0].fields[0].value,true);
 await assert.rejects(api.save(id,'community','foreign',2,[{key:'enabled',value:false}],()=>{}),/不可编辑/);await assert.rejects(api.save(id,'community','expanded',1,[{key:'enabled',value:false}],()=>{}),/已更新/);
 }finally{const resolved=await fs.realpath(directory),base=await fs.realpath(os.tmpdir());assert.equal(path.dirname(resolved),base);assert(path.basename(resolved).startsWith('somnus-plugin-expanded-'));await fs.rm(resolved,{recursive:true});}
});
