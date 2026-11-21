import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/documents/documentLibraryBridge.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function bridge(window, fetch = () => { throw new Error('Unexpected browser request'); }) {
  const exports = {};
  vm.runInNewContext(source, { exports, window, fetch, TextDecoder, Uint8Array, URL, Blob, setTimeout });
  return exports.documentBridge();
}

test('native document operations retain scope, encoded paths and mutation bodies over IPC', async () => {
  const calls = [];
  const value = { folder: '资料', entries: [] };
  const library = bridge({ somnusApi: { async request(path, init) {
    calls.push({ path, init });
    return { status: 200, body: new TextEncoder().encode(JSON.stringify(value)).buffer };
  } } });
  assert.equal((await library.list('shared', '资料')).folder, '资料');
  assert.equal(calls[0].path, '/api/assistant/documents?scope=shared&folder=' + encodeURIComponent('资料'));
  await library.createFile('资料', '笔记.md', '内容');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), { folder: '资料', name: '笔记.md', content: '内容' });
  await library.deleteEntry('资料/笔记.md');
  assert.deepEqual(JSON.parse(calls[2].init.body), { path: '资料/笔记.md' });
  await library.readFile('private', '资料/笔记.md');
  assert(calls[3].path.includes('scope=private&path=' + encodeURIComponent('资料/笔记.md')));
});

test('native document failures report the service message without falling back to the renderer origin', async () => {
  const library = bridge({ somnusApi: { async request() {
    return { status: 403, body: new TextEncoder().encode(JSON.stringify({ error: { message: 'Access denied' } })).buffer };
  } } });
  await assert.rejects(library.list('private'), /Access denied/);
});

test('existing native document bridge and browser HTTP access remain usable', async () => {
  const native = { list() {} };
  assert.equal(bridge({ somnusDocuments: native }), native);
  const calls = [];
  const library = bridge({}, async (path, init) => {
    calls.push({ path, init });
    return { ok: true, json: async () => ({ folder: '', entries: [] }) };
  });
  await library.list('private');
  assert.equal(calls[0].path, '/api/assistant/documents?scope=private&folder=');
});
