const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DshPluginMarket } = require('./acp-dsh-market.cjs');

const version = '0.2.2-rc.1';
const badge = '@deepseek-ai/dsh-experimental-badge-skill-bundle';
const recommendations = '@deepseek-ai/dsh-personalized-recommendations';
const active = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'];

test('managed DSH exposes only authorized pinned bundle changes in its own profile', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vvman-dsh-market-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = path.join(root, 'profile');
  const resources = path.join(root, 'resources');
  const market = new DshPluginMarket(profile, resources);
  async function put(file, text) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof text === 'string' ? text : JSON.stringify(text));
  }
  const plugin = path.join(profile, 'dsh-runtime', version, 'node_modules', badge);
  const runtime = path.join(profile, 'dsh-runtime', version, 'node_modules', '@deepseek-ai', 'dsh');
  const manifest = path.join(market.home, 'profiles', 'acp', 'package.json');
  const personal = path.join(root, 'personal', 'profiles', 'acp', 'package.json');
  const data = { name: 'dsh-profile-acp', private: true, dependencyFixture: true, dsh: { profile: { bundles: active } } };
  assert.deepEqual((await market.status()).runtime, { installed: false, version: null });
  await put(path.join(resources, 'agents', 'codex', 'node.exe'), 'exe');
  await put(path.join(runtime, 'package.json'), { name: '@deepseek-ai/dsh', version, bin: { dsh: './lib/bin.js' } });
  await put(path.join(runtime, 'lib', 'bin.js'), 'node source');
  await put(path.join(plugin, 'package.json'), { name: badge, version, dsh: { bundle: { patch: './cordis.patch.yml' } } });
  await put(path.join(plugin, 'cordis.patch.yml'), '# bundle');
  await put(manifest, data);
  await put(personal, data);
  const launch = await market.launch();
  assert.ok(await market.ownsLaunch(launch));
  assert.deepEqual(launch.args.slice(1), ['--profile', 'acp']);
  assert.deepEqual((await market.status()).runtime, { installed: true, version });
  assert.deepEqual(await market.installedPlugins(), { plugins: [] });
  await assert.rejects(market.setEnabled('../arbitrary', true), /暂无法/);
  await assert.rejects(market.setEnabled('session-titles', true), /暂无法/);
  const result = await market.setEnabled('badge-skill', true);
  assert.ok(result.plugins.find(plugin => plugin.id === 'badge-skill').installed);
  assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), {
    ...data, dsh: { profile: { bundles: [...active, badge] } }, vvman: { installedOfficialPlugins: [badge] },
  });
  assert.deepEqual(JSON.parse(await readFile(personal, 'utf8')), data);
  const disabled = await market.setEnabled('badge-skill', false);
  assert.equal(disabled.plugins.find(plugin => plugin.id === 'badge-skill').installed, false);
  assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), { ...data, vvman: { installedOfficialPlugins: [badge] } });
});

test('installed inventory reads managed plugin packages offline and retains disabled official selections', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vvman-dsh-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const market = new DshPluginMarket(root, root);
  market.launch = async () => ({});
  market.available = async () => true;
  market.community.fetch = async () => assert.fail('inventory contacted the community market');
  const folder = path.join(market.home, 'profiles', 'acp');
  const dependencies = {};
  const allIds = Array.from({ length: 42 }, (_, index) => 'dsh-community-' + index.toString().padStart(2, '0'));
  for (const id of [...allIds, 'unrelated-package', 'missing-patch']) {
    dependencies[id] = '1.2.3';
    const pkg = path.join(folder, 'node_modules', id);
    await mkdir(pkg, { recursive: true });
    const manifest = { name: id, version: '1.2.3' };
    if (id !== 'unrelated-package') manifest.dsh = { bundle: { patch: ['plugin.yml'] } };
    await writeFile(path.join(pkg, 'package.json'), JSON.stringify(manifest));
    if (id !== 'missing-patch') await writeFile(path.join(pkg, 'plugin.yml'), '# bundle');
  }
  const manifest = path.join(folder, 'package.json');
  const data = { name: 'dsh-profile-acp', private: true, dependencies,
    dsh: { profile: { bundles: [...active, badge, recommendations, allIds[41]] } } };
  await writeFile(manifest, JSON.stringify(data));
  const inventory = await market.installedPlugins();
  assert.deepEqual(inventory.plugins.map(({ id, source, enabled }) => [id, source, enabled]), [
    ['badge-skill', 'official', true], [recommendations, 'official', true],
    ...allIds.map((id, index) => [id, 'community', index === 41]),
  ]);
  assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), data);
  const disabled = await market.setInstalledEnabled('badge-skill', 'official', false, () => {});
  assert.equal(disabled.plugins.find(item => item.id === 'badge-skill').enabled, false);
  const communityDisabled = await market.setInstalledEnabled(allIds[41], 'community', false, () => {}, {
    confirm: async () => assert.fail('disable requires no additional confirmation'),
  });
  assert.equal(communityDisabled.plugins.find(item => item.id === allIds[41]).enabled, false);
});
