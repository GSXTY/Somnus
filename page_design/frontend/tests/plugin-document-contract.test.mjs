import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {safePluginDocument} from '../src/plugins/pluginDocument.mjs';
const host=createRequire(import.meta.url)('../../../electron/runtime/declarative-ui.cjs');
const good={version:1,blocks:[{type:'table',columns:[{key:'name',label:'Name'}],rows:[{name:'Somnus'}]},{type:'chart',chartType:'line',labels:['Mon','Tue'],series:[{label:'Sessions',values:[1,2]}]},{type:'status',state:'running',label:'Working'},{type:'form',fields:[{key:'title',label:'Title',kind:'string',value:'Hi'}],submitActionId:'save'}],actions:[{type:'save-own-settings',id:'save',label:'Save',sectionId:'main',revision:0}]};
test('same real host and browser accept the expanded UI contract',()=>{assert(safePluginDocument(good));assert.deepEqual(host.document(good),good);});
test('same real validators reject unsafe fields, mismatched forms and graph dimensions',()=>{for(const alter of [doc=>doc.blocks[0].rows[0].script='x',doc=>doc.blocks[1].series[0].values=[NaN],doc=>doc.blocks[3].fields[0].key='__proto__',doc=>doc.blocks[3].submitActionId='missing',doc=>doc.actions[0].pluginId='another']){const doc=structuredClone(good);alter(doc);assert.equal(safePluginDocument(doc),null);assert.throws(()=>host.document(doc));}});
test('UTF8 byte ceiling and malformed surrogate text match host validation',()=>{for(const text of ['🙂'.repeat(8500),'broken'+String.fromCharCode(0xd800)]){const doc={version:1,blocks:[{type:'text',text}]};assert.equal(safePluginDocument(doc),null);assert.throws(()=>host.document(doc));}});

const shared=JSON.parse(readFileSync(new URL('../../../tests/fixtures/plugin-ui-contract.json',import.meta.url),'utf8'));
for(const entry of shared.cases)test('shared production UI contract: '+entry.name,()=>{
 assert.equal(Boolean(safePluginDocument(entry.document,entry.plugin_id)),entry.valid);
 let accepted=true;try{host.ownedDocument(entry.document,entry.plugin_id);}catch{accepted=false;}
 assert.equal(accepted,entry.valid);
});
