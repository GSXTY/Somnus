import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDshPluginInterop, pluginMcpServers } from '../../../electron/somnus-plugin-interop.mjs';

function fixture() {
  const journal = [], executions = [], inbox = [];
  const definition = { name: 'database_query', description: 'Read selected project data', parameters: { type: 'object' },
    execute() { throw new Error('Direct definition execution must never be used'); } };
  const agent = { id: 'native-session', session: { append: (type, data) => { journal.push({ type, data }); } },
    inbox: { nextStep: inbox, splice(_phase, ...args) { inbox.splice(...args); } } };
  let liveAgent = agent, enabled = true, allowed = true, contexts = [];
  let handler, closed = false, disposed = 0;
  const ctx = { agents: { get: id => id === agent.id ? liveAgent : undefined }, tools: {
    async resolve(input) { assert.equal(input.agent, agent); return { dispose() { disposed++; } }; },
    definitions(owner) { assert.equal(owner, agent); return enabled ? [definition] : []; },
    selectExecutor(owner) { assert.equal(owner, agent); return { describe: definitions => ({ schemas: definitions.map(({ execute, ...schema }) => schema) }) }; },
    async execute(input) {
      executions.push(input); assert.equal(input.agent, agent); assert.equal(input.maxParallelToolCalls, 1);
      assert.ok(input.toolSet); assert.ok(input.signal instanceof AbortSignal);
      return { results: [{ callId: input.calls[0].id, result: allowed
        ? { content: [{ type: 'text', text: 'actual native result' }], isError: false }
        : { content: [{ type: 'text', text: 'Native permission denied' }], isError: true } }],
      additionalContexts: contexts, concluded: false };
    },
  } };
  const registry = createDshPluginInterop(ctx, { createServer: callback => {
    handler = callback;
    return { once() {}, listen(_port, host, ready) { assert.equal(host, '127.0.0.1'); ready(); },
      address: () => ({ port: 49152 }), unref() {}, close(done) { closed = true; done(); } };
  } });
  const controller = new AbortController();
  const call = { sessionId: agent.id, provider: 'somnus-acp-fixture', model: 'fixture-model', signal: controller.signal,
    tools: [{ name: 'database_query', parameters: { type: 'object' } }] };
  const rpc = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  async function http(descriptor, { authorization = 'Bearer ' + descriptor.token, origin, message } = {}) {
    const request = { method: 'POST', url: new URL(descriptor.url).pathname, headers: { authorization, ...(origin ? { origin } : {}) },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(message || { jsonrpc: '2.0', id: 1, method: 'tools/list' })); } };
    let status, body = '';
    await new Promise((resolve, reject) => { handler(request, { headersSent: false,
      writeHead(value) { status = value; this.headersSent = true; },
      end(value = '') { body += value; resolve(); } }); setTimeout(() => reject(new Error('HTTP fixture did not settle')), 200).unref(); });
    return { status, body: body ? JSON.parse(body) : undefined };
  }
  return { registry, call, controller, rpc, http, journal, executions, agent, inbox,
    enable(value) { enabled = value; }, permission(value) { allowed = value; }, replaceAgent() { liveAgent = { ...agent }; },
    contexts(value) { contexts = value; }, get disposed() { return disposed; }, get closed() { return closed; } };
}

test('only current admitted DSH tools are discoverable and removed plugin tools cannot execute', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  const lease = await f.registry.openTurn(f.call, 'external-agent');
  const listed = await lease.dispatch(f.rpc(1, 'somnus_list_tools'));
  assert.deepEqual(JSON.parse(listed.result.content[0].text).tools.map(tool => tool.name), ['database_query']);
  f.enable(false);
  const removed = await lease.dispatch(f.rpc(2, 'somnus_call_tool', { name: 'database_query', arguments: {} }));
  assert.equal(removed.result.isError, true); assert.equal(f.executions.length, 0);
  const arbitrary = await lease.dispatch(f.rpc(3, 'somnus_call_tool', { name: 'unregistered_shell', arguments: {} }));
  assert.equal(arbitrary.result.isError, true); assert.equal(f.executions.length, 0);
});

test('MCP authentication and origin reject access before any native tool admission', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  const lease = await f.registry.openTurn(f.call, 'external-agent');
  assert.equal((await f.http(lease.descriptor, { authorization: 'Bearer ' + 'a'.repeat(64) })).status, 403);
  assert.equal((await f.http(lease.descriptor, { origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await f.http(lease.descriptor)).status, 200);
  assert.equal(f.executions.length, 0);
});

test('native executor owns permissions and exact operation audit without fabricated model calls', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  const lease = await f.registry.openTurn(f.call, 'external-agent');
  f.permission(false);
  const denied = await lease.dispatch(f.rpc(1, 'somnus_call_tool', { name: 'database_query', arguments: { sql: 'SELECT 1' } }));
  assert.equal(denied.result.isError, true); assert.match(denied.result.content[0].text, /permission denied/);
  assert.equal(f.executions.length, 1);
  assert.equal(f.executions[0].calls[0].name, 'database_query');
  assert.deepEqual(JSON.parse(f.executions[0].calls[0].arguments), { sql: 'SELECT 1' });
  assert.deepEqual(f.journal.map(event => event.type), ['somnus/acp-tool', 'somnus/acp-tool']);
  assert.deepEqual(f.journal.map(event => event.data.phase), ['start', 'result']);
  assert.equal(f.journal[1].data.result.isError, true);
  assert.ok(!JSON.stringify(f.journal).includes(lease.descriptor.token));
});

test('same MCP id retries do not duplicate effects and different arguments are rejected', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  const lease = await f.registry.openTurn(f.call, 'external-agent');
  const call = f.rpc('retry', 'somnus_call_tool', { name: 'database_query', arguments: { sql: 'SELECT 1' } });
  const [first, second] = await Promise.all([lease.dispatch(call), lease.dispatch(call)]);
  assert.deepEqual(first, second); assert.equal(f.executions.length, 1);
  const changed = await lease.dispatch(f.rpc('retry', 'somnus_call_tool', { name: 'database_query', arguments: { sql: 'SELECT 2' } }));
  assert.equal(changed.result.isError, true); assert.equal(f.executions.length, 1);
});

test('prepared-call retry retains the last request tool outcomes without replaying effects', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  const call = { ...f.call, requestId: 'prepared-request-one' };
  const first = await f.registry.openTurn(call, 'external-agent');
  const message = f.rpc(7, 'somnus_call_tool', { name: 'database_query', arguments: { sql: 'SELECT 1' } });
  const original = await first.dispatch(message); first.close();
  const retry = await f.registry.openTurn(call, 'external-agent');
  assert.deepEqual(await retry.dispatch(message), original); assert.equal(f.executions.length, 1);
  retry.close();
  const intentional = await f.registry.openTurn({ ...call, requestId: 'prepared-request-two' }, 'external-agent');
  await intentional.dispatch(message); assert.equal(f.executions.length, 2);
});

test('turn closure, cancellation and replaced native ownership revoke tool access', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  const lease = await f.registry.openTurn(f.call, 'external-agent');
  lease.close();
  assert.match((await lease.dispatch(f.rpc(1, 'somnus_list_tools'))).error.message, /not active/);
  const next = await f.registry.openTurn(f.call, 'external-agent');
  assert.deepEqual(next.descriptor, lease.descriptor, 'same external ACP session keeps one scoped MCP address');
  f.replaceAgent();
  assert.match((await next.dispatch(f.rpc(2, 'somnus_list_tools'))).error.message, /not active/);
  f.controller.abort(); assert.ok(f.disposed >= 2);
});

test('different external Agents never share tool capability tokens', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  const a = await f.registry.openTurn(f.call, 'agent-a'); a.close();
  const b = await f.registry.openTurn(f.call, 'agent-b');
  assert.notEqual(a.descriptor.token, b.descriptor.token); assert.notEqual(a.descriptor.url, b.descriptor.url);
});

test('native tool additional context is retained for the owning DSH conversation', async t => {
  const f = fixture(); t.after(() => f.registry.close());
  f.contexts([{ message: { role: 'user', content: [{ type: 'text', text: 'Actual tool context' }] } }]);
  const lease = await f.registry.openTurn(f.call, 'external-agent');
  const response = await lease.dispatch(f.rpc(1, 'somnus_call_tool', { name: 'database_query', arguments: {} }));
  assert.equal(f.inbox.length, 1); assert.match(response.result.content[1].text, /Actual tool context/);
});

test('transport negotiation uses scoped HTTP or fixed stdio relay and rejects arbitrary endpoints', () => {
  const descriptor = { name: 'somnus-dsh-tools', url: 'http://127.0.0.1:49152/somnus-tools/' + 'a'.repeat(32), token: 'b'.repeat(64) };
  const http = pluginMcpServers(descriptor, { mcpCapabilities: { http: true } });
  assert.equal(http.compatibility, 'http'); assert.equal(http.mcpServers[0].headers[0].value, 'Bearer ' + descriptor.token);
  const stdio = pluginMcpServers(descriptor, {}, { command: 'fixed-node.exe', script: 'fixed-relay.cjs' });
  assert.equal(stdio.compatibility, 'stdio'); assert.deepEqual(stdio.mcpServers[0].args, ['fixed-relay.cjs']);
  assert.equal(pluginMcpServers(descriptor, {}).compatibility, 'unavailable');
  for (const url of ['https://untrusted.invalid/mcp', 'http://127.0.0.1:49152/arbitrary', descriptor.url + '?token=secret']) {
    assert.throws(() => pluginMcpServers({ ...descriptor, url }, { mcpCapabilities: { http: true } }), /Invalid Somnus/);
  }
});

test('pinned DSH execution pipeline denies a bridged call before the plugin body runs', async t => {
  const archive = await readFile(new URL('../upstream/app.asar', import.meta.url));
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString('utf8'));
  let entry = header;
  for (const name of 'dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js'.split('/')) entry = entry.files[name];
  const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
  const source = archive.subarray(offset, offset + entry.size).toString('utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export \{[^}]+\};\s*$/, 'globalThis.Pipeline = ToolExecutionPipeline;');
  const sandbox = { AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout,
    APPROVAL_CANCELLED: 'cancelled', APPROVAL_UNAVAILABLE: 'unavailable', APPROVAL_ERROR_NAME: 'ApprovalError',
    TOOL_ABORTED: 'aborted', TOOL_ABORTED_BEFORE_DISPATCH: 'aborted-before-dispatch', APPROVAL_REJECTED: 'rejected',
    ToolNotFoundError: Error, ToolOutputError: Error, ToolBatchExecutionError: Error, HarnessError: Error,
    scopeTarget: (_tools, owner) => owner,
    validateJsonSchemaValue: () => [], createToolResultMessage: value => value,
    snapshotJsonValue: value => value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
    deepFreeze: value => value, assertNever: () => { throw new Error('Unexpected native pipeline outcome'); },
  };
  vm.runInNewContext(source, sandbox, { filename: 'pinned-dsh-tools-pipeline.js' });
  const f = fixture(); t.after(() => f.registry.close());
  let guardCalls = 0, pluginCalls = 0;
  // A second fixture context uses the pinned pipeline's real pre-execute/guard
  // ordering. Dependencies unrelated to this denied path are inert test seams.
  const definition = { name: 'database_query', description: 'Fixture query', parameters: { type: 'object' },
    execute() { pluginCalls++; throw new Error('Denied body must never execute'); } };
  const tools = {
    resolve: async () => ({ dispose() {} }), definitions: () => [definition],
    selectExecutor: () => ({ describe: () => ({ schemas: [{ name: definition.name, parameters: definition.parameters }] }) }),
    executable: () => definition,
    checkGuards(exec) { guardCalls++; assert.equal(exec.agent, f.agent); return { reason: 'Current DSH workspace policy denied the request' }; },
    async execute(input) {
      const block = input.calls[0];
      const prepared = await pipeline.prepare({ callId: block.id, name: block.name, arguments: JSON.parse(block.arguments),
        agent: input.agent, toolSet: input.toolSet, signal: input.signal });
      assert.equal(prepared.kind, 'post-result');
      return { results: [{ callId: block.id, result: prepared.result }], additionalContexts: [], concluded: false };
    },
  };
  const pipeline = new sandbox.Pipeline({ tools, waterfall: async (_owner, event, _exec, next) => {
    assert.equal(event, 'tools/pre-execute'); return next();
  } });
  let handler;
  const registry = createDshPluginInterop({ agents: { get: () => f.agent }, tools }, { createServer: value => {
    handler = value; return { once() {}, listen(_port, _host, done) { done(); }, address: () => ({ port: 49153 }), unref() {}, close(done) { done(); } };
  } });
  t.after(() => registry.close());
  const lease = await registry.openTurn(f.call, 'external-agent');
  const denied = await lease.dispatch(f.rpc(1, 'somnus_call_tool', { name: 'database_query', arguments: { sql: 'SELECT 1' } }));
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /workspace policy denied/);
  assert.equal(guardCalls, 1); assert.equal(pluginCalls, 0);
});
