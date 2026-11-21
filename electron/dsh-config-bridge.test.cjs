const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, rm, writeFile, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { CONFIG_METHODS, createConfigurationDispatcher } = require('./dsh-config-bridge.cjs');
const { registerAcpAgents } = require('./acp-ipc.cjs');

test('configuration RPC accepts only owned mainframe and narrow allowed actions', async () => {
  const mainFrame = { url: 'http://127.0.0.1:4444/', detached: false };
  const window = { isDestroyed: () => false, webContents: { mainFrame } };
  const event = { sender: window.webContents, senderFrame: mainFrame };
  let invocations = 0;
  const handlers = new Map([['vvman-acp:list', () => { invocations++; return []; }]]);
  const dispatch = createConfigurationDispatcher({ window, rendererOrigin: () => 'http://127.0.0.1:4444', handlers,
    onNativeConfigChanged: () => ({ state: 'restart-required' }), onRefreshNativeModels: () => ({ state: 'restarting' }) });
  assert.deepEqual(await dispatch(event, 'list', []), []);
  assert.deepEqual(await dispatch(event, 'nativeConfigChanged', []), { state: 'restart-required' });
  await assert.rejects(dispatch({ ...event, sender: {} }, 'list', []), /unowned/);
  await assert.rejects(dispatch({ ...event, senderFrame: { ...mainFrame } }, 'list', []), /unowned/);
  mainFrame.url = 'https://untrusted.example/';
  await assert.rejects(dispatch(event, 'list', []), /unowned/);
  mainFrame.url = 'http://127.0.0.1:4444/';
  await assert.rejects(dispatch(event, 'run_powershell', []), /Unsupported/);
  await assert.rejects(dispatch(event, 'constructor', []), /Unsupported/);
  await assert.rejects(dispatch(event, 'list', 'bad args'), /Invalid/);
  assert.equal(invocations, 1);
});

test('actual configuration-only ACP service registers no workspace or execution handlers and reads independent registry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnusnext-config-service-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handlers = new Map();
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.webContents = new EventEmitter();
  window.webContents.mainFrame = { url: 'http://127.0.0.1:4444/' };
  await writeFile(join(directory, 'external-acp-agents.json'), JSON.stringify([{ id: 'only-this-profile', name: 'Saved but unverified', executable: 'C:/agent.exe', args: [] }]));
  const agents = registerAcpAgents({ ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    window, origin: 'http://127.0.0.1:5555', trustedOrigin: 'http://127.0.0.1:4444',
    profileDir: directory, dshRuntimeDir: directory, resourcesPath: directory, version: 'test',
    configurationOnly: true, allowedActions: new Set(Object.values(CONFIG_METHODS)) });
  t.after(() => window.emit('closed'));
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.deepEqual((await handlers.get('vvman-acp:list')(event)).map(x => x.id), ['only-this-profile']);
  assert.equal((await handlers.get('vvman-acp:agent-readiness')(event))[0].state, 'unverified');
  assert.equal(handlers.has('vvman-acp:run-delegation'), false);
  assert.equal(handlers.has('vvman-acp:native-dsh-prompt'), false);
  assert.equal([...handlers.keys()].some(key => key.includes('workspace')), false);
  assert.equal((await readdir(directory)).some(name => name.includes('im')), false);
  assert.equal(agents.turns.size, 0);
});


test('embedded frontend and host use the exact same configuration action contract', async () => {
  const { configurationMethods } = await import('../page_design/frontend/src/configuration/embeddedConfigurationBridge.mjs');
  assert.deepEqual([...configurationMethods].sort(), [...Object.keys(CONFIG_METHODS), 'nativeConfigChanged', 'refreshNativeModels'].sort());
});
