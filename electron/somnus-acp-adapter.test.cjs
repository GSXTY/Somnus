const test = require('node:test');
const assert = require('node:assert/strict');

test('configured ACP providers refresh and route exact registry IDs without fabricated models', async t => {
  const prior = { url: process.env.SOMNUS_ACP_URL, token: process.env.SOMNUS_ACP_TOKEN,
    fetch: global.fetch, interval: global.setInterval, clear: global.clearInterval };
  process.env.SOMNUS_ACP_URL = 'http://127.0.0.1:12345';
  process.env.SOMNUS_ACP_TOKEN = 'test-token';
  let agents = [{ id: 'configured-codex-uuid', name: 'Codex', revision: 'first' }];
  let refresh, cleanup, adapter, routes, catalogAvailable = true;
  const requests = [];
  global.setInterval = callback => { refresh = callback; return { unref() {} }; };
  global.clearInterval = () => {};
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/agents')) return Response.json({ agents });
    if (url.includes('/models?') && !catalogAvailable) return new Response('', { status: 403 });
    if (url.includes('/models?')) return Response.json({ models: [{ id: 'actual-model', name: 'Actual model' }] });
    if (url.endsWith('/chat')) return new Response('data: {"text":"hello"}\n\ndata: {"done":true}\n\n');
    throw new Error('Unexpected request');
  };
  t.after(() => {
    cleanup?.(); global.fetch = prior.fetch; global.setInterval = prior.interval; global.clearInterval = prior.clear;
    if (prior.url === undefined) delete process.env.SOMNUS_ACP_URL; else process.env.SOMNUS_ACP_URL = prior.url;
    if (prior.token === undefined) delete process.env.SOMNUS_ACP_TOKEN; else process.env.SOMNUS_ACP_TOKEN = prior.token;
  });
  const module = await import('./somnus-acp-adapter.mjs?test=' + Date.now());
  await module.apply({ llm: { registerAdapter(ids, value) {
    routes = ids; adapter = value;
    return { replace(ids) { routes = ids; } };
  } }, effect(callback) { cleanup = callback(); }, logger: { warn: assert.fail } });
  assert.deepEqual(routes, ['somnus-acp-configured-codex-uuid']);
  assert.equal(adapter.providerInfo('somnus-acp-configured-codex-uuid').name, 'Codex');
  const policy = adapter.providerRetryPolicy();
  assert.equal(policy.maxRetries, 0);
  // Same ordering as pinned dsh-llm-retry: this guard precedes maxRetries.
  assert.equal(policy.retryableCodes.includes('TRANSPORT'), true);
  assert.equal(policy.initialDelayMs, 500);
  assert.equal(adapter.imageRequestPricing(routes[0], 'actual-model'), undefined);
  assert.deepEqual(adapter.imageRequestTarget(routes[0], 'actual-model', { width: 20, height: 30, bytes: 40 }),
    { width: 20, height: 30, maxBytes: 40 });
  assert.deepEqual((await adapter.listModels('somnus-acp-configured-codex-uuid')).map(x => x.id), ['actual-model']);
  assert.ok(requests.some(x => x.url.includes('agentId=configured-codex-uuid')));
  for await (const event of adapter.stream({ provider: 'somnus-acp-configured-codex-uuid', model: 'actual-model',
    sessionId: 'canonical-session', messages: [{ role: 'system', content: 'native-only policy' }, { role: 'user', content: 'hi' }] })) {}
  const transferred = JSON.parse(requests.find(x => x.url.endsWith('/chat')).options.body);
  assert.equal(transferred.agentId, 'configured-codex-uuid');
  assert.equal(transferred.conversationId, 'dsh-canonical-session');
  assert.equal(typeof transferred.requestId, 'string');
  assert.deepEqual(transferred.transcript.messages.map(item => item.role), ['user']);
  assert.equal(transferred.text, undefined);
  for (const purpose of ['session-title', 'compaction', 'auto-review']) {
    for await (const _ of adapter.stream({ provider: routes[0], model: 'actual-model',
      sessionId: 'canonical-session', purpose, tools: [{ name: 'must-not-be-bridged' }],
      messages: [{ role: 'user', content: 'auxiliary input' }] })) {}
  }
  const auxiliaryCalls = requests.filter(x => x.url.endsWith('/chat')).slice(-3).map(x => JSON.parse(x.options.body));
  assert.equal(new Set(auxiliaryCalls.map(x => x.conversationId)).size, 3);
  for (const call of auxiliaryCalls) {
    assert.match(call.conversationId, /^dsh-aux-/);
    assert.notEqual(call.conversationId, transferred.conversationId);
    assert.equal(call.pluginTools, undefined);
  }
  const fetchSuccess = global.fetch;
  global.fetch = async (url, options) => url.endsWith('/chat')
    ? new Response('data: {"error":"synthetic upstream failure"}\n\n') : fetchSuccess(url, options);
  await assert.rejects(async () => {
    for await (const _ of adapter.stream({ provider: routes[0], model: 'actual-model', messages: [] })) {}
  }, /synthetic upstream failure/);
  global.fetch = fetchSuccess;
  const modelRequests = requests.filter(x => x.url.includes('/models?')).length;
  await refresh();
  assert.equal(requests.filter(x => x.url.includes('/models?')).length, modelRequests);
  agents = [{ id: 'custom-uuid', name: 'My configured agent', revision: 'new' }];
  await refresh();
  assert.deepEqual(routes, ['somnus-acp-custom-uuid']);
  assert.equal(adapter.providerInfo(routes[0]).name, 'My configured agent');
  catalogAvailable = false;
  assert.deepEqual(await adapter.listModels(routes[0]), []);
  await assert.rejects(adapter.resolveModel(routes[0], 'default'), /catalog failed/);
  assert.deepEqual(await adapter.listModels('somnus-acp-configured-codex-uuid'), []);
  agents = [{ id: 'custom-uuid', name: 'Codex', revision: 'changed' }, { id: 'other-uuid', name: 'Codex', revision: 'new' }];
  await refresh();
  assert.deepEqual(routes, ['somnus-acp-custom-uuid', 'somnus-acp-other-uuid']);
  agents = []; await refresh(); assert.deepEqual(routes, []);
});
