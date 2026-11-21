import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { buildNativeDeepSeekReasoningOverlay } from './native-deepseek-reasoning.mjs';

const archive = readFileSync(new URL('../upstream/app.asar', import.meta.url));
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
function read(file) {
  const entry = file.split('/').reduce((node, part) => node.files[part], header);
  const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
  return archive.subarray(offset, offset + entry.size);
}

function section(source, start, end) {
  const offset = source.indexOf(start);
  const finish = source.indexOf(end, offset);
  assert.ok(offset >= 0 && finish > offset, start);
  return source.slice(offset, finish);
}

const adapterPath = 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
const responsesPath = 'dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js';
const patched = buildNativeDeepSeekReasoningOverlay(read);
const adapter = patched.get(adapterPath).toString();
const responses = patched.get(responsesPath).toString();
const models = read('dsh/node_modules/@earendil-works/pi-ai/dist/models.js').toString();

const code = vm.createContext({ URL, ReasoningEffortId: value => value, LlmError: Error });
vm.runInContext(section(models, 'const EXTENDED_THINKING_LEVELS', '/**').replace(/export function/g, 'function'), code);
vm.runInContext([
  section(adapter, 'const THINKING_LEVELS', '/**'),
  ...['isSomnusDeepSeekResponses', 'somnusDeepSeekDefault', 'resolveModelReasoning', 'profileOptions',
    'resolveReasoningLevel', 'describableReasoningLevel', 'reasoningInfo'].map(name =>
    section(adapter, `function ${name}(`, '\n}') + '\n}'),
  section(responses, 'function buildParams(', '\n}') + '\n}',
  section(responses, 'export const streamSimple', '\n};').replace('export const', 'const') + '\n};',
].join('\n'), code);
Object.assign(code, {
  resolveTranscriptTools: () => ({ requestTools: [] }), convertResponsesMessages: () => [],
  OPENAI_TOOL_CALL_PROVIDERS: new Set(), resolveCacheRetention: () => 'none', isChatGPTSignIn: () => false,
  getPromptCacheRetention: () => undefined, getPromptCacheOptions: () => undefined,
  resolveSamplingParams: () => undefined, getClientApiKey() {}, buildBaseOptions: () => ({}),
});
vm.runInContext('const stream = (model, context, options) => buildParams(model, context, options, {});', code);

function model(id, baseUrl, api = 'openai-responses', declared = {}) {
  const provider = 'somnus-custom-fixture';
  return { id, baseUrl, api, provider, ...code.resolveModelReasoning(provider, { id, ...declared }, undefined, api, baseUrl) };
}

const describe = /const defaultLevel = (describableReasoningLevel\([^\n]+\));/.exec(adapter)[1];
const choose = /const reasoning = (resolveReasoningLevel\([^\n]+\));/.exec(adapter)[1];
function request(descriptor, chosen, defaultEffort) {
  Object.assign(code, { model: descriptor, options: { reasoningEffort: chosen }, profile: { reasoning: defaultEffort } });
  return vm.runInContext(`streamSimple(model, { messages: [] }, profileOptions(profile, ${choose}, undefined));`, code);
}

test('official DeepSeek Responses advertises actual efforts with High as a fallback default', () => {
  for (const id of ['deepseek-flash', 'deepseek-v4-pro']) {
    for (const url of ['https://api.deepseek.com', 'https://api.deepseek.com/v1/']) {
      const resolvedModel = model(id, url);
      Object.assign(code, { resolvedModel, profile: {} });
      const info = vm.runInContext(`reasoningInfo(resolvedModel, ${describe})`, code).reasoning;
      assert.deepEqual(Array.from(info.efforts, effort => effort.id), ['off', 'low', 'high', 'max']);
      assert.equal(info.defaultEffort, 'high');
      code.profile = { reasoning: 'max' };
      assert.equal(vm.runInContext(`reasoningInfo(resolvedModel, ${describe})`, code).reasoning.defaultEffort, 'max');
    }
  }
});

test('native DSH request flow uses the authoritative DeepSeek wire values including explicit Off', () => {
  const descriptor = model('deepseek-flash', 'https://api.deepseek.com/v1');
  for (const [selected, defaultEffort, wire] of [
    [undefined, undefined, 'high'], ['off', undefined, 'none'], ['low', undefined, 'low'],
    ['high', undefined, 'high'], ['max', undefined, 'max'], [undefined, 'max', 'max'], ['low', 'max', 'low'],
  ]) {
    const payload = request(descriptor, selected, defaultEffort);
    assert.equal(payload.reasoning.effort, wire);
    assert.equal(payload.include, undefined);
  }
  assert.throws(() => request(descriptor, 'medium'), /does not support reasoning effort/);
});

test('capability inference leaves other endpoints, models, protocols and explicit overrides intact', () => {
  for (const [id, url, api] of [
    ['deepseek-chat', 'https://api.deepseek.com'], ['deepseek-flash', 'https://api.deepseek.com.example.com'],
    ['deepseek-flash', 'http://api.deepseek.com'], ['deepseek-flash', 'https://api.deepseek.com/v2'],
    ['deepseek-flash', 'https://api.deepseek.com', 'openai-completions'], ['deepseek-v4-pro', 'malformed'],
  ]) assert.equal(model(id, url, api).reasoning, false);
  assert.equal(model('deepseek-flash', 'https://api.deepseek.com', undefined, { reasoningEfforts: false }).reasoning, false);
  const explicit = model('deepseek-flash', 'https://api.deepseek.com', undefined, { reasoningEfforts: { low: 'low' } });
  assert.deepEqual(Array.from(code.getSupportedThinkingLevels(explicit)), ['low']);
  assert.equal(code.somnusDeepSeekDefault(explicit, undefined), undefined);
  const gateway = model('deepseek-flash', 'https://gateway.example.com', undefined, { reasoningEfforts: { low: 'low' } });
  assert.deepEqual(Array.from(request(gateway, 'low').include), ['reasoning.encrypted_content']);
});
