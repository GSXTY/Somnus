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
