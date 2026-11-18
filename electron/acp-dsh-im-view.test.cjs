const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const test = require('node:test');
const { registerDshImView, registerNativeDshView, registerDshPluginPage } = require('./acp-dsh-im-view.cjs');

const origin = 'http://127.0.0.1:3000';
const managed = 'http://127.0.0.1:40450/?token=generated-test-token-01';
const rect = { x: 10, y: 30, width: 500, height: 400 };

function fixture(settings = async () => ({ ready: Promise.resolve(managed) }), native = false, pluginPage = false) {
  const contents = new EventEmitter();
  contents.mainFrame = { url: origin + '/' };
  contents.getZoomFactor = () => 1;
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const handlers = new Map();
  const ipcMain = { handle: (key, handler) => handlers.set(key, handler), removeHandler: key => handlers.delete(key) };
  const window = new EventEmitter();
  let current;
  Object.assign(window, {
    webContents: contents, isDestroyed: () => false, getContentSize: () => [700, 600],
    contentView: {
      addChildView(view) { current = view; },
      removeChildView(view) { assert.equal(current, view); current = undefined; },
    },
  });
  class View {
    constructor({ webPreferences }) {
      this.preferences = webPreferences;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        isDestroyed: () => false, close() {}, session: webPreferences.session,
        setWindowOpenHandler(fn) { this.open = fn; },
        loadURL(url) { this.url = url; },
        executeJavaScript(script) {
          assert.equal(current.visible, false);
          assert.match(script, /IM.*机器人/);
          this.scoped = true;
        },
      });
    }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(show) { this.visible = show; }
  }
  let beforeRequest;
  const browser = new EventEmitter();
  Object.assign(browser, {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest(fn) { beforeRequest = fn; } },
    clearStorageData: () => Promise.resolve(),
  });
  const register = pluginPage ? registerDshPluginPage : native ? registerNativeDshView : registerDshImView;
  register({
    ipcMain, window, origin, WebContentsView: View, session: { fromPartition: () => browser },
    market: {
      webProfile: async () => ({ bundles: ['@xmanrui/dsh-im'] }), settings,
      community: { installed: async (_profile, id) => ({ name: id }) },
      account: { async request(_server, method, args) {
        assert.equal(method, 'workspace/create');
        assert.deepEqual(args, { request: { path: 'C:/fixture' } });
        return { workspace: { workspaceId: 'ws-native' } };
      } },
    },
    workflow: { async target(id, _tool, scope) {
      assert.equal(id, 'ws_f0123456789a');
      assert.deepEqual(scope, { source: 'source_1' });
      return { root: 'C:/fixture' };
    } },
  });
  return {
    call: (name, ...args) => handlers.get((pluginPage ? 'somnus-dsh-plugin-page:' : native ? 'somnus-native-dsh:' : 'somnus-dsh-im:') + name)(event, ...args),
    view: () => current, request: (url, callback) => beforeRequest({ url }, callback), window, handlers,
  };
}

test('scoped settings view only supports the known installed Web plugin and shows after isolation', async () => {
  const app = fixture(undefined, false, true);
  assert.deepEqual(await app.call('status', '@unknown/provider', 'community'), { available: false });
  await assert.rejects(app.call('show', rect, '@unknown/provider', 'community'), /没有可/);
  assert.equal(app.view(), undefined);
  assert.deepEqual(await app.call('status', '@xmanrui/dsh-im', 'community'), { available: true });
  await app.call('show', rect, '@xmanrui/dsh-im', 'community');
  assert.equal(app.view().webContents.scoped, true);
  assert.equal(app.view().visible, true);
});

test('IM view loads the managed auth URL while rejecting other loopback hosts', async () => {
  const app = fixture();
  assert.deepEqual(await app.call('status'), { installed: true });
  await app.call('show', rect);
  assert.equal(app.view().webContents.url, managed);
  assert.deepEqual(app.view().bounds, rect);
  assert.equal(app.view().preferences.nodeIntegration, false);
  let blocked = false;
  app.view().webContents.emit('will-frame-navigate', { url: origin, preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
  assert.deepEqual(app.view().webContents.open(), { action: 'deny' });
  app.request(origin, result => assert.equal(result.cancel, true));
  app.request('ws://127.0.0.1:40450/api', result => assert.equal(result.cancel, false));
  app.call('bounds', { ...rect, height: 0 });
  assert.equal(app.view().visible, false);
  app.call('close');
  assert.equal(app.view(), undefined);
});

test('closing the panel cancels attaching a view while the host starts', async () => {
  let finish;
  const entered = Promise.withResolvers();
  const app = fixture(() => new Promise(resolve => { finish = resolve; entered.resolve(); }));
  const shown = app.call('show', rect);
  await entered.promise;
  app.call('close');
  finish({ ready: Promise.resolve(managed) });
  await shown;
  assert.equal(app.view(), undefined);
  app.window.emit('closed');
  assert.equal(app.handlers.size, 0);
});

test('native view registers a trusted project and retains its page while hidden', async () => {
  const app = fixture(async () => ({ ready: Promise.resolve(managed), companyModel: 'deepseek-flash' }), true);
  assert.deepEqual(await app.call('show', rect, 'ws_f0123456789a'),
    { projectRegistered: true, companyModel: 'deepseek-flash' });
  const initial = app.view();
  app.call('close');
  assert.equal(initial.visible, false);
  app.call('bounds', rect);
  assert.equal(initial.visible, false);
  await app.call('show', rect);
  assert.equal(app.view(), initial);
  assert.equal(initial.visible, true);
  app.window.emit('closed');
  assert.equal(app.view(), undefined);
  assert.equal(app.handlers.size, 0);
});
