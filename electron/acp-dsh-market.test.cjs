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

test('managed Web waits past the regular readiness deadline for an enabled IM bundle', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-web-im-'));
  const market = new DshPluginMarket(root, root);
  const entry = path.join(root, 'entry.cjs');
  const readyUrl = 'http://127.0.0.1:32123/?token=fixture_token_12345';
  await mkdir(market.home);
  await writeFile(entry, `console.log(${JSON.stringify('dsh web: ' + readyUrl)}); setInterval(() => {}, 1000);`);
  t.after(async () => {
    await market.closeSettings();
    await rm(root, { recursive: true, force: true });
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = { imBundle: true };
  market.settingsServer = server;

  const ready = market.spawnSettings(server, { executable: process.execPath, args: [entry] });
  t.mock.timers.tick(34_000);

  assert.equal(await ready, readyUrl);
});

test('fresh Web profiles install and enable the verified IM default once and preserve earlier ownership',
  { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'somnus-default-im-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const market = new DshPluginMarket(root, root);
    const file = path.join(market.home, 'profiles', 'web', 'package.json');
    const id = '@xmanrui/dsh-im';
    const base = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
    const manifest = { name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: base } },
      vvman: { defaultIm: 'pending', unrelated: true } };
    const metadata = { name: id, version: '5.10.0', dsh: { bundle: { patch: 'patch.yml' } },
      dist: { tarball: 'https://registry.npmjs.org/@xmanrui/dsh-im/-/dsh-im-5.10.0.tgz', integrity: 'sha512-test' } };
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(manifest));
    market.launch = async () => ({});
    market.community.installer = async () => 'installer';
    market.community.validateBundle = async data => assert.equal(data.version, metadata.version);
    market.community.installed = async profile => profile?.data.dependencies[id] ? metadata : null;
    market.community.verifyBundle = async (_profile, name, data, protect) => assert.deepEqual([name, data, protect], [id, metadata, true]);
    let calls = 0;
    market.community.fetch = async url => {
      calls++;
      assert.equal(url, 'https://registry.npmjs.org/%40xmanrui%2Fdsh-im/5.10.0');
      return Response.json(metadata);
    };
    market.community.install = async (_launch, profile, _installer, name, version, mode) => {
      assert.deepEqual([name, version, mode], [id, metadata.version, 'web']);
      profile.data.dependencies[id] = version;
      await writeFile(profile.file, JSON.stringify(profile.data));
    };
    const attempts = await Promise.all([market.ensureDefaultIm(), market.ensureDefaultIm()]);
    assert.deepEqual(attempts, [{ status: 'ready' }, { status: 'ready' }]);
    const current = await market.webProfile();
    assert.deepEqual(current.bundles, [...base, id]);
    assert.deepEqual(current.data.vvman, { defaultIm: 'ready', unrelated: true });
    assert.equal(calls, 1);
    const inventory = await market.installedPlugins();
    assert.equal(inventory.plugins[0].managedDefault, true);
    assert.equal(inventory.defaultIm.status, 'ready');
    await assert.rejects(market.uninstallInstalledPlugin(id, 'community', () => {}), /Somnus/);
    await assert.rejects(market.setInstalledEnabled(id, 'community', false, () => {}), /Somnus/);
    await assert.rejects(market.community.change(id, false, () => {}, { confirm: async () => true }), /Somnus/);

    const earlier = structuredClone(manifest);
    earlier.vvman = { unrelated: true };
    earlier.dependencies = { [id]: '5.8.0' };
    await writeFile(file, JSON.stringify(earlier));
    assert.equal(await market.ensureDefaultIm(), undefined);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), earlier);
    earlier.dependencies = {};
    earlier.vvman.defaultIm = 'pending';
    await writeFile(file, JSON.stringify(earlier));
    market.community.fetch = async () => { throw new Error('offline'); };
    const failed = await market.ensureDefaultIm();
    assert.equal(failed.status, 'failed');
    assert.match(failed.message, /联网/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), earlier);
  });

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

test('official uninstall removes both registrations while preserving the profile and reusable package', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-official-uninstall-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const market = new DshPluginMarket(path.join(root, 'profile'), root, runtimeRoot);
  market.launch = async () => ({});
  const secondProfile = new DshPluginMarket(path.join(root, 'other'), root, runtimeRoot);
  const file = path.join(market.home, 'profiles', 'acp', 'package.json');
  const otherFile = path.join(secondProfile.home, 'profiles', 'acp', 'package.json');
  const packageDir = path.join(runtimeRoot, 'dsh-runtime', version, 'node_modules', badge);
  const patch = path.join(packageDir, 'cordis.patch.yml');
  const data = { name: 'dsh-profile-acp', private: true, dsh: { profile: { bundles: [...active, badge] } },
    vvman: { installedOfficialPlugins: [badge, recommendations], settingFixture: true } };
  for (const dir of [path.dirname(file), path.dirname(otherFile), packageDir]) await mkdir(dir, { recursive: true });
  const original = JSON.stringify(data);
  for (const target of [file, otherFile]) await writeFile(target, original);
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: badge, version,
    dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(patch, '# shared bundle');

  const protectedConfirm = async () => assert.fail('Protected items must not offer uninstall');
  await assert.rejects(market.uninstallInstalledPlugin(active[0], 'official', () => {}, { confirm: protectedConfirm }));
  await assert.rejects(market.uninstallInstalledPlugin(recommendations, 'community', () => {}, { confirm: protectedConfirm }));
  const confirmBadge = async ({ id, versions }) => {
    assert.equal(id, 'badge-skill');
    assert.deepEqual(versions, [version]);
    return true;
  };
  const cancelled = await market.uninstallInstalledPlugin('badge-skill', 'official', () => {}, { confirm: async () => false });
  assert.equal(cancelled.plugins.find(item => item.id === 'badge-skill').enabled, true);
  assert.equal(await readFile(file, 'utf8'), original);
  let trusted = true;
  await assert.rejects(market.uninstallInstalledPlugin('badge-skill', 'official', () => assert.ok(trusted), {
    confirm: async () => { trusted = false; return true; },
  }));
  assert.equal(await readFile(file, 'utf8'), original);

  const removed = await market.uninstallInstalledPlugin('badge-skill', 'official', () => {}, { confirm: confirmBadge });
  assert.deepEqual(removed.plugins.map(item => item.id), [recommendations]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    ...data, dsh: { profile: { bundles: active } }, vvman: { ...data.vvman, installedOfficialPlugins: [recommendations] },
  });
  const empty = await market.uninstallInstalledPlugin(recommendations, 'official', () => {}, { confirm: async () => true });
  assert.deepEqual(empty.plugins, []);
  await market.uninstallInstalledPlugin(recommendations, 'official', () => {}, { confirm: protectedConfirm });
  assert.equal(await readFile(otherFile, 'utf8'), original);
  assert.equal(await readFile(patch, 'utf8'), '# shared bundle');

  await market.setEnabled('badge-skill', true);
  assert.deepEqual((await market.installedPlugins()).plugins.map(item => [item.id, item.enabled]), [['badge-skill', true]]);
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
