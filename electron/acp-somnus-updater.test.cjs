const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { createUpdaterState, updateUrl } = require('./acp-somnus-updater.cjs');

test('update feeds require HTTPS outside explicit local development', () => {
  assert.equal(updateUrl('https://updates.example/somnus'), 'https://updates.example/somnus/');
  assert.equal(updateUrl('https://user:secret@updates.example/'), null);
  assert.equal(updateUrl('https://updates.example/?token=secret'), null);
  assert.equal(updateUrl('http://127.0.0.1:4123/'), null);
  assert.equal(updateUrl('http://127.0.0.1:4123/', true), 'http://127.0.0.1:4123/');
  assert.equal(updateUrl('http://192.168.1.1/', true), null);
});

test('unsupported and unconfigured apps do not start an update', async () => {
  const currentVersion = '0.3.0-beta.4';
  const unsupported = createUpdaterState({
    currentVersion, supported: false, resolveUpdater: () => assert.fail('must not initialize'),
  });
  const unconfigured = createUpdaterState({ currentVersion, supported: true, resolveUpdater: () => null });
  assert.equal((await unsupported.check()).phase, 'unsupported');
  assert.equal((await unconfigured.getState()).phase, 'unconfigured');
  assert.equal((await unconfigured.download()).phase, 'unconfigured');
  assert.equal((await unconfigured.install()).phase, 'unconfigured');
});

test('updates require separate check, download and install actions', async () => {
  const currentVersion = '0.3.0-beta.4';
  const version = '0.3.1';
  const events = [];
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => updater.emit('update-available', { version });
  updater.downloadUpdate = async () => {
    updater.emit('download-progress', { percent: 27 });
    updater.emit('update-downloaded', { version });
  };
  updater.quitAndInstall = () => events.push('install');
  const updates = createUpdaterState({
    currentVersion,
    supported: true,
    resolveUpdater: () => updater,
    publish: state => events.push(state.phase === 'downloading' ? state.percent : state.phase),
    prepareInstall: async () => events.push('stopped'),
  });
  assert.equal((await updates.getState()).phase, 'idle');
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal((await updates.install()).phase, 'idle');
  assert.deepEqual(await updates.check(), { phase: 'available', currentVersion, version });
  assert.deepEqual(await updates.download(), { phase: 'downloaded', currentVersion, version, percent: 100 });
  assert.deepEqual(events, ['idle', 'checking', 'available', 0, 27, 'downloaded']);
  await updates.install();
  assert.deepEqual(events.slice(-2), ['stopped', 'install']);
});
