import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function harness() {
  const source = readFileSync(new URL('./standalone-main.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = source.indexOf("    ipcMain.handle('somnus:api:request',");
  const end = source.indexOf('\n    });\n  };', start);
  assert.ok(start >= 0 && end > start, 'Actual native API handler must have a unique registration boundary');
  let invoke;
  const calls = [];
  const mainFrame = { url: 'http://127.0.0.1:4444/', detached: false };
  const window = { isDestroyed: () => false, webContents: { mainFrame } };
  vm.runInNewContext(source.slice(start, end + '\n    });'.length), {
    ipcMain: { handle: (name, callback) => { assert.equal(name, 'somnus:api:request'); invoke = callback; } },
    dshWindow: window, dshUrl: 'http://127.0.0.1:4444/', somnusOrigin: 'http://127.0.0.1:5555', somnusToken: 'fixture-native-token', URL,
    net: { fetch: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, headers: new Map([['content-type', 'application/json']]), arrayBuffer: async () => new TextEncoder().encode('{}').buffer };
    } },
  });
  return { invoke, calls, window, mainFrame, event: { sender: window.webContents, senderFrame: mainFrame } };
}

test('actual native API bridge supplies local POST intent and native authentication without depending on cookies or Origin', async () => {
  const h = harness();
  await h.invoke(h.event, { path: '/api/assistant/workspaces', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(h.calls.length, 1);
  const request = h.calls[0];
  assert.equal(request.url, 'http://127.0.0.1:5555/api/assistant/workspaces');
  assert.equal(request.options.headers['X-Data-Agent-Native'], 'fixture-native-token');
  assert.equal(request.options.headers['X-Data-Agent-Local'], '1');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body, '{}');
  assert.equal(request.options.redirect, 'error');
});

test('native API bridge refuses subframes, detached frames, foreign renderer origins and foreign senders before issuing local credentials', async () => {
  const h = harness();
  const payload = { path: '/api/assistant/workspaces', method: 'POST', body: '{}' };
  await assert.rejects(h.invoke({ ...h.event, sender: {} }, payload), /unowned/);
  await assert.rejects(h.invoke({ ...h.event, senderFrame: { ...h.mainFrame } }, payload), /unowned/);
  await assert.rejects(h.invoke({ ...h.event, senderFrame: undefined }, payload), /unowned/);
  h.mainFrame.detached = true;
  await assert.rejects(h.invoke(h.event, payload), /unowned/);
  h.mainFrame.detached = false;
  h.mainFrame.url = 'https://foreign.example/';
  await assert.rejects(h.invoke(h.event, payload), /unowned/);
  assert.equal(h.calls.length, 0);
});
