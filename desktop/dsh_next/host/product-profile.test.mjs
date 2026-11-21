import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { PRODUCT_APP_ID, productProfile } from './product-profile.mjs';

test('SomnusNext has independent product identity and isolated default configuration', async () => {
  const appData = resolve('fixture-appdata');
  assert.equal(productProfile(appData), join(appData, 'VVFLY', 'SomnusNext'));
  assert.notEqual(PRODUCT_APP_ID, 'com.vvfly.respiratoryviewer');
  assert.equal(productProfile(appData, './isolated-test'), resolve('./isolated-test'));
  const desktop = await readFile(new URL('./somnus-desktop.ts', import.meta.url), 'utf8');
  assert.ok(desktop.includes('new DesktopProfileStore(baseDir, true)'));
  assert.ok(desktop.includes('isolatedDefault: true'));
  assert.ok(desktop.includes("SOMNUS_DSH_CONFIGURED_PROVIDERS: '1'"));
  assert.ok(!desktop.includes("join(app.getPath('appData'), 'RespiratoryViewer')"));
  const main = await readFile(new URL('./standalone-main.mjs', import.meta.url), 'utf8');
  assert.ok(main.includes('startAcpHost(service.profileDir)'));
  assert.ok(main.includes("SOMNUS_ACP_CWD: join(profileDir, 'workspace')"));
});


test('pinned DSH default model service accepts an empty unresolved Somnus selection without invented options', async () => {
  const vm = await import('node:vm');
  const archive = await readFile(new URL('../upstream/app.asar', import.meta.url));
  const headerSize = archive.readUInt32LE(4);
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
  function read(name) {
    const entry = name.split('/').reduce((node, part) => node.files[part], header);
    return archive.subarray(8 + headerSize + Number(entry.offset), 8 + headerSize + Number(entry.offset) + entry.size).toString();
  }
  const cosmokit = await import('data:text/javascript;base64,' + Buffer.from(read('dsh/node_modules/@deepseek-ai/cosmokit/lib/index.js')).toString('base64'));
  const schemaModule = { exports: {} };
  vm.runInNewContext(read('dsh/node_modules/@deepseek-ai/schemastery/lib/index.cjs'), {
    module: schemaModule, require(name) { assert.equal(name, '@deepseek-ai/cosmokit'); return cosmokit; },
  });
  const source = read('dsh/node_modules/@deepseek-ai/dsh-agent-default-model/lib/index.js')
    .replace(/^import .+;$/gm, '').replace(/export \{[^}]+\};/, '');
  const Service = class { constructor(ctx) { this.ctx = ctx; } };
  const DefaultModel = vm.runInNewContext(source + '\nAgentDefaultModelConfig;', {
    Service, z: schemaModule.exports, ReasoningEffortId: value => value,
  });
  const parsed = DefaultModel.Config({ provider: 'vvman-company', model: '' });
  const service = new DefaultModel({ inject() {} }, parsed);
  assert.equal(service.currentSelection().provider, 'vvman-company');
  assert.equal(service.currentSelection().model, '');
});
