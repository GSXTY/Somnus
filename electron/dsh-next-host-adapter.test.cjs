const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

test('DSH NEXT retains personal settings while filtering reserved MCP overrides and aliases', async () => {
  const { protectDataPatches } = await import('./dsh-next-host-adapter.mjs');
  const connector = '@deepseek-ai/dsh-mcp-client';
  const personal = { id: 'personal-mcp', name: connector, config: { serverName: 'docs' } };
  const duplicates = [
    { id: 'somnus-database', disabled: true },
    { id: 'SOMNUS_TEXT_TO_SQL', config: { url: 'https://other.invalid' } },
    { id: 'personal-mcp', config: { serverName: 'DATABASE' } },
    { id: 'mcp-alias', name: connector, config: { serverName: 'TEXT_TO_SQL' } },
  ];
  const manager = { id: 'mcp-manager', config: { servers: { personal: {}, database: {}, text_to_sql: {} } } };
  const rows = [...duplicates.slice(0, 3), { insert: [personal, duplicates[3], {
    id: 'group', group: true, config: [duplicates[1]],
  }, { id: 'preset', config: { plugins: [duplicates[3], personal], provider: 'example' } }] }, manager];
  const original = structuredClone(rows);

  assert.deepEqual(protectDataPatches(rows), [{ insert: [personal, { id: 'group', group: true, config: [] }, {
    id: 'preset', config: { plugins: [personal], provider: 'example' },
  }] }, { id: 'mcp-manager', config: { servers: { personal: {} } } }]);
  assert.deepEqual(rows, original);
});

test('DSH NEXT requires both separate MCP lease tokens and keeps raw tokens out of the patch', async t => {
  const { prepareSomnusHost } = await import('./dsh-next-host-adapter.mjs');
  const tempRoot = await mkdtemp(join(tmpdir(), 'somnus-host-adapter-test-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const tokens = ['d'.repeat(64), 'e'.repeat(64)];
  const lease = { id: 'a'.repeat(32), subagents: { maxDepth: 0, maxActiveSubagents: 1 }, data_servers: [
    { id: 'database', token: tokens[0] }, { id: 'text-to-sql', token: tokens[1] },
  ] };
  const revocations = [];
  const fetcher = async (url, { method }) => {
    if (method === 'DELETE') revocations.push(url);
    return Response.json(lease);
  };
  const options = { origin: 'http://127.0.0.1:12345', token: 'b'.repeat(64), fetcher, tempRoot };
  const host = await prepareSomnusHost(options);
  t.after(host.dispose);
  const patch = await readFile(host.patchFile, 'utf8');
  assert.match(patch, /id: somnus-database/);
  assert.match(patch, /id: somnus-text-to-sql/);
  assert.deepEqual(Object.values(host.env), tokens);
  assert.ok(tokens.every(token => !patch.includes(token)));

  lease.data_servers.pop();
  await assert.rejects(prepareSomnusHost(options), /invalid Host capability/);
  await host.dispose();
  assert.equal(revocations.length, 2);
});


test('native DSH Provider config remains authoritative; data lease adds no model overrides', async t => {
  const { prepareSomnusHost } = await import('./dsh-next-host-adapter.mjs');
  const tempRoot = await mkdtemp(join(tmpdir(), 'somnus-native-authority-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const lease = { id: 'a'.repeat(32), provider: { model: 'deepseek-flash', token: 'c'.repeat(64), models: [] },
    subagents: { maxDepth: 0, maxActiveSubagents: 1 }, data_servers: [
      { id: 'database', token: 'd'.repeat(64) }, { id: 'text-to-sql', token: 'e'.repeat(64) }] };
  const host = await prepareSomnusHost({ origin: 'http://127.0.0.1:12345', token: 'b'.repeat(64),
    importModelsFile: join(tempRoot, 'models.json'), tempRoot, fetcher: async () => Response.json(lease) });
  t.after(host.dispose);
  const patch = await readFile(host.patchFile, 'utf8');
  assert.ok(!patch.includes('agent-default-model'));
  assert.ok(!patch.includes('llm-pi-ai'));
  assert.ok(patch.includes('somnus-provider-policy'));
  const rows = patch.split('\n').filter(line => line.startsWith('- {')).map(line => JSON.parse(line.slice(2)));
  assert.equal(rows.find(row => row.id === 'llm-deepseek').disabled, true);
  assert.equal(rows.find(row => row.id === 'llm-deepseek-account').disabled, true);
  assert.ok(!patch.includes('somnus-provider-sync'));
  assert.ok(patch.includes('somnus-native-migration'));
  assert.equal(host.env.SOMNUS_NATIVE_IMPORT_FILE, join(tempRoot, 'models.json'));
  assert.equal(host.env.DSH_SOMNUS_NEXT_MODEL_TOKEN, undefined);
});
