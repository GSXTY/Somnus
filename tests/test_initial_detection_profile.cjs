const assert=require('node:assert/strict'),vm=require('node:vm'),{readFileSync}=require('node:fs');
const html=readFileSync('event_detection/index.html','utf8'),script=readFileSync('event_detection/viewer.js','utf8');
function freshPage(){
 const elements=new Map(),requests=[];
 function element(){return {value:'',textContent:'',clientWidth:1000,children:[],dataset:{},style:{},checked:false,addEventListener(){},setAttribute(){},replaceChildren(){this.children=[]},append(...v){this.children.push(...v)},querySelectorAll(){return []}}}
 function get(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}
 // Seed controls from the delivered HTML before executing the real startup.
 for(const match of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
  const select=get(match[1]);select.options=[...match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(option=>({value:option[1].match(/\bvalue="([^"]*)"/)?.[1]||option[2],selected:/\bselected\b/.test(option[1]),disabled:/\bdisabled\b/.test(option[1]),hidden:/\bhidden\b/.test(option[1]),textContent:option[2],dataset:{}}));
  select.value=(select.options.find(o=>o.selected)||select.options.find(o=>!o.disabled))?.value||'';
 }
 for(const match of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)){
  get(match[1]).value=match[0].match(/\bvalue="([^"]*)"/)?.[1]||'';
  get(match[1]).checked=/\bchecked\b/.test(match[0]);
 }
 const context=vm.createContext({document:{getElementById:get,createElement:element,createTextNode:text=>({textContent:text})},window:{addEventListener(){}},localStorage:{getItem(){return null},setItem(){}},fetch(url){requests.push(url);return new Promise(()=>{})},URLSearchParams,AbortController,requestAnimationFrame(){return 1},setTimeout(){return 1},clearTimeout(){},console,devicePixelRatio:1});
 vm.runInContext(script,context);
 return {read:code=>vm.runInContext(code,context),get,requests};
}
const page=freshPage(),{read,get}=page;
assert.equal(get('scan-profile').value,'dynamic_baseline_v3');
assert.equal(get('baseline-method').value,'detrended_abs');
assert.equal(get('baseline-window').value,'8','preserve the existing v3 initialization window');
assert.equal(Number(get('scan-duration').value),10);
assert.equal(get('baseline-method').disabled,false);
assert.equal(get('baseline-duration').disabled,false);
assert.equal(read('activeBaselineProfile'),'dynamic_baseline_v3');
assert.deepEqual(JSON.parse(read('JSON.stringify([...chosenDetectionTypes])')),['强度显著下降候选','强度减弱候选','数据缺失','信号异常']);
assert(!page.requests.some(url=>/\/api\/(detect|events|scans)/.test(url)),'startup does not scan or write events');
read("$('scan-profile').value='patient_flow_v4';$('scan-profile').onchange()");
assert.equal(get('baseline-method').value,'absolute_mean');
assert.equal(get('baseline-window').value,'5');
assert.equal(Number(get('scan-duration').value),10);
assert.equal(get('baseline-duration').disabled,true);
read("$('baseline-window').value='7';$('baseline-window').onchange();$('scan-profile').value='dynamic_baseline_v3';$('scan-profile').onchange()");
assert.equal(get('baseline-window').value,'8');
read("$('baseline-method').value='centered_rms';$('baseline-window').value='3';$('baseline-duration').value='6';$('baseline-duration').onchange();$('scan-profile').value='patient_flow_v4';$('scan-profile').onchange()");
assert.equal(get('baseline-window').value,'7','keep explicit v4 window in the existing page session');
read("$('scan-profile').value='dynamic_baseline_v3';$('scan-profile').onchange()");
assert.equal(get('baseline-method').value,'centered_rms');
assert.equal(get('baseline-window').value,'3');
assert.equal(Number(get('scan-duration').value),6);
const reopened=freshPage();
assert.equal(reopened.get('scan-profile').value,'dynamic_baseline_v3','a new page uses the requested default');
assert.equal(reopened.get('baseline-window').value,'8');
console.log('PASS: real HTML startup defaults to v3 with existing8/10 controls, manual v4 and explicit in-session parameter preferences survive without scanning');
