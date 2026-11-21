import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, migrateNativeProviders, migrationGroups } from './somnus-native-migration.mjs';

test('saved two-model Provider imports once through native secret/settings services without rewriting source', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'somnus-native-import-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const source = join(folder, 'models.json');
  const key = 'synthetic-private-key';
  const saved = JSON.stringify({ active: 'm_first', providers: [
    { id: 'm_first', group_id: 'group', name: 'DeepSeek', api: 'openai-responses', base_url: 'https://fixture.invalid/v1/responses', api_key: key, model: 'deepseek-flash' },
    { id: 'm_second', group_id: 'group', name: 'DeepSeek', api: 'openai-responses', base_url: 'https://fixture.invalid/v1/responses', api_key: key, model: 'deepseek-v4-pro' },
  ] });
  await writeFile(source, saved);
  const native = { providers: {} }, secrets = new Map();
  let selection = { provider: 'vvman-company', model: '' }, writes = 0;
  const ctx = { settings: {
    describe: () => [{ ns: 'llm-pi-ai', revision: writes, value: structuredClone(native) }],
    async mutate(ns, ops, revision) { assert.equal(ns, 'llm-pi-ai'); assert.equal(revision, writes);
      assert.ok(!JSON.stringify(ops).includes(key)); for (const op of ops) native.providers[op.path[1]] = op.value; writes++; },
  }, credentials: { async set(ref, value) { secrets.set(ref, value); } },
    agentDefaultModel: { currentSelection: () => selection, async saveSelection(value) { selection = value; } } };
  assert.deepEqual(await migrateNativeProviders(ctx, source), { state: 'imported', providers: 1, models: 2 });
  const [provider] = Object.keys(native.providers);
  assert.deepEqual(native.providers[provider].models.map(x => x.id), ['deepseek-flash', 'deepseek-v4-pro']);
  assert.equal(native.providers[provider].baseURL, 'https://fixture.invalid/v1');
  assert.equal(secrets.get(native.providers[provider].apiKeyEnv), key);
  assert.deepEqual(selection, { provider, model: 'deepseek-flash' });
  assert.equal(await readFile(source, 'utf8'), saved);
  assert.equal(await readFile(source + '.before-native-import.json', 'utf8'), saved);
  assert.ok(!(await readFile(source + '.native-dsh-import-v1.json', 'utf8')).includes(key));
  // Native user edits become the sole truth; old Python file is never synchronized back.
  native.providers[provider].models.pop();
  assert.deepEqual(await migrateNativeProviders(ctx, source), { state: 'already-imported' });
  assert.equal(native.providers[provider].models.length, 1); assert.equal(writes, 1);
});

test('migration failure keeps source untouched and writes no successful marker', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'somnus-native-import-fail-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const source = join(folder, 'models.json');
  const saved = JSON.stringify({ providers: [{ id: 'm_a', name: 'Fixture', model: 'fixture-model', api: 'openai-completions', api_key: 'synthetic', base_url: 'https://fixture.invalid/v1' }] });
  await writeFile(source, saved);
  const ctx = { settings: { describe: () => [{ ns: 'llm-pi-ai', revision: 0, value: { providers: {} } }],
    mutate() { throw new Error('native write failed'); } }, credentials: { async set() {} } };
  await assert.rejects(migrateNativeProviders(ctx, source), /native write failed/);
  await assert.rejects(readFile(source + '.native-dsh-import-v1.json'), { code: 'ENOENT' });
  assert.equal(await readFile(source, 'utf8'), saved);
});

test('unconfigured profiles are not imported as selectable fake models', () => {
  assert.deepEqual(migrationGroups([{ id: 'm_a', api: 'openai-responses', base_url: 'https://fixture.invalid', model: 'fixture-model' }]), []);
});


test('migration plugin never blocks Loader boot with a settings write', async () => {
  let resolveBoot, reads = 0, dispose;
  const boot = new Promise(resolve => { resolveBoot = resolve; });
  const ctx = { effect(callback) { dispose = callback(); }, root: { loader: { await: () => boot } },
    settings: { describe() { reads++; throw new Error('not used without source path'); } }, logger: { warn() {} } };
  const previous = process.env.SOMNUS_NATIVE_IMPORT_FILE;
  delete process.env.SOMNUS_NATIVE_IMPORT_FILE;
  try {
    assert.equal(apply(ctx), undefined);
    assert.equal(reads, 0);
    resolveBoot(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 0);
    dispose();
  } finally { if (previous !== undefined) process.env.SOMNUS_NATIVE_IMPORT_FILE = previous; }
});
