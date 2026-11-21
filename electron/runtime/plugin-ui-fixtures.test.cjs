const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');const {ownedDocument}=require('./declarative-ui.cjs');
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'../../tests/fixtures/plugin-ui-contract.json'),'utf8')).cases;
for(const row of cases)test('shared plugin UI contract: '+row.name,()=>{if(row.valid)assert.doesNotThrow(()=>ownedDocument(row.document,row.plugin_id));else assert.throws(()=>ownedDocument(row.document,row.plugin_id));});
