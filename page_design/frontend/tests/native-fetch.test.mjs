import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeFetch } from '../src/shared/nativeFetch.mjs';

test('native transport preserves JSON and binary upload bodies and response headers', async t => {
  const original = globalThis.window;
  t.after(() => { globalThis.window = original; });
  const calls = [];
  globalThis.window = { somnusApi: { async request(path, init) {
    calls.push({ path, init });
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: new TextEncoder().encode('{"ready":true}').buffer };
  } } };
  const response = await nativeFetch('/api/sql/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sql":"SELECT 1"}' });
  assert.deepEqual(await response.json(), { ready: true });
  assert.equal(calls[0].init.body, '{"sql":"SELECT 1"}');
  const file = new File(['flow\n1\n'], 'sample.csv', { type: 'text/csv' });
  await nativeFetch('/api/open', { method: 'POST', headers: { 'X-Filename': 'sample.csv' }, body: file });
  assert.equal(new TextDecoder().decode(calls[1].init.body), 'flow\n1\n');
  assert.equal(calls[1].init.headers['x-filename'], 'sample.csv');
});

test('native transport ignores a late response after cancellation and refuses non-API routes', async t => {
  const original = globalThis.window;
  t.after(() => { globalThis.window = original; });
  const controller = new AbortController();
  globalThis.window = { somnusApi: { async request() {
    controller.abort();
    return { status: 200, body: new ArrayBuffer(0) };
  } } };
  await assert.rejects(nativeFetch('/api/sql/schema', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(nativeFetch('https://example.com/api/sql/schema'), /Invalid domain API path/);
});
