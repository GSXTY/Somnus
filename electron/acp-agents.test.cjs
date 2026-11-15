const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AcpAgents } = require('./acp-agents.cjs');
const { eligibleAuthUrl, openDeepSeekHarness } = require('./acp-ipc.cjs');

test('delegation uses a fresh tool-free ACP session for the confirmed managed target', { skip: process.platform !== 'win32' }, async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'vvman-delegation-test-'));
  const fixture = path.join(__dirname, 'test-fixtures', 'acp-test-agent.cjs');
  const launch = { executable: await realpath(process.execPath), args: [fixture] };
  const dsh = { launch: async () => launch, profile: async () => ({ bundles: [] }), home: workspace };
  const agents = new AcpAgents(path.join(workspace, 'agents.json'), '1.0.0', workspace, undefined, undefined, undefined, dsh);
  t.after(async () => {
    agents.close();
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });
  const target = await agents.save({ ...launch, name: 'Managed DSH' });
  const unsupported = await agents.save({ ...launch, args: [fixture, '--custom'], name: 'Custom' });
  assert.deepEqual(await agents.listDelegationAgents(), [{ id: target.id, name: target.name }]);
  const input = { agentId: target.id, conversationId: 'conversation', requestId: 'a'.repeat(32),
    task: '复核统计口径', context: '仅有汇总数据' };
  await assert.rejects(agents.runDelegation({ ...input, agentId: unsupported.id }), /委派仅支持/);
  const first = await agents.runDelegation(input);
  const second = await agents.runDelegation({ ...input, requestId: 'b'.repeat(32) });
  assert.equal(first.agentName, target.name);
  assert.match(first.text, /复核统计口径/);
  assert.match(first.text, /仅有汇总数据/);
  assert.equal(first.text, second.text);
  assert.match(second.text, /\(1\)$/);
  assert.equal(agents.conversations.size, 0);
});

test('ACP profiles, streaming, reuse, login and cancellation', { skip: process.platform !== 'win32' }, async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-test-'));
  const agents = new AcpAgents(path.join(workspace, 'external-acp-agents.json'), '1.0.0');
  const executable = process.execPath;
  const fixture = path.join(workspace, 'acp-test-agent.cjs');
  await copyFile(path.join(__dirname, 'test-fixtures', 'acp-test-agent.cjs'), fixture);
  const args = [fixture];
  const environmentKey = 'VV_MAN_TEST_SECRET';
  const previous = process.env[environmentKey];
  process.env[environmentKey] = 'test-secret-value';
  t.after(async () => {
    agents.close();
    if (previous === undefined) delete process.env[environmentKey];
    else process.env[environmentKey] = previous;
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  await assert.rejects(agents.save({ name: 'Invalid', executable: 'relative.exe', args }), /本机/);
  const profile = await agents.save({ name: 'Experimental ACP', executable, args });
  assert.deepEqual(await agents.list(), [profile]);
  assert.deepEqual(await agents.probe(profile.id), {
    name: 'Local ACP Mock', version: '1.0', provider: 'custom', authMethods: [], loginMethods: [], authentication: 'ready',
  });
  const output = [];
  const reply = await agents.prompt(profile.id, '第一轮', update => output.push(update));
  assert.deepEqual(reply, { text: '代理回复：第一轮 (1)', stopReason: 'end_turn' });
  assert.deepEqual(output, [{ agentId: profile.id, text: '代理回复：' }, { agentId: profile.id, text: '第一轮 (1)' }]);
  assert.equal((await agents.prompt(profile.id, '第二轮', () => {})).text, '代理回复：第二轮 (2)');
  const cancelled = agents.prompt(profile.id, 'cancel me', () => {});
  agents.cancel();
  assert.deepEqual(await cancelled, { text: '', stopReason: 'cancelled' });
  const previousProcess = agents.active.connection.exited;
  agents.reset();
  await previousProcess;
  assert.equal((await agents.prompt(profile.id, '新对话', () => {})).text, '代理回复：新对话 (1)');

  const loginProfile = await agents.save({ name: 'Login required', executable, args: [...args, '--needs-login'] });
  assert.equal((await agents.probe(loginProfile.id)).authentication, 'required');
  await agents.remove(profile.id);
  assert.deepEqual(await agents.list(), [loginProfile]);
});

test('OpenMA browser API key prompts are unavailable and official browser links remain scoped', { skip: process.platform !== 'win32' }, async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-auth-url-'));
  let opened = 0;
  const agents = new AcpAgents(path.join(workspace, 'external-acp-agents.json'), '1.0.0', undefined,
    async () => {
      opened += 1;
    });
  const fixture = path.join(__dirname, 'test-fixtures', 'acp-test-agent.cjs');
  t.after(async () => {
    agents.close();
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  assert.equal(eligibleAuthUrl('openma', 'http://127.0.0.1:12345/key'), null);
  assert.equal(eligibleAuthUrl('codebuddy', 'https://codebuddy.ai.evil.example/login'), null);
  assert.equal(eligibleAuthUrl('codebuddy', 'https://user:password@codebuddy.ai/login'), null);
  assert.equal(eligibleAuthUrl('codebuddy', 'https://codebuddy.ai/login').hostname, 'codebuddy.ai');
  const openma = await agents.save({ name: 'OpenMA Browser', executable: process.execPath,
    args: [fixture, '--openma', '--openma-browser'] });
  assert.equal((await agents.probe(openma.id)).authentication, 'required');
  await assert.rejects(agents.authenticate(openma.id, 'browser'), /未提供/);
  assert.equal(opened, 0);
});

test('DeepSeek opens only the vendor app protocol or official website', async () => {
  const links = [];
  const shell = { openExternal: async url => links.push(url) };
  const app = { getApplicationNameForProtocol: url => {
    assert.equal(url, 'dsh://open');
    return 'DeepSeek Harness';
  } };
  assert.equal(await openDeepSeekHarness(app, shell), 'desktop');
  assert.equal(await openDeepSeekHarness({ getApplicationNameForProtocol: () => '' }, shell), 'website');
  assert.deepEqual(links, ['dsh://open', 'https://www.deepseek.com/harness/']);
});

test('ACP main-chat routes advertised model selections and isolates native sessions', { skip: process.platform !== 'win32' }, async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-main-chat-'));
  const agents = new AcpAgents(path.join(workspace, 'external-acp-agents.json'), '1.0.0');
  const fixture = path.join(__dirname, 'test-fixtures', 'acp-test-agent.cjs');
  t.after(async () => {
    agents.close();
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });
  const add = (name, args) => agents.save({ name, executable: process.execPath, args: [fixture, ...args] });
  const modern = await add('Modern', ['--modern-models']);
  const legacy = await add('Legacy', ['--legacy-models']);
  const login = await add('Login', ['--needs-login']);

  assert.deepEqual(await agents.discoverModels(modern.id), {
    agentId: modern.id, modelId: 'mock-default',
    models: [{ id: 'mock-default', name: 'Mock Default' }, { id: 'mock-selectable', name: 'Mock Selectable' }],
  });
  await assert.rejects(agents.discoverModels(login.id), error => error.code === -32000);
  const events = [];
  const send = (agent, conversationId, text, modelId) => agents.promptConversation({
    agentId: agent.id, conversationId, text, modelId,
  }, update => events.push(update));
  await assert.rejects(send(modern, 'first', 'invalid', 'made-up-model'), /刷新模型列表/);
  assert.deepEqual(await send(modern, 'first', 'one', 'mock-selectable'), {
    text: '代理回复：one (1) mock-selectable', stopReason: 'end_turn',
    modelId: 'mock-selectable', modelName: 'Mock Selectable',
  });
  assert.deepEqual(events.map(({ conversationId }) => conversationId), ['first', 'first']);
  assert.equal((await send(modern, 'second', 'two')).text, '代理回复：two (1) mock-default');
  assert.equal((await agents.prompt(modern.id, 'trial', () => {})).text, '代理回复：trial (1) mock-default');
  assert.equal((await send(modern, 'first', 'three')).text, '代理回复：three (2) mock-selectable');
  assert.equal((await send(legacy, 'third', 'legacy model', 'mock-selectable')).modelId, 'mock-selectable');
  const cancellation = send(modern, 'first', 'cancel me');
  agents.cancelConversation('second');
  agents.cancelConversation('first');
  assert.equal((await cancellation).stopReason, 'cancelled');
  agents.resetConversation('first');
  assert.equal((await send(modern, 'first', 'new')).text, '代理回复：new (1) mock-default');
  assert.equal((await send(modern, 'second', 'still')).text, '代理回复：still (2) mock-default');

  assert.deepEqual((await send(modern, 'usage', 'usage-zero')).usage, { input_tokens: 0, output_tokens: 0 });
  const limited = await send(modern, 'usage', 'usage-max-tokens');
  assert.equal(limited.stopReason, 'max_tokens');
  assert.deepEqual(limited.usage, { input_tokens: 12, output_tokens: 6, partial: true });
  for (const input of ['usage-unsafe', 'usage-incomplete', 'usage-string', 'usage-context-only']) {
    assert.ok(!Object.hasOwn(await send(modern, 'usage', input), 'usage'), input);
  }
  const context = { used_tokens: 83, max_tokens: 200_000 };
  assert.deepEqual(events.findLast(event => event.contextUsage)?.contextUsage, context);
  assert.deepEqual((await send(modern, 'usage', 'usage-context-only')).contextUsage, context);
  const withCache = await send(modern, 'usage', 'usage-with-cache');
  assert.deepEqual(withCache.usage, { input_tokens: 100, output_tokens: 9, cached_input_tokens: 50 });
  assert.equal(withCache.contextUsage, undefined);
  assert.deepEqual((await send(modern, 'usage', 'usage-zero-cache')).usage,
    { input_tokens: 10, output_tokens: 1, cached_input_tokens: 0 });

  const reasoningAgent = await add('Reasoning', ['--modern-models', '--reasoning']);
  const defaultDiscovery = agents.discoverModels(reasoningAgent.id);
  assert.equal(agents.discoverModels(reasoningAgent.id), defaultDiscovery);
  const [initialCatalog, catalog] = await Promise.all([
    defaultDiscovery, agents.discoverModels(reasoningAgent.id, 'mock-selectable'),
  ]);
  assert.equal(initialCatalog.reasoning.value, 'low');
  assert.deepEqual(catalog.reasoning, {
    modelId: 'mock-selectable', value: '', options: [{ id: '', name: 'Provider default' }, { id: 'high', name: 'High' }],
  });
  const sendEffort = (conversationId, modelId, reasoningEffort) => agents.promptConversation({
    agentId: reasoningAgent.id, conversationId, text: 'effort', modelId, reasoningEffort,
  }, () => {});
  await assert.rejects(sendEffort('effort-a', undefined, 'high'), /所选推理档位/);
  const high = await sendEffort('effort-a', 'mock-selectable', 'high');
  assert.equal(high.text, '代理回复：effort (1) mock-selectable effort=high');
  assert.equal(high.reasoningEffort, 'high');
  assert.equal(high.reasoningName, 'High');
  assert.equal((await sendEffort('effort-b', undefined, undefined)).reasoningEffort, 'low');
  assert.equal((await sendEffort('effort-a', 'mock-selectable', '')).reasoningEffort, '');
});

test('parallel managed ACP chats isolate startup, tools, approvals, cancellation and session ownership', {
  skip: process.platform !== 'win32', timeout: 12_000,
}, async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-parallel-'));
  const resources = path.join(workspace, 'resources');
  const codexHome = path.join(workspace, 'codex-home');
  const runtime = path.join(resources, 'agents', 'codex');
  const adapter = path.join(runtime, 'node_modules', '@agentclientprotocol', 'codex-acp');
  const executable = path.join(runtime, 'node.exe');
  const script = path.join(adapter, 'dist', 'index.js');
  const heldInitialize = path.join(path.dirname(script), 'hold-initialize');
  const projectCalls = [];
  const client = {
    async prepare(turn) {
      return {
        text: 'conversation=' + turn.conversationId, images: [], permission_mode: 'workspace_write',
        project: { available: true, files: [{ source: 'source_1', path: 'concurrent.txt' }] },
        tools: [{ name: 'test_project_tool', inputSchema: { type: 'object' } }],
      };
    },
    async file(turn, request) {
      assert.equal(request.action, 'read');
      return { content: turn.conversationId, sha256: createHash('sha256').update(turn.conversationId).digest('hex') };
    },
    async tool(turn, request) {
      assert.equal(request.arguments.identity, turn.conversationId);
      projectCalls.push(turn.conversationId);
      return { content: [{ type: 'text', text: turn.conversationId }], isError: false };
    },
  };
  const agents = new AcpAgents(path.join(workspace, 'external-acp-agents.json'), 'test', resources, undefined, client);
  const children = new Set();
  t.after(async () => {
    agents.close();
    await Promise.all([...children].map(connection => connection.exited));
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(process.execPath, executable);
  await copyFile(path.join(__dirname, 'test-fixtures', 'acp-concurrent-agent.cjs'), script);
  await writeFile(path.join(adapter, 'package.json'), JSON.stringify({
    name: '@agentclientprotocol/codex-acp', bin: { 'codex-acp': 'dist/index.js' },
  }));
  const profile = await agents.save({ name: 'Managed mock', executable, args: [await realpath(script)] });
  // The managed signature includes exact arguments. The fixture derives the expected
  // shared home from a synthetic marker stored alongside its script.
  await writeFile(path.join(path.dirname(script), 'expected-home'), codexHome);

  const eventually = async read => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const value = read();
      if (value) return value;
      await delay(15);
    }
    assert.fail('Timed out waiting for test Agent state');
  };
  const start = conversationId => {
    const updates = [];
    const state = { updates };
    const result = agents.promptConversation({ agentId: profile.id, conversationId, turnId: 'turn-' + conversationId },
      event => updates.push(event));
    result.catch(error => { state.failure = error; });
    state.result = result;
    return state;
  };
  const a = start('alpha');
  const b = start('bravo');
  await assert.rejects(start('alpha').result, /此聊天已有/);
  await assert.rejects(agents.probe(profile.id), /正在运行/);
  const permission = turn => eventually(() => {
    if (turn.failure) throw turn.failure;
    return turn.updates.find(event => event.acpPermission)?.acpPermission;
  });
  const [requestA, requestB] = await Promise.all([permission(a), permission(b)]);
  const currentA = agents.conversations.get('alpha');
  const currentB = agents.conversations.get('bravo');
  children.add(currentA.connection).add(currentB.connection);
  assert.notEqual(currentA.cwd, currentB.cwd);
  assert.notEqual(currentA.mcp.host, currentB.mcp.host);
  assert.notEqual(requestA.requestId, requestB.requestId);
  assert.throws(() => agents.respondPermission('bravo', requestA.requestId, 'allow'), /已结束/);

  await writeFile(heldInitialize, '');
  const c = start('charlie');
  const d = start('delta');
  await assert.rejects(start('echo').result, /最多同时运行 4/);
  const pendingC = await eventually(() => agents.turns.get('charlie')?.current);
  const pendingD = await eventually(() => agents.turns.get('delta')?.current);
  children.add(pendingC.connection).add(pendingD.connection);
  assert.equal(pendingC.sessionId, null);
  assert.equal(pendingD.sessionId, null);
  agents.cancelConversation('charlie');
  assert.equal((await c.result).stopReason, 'cancelled');
  assert.equal(pendingD.connection.failure, undefined);
  assert.equal(currentB.connection.failure, undefined);
  agents.resetConversation('delta');
  assert.equal((await d.result).stopReason, 'cancelled');
  assert.deepEqual(c.updates.concat(d.updates), []);

  agents.cancelConversation('alpha');
  const cancelled = await a.result;
  assert.equal(cancelled.stopReason, 'cancelled');
  assert.equal(cancelled.text, 'started-alpha');
  assert.deepEqual(cancelled.usage, { input_tokens: 13, output_tokens: 2, partial: true });
  assert.ok(a.updates.some(event => event.acpPermissionClosed?.requestId === requestA.requestId));
  assert.ok(!b.updates.some(event => event.acpPermissionClosed));
  agents.respondPermission('bravo', requestB.requestId, 'allow');
  const completed = await b.result;
  assert.equal(completed.text, 'started-bravoapproved-bravo');
  assert.deepEqual(completed.usage, { input_tokens: 36, output_tokens: 5, cached_input_tokens: 7 });
  for (const [conversationId, turn] of [['alpha', a], ['bravo', b]]) {
    assert.ok(turn.updates.every(event => event.conversationId === conversationId));
    assert.deepEqual(turn.updates.flatMap(event => event.toolProgress ? [event.toolProgress] : []), [
      { name: 'test_project_tool', callId: 'call-1', status: 'running' },
      { name: 'test_project_tool', callId: 'call-1', status: 'complete' },
    ]);
  }
  assert.deepEqual(projectCalls.sort(), ['alpha', 'bravo']);
});

test('ACP replays same-chat history on Agent handoff and keeps uninterrupted sessions', { skip: process.platform !== 'win32' }, async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'somnus-acp-handoff-'));
  const history = [
    { role: 'user', content: 'default-context-question', attachments: ['private image bytes'] },
    { role: 'assistant', content: 'default-context-answer' },
  ];
  let predecessor = 'default-first';
  const client = { async prepare(turn) {
    assert.equal(turn.conversationId, 'handoff-chat');
    return { text: 'Current: ' + turn.turnId, images: [], history, history_predecessor: predecessor, history_summary: 'earlier checkpoint' };
  } };
  const agents = new AcpAgents(path.join(workspace, 'external-acp-agents.json'), 'test', undefined, undefined, client);
  const fixture = path.join(__dirname, 'test-fixtures', 'acp-test-agent.cjs');
  t.after(async () => {
    const exits = [...agents.conversations.values()].map(current => current.connection.exited);
    agents.close();
    await Promise.all(exits);
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });
  const add = name => agents.save({ name, executable: process.execPath, args: [fixture] });
  const codex = await add('Codex');
  const dsh = await add('DSH');
  const send = (agent, turnId) => agents.promptConversation({ agentId: agent.id, conversationId: 'handoff-chat', turnId }, () => {});
  const current = () => agents.conversations.get('handoff-chat');
  const first = await send(codex, 'codex-first');
  assert.match(first.text, /default-context-answer/);
  assert.match(first.text, /earlier checkpoint/);
  assert.doesNotMatch(first.text, /private image bytes/);
  assert.ok(first.text.indexOf('default-context-answer') < first.text.indexOf('Current: codex-first'));
  const codexSession = current();

  predecessor = 'codex-first';
  const continued = await send(codex, 'codex-second');
  assert.equal(current(), codexSession);
  assert.doesNotMatch(continued.text, /default-context-answer|earlier checkpoint/);

  predecessor = 'default-interim';
  history.push({ role: 'user', content: 'intervening question' }, { role: 'assistant', content: 'intervening reply' });
  const resumed = await send(codex, 'codex-third');
  assert.notEqual(current(), codexSession);
  assert.match(resumed.text, /intervening reply/);
  assert.equal(resumed.text.match(/default-context-answer/g).length, 1);
  const resumedSession = current();

  predecessor = 'codex-third';
  history.push({ role: 'user', content: 'Codex question' }, { role: 'assistant', content: 'Codex response' });
  assert.match((await send(dsh, 'dsh-first')).text, /Codex response/);
  assert.notEqual(current(), resumedSession);
  predecessor = 'dsh-first';
  history.push({ role: 'user', content: 'DSH question' }, { role: 'assistant', content: 'DSH response' });
  assert.match((await send(codex, 'codex-fourth')).text, /DSH response/);
});

test('ACP supports advertised account choices without persisting credentials', { skip: process.platform !== 'win32' }, async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-auth-test-'));
  const registry = path.join(workspace, 'external-acp-agents.json');
  const agents = new AcpAgents(registry, '1.0.0');
  const fixture = path.join(__dirname, 'test-fixtures', 'acp-test-agent.cjs');
  t.after(async () => {
    agents.close();
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  const add = (name, ...args) => agents.save({ name, executable: process.execPath, args: [fixture, ...args] });
  const codex = await add('Codex', '--codex');
  const legacyCodex = await add('Legacy Codex', '--legacy-codex');
  const waiting = await add('Waiting Codex', '--codex', '--wait-login');
  const openma = await add('OpenMA', '--openma');
  const existingOpenma = await add('Previously configured OpenMA', '--openma', '--already-authenticated');
  const dsh = await add('DSH', '--dsh');

  const offered = await agents.probe(codex.id);
  assert.equal(offered.provider, 'codex');
  assert.equal(offered.authentication, 'required');
  assert.deepEqual(offered.loginMethods.map(item => [item.id, item.kind]), [['chat-gpt', 'browser']]);
  assert.deepEqual(offered.authMethods, ['ChatGPT']);
  await assert.rejects(agents.authenticate(codex.id, 'api-key'), /未提供/);
  await assert.rejects(agents.authenticate(codex.id, 'chat-gpt', 'mock-key-value'), /Provider/);
  assert.equal((await agents.authenticate(codex.id, 'chat-gpt')).authentication, 'ready');
  assert.equal((await agents.probe(legacyCodex.id)).loginMethods[0].id, 'chatgpt');
  assert.equal((await agents.authenticate(legacyCodex.id, 'chatgpt')).authentication, 'ready');

  const started = agents.authenticate(waiting.id, 'chat-gpt');
  await new Promise(resolve => setTimeout(resolve, 200));
  await assert.rejects(agents.probe(codex.id), /正在运行/);
  agents.cancelAuthentication();
  await assert.rejects(started, /已取消/);
  assert.equal((await agents.probe(waiting.id)).authentication, 'required');

  const deepSeek = await agents.probe(openma.id);
  assert.equal(deepSeek.provider, 'deepseek-harness');
  assert.deepEqual(deepSeek.loginMethods, []);
  await assert.rejects(agents.authenticate(openma.id, 'api-key:deepseek-official'), /未提供/);
  assert.equal((await agents.probe(existingOpenma.id)).authentication, 'ready');
  assert.ok((await agents.list()).some(profile => profile.id === existingOpenma.id));
  assert.ok(!(await readFile(registry, 'utf8')).includes('mock-key-value'));
  assert.equal((await agents.probe(dsh.id)).authentication, 'unverified');
});
