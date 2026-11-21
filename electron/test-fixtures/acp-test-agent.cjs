const assert = require('node:assert/strict');
const readline = require('node:readline');

let activePrompt;
let promptText;
let turns = 0;
let authenticated = process.argv.includes('--already-authenticated');
const args = process.argv.slice(2);
const isCodex = args.includes('--codex');
const isLegacyCodex = args.includes('--legacy-codex');
const chatGptMethod = isLegacyCodex ? 'chatgpt' : 'chat-gpt';
const isOpenMa = args.includes('--openma');
const isDsh = args.includes('--dsh');
const usesBrowser = args.includes('--openma-browser');
const legacyModels = args.includes('--legacy-models');
const dshAccount = args.includes('--dsh-account');
const modernModels = args.includes('--modern-models') || dshAccount;
const supportsReasoning = args.includes('--reasoning');
let model = 'mock-default';
let effort = 'low';
let browserAuthRequest;
const models = [
  { modelId: 'mock-default', name: 'Mock Default' },
  { modelId: 'mock-selectable', name: 'Mock Selectable' },
  ...(dshAccount ? [{ modelId: JSON.stringify(['deepseek-account', 'deepseek-flash']), name: 'Account Flash' }, { modelId: JSON.stringify(['deepseek-account', 'deepseek-pro']), name: 'Account Pro' }] : []),
];
const configOptions = () => [{
  type: 'select',
  category: 'model',
  id: 'backend-model',
  currentValue: model,
  options: [{ group: 'mock', name: 'Mock', options: models.map(({ modelId: value, name }) => ({ value, name })) }],
}, ...(supportsReasoning ? [{
  type: 'select',
  category: 'thought_level',
  id: 'backend-thought',
  currentValue: effort,
  options: model === 'mock-default' ? [{ value: 'low', name: 'Low' }] : [
    { value: '', name: 'Provider default' }, { value: 'high', name: 'High' },
  ],
}] : [])];
const codexMethods = [
  { id: chatGptMethod, name: 'ChatGPT' },
  { id: 'api-key', name: 'API Key', _meta: { 'api-key': { provider: 'openai' } } },
  { id: 'gateway', name: 'Gateway' },
  { id: 'terminal-test', name: 'Terminal', type: 'terminal' },
];
const openMaMethods = [
  { id: 'api-key:deepseek-official', name: 'DeepSeek API Key', _meta: { 'api-key': { provider: 'deepseek-official' } } },
  { id: 'api-key:deepseek-account', name: 'DeepSeek Account', _meta: { 'api-key': { provider: 'deepseek-account' } } },
];
if (usesBrowser) openMaMethods.push({ id: 'browser', name: 'Browser login' });
const send = fields => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...fields }) + '\n');
const usageResponses = new Map([
  ['usage-zero', { usage: { inputTokens: 0, outputTokens: 0 } }],
  ['usage-unsafe', { usage: { inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 7 } }],
  ['usage-incomplete', { usage: { totalTokens: 10, outputTokens: 7 } }],
  ['usage-string', { usage: { inputTokens: '3', outputTokens: 7 } }],
  ['usage-max-tokens', { stopReason: 'max_tokens', usage: { inputTokens: 12, outputTokens: 6 } }],
  ['usage-with-cache', { usage: { inputTokens: 40, outputTokens: 9, cachedReadTokens: 50, cachedWriteTokens: 10 } }],
  ['usage-zero-cache', { usage: { inputTokens: 10, outputTokens: 1, cachedReadTokens: 0 } }],
]);
const finish = () => {
  send({ id: activePrompt, result: { stopReason: 'end_turn', ...usageResponses.get(promptText) } });
  activePrompt = undefined;
};
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const { id, method, params, result, error } = JSON.parse(line);
  switch (method) {
    case 'initialize':
      assert.equal(params.protocolVersion, 1);
      assert.deepEqual(params.clientCapabilities, usesBrowser ? { elicitation: { url: {} } } : {});
      assert.equal(process.env.VV_MAN_TEST_SECRET, undefined);
      send({ id, result: {
        protocolVersion: 1,
        agentInfo: {
          name: isLegacyCodex ? 'codex-acp' : isCodex ? '@agentclientprotocol/codex-acp' :
            isOpenMa ? 'dsh-acp' : isDsh ? 'deepseek-harness-acp' : 'mock',
          title: 'Local ACP Mock',
          version: '1.0',
        },
        authMethods: isCodex || isLegacyCodex ? codexMethods : isOpenMa ? openMaMethods : [],
      } });
      break;
    case 'authenticate':
      if (usesBrowser) {
        assert.deepEqual(params, { methodId: 'browser' });
        browserAuthRequest = id;
        send({ method: 'elicitation/create', id: 'browser', params: {
          mode: 'url', requestId: id, elicitationId: 'test-login', url: 'http://127.0.0.1:12345/key',
        } });
        break;
      }
      if (params.methodId === chatGptMethod) {
        assert.equal(isCodex || isLegacyCodex, true);
        assert.deepEqual(params, { methodId: chatGptMethod });
        if (args.includes('--wait-login')) break;
      } else {
        assert.equal(isOpenMa, true);
        assert.equal(params.methodId, 'api-key:deepseek-official');
        if (params._meta?.['api-key']?.apiKey !== 'mock-key-value') {
          send({ id, error: { code: -32000, message: 'Sensitive mock error that must not be forwarded' } });
          break;
        }
      }
      authenticated = true;
      send({ id, result: {} });
      break;
    case 'session/new':
      assert.equal(params.cwd, process.cwd());
      assert.deepEqual(params.mcpServers, []);
      if (!authenticated && (isCodex || isLegacyCodex || isOpenMa || args.includes('--needs-login'))) {
        send({ id, error: { code: -32000, message: 'Authentication required' } });
      }
      else send({ id, result: { sessionId: 'local-test',
        ...(modernModels ? { configOptions: configOptions() } : {}),
        ...(legacyModels ? { models: { currentModelId: model, availableModels: models } } : {}),
      } });
      break;
    case 'session/set_config_option':
      assert.equal(modernModels, true);
      if (params.configId === 'backend-model') {
        assert.ok(params.value === 'mock-selectable' || (dshAccount && models.some(m => m.modelId === params.value)));
        model = params.value;
        effort = '';
      } else {
        assert.equal(supportsReasoning, true);
        assert.equal(params.configId, 'backend-thought');
        assert.equal(model, 'mock-selectable');
        assert.ok(['', 'high'].includes(params.value));
        effort = params.value;
      }
      send({ id, result: { configOptions: configOptions() } });
      break;
    case 'session/set_model':
      assert.equal(legacyModels, true);
      assert.equal(params.modelId, 'mock-selectable');
      model = params.modelId;
      send({ id, result: {} });
      break;
    case 'session/prompt': {
      assert.equal(params.sessionId, 'local-test');
      if (dshAccount) assert.equal(JSON.parse(model)[0], 'deepseek-account');
      assert.equal(params.prompt[0].type, 'text');
      activePrompt = id;
      const text = params.prompt[0].text;
      promptText = text;
      turns += 1;
      if (text === 'cancel me') break;
      if (text === 'usage-context-only') {
        send({ method: 'session/update', params: {
          sessionId: 'local-test', update: { sessionUpdate: 'usage_update', used: 83, size: 200_000 },
        } });
        send({ method: 'session/update', params: {
          sessionId: 'local-test', update: { sessionUpdate: 'usage_update', used: 900, size: 0 },
        } });
      }
      send({ method: 'session/update', params: {
        sessionId: 'local-test', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '代理回复：' } },
      } });
      send({ method: 'session/update', params: {
        sessionId: 'local-test', update: { sessionUpdate: 'agent_message_chunk', content: {
          type: 'text', text: `${text} (${turns})${modernModels || legacyModels ? ' ' + model : ''}${supportsReasoning ? ' effort=' + effort : ''}`,
        } },
      } });
      send({ id: 'permission', method: 'session/request_permission', params: { sessionId: 'local-test', options: [] } });
      break;
    }
    case 'session/cancel':
      assert.equal(params.sessionId, 'local-test');
      send({ id: activePrompt, result: { stopReason: 'cancelled' } });
      activePrompt = undefined;
      break;
    default:
      if (id === 'permission') {
        assert.deepEqual(result, { outcome: { outcome: 'cancelled' } });
        send({ id: 'filesystem', method: 'fs/read_text_file', params: { sessionId: 'local-test', path: 'C:/secret' } });
      } else if (id === 'filesystem') {
        assert.equal(error.code, -32601);
        finish();
      } else if (id === 'browser') {
        assert.deepEqual(result, { action: 'accept' });
        authenticated = true;
        send({ id: browserAuthRequest, result: {} });
      }
  }
});
