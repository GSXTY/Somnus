import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { attachConfigurationRelay, configurationMethods, installEmbeddedConfigurationBridge, nativeRefreshActivity } from '../src/configuration/embeddedConfigurationBridge.mjs';

function surface() {
  const listeners = new Map();
  return { listeners, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
}

test('embedded configuration allowlist exactly matches the native dispatcher contract', () => {
  const require = createRequire(import.meta.url);
  const { CONFIG_METHODS } = require('../../../electron/dsh-config-bridge.cjs');
  assert.deepEqual([...configurationMethods].sort(), [...Object.keys(CONFIG_METHODS), 'nativeConfigChanged', 'refreshNativeModels'].sort());
});

test('configuration relay rejects foreign origins, foreign frames, and unsupported methods', async () => {
  const host = surface(); const replies = []; const calls = [];
  const child = { postMessage: (...args) => replies.push(args) };
  const dispose = attachConfigurationRelay(host, { contentWindow: child }, 'http://127.0.0.1:8111',
    { configuration: async (...args) => { calls.push(args); return [{ id: 'verified' }]; } });
  const data = { type: 'somnus-config-request', id: 'request-1', method: 'list', args: [] };
  const handle = host.listeners.get('message');
  await handle({ origin: 'https://foreign.example', source: child, data });
  await handle({ origin: 'http://127.0.0.1:8111', source: {}, data });
  await handle({ origin: 'http://127.0.0.1:8111', source: child, data: { ...data, method: 'arbitrary:execute' } });
  assert.equal(calls.length, 0);
  await handle({ origin: 'http://127.0.0.1:8111', source: child, data });
  assert.deepEqual(calls, [['list', []]]);
  assert.equal(replies[0][1], 'http://127.0.0.1:8111');
  assert.deepEqual(replies[0][0].result, [{ id: 'verified' }]);
  dispose(); assert.equal(host.listeners.has('message'), false);
});

test('embedded shim pins loopback parent origin and source before accepting RPC responses', async () => {
  const child = surface(); const requests = [];
  const parent = { postMessage: (...args) => requests.push(args) };
  Object.assign(child, { parent, location: { href: 'http://127.0.0.1:8111/embed.html?somnus_parent_origin=http%3A%2F%2F127.0.0.1%3A9222' },
    setTimeout: () => 1, clearTimeout() {} });
  installEmbeddedConfigurationBridge(child);
  let resolved = false;
  const result = child.vvmanAcp.list().then(value => { resolved = true; return value; });
  assert.equal(requests[0][1], 'http://127.0.0.1:9222');
  const data = { type: 'somnus-config-response', id: requests[0][0].id, result: ['trusted'] };
  child.listeners.get('message')({ source: parent, origin: 'http://127.0.0.1:9999', data });
  child.listeners.get('message')({ source: {}, origin: 'http://127.0.0.1:9222', data });
  await Promise.resolve(); assert.equal(resolved, false);
  child.listeners.get('message')({ source: parent, origin: 'http://127.0.0.1:9222', data });
  assert.deepEqual(await result, ['trusted']);
});

test('embedded shim rejects a non-loopback parent bootstrap', () => {
  const child = surface(); Object.assign(child, { parent: {}, location: { href: 'http://127.0.0.1/embed.html?somnus_parent_origin=https://foreign.example' } });
  installEmbeddedConfigurationBridge(child);
  assert.equal(child.vvmanAcp, undefined);
});

test('model refresh is refused for running or unknown native sessions and forwarded only when idle', async () => {
  const host = surface(); const replies = []; let calls = 0;
  const child = { postMessage: value => replies.push(value) };
  let snapshot;
  attachConfigurationRelay(host, { contentWindow: child }, 'http://127.0.0.1:8111',
    { configuration: async () => { calls++; return { state: 'restarting' }; } }, () => nativeRefreshActivity(snapshot));
  const event = { origin: 'http://127.0.0.1:8111', source: child,
    data: { type: 'somnus-config-request', id: 'refresh', method: 'refreshNativeModels', args: [] } };
  await host.listeners.get('message')(event);
  assert.equal(calls, 0); assert.match(replies.at(-1).error, /无法确认任务状态/);
  snapshot = { byId: { one: { running: true } } };
  await host.listeners.get('message')(event);
  assert.equal(calls, 0); assert.match(replies.at(-1).error, /任务正在运行/);
  snapshot = { byId: { one: { running: false } } };
  await host.listeners.get('message')(event);
  assert.equal(calls, 1); assert.equal(replies.at(-1).result.state, 'restarting');
});
