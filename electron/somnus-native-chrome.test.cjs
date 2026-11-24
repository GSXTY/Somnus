const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromeWindowOptions, registerNativeChrome } = require('./somnus-native-chrome.cjs');

test('native Windows frame uses the Somnus light palette and the existing dark palette', () => {
  for (const dark of [false, true]) {
    const options = chromeWindowOptions('win32', dark);
    assert.deepEqual([options.width, options.height, options.minWidth, options.minHeight], [1280, 820, 520, 600]);
    assert.equal(options.backgroundColor, dark ? '#1b1b1c' : '#f4f8f6');
    assert.deepEqual(options.titleBarOverlay, { height: 40, color: options.backgroundColor, symbolColor: dark ? '#f9fafb' : '#183630' });
  }
});

test('native appearance events reject forged frames and follow the renderer palette', () => {
  const listeners = new Map(), handles = new Map(), changed = [];
  const frame = { url: 'http://127.0.0.1:4444/' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame }, setTitleBarOverlay: value => changed.push(value) };
  const nativeTheme = { themeSource: 'system' };
  registerNativeChrome({ ipcMain: { on: (name, listener) => listeners.set(name, listener), handle: (name, handler) => handles.set(name, handler) },
    getWindow: () => window, rendererOrigin: () => 'http://127.0.0.1:4444', nativeTheme, readDeviceInfo: () => ({ platform: 'fixture' }) });
  const event = { sender: window.webContents, senderFrame: frame };
  const update = listeners.get('dsh-desktop:windows-appearance');
  update({ ...event, sender: {} }, 'zh-CN', '#ffffff', '#000000');
  update({ ...event, senderFrame: { ...frame } }, 'zh-CN', '#ffffff', '#000000');
  assert.equal(changed.length, 0);
  update(event, 'zh-CN', 'rgba(244, 248, 246, 1)', '#183630');
  assert.deepEqual(changed, [{ height: 40, color: 'rgba(244, 248, 246, 1)', symbolColor: '#183630' }]);
  listeners.get('dsh-desktop:native-theme-set')(event, 'dark');
  assert.equal(nativeTheme.themeSource, 'dark');
  assert.deepEqual(handles.get('dsh-desktop:device-info')(event), { platform: 'fixture' });
  assert.deepEqual(handles.get('dsh-desktop:updates-status')(event), { phase: 'idle', supported: false });
  assert.deepEqual(handles.get('dsh-desktop:updates-open')(event), { state: 'disabled', supported: false });
  assert.throws(() => handles.get('dsh-desktop:updates-status')({ ...event, sender: {} }), /unowned/);
});

test('standalone shell composes the original preload and removes duplicate custom chrome', () => {
  const main = readFileSync(join(__dirname, '../desktop/dsh_next/host/standalone-main.mjs'), 'utf8');
  const stage = readFileSync(join(__dirname, '../desktop/dsh_next/stage-next.mjs'), 'utf8');
  for (const obsolete of ['applyTitlebar', 'somnus-titlebar', 'padding-top: 40px', '#F4F8F6']) assert.ok(!main.includes(obsolete));
  assert.ok(stage.includes("read('lib/preload-app.cjs')"));
  assert.ok(stage.includes('syncWindowsAppearance();'));
  assert.ok(main.includes("'lib', 'somnus-preload.cjs'"));
  assert.ok(main.includes('background:${chromeFallbackFill(false)}'));
  assert.ok(main.includes('background:${chromeFallbackFill(true)}'));
});

const editCopy = { undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', delete: '删除', selectAll: '全选' };
const shellCopy = { about: '关于 SomnusNext', quit: '退出', ...editCopy };

function menuFixture(actions) {
  const handles = new Map();
  const listeners = new Map();
  const template = { items: undefined };
  const frame = { url: 'http://127.0.0.1:4444/' };
  const window = { isDestroyed: () => false,
    webContents: { mainFrame: frame, getZoomFactor: () => 1, sendInputEvent: () => {} } };
  const Menu = { buildFromTemplate: items => { template.items = items; return { popup: ({ callback }) => callback?.() }; } };
  registerNativeChrome({
    ipcMain: { on: (name, listener) => listeners.set(name, listener), handle: (name, handler) => handles.set(name, handler) },
    getWindow: () => window, rendererOrigin: () => 'http://127.0.0.1:4444',
    nativeTheme: { themeSource: 'system' }, Menu, app: { getPreferredSystemLanguages: () => ['zh-CN'] },
    readDeviceInfo: () => ({}), resolveDesktopLocale: () => ({ messages: shellCopy }), actions,
  });
  const event = { sender: window.webContents, senderFrame: frame };
  return { open: name => handles.get('dsh-desktop:windows-menu')(event, name, 10, 10), template };
}

const shape = items => items.map(item => item.type ?? item.role);

test('the application menu keeps its original entries when no actions are provided', async () => {
  const menu = menuFixture(undefined);
  await menu.open('application');
  assert.deepEqual(shape(menu.template.items), ['about', 'separator', 'quit']);
  assert.deepEqual(menu.template.items.map(item => item.label), ['关于 SomnusNext', undefined, '退出']);
});

test('the application menu runs each supplied action between about and quit', async () => {
  const calls = [];
  const menu = menuFixture({
    openProfiles: () => { calls.push('profiles'); },
    openRecovery: () => { calls.push('recovery'); },
    openLogs: () => { calls.push('logs'); },
  });
  await menu.open('application');
  assert.deepEqual(shape(menu.template.items), ['about', 'separator', undefined, undefined, undefined, 'separator', 'quit']);
  assert.deepEqual(menu.template.items.slice(2, 5).map(item => item.label), ['运行配置…', '故障恢复…', '打开日志文件夹']);
  for (const item of menu.template.items.slice(2, 5)) item.click();
  assert.deepEqual(calls, ['profiles', 'recovery', 'logs']);
});

test('the application menu adds only the available action and never repeats a separator', async () => {
  const calls = [];
  const menu = menuFixture({ openRecovery: () => { calls.push('recovery'); } });
  await menu.open('application');
  assert.deepEqual(shape(menu.template.items), ['about', 'separator', undefined, 'separator', 'quit']);
  assert.equal(menu.template.items[2].label, '故障恢复…');
  assert.equal(menu.template.items.filter(item => item.type === 'separator').length, 2);
  menu.template.items[2].click();
  assert.deepEqual(calls, ['recovery']);
});

test('a failing menu action is contained instead of becoming an unhandled rejection', async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const menu = menuFixture({
      openProfiles: async () => { throw new Error('profile store unavailable'); },
      openLogs: () => { throw new Error('logs unavailable'); },
    });
    await menu.open('application');
    menu.template.items[2].click();
    menu.template.items[3].click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(logged.map(args => args[1]?.message).sort(), ['logs unavailable', 'profile store unavailable']);
  } finally { console.error = original; }
});

test('the edit menu is unchanged by the application menu actions', async () => {
  const menu = menuFixture({ openProfiles: () => {}, openRecovery: () => {}, openLogs: () => {} });
  await menu.open('edit');
  assert.deepEqual(menu.template.items.map(item => item.label ?? item.type),
    ['撤销', '重做', 'separator', '剪切', '复制', '粘贴', '删除', 'separator', '全选']);
});
