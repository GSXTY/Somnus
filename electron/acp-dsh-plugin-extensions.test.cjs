const assert = require('node:assert/strict');
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os'); const path = require('node:path'); const test = require('node:test');
const { pluginExtensions } = require('./acp-dsh-plugin-pages.cjs');

test('extension registry only opens enabled owned pages, describes unadapted slots and scopes known cards', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'somnus-extension-fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'panel'));await writeFile(path.join(root,'panel','index.html'),'<h1>synthetic</h1>');
  const id='@example/synthetic', other='@example/raw-ui';
  const manifests={ [id]:{dsh:{somnus:{pages:[{id:'main',title:'Synthetic settings',directory:'panel',sidebar:true}],extensions:[
    {id:'settings',label:'Model settings',slot:'settings',renderer:'page',pageId:'main'},
    {id:'card',label:'Unknown card',slot:'chat-card',renderer:'recommendation'},
    {id:'escape',label:'Cross-plugin page',slot:'sidebar',renderer:'page',pageId:other+'#main'},
    {id:'raw',label:'Unknown slot',slot:'native-slot',renderer:'page',pageId:'main'},
  ]}}}, [other]:{name:other,dsh:{client:{main:'client.js'}}} };
  let enabled=[id,other,'@deepseek-ai/dsh-personalized-recommendations'];
  const market={webProfile:async()=>({bundles:enabled}),community:{installed:async(_profile,name)=>manifests[name],packageRoot:async()=>root}};
  const rows=await pluginExtensions(market);
  assert(rows.some(row=>row.label==='Model settings'&&row.compatibility==='ready'&&row.pageId===id+'#main'));
  assert(rows.some(row=>row.pluginId===id&&row.slot==='sidebar'&&row.compatibility==='ready'));
  assert(rows.filter(row=>['Unknown card','Cross-plugin page','Unknown slot'].includes(row.label)).every(row=>row.compatibility==='adapter-required'&&!row.pageId));
  assert(rows.some(row=>row.pluginId===other&&row.compatibility==='adapter-required'));
  assert(rows.some(row=>row.renderer==='recommendation'&&row.compatibility==='ready'&&row.pluginId.startsWith('@deepseek-ai/')));
  assert(!JSON.stringify(rows).includes(root));
  assert((await pluginExtensions(market,id)).every(row=>row.pluginId===id));
  enabled=[other];
  const disabled=await pluginExtensions(market);
  assert(!disabled.some(row=>row.pluginId===id||row.renderer==='recommendation'));
});
