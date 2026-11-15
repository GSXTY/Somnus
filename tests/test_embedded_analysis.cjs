const assert=require('node:assert/strict'),vm=require('node:vm'),{readFileSync}=require('node:fs');
const source=readFileSync('event_detection/viewer.js','utf8');
function workspace({embedded=true,framed=true}={}){
 const elements=new Map(),classes=new Set(),frames=[],listeners=new Map();
 function element(){return {value:'',textContent:'',clientWidth:1000,children:[],dataset:{},style:{setProperty(){}},checked:false,addEventListener(){},setAttribute(name,value){this[name]=value},focus(){this.focused=true},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)},querySelectorAll(){return []},getBoundingClientRect(){return {top:10}}}}
 function get(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}
 const media=new Map(),parent={};
 const window={parent,location:{search:embedded?'?embedded=1':'',origin:'http://127.0.0.1:8765'},innerHeight:700,
  matchMedia(query){
   if(!media.has(query))media.set(query,{matches:false,addEventListener(type,fn){if(type==='change')this.onChange=fn}});
   return media.get(query);
  },addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)}};
 if(!framed)window.parent=window;
 const document={documentElement:{clientWidth:1200},body:{classList:{toggle(name,on){on?classes.add(name):classes.delete(name)}}},getElementById:get,querySelector(){return null},createElement:element,createTextNode:text=>({textContent:text})};
 const context=vm.createContext({document,window,URLSearchParams,AbortController,fetch(){return new Promise(()=>{})},requestAnimationFrame(fn){frames.push(fn);return frames.length},setTimeout(){return 1},clearTimeout(){},console,devicePixelRatio:1});
 vm.runInContext(source,context);frames.length=0;
 const read=code=>vm.runInContext(code,context);
 read(`
 const originalUpdateEventPanelChrome=updateEventPanelChrome;
 let layoutCalls={render:0,sidebar:0,wave:0,chrome:0};
 scheduleRender=()=>layoutCalls.render++;scheduleSidebarResize=()=>layoutCalls.sidebar++;
 updateEventPanelChrome=()=>layoutCalls.chrome++;loadWave=force=>{if(force)layoutCalls.wave++};
 meta={file_id:'kept-csv'};view=[23,47];selected=['流量'];groups=[['流量']];
 fileLibrary=[{id:1,file_id:'kept-csv',file:{name:'memory-only.csv'}}];activeLibraryId=1;
 annotations={items:[{id:'manual-kept',status:'reviewed'}]};eventDraft={id:'unsaved-draft',start:24,end:29};
 scanViews.set('kept-csv',{runId:'kept-batch',profile:'dynamic_baseline_v3',ids:new Set(['manual-kept'])});
 const preserved=JSON.stringify({meta,view,selected,groups,fileLibrary,activeLibraryId,annotations,eventDraft,batch:[...scanViews]});
 `);
 function message(data,origin=window.location.origin,sender=window.parent){for(const fn of listeners.get('message')||[])fn({data,origin,source:sender})}
 function flush(){while(frames.length)frames.shift()()}
 const visible=value=>({source:'data-workbench',type:'analysis:visibility',visible:value});
 function resize(width){
  document.documentElement.clientWidth=width;
  for(const [query,entry] of media){
   const matches=width<=Number(query.match(/\d+/)[0]);
   if(matches!==entry.matches){entry.matches=matches;entry.onChange?.()}
  }
  for(const fn of listeners.get('resize')||[])fn();
 }
 return {read,message,flush,visible,classes,document,get,resize};
}
const frame=workspace();assert(frame.classes.has('analysis-embedded'));
frame.message(frame.visible(true),'https://unrelated.invalid');frame.message(frame.visible(true),undefined,{});
frame.message({source:'other',type:'analysis:visibility',visible:true});frame.message({...frame.visible(true),visible:'yes'});
frame.flush();assert.equal(frame.read('layoutCalls.wave'),0,'only same-origin parent protocol is accepted');
frame.message(frame.visible(false));frame.flush();assert.equal(frame.read('embeddedAnalysisVisible'),false);assert.equal(frame.read('layoutCalls.wave'),0);
frame.message(frame.visible(true));frame.message(frame.visible(true));frame.flush();
assert.equal(frame.read('layoutCalls.wave'),1,'restore coalesces into one read-only waveform request');
assert.equal(frame.read('layoutCalls.render'),1);assert.equal(frame.read('layoutCalls.sidebar'),1);assert.equal(frame.read('layoutCalls.chrome'),1);
assert.equal(frame.read('JSON.stringify({meta,view,selected,groups,fileLibrary,activeLibraryId,annotations,eventDraft,batch:[...scanViews]})'),frame.read('preserved'),'visibility and resize must preserve CSV refs, manual review, draft, batch and viewport');
frame.document.documentElement.clientWidth=0;frame.message(frame.visible(true));frame.flush();assert.equal(frame.read('layoutCalls.wave'),1,'never resize into a zero-width hidden layout');
frame.document.documentElement.clientWidth=1200;frame.message(frame.visible(true));frame.message(frame.visible(false));frame.flush();assert.equal(frame.read('layoutCalls.wave'),1,'a queued show is ignored if hidden before the frame');
for(const options of [{embedded:true,framed:false},{embedded:false,framed:true}]){
 const standalone=workspace(options);assert(!standalone.classes.has('analysis-embedded'));
 standalone.message(standalone.visible(true));standalone.flush();assert.equal(standalone.read('layoutCalls.wave'),0,'standalone entry ignores embedding messages');
}
const layout=workspace();
for(const id of ['analysis-notes','scan-options','external-tools'])assert.equal(layout.get(id).open,false);
assert.equal(layout.get('channel-panel').hidden,false);
// Use the real panel chrome for width changes instead of the redraw counter.
layout.read('updateEventPanelChrome=originalUpdateEventPanelChrome');
layout.resize(1000);
assert.equal(layout.get('event-panel').hidden,true,'an embedded narrow viewport must not start with review covering the chart');
layout.get('toggle-events').onclick();
assert.equal(layout.get('event-panel').hidden,false);
layout.resize(600);
assert.equal(layout.get('channel-panel').hidden,true);
assert.equal(layout.get('toggle-channels')['aria-expanded'],'false');
layout.get('toggle-channels').onclick();
assert.equal(layout.get('channel-panel').hidden,false);
assert.equal(layout.get('close-channel-panel').focused,true);
layout.get('close-channel-panel').onclick();
assert.equal(layout.get('channel-panel').hidden,true);
assert.equal(layout.get('toggle-channels').focused,true);
layout.resize(1200);
assert.equal(layout.get('channel-panel').hidden,false);
assert.equal(layout.get('event-panel').hidden,false);
layout.resize(600);
assert.equal(layout.get('event-panel').hidden,true,'widening and narrowing must not reopen a previous drawer');
assert.equal(layout.read('JSON.stringify({meta,view,selected,groups,fileLibrary,activeLibraryId,annotations,eventDraft,batch:[...scanViews]})'),layout.read('preserved'));
console.log('PASS: opt-in iframe mode, trusted visibility protocol, coalesced resize, hidden geometry protection and preserved CSV/review/draft/batch state');
