const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');
const { companyWebOverlay } = require('./acp-dsh-web-model.cjs');
const { createProjectClient } = require('./acp-project.cjs');

test('company Web overlay sets a new default model and keeps its temporary token out of the file', async () => {
  const token = 'd'.repeat(64);
  let revokes = 0;
  const overlay = await companyWebOverlay({
    model: 'deepseek-flash', endpoint: 'http://127.0.0.1:8801/provider', token,
    dispose: async () => { revokes++; },
  }, 3);
  try {
    const content = await readFile(overlay.file, 'utf8');
    assert.ok(!content.includes(token));
    const rows = JSON.parse(content);
    assert.deepEqual(rows.find(row => row.id === 'agent-default-model').config, {
      provider: 'vvman-company', model: 'deepseek-flash',
    });
    const provider = rows.find(row => row.id === 'llm-pi-ai').config.providers['vvman-company'];
    assert.equal(overlay.env[provider.apiKeyEnv], token);
    assert.equal(provider.api, 'openai-responses');
    assert.equal(provider.compat.supportsDeveloperRole, false);
    assert.match(provider.apiKeyEnv, /^DSH_/);
    assert.equal(provider.models[0].contextWindow, 1_000_000);
    assert.equal(rows.find(row => row.id === 'agent-loop').config.maxParallelToolCalls, 3);
  } finally {
    await Promise.all([overlay.dispose(), overlay.dispose()]);
  }
  assert.equal(revokes, 1);
  await assert.rejects(() => readFile(overlay.file), { code: 'ENOENT' });
});

test('company Web overlay attaches distinct database MCP transports and rejects mismatched leases', async t => {
  const id = 'a'.repeat(32);
  const modelToken = 'd'.repeat(64);
  const dataServers = [{ id: 'database', token: 'a'.repeat(64) }, { id: 'text-to-sql', token: 'b'.repeat(64) }];
  const lease = { id, token: modelToken, model: 'deepseek-flash', data_servers: dataServers,
    data: { available: true, token: 'c'.repeat(64) } };
  let revoked = 0;
  const origin = 'http://127.0.0.1:7301';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.startsWith(origin + '/api/assistant/company-web-runtime'));
    if (options.method === 'DELETE') revoked++;
    return Response.json(lease);
  });
  const client = createProjectClient(origin, 'local-native-fixture');
  const config = await client.openCompanyWeb();
  assert.equal(config.data, undefined);
  assert.deepEqual(config.dataServers.map(({ id, endpoint }) => [id, endpoint]), dataServers.map(({ id: name }) =>
    [name, origin + '/api/assistant/company-web-runtime/' + id + '/mcp/' + name]));
  const overlay = await companyWebOverlay(config);
  try {
    const yaml = await readFile(overlay.file, 'utf8');
    assert.match(yaml, /id: somnus-database\n.*\n.*\n.*\n\s+serverName: database\n/);
    assert.match(yaml, /id: somnus-text-to-sql\n.*\n.*\n.*\n\s+serverName: text-to-sql\n/);
    assert.doesNotMatch(yaml, /somnus-company-data|vv_man/);
    for (const token of [modelToken, ...dataServers.map(server => server.token)]) assert.ok(!yaml.includes(token));
    assert.equal(overlay.env.DSH_SOMNUS_DATABASE_MCP_TOKEN, dataServers[0].token);
    assert.equal(overlay.env.DSH_SOMNUS_TEXT_TO_SQL_MCP_TOKEN, dataServers[1].token);
  } finally {
    await overlay.dispose();
  }
  lease.data_servers = [dataServers[0], { ...dataServers[1], token: dataServers[0].token }];
  await assert.rejects(() => client.openCompanyWeb(), /MCP/);
  assert.equal(revoked, 2);
  delete lease.data_servers;
  const legacy = await client.openCompanyWeb();
  assert.match(legacy.data.endpoint, /\/mcp$/);
  await legacy.dispose();
});
