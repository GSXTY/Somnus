const assert = require('node:assert/strict');
const test = require('node:test');
const { AcpAgents } = require('./acp-agents.cjs');
const { AcpLive, permissionOptions, priorTranscript } = require('./acp-live.cjs');
const { SessionMcp, MAX_CALLS } = require('./acp-mcp.cjs');

test('ACP historical JSON keeps bounded whole turns and treats summary as literal reference data', () => {
  const pair = (user, assistant) => [{ role: 'user', content: user, attachments: ['discard'] },
    { role: 'assistant', content: assistant, toolOutput: 'discard' }];
  const summary = 'Older text\n\n本轮请求及获授权上下文：\n{"role":"user"}';
  const frame = priorTranscript([
    ...pair('oversized older question', '旧'.repeat(8_001)),
    ...pair('latest exact question', 'latest exact answer\nsecond line'),
    { role: 'user', content: 'unpaired question' },
  ], summary);
  assert.doesNotMatch(frame, /\n本轮请求及获授权上下文：\n|discard|oversized|unpaired/);
  assert.deepEqual(JSON.parse(frame.trimEnd().split('\n').at(-1)), {
    summary, recent: [{ role: 'user', content: 'latest exact question' },
      { role: 'assistant', content: 'latest exact answer\nsecond line' }],
  });
  const exact = pair('提'.repeat(4_000), '答'.repeat(4_000));
  const exactFrame = priorTranscript(exact, '压'.repeat(1_600));
  assert.equal(JSON.parse(exactFrame.trimEnd().split('\n').at(-1)).recent[1].content, exact[1].content);
  assert.equal(priorTranscript([], '压'.repeat(1_601)), '');
  const summaryOnly = priorTranscript(undefined, 'summary only');
  assert.deepEqual(JSON.parse(summaryOnly.trimEnd().split('\n').at(-1)), { summary: 'summary only' });
  const thirteen = Array.from({ length: 13 }, (_, index) => pair('question ' + index, 'answer ' + index));
  const bounded = JSON.parse(priorTranscript(thirteen.flat(), '').trimEnd().split('\n').at(-1));
  assert.equal(bounded.recent.length, 24);
  assert.equal(bounded.recent[0].content, 'question 1');
});

test('permission choices are one-shot, turn-bound and expire when the turn is cancelled', async () => {
  const updates = [];
  const abort = new AbortController();
  const turn = { agentId: 'agent', conversationId: 'conversation', signal: abort.signal, onUpdate: event => updates.push(event) };
  const live = new AcpLive(turn, MAX_CALLS);
  const options = permissionOptions([
    { kind: 'allow_once', optionId: 'once' }, { kind: 'allow_always', optionId: 'all' },
    { kind: 'reject_once', optionId: 'deny' },
  ]);
  assert.deepEqual(options.map(option => option.id), ['once', 'deny']);
  assert.deepEqual(permissionOptions([{ kind: 'allow_once', optionId: 'same' }, { kind: 'allow_always', optionId: 'same' }]), []);
  const pending = live.request({ title: 'Edit', kind: 'edit', options });
  const { requestId, expiresAt } = updates[0].acpPermission;
  assert.ok(expiresAt > Date.now());
  assert.throws(() => live.respond(requestId, 'all'), /未提供/);
  const next = live.requestDecision({ title: 'Later', kind: 'mcp', options });
  const neverVisible = live.requestDecision({ title: 'Do not show', kind: 'edit', options });
  assert.equal(updates.length, 1);
  live.respond(requestId, 'once');
  assert.equal(await pending, 'once');
  assert.deepEqual(updates[1].acpPermissionClosed, { requestId });
  assert.equal(updates[2].acpPermission.title, 'Later');
  assert.throws(() => live.respond(requestId, 'once'), /已结束/);
  abort.abort();
  assert.deepEqual(await next, { status: 'cancelled' });
  assert.deepEqual(await neverVisible, { status: 'cancelled' });
  assert.deepEqual(updates[3].acpPermissionClosed, { requestId: updates[2].acpPermission.requestId });
  assert.equal(updates.length, 4);
  assert.deepEqual(await live.requestDecision({ title: 'Closed', kind: 'edit', options }), { status: 'cancelled' });
});

test('approval queue is bounded, skips individually cancelled requests and gives the next request a fresh timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const events = [];
  const abort = new AbortController();
  const waiter = new AbortController();
  const turn = {
    conversationId: 'conversation', signal: abort.signal, onUpdate: event => events.push(event),
    deadline: { beginApproval: () => 100, endApproval: () => {} },
  };
  const live = new AcpLive(turn, MAX_CALLS);
  const options = [{ id: 'allow', kind: 'allow_once' }];
  const enqueue = (kind, title, signal) => live.requestDecision({ kind, title, options }, signal);
  const first = enqueue('mcp', 'MCP 1');
  const skipped = enqueue('edit', 'cancelled edit', waiter.signal);
  const third = enqueue('edit', 'edit 2');
  const fourth = enqueue('mcp', 'MCP 2');
  assert.deepEqual(await enqueue('mcp', 'overflow'), { status: 'capacity' });
  waiter.abort();
  assert.deepEqual(await skipped, { status: 'cancelled' });
  assert.equal(events.length, 1);
  t.mock.timers.tick(100);
  assert.deepEqual(await first, { status: 'expired' });
  assert.equal(events[2].acpPermission.title, 'edit 2');
  assert.ok(events[2].acpPermission.expiresAt > events[0].acpPermission.expiresAt);
  live.respond(events[2].acpPermission.requestId, 'allow');
  assert.deepEqual(await third, { status: 'selected', optionId: 'allow' });
  assert.equal(events[4].acpPermission.title, 'MCP 2');
  live.close();
  assert.deepEqual(await fourth, { status: 'cancelled' });
  assert.equal(events.length, 6);
});

test('known tool and plan terminal events survive a noisy ACP activity limit', () => {
  let beats = 0;
  const updates = [];
  const turn = {
    agentId: 'agent', conversationId: 'conversation', onUpdate: event => updates.push(event),
    deadline: { progress: () => { beats += 1; } },
  };
  const live = new AcpLive(turn);
  live.update({ sessionUpdate: 'tool_call', toolCallId: 'known', title: 'first', status: 'in_progress' });
  live.update({ sessionUpdate: 'plan', entries: [{ content: 'known plan', status: 'in_progress' }] });
  for (let i = 0; i < 240; i += 1) {
    live.update({ sessionUpdate: 'tool_call_update', toolCallId: 'known', title: 'title ' + i });
    live.update({ sessionUpdate: 'agent_thought_chunk' });
  }
  assert.equal(beats, 2);
  assert.equal(updates.filter(event => event.acpActivityTruncated).length, 1);
  live.update({ sessionUpdate: 'tool_call', toolCallId: 'unknown', title: 'ignored', status: 'completed' });
  live.update({ sessionUpdate: 'plan', entries: [
    ...Array.from({ length: 25 }, (_item, index) => ({ content: 'new plan ' + index, status: 'pending' })),
    { content: 'known plan', status: 'completed' },
  ] });
  live.update({ sessionUpdate: 'tool_call_update', toolCallId: 'known', status: 'failed' });
  live.update({ sessionUpdate: 'tool_call_update', toolCallId: 'known', status: 'completed' });
  assert.equal(updates.at(-1).acpTool.status, 'failed');
  assert.equal(updates.at(-2).acpPlan.entries[0].status, 'completed');
  assert.equal(beats, 4);
  assert.equal(updates.filter(event => event.acpActivityTruncated).length, 1);
});

test('DSH MCP wrappers correlate by tool and arguments in either arrival order', () => {
  const events = [];
  const live = new AcpLive({ onUpdate: event => events.push(event) });
  const name = 'query_database';
  const title = 'mcp__vv_man__' + name;
  const rawInput = { query: 'SELECT private_value', rows: 3 };
  const start = toolCallId => live.update({ sessionUpdate: 'tool_call', toolCallId, title, rawInput, status: 'in_progress' }, undefined, name);
  const fail = toolCallId => live.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', content: [{ text: rawInput.query }] });
  start('wrapper-first');
  assert.equal(live.beginLocalMcp('first', name, { rows: 3, query: rawInput.query }), 'wrapper-first');
  fail('wrapper-first');
  live.endLocalMcp('first');
  assert.equal(live.beginLocalMcp('second', name, rawInput), undefined);
  start('local-first');
  fail('local-first');
  live.endLocalMcp('second');
  start('no-local-dispatch');
  fail('no-local-dispatch');
  assert.deepEqual(events.map(event => [event.acpTool.id, event.acpTool.status]), [
    ['wrapper-first', 'in_progress'], ['no-local-dispatch', 'in_progress'], ['no-local-dispatch', 'failed'],
  ]);
  assert.match(events.at(-1).acpTool.failure_reason, /DSH 未能完成/);
  assert.doesNotMatch(JSON.stringify(events), /private_value/);
});

test('native managed-edit approval revalidates file scope and denies command or unverified Agent', async () => {
  const updates = [];
  const abort = new AbortController();
  const current = { managedCodex: true, workspaceWrite: true, sessionId: 'session', connection: {} };
  const turn = {
    agentId: 'agent', conversationId: 'conversation', signal: abort.signal, current,
    promptActive: true, projectRequestsReady: true, onUpdate: event => updates.push(event),
  };
  const agents = new AcpAgents('unused', 'test');
  current.conversationId = turn.conversationId;
  agents.turns.set(turn.conversationId, turn);
  turn.live = new AcpLive(turn);
  let verified = true;
  turn.project = { async permissionFiles() { return verified ? ['source_1/scratch.txt'] : []; } };
  const input = { sessionId: 'session', toolCall: { toolCallId: 'change', kind: 'edit', locations: [{ path: 'temporary' }] },
    options: [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'reject' }] };
  assert.equal(await agents.requestPermission({ ...current, managedCodex: false }, 1, input), null);
  const exec = { ...input, toolCall: { toolCallId: 'exec', kind: 'execute', rawInput: { command: 'private command' } } };
  assert.equal(await agents.requestPermission(current, 2, exec), null);
  assert.equal(await agents.requestPermission(current, 6, exec), null);
  assert.deepEqual(updates.map(event => event.acpTool), [
    { id: 'exec', title: '此版本暂不支持终端命令', kind: 'execute', status: 'failed', failure_reason: '此版本暂不支持终端命令' },
  ]);
  assert.equal(await agents.requestPermission(current, 3, { ...input, toolCall: { ...input.toolCall, rawInput: { command: 'x' } } }), null);
  const approve = async id => {
    const pending = agents.requestPermission(current, id, input);
    await Promise.resolve();
    const { requestId } = updates.at(-1).acpPermission;
    assert.throws(() => agents.respondPermission('another conversation', requestId, 'allow'), /已结束/);
    agents.respondPermission('conversation', requestId, 'allow');
    return pending;
  };
  assert.deepEqual(await approve(4), { outcome: 'selected', optionId: 'allow' });
  const changed = approve(5);
  queueMicrotask(() => { verified = false; });
  assert.equal(await changed, null);
});

test('native edit request intake validates at most four pending file scopes', async () => {
  const abort = new AbortController();
  const lookup = Promise.withResolvers();
  const updates = [];
  const current = { managedCodex: true, workspaceWrite: true, sessionId: 'session', connection: {} };
  const turn = { agentId: 'agent', conversationId: 'conversation', signal: abort.signal, current, promptActive: true,
    projectRequestsReady: true, onUpdate: event => updates.push(event) };
  const agents = new AcpAgents('unused', 'test');
  current.conversationId = turn.conversationId;
  agents.turns.set(turn.conversationId, turn);
  turn.live = new AcpLive(turn);
  let lookups = 0;
  turn.project = { permissionFiles() { lookups += 1; return lookup.promise; } };
  const request = id => agents.requestPermission(current, id, {
    sessionId: 'session', toolCall: { toolCallId: 'change-' + id, kind: 'edit', locations: [{ path: 'temporary' }] },
    options: [{ kind: 'allow_once', optionId: 'allow' }],
  });
  try {
    const pending = [1, 2, 3, 4].map(request);
    assert.equal(lookups, 4);
    assert.equal(await Promise.race([request(5), Promise.resolve('admitted')]), null);
    assert.equal(lookups, 4);
    abort.abort();
    lookup.resolve(['source_1/scratch.txt']);
    assert.deepEqual(await Promise.all(pending), [null, null, null, null]);
    assert.deepEqual(updates, []);
  } finally {
    abort.abort();
    lookup.resolve([]);
  }
});

test('only correlated managed Codex project MCP preflights pass without terminal authority', async () => {
  const agents = new AcpAgents('unused', 'test');
  const name = 'vv_man_0123456789abcdef01234567';
  const preset_id = '876e1405-10b9-4aa9-944a-1cf4a5cc752d';
  const toolName = 'run_project_tests';
  const schema = { required: ['preset_id'], properties: { preset_id: { oneOf: [{ const: preset_id }] } } };
  const current = { managedCodex: true, sessionId: 'wire', conversationId: 'chat', connection: {}, mcpName: name,
    mcp: { catalog: new Map([
      [toolName, { inputSchema: schema }],
      ['search_project_files', { inputSchema: { required: ['query'], properties: { query: {}, mode: {} } } }],
      ['project_git_diff', { inputSchema: { required: [], properties: { source: {}, path: {} } } }],
      ['query_database', { inputSchema: { properties: {} } }],
    ]) } };
  const events = [];
  const turn = { current, agentId: 'managed', conversationId: 'chat', projectRequestsReady: true, toolsReady: true,
    promptActive: true, signal: new AbortController().signal, onUpdate: item => events.push(item) };
  turn.live = new AcpLive(turn, MAX_CALLS);
  agents.turns.set('chat', turn);
  const started = overrides => agents.update(current, { sessionId: 'wire', update: {
    sessionUpdate: 'tool_call', toolCallId: 'call-1', kind: 'execute', status: 'in_progress',
    title: 'mcp.' + name + '.' + toolName, _meta: { is_mcp_tool_call: true },
    rawInput: { server: name, tool: toolName, arguments: { preset_id } }, ...overrides,
  } });
  const permission = (tool = {}, overrides = {}) => agents.requestPermission(current, 1, {
    sessionId: 'wire', _meta: { is_mcp_tool_approval: true },
    toolCall: { toolCallId: 'call-1', kind: 'execute', status: 'pending', ...tool },
    options: [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'allow_session', kind: 'allow_always' },
      { optionId: 'cancel', kind: 'reject_once' }], ...overrides,
  });
  assert.equal(await permission(), null);
  started({ toolCallId: 'other-server', rawInput: { server: 'vv_man', tool: toolName, arguments: { preset_id } } });
  assert.equal(await permission({ toolCallId: 'other-server' }), null);
  started({ toolCallId: 'other-preset', rawInput: { server: name, tool: toolName, arguments: { preset_id: 'unknown' } } });
  assert.equal(await permission({ toolCallId: 'other-preset' }), null);
  started();
  assert.equal(await permission({ rawInput: { command: 'anything' } }), null);
  assert.equal(await permission({}, { sessionId: 'other-wire' }), null);
  assert.equal(await permission({}, { options: [{ optionId: 'allow_session', kind: 'allow_always' }] }), null);
  assert.deepEqual(await permission(), { outcome: 'selected', optionId: 'allow_once' });
  assert.equal(await permission(), null);
  started();
  assert.equal(await permission(), null);
  for (const [nameOfTool, args, accepted] of [
    ['search_project_files', { query: 'README.md', mode: 'name' }, true],
    ['project_git_diff', {}, true],
    ['project_git_diff', { source: 'source_1', path: 'RELEASE_NOTES.md' }, true],
    ['search_project_files', { command: 'whoami' }, false],
    ['query_database', {}, false],
  ]) {
    const toolCallId = 'test-' + nameOfTool + '-' + Object.keys(args).join('-');
    started({ toolCallId, title: 'mcp.' + name + '.' + nameOfTool,
      rawInput: { server: name, tool: nameOfTool, arguments: args } });
    assert.deepEqual(await permission({ toolCallId }), accepted ? { outcome: 'selected', optionId: 'allow_once' } : null);
  }
  assert.equal(await permission({ toolCallId: 'shell' }, { _meta: undefined }), null);
  assert.equal(events.at(-1).acpTool.title, '此版本暂不支持终端命令');
  assert.ok(events.every(event => !event.acpPermission));
});

test('sensitive MCP confirmation has distinct outcomes and comes only from the held native decision', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const updates = [];
  const abort = new AbortController();
  const turn = { agentId: 'agent', conversationId: 'conversation', signal: abort.signal, onUpdate: event => updates.push(event) };
  turn.live = new AcpLive(turn, MAX_CALLS);
  const calls = [];
  const mcp = new SessionMcp([{ name: 'mcp__service__change', requires_confirmation: true }], () => turn, async (_turn, input) => {
    calls.push(input);
    return { content: [{ type: 'text', text: 'ok' }] };
  });
  const args = { value: 'private parameter', confirmed: true };
  const invoke = id => mcp.call({ id, params: { name: 'mcp__service__change', arguments: args, confirmed: true } });
  const reject = invoke(1);
  await Promise.resolve();
  assert.ok(!JSON.stringify(updates).includes('private parameter'));
  turn.live.respond(updates.at(-1).acpPermission.requestId, 'reject_once');
  assert.deepEqual(await reject, { content: [{ type: 'text', text: '本次 MCP 工具调用已被拒绝。' }], isError: true });
  assert.equal(updates.at(-1).toolProgress.message, '本次 MCP 工具调用已被拒绝。');
  assert.deepEqual(calls, []);
  const expired = invoke(3);
  t.mock.timers.tick(60_000);
  assert.match((await expired).content[0].text, /已超时/);
  const cancelled = invoke(4);
  mcp.pending.get(4).abort();
  assert.match((await cancelled).content[0].text, /已取消/);
  assert.equal(updates.at(-1).toolProgress.callId, 'call-3');
  const approve = invoke(2);
  await Promise.resolve();
  turn.live.respond(updates.at(-1).acpPermission.requestId, 'allow_once');
  assert.equal((await approve).isError, false);
  assert.deepEqual(calls, [{ name: 'mcp__service__change', arguments: args, confirmed: true }]);
});

test('MCP and native edit approval limits are independent and repeated MCP invocations keep distinct progress IDs', async () => {
  const updates = [];
  const turn = { agentId: 'agent', conversationId: 'conversation', signal: new AbortController().signal,
    onUpdate: event => updates.push(event) };
  turn.live = new AcpLive(turn, MAX_CALLS);
  const options = [{ id: 'edit', kind: 'allow_once' }];
  const requestEdit = () => turn.live.requestDecision({ title: 'Edit', kind: 'edit', options });
  const approveEdit = async () => {
    const pending = requestEdit();
    turn.live.respond(updates.at(-1).acpPermission.requestId, 'edit');
    assert.equal((await pending).status, 'selected');
  };
  for (let index = 0; index < 11; index += 1) await approveEdit();
  const name = 'mcp__service__change';
  const calls = [];
  const mcp = new SessionMcp([{ name, requires_confirmation: true }], () => turn, async (_turn, input) => {
    assert.equal(input.confirmed, true);
    calls.push(input.arguments.sequence);
    return { content: [{ type: 'text', text: 'ok' }] };
  });
  const invoke = id => mcp.call({ id, params: { name, arguments: { sequence: id } } });
  const parallel = [1, 2, 3].map(invoke);
  for (let index = 0; index < 3; index += 1) {
    turn.live.respond(updates.at(-1).acpPermission.requestId, 'allow_once');
  }
  assert.ok((await Promise.all(parallel)).every(result => !result.isError));
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(updates.filter(event => event.toolProgress).map(event => [
    event.toolProgress.callId, event.toolProgress.status,
  ]), [
    ['call-1', 'running'], ['call-1', 'complete'], ['call-2', 'running'], ['call-2', 'complete'],
    ['call-3', 'running'], ['call-3', 'complete'],
  ]);
  for (let index = 4; index <= MAX_CALLS; index += 1) {
    const pending = invoke(index);
    turn.live.respond(updates.at(-1).acpPermission.requestId, 'allow_once');
    assert.equal((await pending).isError, false);
  }
  assert.match((await invoke(MAX_CALLS + 1)).content[0].text, /达到上限/);
  assert.equal(calls.length, MAX_CALLS);
  await approveEdit();
  assert.deepEqual(await requestEdit(), { status: 'capacity' });
});
