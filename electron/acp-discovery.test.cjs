const assert = require('node:assert/strict');
const { copyFile, mkdir, mkdtemp, realpath, readdir, rm, symlink, writeFile } = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { detectAdapter, detectManagedCodex } = require('./acp-discovery.cjs');
const { registerAcpAgents } = require('./acp-ipc.cjs');

test('managed DSH reconnect keeps its ID and checkpoint verifies separate account state', { skip: process.platform !== 'win32' }, async t => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'somnus-dsh-checkpoint-'));
  const origin = 'http://127.0.0.1:8765';
  const frame = { url: origin + '/' };
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.webContents = Object.assign(new EventEmitter(), { mainFrame: frame });
  const event = { sender: window.webContents, senderFrame: frame };
  const handlers = new Map();
  const agents = registerAcpAgents({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    window, origin, profileDir, resourcesPath: profileDir, token: 'test-native-token', version: '1.0.0',
  });
  t.after(async () => {
    window.emit('closed');
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5 });
  });
  const args = [path.join(profileDir, 'managed-dsh.cjs'), '--profile', 'acp'];
  const launch = { name: 'DeepSeek Harness 官方 ACP', executable: await realpath(process.execPath), args };
  const old = { ...launch, id: 'existing-dsh', executable: path.join(profileDir, 'old', 'resources', 'agents', 'codex', 'node.exe') };
  const custom = { ...old, id: 'custom-acp', executable: launch.executable, args: [args[0], '--custom'] };
  await writeFile(agents.file, JSON.stringify([old, custom]));
  t.mock.method(agents.dshMarket, 'launch', async () => launch);
  t.mock.method(agents.dshMarket, 'profile', async () => ({ bundles: [] }));
  t.mock.method(agents.dshMarket, 'ownsLaunch', async agent => agent.args[0] === args[0]);
  const probe = t.mock.method(agents, 'probe', async () => ({ authentication: 'unverified' }));
  let state = 'signed-out';
  const account = t.mock.method(agents.dshMarket, 'accountStatus', async validateSender => {
    validateSender();
    return { state };
  });
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.href, origin + '/api/assistant/configuration-checkpoints');
    assert.deepEqual(JSON.parse(options.body), {
      revision: 'a'.repeat(64), agent: { id: old.id, name: old.name },
    });
    return new Response('{"id":"checkpoint"}', { status: 201 });
  });
  const connect = handlers.get('vvman-acp:connect-managed-dsh');
  const first = await connect(event);
  assert.equal(first.agent.id, old.id);
  assert.equal(first.agent.executable, launch.executable);
  assert.equal((await connect(event)).agent.id, old.id);
  assert.deepEqual((await agents.list()).map(item => item.id), [old.id, custom.id]);
  const save = handlers.get('vvman-acp:save-configuration-checkpoint');
  await assert.rejects(save(event, old.id, 'a'.repeat(64)), /账号尚未通过验证/);
  await assert.rejects(save(event, custom.id, 'a'.repeat(64)), /账号尚未通过验证/);
  assert.equal(account.mock.callCount(), 1);
  assert.equal(fetch.mock.callCount(), 0);
  state = 'signed-in';
  assert.deepEqual(await save(event, old.id, 'a'.repeat(64)), { id: 'checkpoint' });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(probe.mock.callCount(), 5);
});

test('detect installed Windows ACP adapters using their known entries', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    ProgramFiles: path.join(root, 'Program Files'),
    APPDATA: path.join(root, 'Roaming'),
    LOCALAPPDATA: path.join(root, 'Local'),
  };
  const write = async (file, contents) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
    return realpath(file);
  };
  const npmRoot = path.join(env.APPDATA, 'npm', 'node_modules');
  const install = async (name, command, entry, bin = entry) => {
    const folder = path.join(npmRoot, name);
    await write(path.join(folder, 'package.json'), JSON.stringify({ name, bin: { [command]: bin } }));
    return write(path.join(folder, entry), "throw new Error('Detection must never execute this script');");
  };

  assert.equal(await detectAdapter('codex', env), null);
  assert.equal(await detectAdapter('constructor', env), null);
  const codex = await install('@agentclientprotocol/codex-acp', 'codex-acp', 'dist/index.js');
  assert.equal(await detectAdapter('codex', env), null);
  const node = await write(path.join(env.ProgramFiles, 'nodejs', 'node.exe'), 'Mock runtime');
  assert.deepEqual(await detectAdapter('codex', env), { name: 'Codex', executable: node, args: [codex] });

  const official = await install('@deepseek-ai/dsh', 'dsh', 'lib/bin.js');
  assert.deepEqual(await detectAdapter('deepseek-harness', env), {
    name: 'DeepSeek Harness', executable: node, args: [official, '--profile', 'acp'],
  });
  await install('@openma/deepseek-harness-acp', 'dsh-acp', 'dist/bin.js', '../../../wrong.js');
  assert.equal((await detectAdapter('deepseek-harness', env)).args[0], official);
  const openma = await install('@openma/deepseek-harness-acp', 'dsh-acp', 'dist/bin.js');
  assert.deepEqual((await detectAdapter('deepseek-harness', env)).args, [openma]);
  assert.deepEqual(await detectAdapter('deepseek-harness-native', env), {
    name: 'DSH 插件运行时', executable: node, args: [official, '--profile', 'acp'],
  });

  const codebuddy = await write(path.join(env.LOCALAPPDATA, 'codebuddy', 'bin', 'codebuddy.exe'), 'Mock native program');
  assert.deepEqual(await detectAdapter('codebuddy', env), {
    name: 'CodeBuddy Code', executable: codebuddy, args: ['--acp'],
  });

  const codexEntryDir = path.dirname(codex);
  const elsewhere = path.join(root, 'elsewhere');
  await write(path.join(elsewhere, 'index.js'), 'Unrelated');
  await rm(codexEntryDir, { recursive: true });
  await symlink(elsewhere, codexEntryDir, 'junction');
  assert.equal(await detectAdapter('codex', env), null);
});

test('official DSH detection uses the bundled Node fallback and only the supported official ACP launcher', {
  skip: process.platform !== 'win32',
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vvman-native-dsh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources');
  const prefix = path.join(root, 'alternate-prefix');
  const env = { APPDATA: path.join(root, 'Roaming'), NPM_CONFIG_PREFIX: prefix };
  const executable = path.join(resources, 'agents', 'codex', 'node.exe');
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, 'Stub Node: detection must not execute');
  const install = async (parent, name, command, entry, bin = entry) => {
    const packageRoot = path.join(parent, 'node_modules', name);
    const script = path.join(packageRoot, entry);
    await mkdir(path.dirname(script), { recursive: true });
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name, bin: { [command]: bin } }));
    await writeFile(script, 'throw new Error("Read-only discovery must not execute this script");');
    return realpath(script);
  };
  await install(path.join(env.APPDATA, 'npm'), '@openma/deepseek-harness-acp', 'dsh-acp', 'dist/bin.js');
  assert.equal(await detectAdapter('deepseek-harness-native', env, resources), null);
  await install(prefix, '@deepseek-ai/dsh', 'dsh', 'lib/bin.js', './other.js');
  assert.equal(await detectAdapter('deepseek-harness-native', env, resources), null);
  const script = await install(prefix, '@deepseek-ai/dsh', 'dsh', 'lib/bin.js');
  assert.deepEqual(await detectAdapter('deepseek-harness-native', env, resources), {
    name: 'DSH 插件运行时', executable: await realpath(executable), args: [script, '--profile', 'acp'],
  });
  assert.equal(await detectAdapter('deepseek-harness', env, resources), null);
});

test('bundled Codex connects without npm and uses its own login profile', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-codex-'));
  const resourcesPath = path.join(root, 'resources');
  const codexRoot = path.join(resourcesPath, 'agents', 'codex');
  const packageRoot = path.join(codexRoot, 'node_modules', '@agentclientprotocol', 'codex-acp');
  const executable = path.join(codexRoot, 'node.exe');
  const script = path.join(packageRoot, 'dist', 'index.js');
  const profileDir = path.join(root, 'profile');
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  assert.equal(await detectManagedCodex(resourcesPath), null);
  await mkdir(path.dirname(script), { recursive: true });
  await mkdir(profileDir);
  await copyFile(process.execPath, executable);
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@agentclientprotocol/codex-acp', bin: { 'codex-acp': 'dist/index.js' },
  }));
  await writeFile(script, `
    const assert = require('node:assert/strict');
    const { createInterface } = require('node:readline');
    assert.equal(process.env.CODEX_HOME, ${JSON.stringify(path.join(profileDir, 'codex-home'))});
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    let loggedIn = false;
    createInterface({ input: process.stdin }).on('line', line => {
      const { id, method, params } = JSON.parse(line);
      let result;
      if (method === 'initialize') result = {
        protocolVersion: 1,
        agentInfo: { name: '@agentclientprotocol/codex-acp', version: '2.6.0' },
        authMethods: [{ id: 'chat-gpt', name: 'ChatGPT' }],
      };
      if (method === 'authenticate') {
        assert.deepEqual(params, { methodId: 'chat-gpt' });
        loggedIn = true;
        result = {};
      }
      if (method === 'session/new') {
        assert.equal(loggedIn, true);
        result = { sessionId: 'managed-codex' };
      }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
    });
  `);
  const managed = { name: 'Codex', executable: await realpath(executable), args: [await realpath(script)] };
  assert.deepEqual(await detectAdapter('codex', {}, resourcesPath), managed);
  const codeBuddyRoot = path.join(resourcesPath, 'agents', 'codebuddy', 'node_modules', '@tencent-ai', 'codebuddy-code');
  const codeBuddyScript = path.join(codeBuddyRoot, 'bin', 'codebuddy');
  await mkdir(path.dirname(codeBuddyScript), { recursive: true });
  await writeFile(path.join(codeBuddyRoot, 'package.json'), JSON.stringify({
    name: '@tencent-ai/codebuddy-code', bin: { codebuddy: 'bin/codebuddy' },
  }));
  await writeFile(codeBuddyScript, 'throw new Error("Do not run detection fixture");');
  assert.deepEqual(await detectAdapter('codebuddy', {}, resourcesPath), {
    name: 'CodeBuddy Code', executable: managed.executable, args: [await realpath(codeBuddyScript), '--acp'],
  });

  const handlers = new Map();
  const window = new EventEmitter();
  const origin = 'http://127.0.0.1:8765';
  const frame = { url: origin + '/' };
  window.isDestroyed = () => false;
  window.webContents = new EventEmitter();
  window.webContents.mainFrame = frame;
  const event = { sender: window.webContents, senderFrame: frame };
  const dialog = {
    approved: false,
    calls: 0,
    async showMessageBox(owner, options) {
      assert.equal(owner, window);
      assert.ok(options.detail.includes(managed.executable));
      this.calls += 1;
      return { response: Number(this.approved) };
    },
  };
  registerAcpAgents({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog,
    window, origin, resourcesPath, profileDir, version: '1.0.0' });
  const connect = handlers.get('vvman-acp:connect-codex');
  assert.throws(() => connect({ sender: window.webContents, senderFrame: { url: origin + '/' } }), /工作台|拒绝|页面/);
  await assert.rejects(connect(event), /已取消/);
  assert.deepEqual(await readdir(profileDir), []);
  dialog.approved = true;
  const first = await connect(event);
  assert.deepEqual({ name: first.agent.name, executable: first.agent.executable, args: first.agent.args }, managed);
  assert.equal(first.info.authentication, 'ready');
  assert.equal((await connect(event)).agent.id, first.agent.id);
  assert.equal(dialog.calls, 2);
  assert.deepEqual(await readdir(profileDir), ['codex-home', 'external-acp-agents.json']);
});
