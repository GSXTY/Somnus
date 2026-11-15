const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const test = require('node:test');
const { SessionMcp, toolCatalog } = require('./acp-mcp.cjs');

test('session MCP exposes authenticated HTTP and default stdio with active-turn dispatch', async t => {
  const updates = [];
  const controller = new AbortController();
  const owner = { conversationId: 'conversation', agentId: 'agent', signal: controller.signal, onUpdate: item => updates.push(item) };
  let turn;
  let calls = 0;
  const taskId = '0'.repeat(32);
  const tools = toolCatalog([
    { name: 'query_database', description: 'Run read-only SQL', inputSchema: { type: 'object' } },
    { name: 'create_deep_analysis', inputSchema: { type: 'object' } },
    { name: 'save token', inputSchema: { type: 'object' } },
  ]);
  const mcp = new SessionMcp(tools, () => turn, async (identity, input, signal) => {
    assert.equal(identity, owner);
    assert.equal(signal.aborted, false);
    calls += 1;
    const value = input.name === 'query_database' ? input.arguments.sql : JSON.stringify({ task_id: taskId });
    return { content: [{ type: 'text', text: value }], isError: false };
  }, controller.signal);
  await mcp.listen();
  t.after(() => mcp.close());
  const http = mcp.descriptor(true);
  const headers = { Authorization: http.headers[0].value, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  let number = 0;
  const send = (method, params, extraHeaders = headers) => fetch(http.url, {
    method: 'POST', headers: extraHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: ++number, method, params }),
  });
  assert.equal((await send('tools/list', {}, {})).status, 403);
  assert.equal((await send('tools/list', {}, { ...headers, Origin: 'https://example.com' })).status, 403);
  assert.equal((await fetch(http.url, { headers })).status, 405);
  const init = await (await send('initialize', { protocolVersion: '2025-03-26' })).json();
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual((await (await send('tools/list')).json()).result.tools, tools);
  const idle = await (await send('tools/call', { name: 'query_database', arguments: { sql: 'SELECT 1' } })).json();
  assert.equal(idle.result.isError, true);
  assert.equal(calls, 0);
  turn = owner;
  const blocked = await (await send('tools/call', { name: 'not_advertised' })).json();
  assert.equal(blocked.result.isError, true);
  const query = await (await send('tools/call', { name: 'query_database', arguments: { sql: 'SELECT 1' } })).json();
  assert.equal(query.result.content[0].text, 'SELECT 1');

  const stdio = mcp.descriptor(false);
  assert.notEqual(stdio.command, undefined);
  const relay = spawn(stdio.command, stdio.args, {
    stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    env: { ...process.env, ...Object.fromEntries(stdio.env.map(item => [item.name, item.value])) },
  });
  const lines = createInterface({ input: relay.stdout });
  const reply = async (id, method, params) => {
    const finished = once(lines, 'line', { signal: AbortSignal.timeout(6000) });
    relay.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return JSON.parse((await finished)[0]).result;
  };
  try {
    assert.equal((await reply(1, 'initialize', { protocolVersion: '2025-06-18' })).protocolVersion, '2025-06-18');
    assert.deepEqual((await reply(2, 'tools/list')).tools, tools);
    assert.equal((await reply(3, 'tools/call', { name: 'create_deep_analysis' })).isError, false);
    turn = null;
    assert.equal((await reply(4, 'tools/call', { name: 'create_deep_analysis' })).isError, true);
  } finally {
    const exited = once(relay, 'exit', { signal: AbortSignal.timeout(6000) });
    relay.stdin.end();
    await exited;
  }
  assert.deepEqual(updates.map(item => item.toolProgress), [
    { name: 'query_database', callId: 'call-1', status: 'running' },
    { name: 'query_database', callId: 'call-1', status: 'complete' },
    { name: 'create_deep_analysis', callId: 'call-2', status: 'running' },
    { name: 'create_deep_analysis', callId: 'call-2', status: 'complete', taskId },
  ]);
  assert.equal(calls, 2);
});

test('MCP serializes at most four calls and does not send cancelled or stale work', async () => {
  const signal = new AbortController();
  let owner = { agentId: 'agent', conversationId: 'conversation', signal: signal.signal, onUpdate: () => {} };
  const blocking = Promise.withResolvers();
  const second = Promise.withResolvers();
  const third = Promise.withResolvers();
  const started = [];
  const mcp = new SessionMcp([{ name: 'query_database' }], () => owner, async (_turn, input) => {
    const sequence = input.arguments.sequence;
    started.push(sequence);
    if (sequence === 1) await blocking.promise;
    if (sequence === 2) second.resolve();
    if (sequence === 3) await third.promise;
    return { content: [{ type: 'text', text: String(sequence) }] };
  });
  const call = id => mcp.call({ id, params: { name: 'query_database', arguments: { sequence: id } } });
  const first = call(1);
  const queued = call(2);
  const cancelled = call(3);
  const stale = call(4);
  assert.equal((await call(5)).isError, true);
  assert.deepEqual(started, [1]);
  blocking.resolve();
  assert.equal((await first).content[0].text, '1');
  await second.promise;
  assert.equal((await queued).content[0].text, '2');
  assert.deepEqual(started, [1, 2, 3]);
  signal.abort();
  assert.equal((await cancelled).isError, true);
  assert.equal((await stale).isError, true);
  owner = { ...owner, signal: new AbortController().signal };
  const nextTurn = call(6);
  third.resolve();
  assert.equal((await nextTurn).content[0].text, '6');
  assert.deepEqual(started, [1, 2, 3, 6]);
});
