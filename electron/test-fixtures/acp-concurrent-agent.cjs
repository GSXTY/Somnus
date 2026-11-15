const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');

const sessionId = 'shared-wire-session';
const send = fields => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...fields }) + '\n');
const chunk = text => send({ method: 'session/update', params: { sessionId, update: {
  sessionUpdate: 'agent_message_chunk', content: { type: 'text', text },
} } });
let promptId;
let mcp;
let identity;

createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params, result } = JSON.parse(line);
  if (method === 'initialize') {
    assert.equal(process.env.INITIAL_AGENT_MODE, 'workspace-write');
    assert.equal(process.env.CODEX_HOME, readFileSync(path.join(__dirname, 'expected-home'), 'utf8'));
    if (!existsSync(path.join(__dirname, 'hold-initialize'))) {
      send({ id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } } });
    }
  } else if (method === 'session/new') {
    assert.equal(params.cwd, process.cwd());
    [mcp] = params.mcpServers;
    send({ id, result: { sessionId } });
  } else if (method === 'session/prompt') {
    promptId = id;
    const text = params.prompt[0].text;
    identity = text.match(/conversation=(\w+)/)[1];
    const mirror = text.match(/Somnus 项目临时视图：([^\n]+)/)[1];
    const file = path.join(mirror, 'source_1', 'concurrent.txt');
    assert.equal(readFileSync(file, 'utf8'), identity);
    chunk('started-' + identity);
    const response = await fetch(mcp.url, {
      method: 'POST', headers: {
        ...Object.fromEntries(mcp.headers.map(({ name, value }) => [name, value])), 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'same-mcp-request', method: 'tools/call',
        params: { name: 'test_project_tool', arguments: { identity } } }),
    });
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.equal(reply.result.content[0].text, identity);
    send({ id: 'same-permission-request', method: 'session/request_permission', params: {
      sessionId, toolCall: { toolCallId: 'same-edit', kind: 'edit', locations: [{ path: file }] },
      options: [{ kind: 'allow_once', optionId: 'allow' }],
    } });
  } else if (method === 'session/cancel') {
    assert.equal(params.sessionId, sessionId);
    chunk('late-' + identity);
    send({ id: promptId, result: { stopReason: 'cancelled', usage: { inputTokens: 13, outputTokens: 2 } } });
  } else if (id === 'same-permission-request' && result.outcome.outcome === 'selected') {
    assert.equal(result.outcome.optionId, 'allow');
    chunk('approved-' + identity);
    send({ id: promptId, result: { stopReason: 'end_turn',
      usage: { inputTokens: 29, outputTokens: 5, totalTokens: 41, cachedReadTokens: 7, thoughtTokens: 3 } } });
  }
});
