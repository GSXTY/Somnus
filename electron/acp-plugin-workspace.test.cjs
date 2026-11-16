const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { registerPluginWorkspace } = require('./acp-plugin-workspace.cjs');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-plugin-workspace-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'Somnus-Plugins');
  const profileDir = path.join(root, 'profile');
  const personal = path.join(workspace, 'personal');
  const defaults = path.join(workspace, 'default');
  await Promise.all([personal, defaults, profileDir].map(folder => fs.mkdir(folder, { recursive: true })));
  await fs.writeFile(path.join(profileDir, 'somnus-plugin-workspace.json'), JSON.stringify({ directory: workspace }));
  const window = new EventEmitter();
  const origin = 'http://127.0.0.1:1234';
  const token = 'fixture-native-token';
  window.webContents = { mainFrame: { url: origin + '/' } };
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const handlers = new Map();
  const model = { owner: true, response: 0, selected: null, opened: [], candidate: null, confirmations: 0, updates: 0 };
  registerPluginWorkspace({ ipcMain: { handle: (name, handler) => handlers.set(name, handler),
    removeHandler: name => handlers.delete(name) }, window, origin, token, profileDir, env: {},
  dialog: {
    showOpenDialog: async () => ({ canceled: !model.selected, filePaths: model.selected ? [model.selected] : [] }),
    showMessageBox: async () => { model.confirmations++; return { response: model.response }; },
  }, shell: { openPath: async target => { model.opened.push(target); return ''; } },
  request: async (address, secret, endpoint) => {
    assert.equal(address, origin);
    assert.equal(secret, token);
    if (endpoint === '/plugins/defaults') return { owner_configured: model.owner };
    assert.equal(endpoint, '/plugins/development/candidates/' + model.candidate.id);
    model.updates++;
    return { candidate: model.candidate };
  } });
  const invoke = (name, ...args) => handlers.get('somnus-plugin-workspace:' + name)(event, ...args);
  return { root, window, personal, defaults, handlers, model, invoke };
}

test('personal selection stays inside the configured normal directory', async t => {
  const { root, window, personal, defaults, model, invoke, handlers } = await fixture(t);
  assert.deepEqual(await invoke('status'), { configured: true, owner: true, personalPath: personal, defaultPath: defaults });
  model.owner = false;
  assert.deepEqual(await invoke('status'), { configured: true, owner: false, personalPath: personal });
  await assert.rejects(invoke('open-folder', 'default'), /只有本机插件所有者/);
  await invoke('open-folder', 'personal');
  assert.deepEqual(model.opened, [personal]);
  assert.equal(await invoke('choose-personal-manifest'), null);
  const manifest = { name: '示例插件' };
  model.selected = path.join(root, 'outside.json');
  await fs.writeFile(model.selected, JSON.stringify(manifest));
  await assert.rejects(invoke('choose-personal-manifest'), /personal 工作区/);
  const link = path.join(personal, 'linked');
  await fs.symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  model.selected = path.join(link, 'outside.json');
  await assert.rejects(invoke('choose-personal-manifest'), /链接|重定向/);
  model.selected = path.join(personal, 'plugin.json');
  await fs.writeFile(model.selected, '\ufeff' + JSON.stringify(manifest));
  assert.deepEqual(await invoke('choose-personal-manifest'), { name: 'plugin.json', manifest });
  await assert.rejects(handlers.get('somnus-plugin-workspace:status')({ sender: window.webContents, senderFrame: {} }), /Somnus/);
  window.emit('closed');
  assert.equal(handlers.size, 0);
});

test('only owner approval can save the exact candidate and never overwrite', async t => {
  const { defaults, model, invoke } = await fixture(t);
  const id = 'a'.repeat(32);
  const manifest = { version: '1.0.0-beta.1', name: '示例插件', skill_ids: ['b'.repeat(32)] };
  const canonical = JSON.stringify({ name: manifest.name, skill_ids: manifest.skill_ids, version: manifest.version });
  const sha256 = createHash('sha256').update(canonical).digest('hex');
  model.candidate = { id, sha256, manifest, report: { ok: true, checks: [] }, created_at: 1 };
  model.owner = false;
  await assert.rejects(invoke('save-candidate', id), /只有本机插件所有者/);
  assert.equal(model.confirmations, 0);
  model.owner = true;
  await assert.rejects(invoke('save-candidate', '../outside'), /请选择/);
  model.response = 1;
  assert.equal(await invoke('save-candidate', id), null);
  assert.deepEqual(await fs.readdir(defaults), []);
  model.response = 0;
  model.candidate.sha256 = 'b'.repeat(64);
  await assert.rejects(invoke('save-candidate', id), /快照不一致/);
  model.candidate.sha256 = sha256;
  const expected = path.join(defaults, id);
  assert.deepEqual(await invoke('save-candidate', id), { path: expected });
  assert.equal(await fs.readFile(path.join(expected, 'plugin.json'), 'utf8'), canonical);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(expected, 'review.json'), 'utf8')),
    { id, sha256, report: model.candidate.report, created_at: 1 });
  await assert.rejects(invoke('save-candidate', id), /已保存/);
});
