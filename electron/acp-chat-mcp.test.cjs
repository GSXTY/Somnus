const assert = require('node:assert/strict');
const test = require('node:test');
const { installChatMcp, mcpAddress } = require('./acp-chat-mcp.cjs');

test('MCP install creates one persistent shared-profile entry and only probes discovery', async () => {
  const seen = [];
  const origin = 'http://127.0.0.1:4123';
  const reference = 'https://example.invalid/mcp';
  let configured;
  const fetcher = async (url, request) => {
    assert.ok(url.startsWith(origin + '/api/mcp/servers'));
    assert.equal(request.headers.Origin, origin);
    assert.equal(request.headers['X-Data-Agent-Local'], '1');
    seen.push(request.method);
    if (request.method === 'GET') return Response.json({ servers: configured ? [configured] : [] });
    if (url.endsWith('/test')) return Response.json({ server: { status: 'ready' } });
    configured = JSON.parse(request.body);
    assert.equal(configured.url, reference);
    assert.equal(configured.enabled, true);
    return Response.json({ server: configured });
  };
  const stages = [];
  const configure = () => installChatMcp(origin, reference, () => {}, stage => stages.push(stage), fetcher);
  assert.equal((await configure()).verified, true);
  assert.equal((await configure()).alreadyInstalled, true);
  assert.deepEqual(stages, ['installing', 'verifying', 'verifying']);
  assert.deepEqual(seen, ['GET', 'POST', 'POST', 'GET', 'POST']);
});

test('MCP chat does not accept credentials or silently reenable a disconnected existing server', async () => {
  for (const url of ['https://secret@example.invalid/mcp', 'https://example.invalid/mcp?token=abc', 'http://example.invalid/mcp']) {
    assert.throws(() => mcpAddress(url), /HTTPS MCP/);
  }
  const reference = 'https://example.invalid/mcp';
  const report = await installChatMcp('http://127.0.0.1:4123', reference, () => {}, () => {}, async (_url, config) => {
    assert.equal(config.method, 'GET');
    return Response.json({ servers: [{ id: 'server-manual', enabled: false, transport: 'http', name: 'Fixture', url: reference }] });
  });
  assert.equal(report.alreadyInstalled, true);
  assert.equal(report.verified, false);
  assert.match(report.message, /停用/);
});
