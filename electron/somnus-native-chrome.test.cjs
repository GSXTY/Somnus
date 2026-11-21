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
