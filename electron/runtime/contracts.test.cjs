const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pluginContract,pluginContractView}=require('./plugin-contract.cjs');
test('DSH contract preserves legacy and rejects unsupported declarations on installation',()=>{
 assert.equal(pluginContract({}).legacy,true);
 const metadata={dsh:{somnus:{contract:{schema_version:1,minimum_somnus_version:'0.3.0',capabilities:['skills','mcp']}}}};
 assert.equal(pluginContract(metadata,'0.3.1').compatibility,'compatible');
 assert.throws(()=>pluginContract(metadata,'0.2.0'),/更新版本/);
 assert.throws(()=>pluginContract(metadata,'0.3.0-beta.1'),/更新版本/);
 assert.throws(()=>pluginContract({dsh:{somnus:{contract:{schema_version:2}}}}),/不受支持/);
 assert.throws(()=>pluginContract({dsh:{somnus:{contract:{schema_version:1,capabilities:['arbitrary-ui']}}}}),/能力/);
 assert.equal(pluginContract({dsh:{client:{},somnus:{contract:{schema_version:1}}}}).compatibility,'requires-adapter');
});
test('runtime dependencies stay inside host adapter layer, installed and page entries validate real contracts',()=>{
 for(const name of fs.readdirSync(__dirname).filter(name=>name.endsWith('.cjs')&&!name.includes('.test.'))){
  const source=fs.readFileSync(path.join(__dirname,name),'utf8');
  for(const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g))assert(match[1].startsWith('node:')||/^\.\/[^/]+\.cjs$/.test(match[1]),name+' crosses runtime module boundary: '+match[1]);
 }
 const community=fs.readFileSync(path.join(__dirname,'../acp-dsh-community.cjs'),'utf8');assert.match(community,/async validateBundle\(metadata\) \{\s*pluginContract\(metadata/);
 const pages=fs.readFileSync(path.join(__dirname,'../acp-dsh-plugin-pages.cjs'),'utf8');assert.match(pages,/pluginContract\(installed, market.appVersion\)/);
});

test('minimum SemVer compares numeric prerelease, labels, stable and build metadata; listing remains readable',()=>{
 const metadata=version=>({dsh:{somnus:{contract:{schema_version:1,minimum_somnus_version:version}}}});
 assert.throws(()=>pluginContract(metadata('0.3.0-beta.10'),'0.3.0-beta.9'),/更新版本/);
 assert.throws(()=>pluginContract(metadata('0.3.0-rc.1'),'0.3.0-beta.10'),/更新版本/);
 assert.throws(()=>pluginContract(metadata('0.3.0'),'0.3.0-rc.1'),/更新版本/);
 assert.equal(pluginContract(metadata('0.3.0+abc'),'0.3.0+def').compatibility,'compatible');
 assert.equal(pluginContractView(metadata('0.3.0-beta.10'),'0.3.0-beta.9').compatibility,'incompatible');
 assert.equal(pluginContractView({}).legacy,true);
});
