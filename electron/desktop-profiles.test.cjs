const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { DesktopProfileStore } = require('./desktop-profiles.cjs');
const { createDesktopProfiles, disableDshExtensions, restoreDshExtensions } = require('./desktop-recovery.cjs');

function profileFolder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'somnus-profiles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

function controller(root, switches = {}) {
  const windows = [];
  const restarts = [];
  const handlers = new Map();
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: {}, session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} },
        setWindowOpenHandler() {},
      });
      windows.push(this);
    }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    show() {}
    focus() {}
  }
  const manager = createDesktopProfiles({
    app: {
      commandLine: { getSwitchValue: key => switches[key] ?? '', hasSwitch: key => Boolean(switches[key]) },
      getVersion: () => 'test',
    },
    BrowserWindow,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: {
      showMessageBox: async () => ({ response: 1 }),
      showSaveDialog: async () => ({ canceled: false, filePath: path.join(root, 'diagnostics.json') }),
    },
    baseDir: root, isolatedDefault: Boolean(switches['user-data-dir']),
    restart: args => restarts.push(args),
  });
  const use = (action, value) => {
    const contents = windows.at(-1).webContents;
    return handlers.get('somnus-runtime-profiles')({ sender: contents, senderFrame: contents.mainFrame }, action, value);
  };
  return { manager, windows, restarts, use, handlers };
}

test('named runtime profile isolates settings, DSH and data from the unchanged default', async t => {
  const root = profileFolder(t);
  const store = new DesktopProfileStore(root);
  assert.deepEqual(store.resolve('default'), {
    id: 'default', name: '默认配置', roamingDir: root, dataDir: undefined,
  });
  const legacy = path.join(root, 'external-acp-agents.json');
  fs.writeFileSync(legacy, 'existing agents');
  const desktop = controller(root);
  await desktop.manager.openProfiles();
  assert.equal(desktop.manager.focus(), true);
  const created = await desktop.use('create', '研究');
  const { id } = created.profiles.find(row => row.name === '研究');
  desktop.manager.markHealthy();
  await desktop.use('select', id);
  assert.equal(desktop.restarts.length, 1);
  const named = controller(root);
  assert.equal(named.manager.active.id, id);
  assert.equal(named.manager.environment().SOMNUS_PROFILE_CONFIG_ONLY, '1');
  assert.equal(named.manager.environment().AI_AGENT_DATA_DIR, store.resolve(id).dataDir);
  assert.equal(named.manager.environment().SOMNUS_DESKTOP_ROAMING_DIR, store.resolve(id).roamingDir);
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'existing agents');
  assert.equal(fs.existsSync(path.join(named.manager.active.roamingDir, 'external-acp-agents.json')), false);
  for (const mode of ['acp', 'web']) {
    const file = path.join(named.manager.active.roamingDir, 'dsh-home', 'profiles', mode, 'package.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(data.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-' + mode + '-app']);
  }
  const recovery = controller(root, { recovery: true });
  assert.equal(recovery.manager.isRecovery, true);
  await recovery.manager.openRecovery(Error('private detail'));
  assert.match(recovery.windows[0].url, /^data:text\/html/);
  assert.match(recovery.windows[0].options.webPreferences.partition, /^somnus-profile-window-/);
  assert.equal((await recovery.use('status')).rollback.id, 'default');
  await assert.rejects(recovery.handlers.get('somnus-runtime-profiles')({ sender: {} }, 'status'));
  assert.equal(await recovery.use('diagnostics'), true);
  const diagnostics = fs.readFileSync(path.join(root, 'diagnostics.json'), 'utf8');
  assert.equal(JSON.parse(diagnostics).startupFailed, true);
  assert.ok(!diagnostics.includes('private detail') && !diagnostics.includes('研究'));
  await recovery.use('rollback');
  assert.equal(store.read().active, 'default');
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'existing agents');
});

test('broken registry recovers named profile folders and safe mode keeps the temporary data directory', async t => {
  const root = profileFolder(t);
  const options = { 'user-data-dir': root };
  const store = new DesktopProfileStore(root, true);
  const item = store.create('可恢复');
  const data = path.join(store.resolve(item.id).dataDir, 'sample.csv');
  fs.writeFileSync(data, 'historical file');
  fs.writeFileSync(store.file, 'corrupted');
  const recovery = controller(root, options);
  assert.equal(recovery.manager.isRecovery, true);
  await recovery.manager.openRecovery();
  assert.equal((await recovery.use('status')).registryValid, false);
  await recovery.use('reset-registry');
  assert.equal(store.read().active, 'default');
  assert.equal(store.resolve(item.id).name, item.name);
  assert.equal(fs.readFileSync(data, 'utf8'), 'historical file');
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('runtime-profiles.invalid-')));
  const next = controller(root, { ...options, recovery: true });
  await next.manager.openRecovery();
  await next.use('safe');
  assert.deepEqual(next.restarts[0], ['--user-data-dir=' + root, '--safe-mode']);
  const safe = controller(root, { ...options, 'safe-mode': true });
  assert.deepEqual(safe.manager.environment(), { SOMNUS_DESKTOP_ROAMING_DIR: safe.manager.active.roamingDir,
    AI_AGENT_DATA_DIR: path.join(root, 'data'), SOMNUS_PROFILE_CONFIG_ONLY: 'safe' });
  safe.manager.markHealthy();
  assert.equal(store.read().lastHealthy, null);
});

test('DSH recovery preserves plugin files, original profile bytes and other profiles', t => {
  const store = new DesktopProfileStore(profileFolder(t));
  const active = store.resolve(store.create('待修复').id);
  const untouched = store.resolve(store.create('独立').id);
  const manifest = profile => path.join(profile.roamingDir, 'dsh-home', 'profiles', 'acp', 'package.json');
  const patch = path.join(path.dirname(manifest(active)), 'cordis.patch.yml');
  const composition = JSON.parse(fs.readFileSync(manifest(active)));
  composition.dsh.profile.bundles.push('dsh-example');
  composition.dependencies['dsh-example'] = '1.0.0';
  const original = JSON.stringify(composition);
  fs.writeFileSync(manifest(active), original);
  fs.writeFileSync(patch, '- custom\n');
  const other = fs.readFileSync(manifest(untouched), 'utf8');
  disableDshExtensions(active);
  const disabled = JSON.parse(fs.readFileSync(manifest(active)));
  assert.equal(disabled.dsh.profile.bundles.includes('dsh-example'), false);
  assert.equal(disabled.dependencies['dsh-example'], '1.0.0');
  assert.equal(fs.readFileSync(patch, 'utf8'), '[]\n');
  restoreDshExtensions(active);
  assert.equal(fs.readFileSync(manifest(active), 'utf8'), original);
  assert.equal(fs.readFileSync(patch, 'utf8'), '- custom\n');
  assert.equal(fs.readFileSync(manifest(untouched), 'utf8'), other);
});
