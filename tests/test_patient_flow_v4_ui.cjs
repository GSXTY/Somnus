const assert=require('node:assert/strict'),vm=require('node:vm'),{readFileSync}=require('node:fs');
const {AnnotationModel}=require('../event_detection/annotation-model.js'),elements=new Map();
function element(){return {value:'',textContent:'',clientWidth:1000,children:[],dataset:{},style:{},checked:false,addEventListener(){},setAttribute(){},replaceChildren(){this.children=[]},append(...v){this.children.push(...v)},querySelectorAll(){return []}}}
const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,createTextNode:text=>({textContent:text})},window:{addEventListener(){}},fetch(){return new Promise(()=>{})},URLSearchParams,AbortController,requestAnimationFrame(){return 1},setTimeout(){return 1},clearTimeout(){},console,devicePixelRatio:1});
vm.runInContext(readFileSync('event_detection/viewer.js','utf8'),context);
const read=code=>vm.runInContext(code,context),json=code=>JSON.parse(read(`JSON.stringify(${code})`));
(async()=>{
read(`
meta={file_id:'v4',start:'2026-01-01 00:00:00',raw_duration:200,duration:200,patient_flow_v4_version:'patient-flow-v4-v1',dynamic_baseline_optimized_v3_version:'dynamic-baseline-optimized-v3-configurable-v22',channels:['流量',...allPatientNames,...allOptimizedNames]};
$('baseline-window').options=Array.from({length:10},(_,i)=>({value:String(i+1)}));$('baseline-method').options=[{value:'detrended_abs'},{value:'absolute_mean'}];
selected=['流量'];groups=[['流量']];eventSyncReady=true;filterChannels=()=>{};loadWave=()=>{};render=()=>{};loadFeedbackRuns=async()=>{};loadDeviceMetrics=async()=>{};setView=()=>{};
const event={id:'new',start:80,end:90,type:'呼吸暂停候选',source:'detector',status:'candidate',mode:'raw',note:'v4',channels:['流量'],detection_profile:'patient_flow_v4',detection_method:'absolute_mean',detection_window_seconds:5,detection_min_duration:10,detection_version:'patient-flow-v4-v1',evidence:{schema:1,minimum_duration:10,review_flags:[]}};
annotations={items:[event,{...event,id:'old',type:'强度显著下降候选',detection_profile:'dynamic_baseline_v3'}]};
$('scan-profile').value='patient_flow_v4';$('scan-profile').onchange();
`);
assert.equal(read("$('baseline-window').value"),'5');assert.equal(read("$('baseline-method').value"),'absolute_mean');assert.equal(read("$('baseline-method').disabled"),true);assert.equal(read("$('baseline-duration').disabled"),true);assert.equal(Number(read("$('scan-duration').value")),10);
assert.equal(read("$('baseline-window').options.every(o=>!o.disabled)"),true);
assert.deepEqual(json('[...chosenDetectionTypes]'),['呼吸暂停候选','低通气候选','数据缺失','信号异常']);
assert.deepEqual(json('visibleEvents(annotations.items).map(e=>e.id)'),['new']);
assert.equal(read("channelLabel('流量')"),'流量 · 患者呼吸流量 [L/min]');
read("$('show-company-a').onclick()");assert.equal(read("selected.includes('患者流量v45秒10%门限')"),true);assert.equal(read("selected.includes('患者流量v45秒1秒参考')"),true);assert.equal(read("selected.some(n=>allOptimizedNames.includes(n))"),false);
const key=read('selectionKey()');read("$('baseline-window').value='6';$('baseline-window').onchange()");assert.notEqual(read('selectionKey()'),key);assert.equal(read("selected.includes('患者流量v46秒强度')"),true);
read("$('baseline-duration').value='5';$('baseline-duration').onchange()");assert.equal(Number(read("$('scan-duration').value")),10);
read("$('scan-profile').value='dynamic_baseline_v3';$('scan-profile').onchange();$('baseline-method').value='centered_rms';$('baseline-window').value='3';$('baseline-duration').value='6';$('baseline-duration').onchange();$('scan-profile').value='patient_flow_v4';$('scan-profile').onchange()");
assert.equal(read("$('baseline-method').disabled"),true);assert.equal(read("selected.some(n=>allOptimizedNames.includes(n))"),false);
read("$('scan-profile').value='dynamic_baseline_v3';$('scan-profile').onchange()");assert.equal(read("$('baseline-window').value"),'3');assert.equal(read("$('baseline-method').value"),'centered_rms');assert.equal(Number(read("$('scan-duration').value")),6);assert.equal(read("$('baseline-duration').disabled"),false);
read('jumpEvent(event)');assert.equal(read("$('scan-profile').value"),'patient_flow_v4');assert.equal(read("$('baseline-window').value"),'5');
// Server receives fixed settings even if hidden controls are tampered with.
read(`let sent;applyShared=p=>{annotations.items=p.events};api=async(url,opts)=>{const body=JSON.parse(opts.body);if(url==='/api/scans/match'){sent=body;return {match:null}}if(url==='/api/detect')return {packet:{run_id:'batch',events:annotations.items},detected_count:1,added:1,skipped:0,eligible_seconds:120,warnings:[]};if(url==='/api/feedback')return {settings:{profile:'patient_flow_v4',method:'absolute_mean',window_seconds:5,min_duration:10,event_types:detectionTypes.patient_flow_v4},events:[{id:'new'}]};throw Error(url)};$('scan-duration').value='5';$('baseline-method').value='detrended_abs';`);
await read('scanRecording(true)');assert.equal(read('sent.min_duration'),10);assert.equal(read('sent.dynamic_method'),'absolute_mean');assert.equal(read('sent.profile'),'patient_flow_v4');assert.equal(read("$('baseline-method').disabled"),true);assert.equal(read("$('baseline-duration').disabled"),true);
assert.deepEqual(json('visibleEvents(annotations.items).map(e=>e.id)'),['new']);
const model=new AnnotationModel({file_id:'v4',raw_duration:200,display_duration:200,channels:['流量']},{setItem(){}}),event=json('event');model.save(event);model.save({...event,status:'reviewed',note:'复核'});assert.equal(model.export().events[0].detection_profile,'patient_flow_v4');assert.deepEqual(model.export().events[0].evidence,event.evidence);assert.throws(()=>model.save({...event,detection_method:'detrended_abs'}));assert.throws(()=>model.save({...event,detection_min_duration:5}));assert.throws(()=>model.save({...event,detection_window_seconds:11}));
read("annotations.items=[{...event,evidence:{...event.evidence,threshold_met_at:91,confirmed_at:90,finalized_at:105}}];renderEventList()");
let rendered=JSON.stringify(elements.get('event-list').children);assert(rendered.includes('门限达标时间 2026-01-01 00:01:31'));assert(rendered.includes('结果形成时间 2026-01-01 00:01:45'));assert(!rendered.includes('达标确认'));assert(rendered.includes('原始源秒连续达标至少10秒'));
read("annotations.items=[{...event,evidence:{...event.evidence,confirmed_at:90}}];renderEventList()");rendered=JSON.stringify(elements.get('event-list').children);assert(rendered.includes('门限达标时间 2026-01-01 00:01:30'));assert(rendered.includes('结果形成时间 未记录'));
const html=readFileSync('event_detection/index.html','utf8');assert(html.includes('value="dynamic_baseline_v3" selected'));assert(html.includes('低通气尚未接入血氧下降或觉醒证据'));assert(html.includes('暂停与低通气两类候选均需原始源秒连续达标至少10秒，并有主窗口支持'));
assert(read("scanLabel({created_at:'2026-01-01',title:'v4',detected_count:1,settings:{profile:'patient_flow_v4',version:'v1'}}).includes('[患者流量v4]')"));
console.log('PASS: patient v4 defaults, fixed10s, method/window controls, v3 preference restore, profile/batch/trace isolation, scan payload, immutable review/export and labels');
})().catch(e=>{console.error(e);process.exitCode=1});
