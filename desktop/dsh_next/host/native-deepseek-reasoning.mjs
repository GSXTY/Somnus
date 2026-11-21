import { replaceExact } from '../overlay.mjs';

// Keep capability inference and request compatibility scoped to the same official route.
function isSomnusDeepSeekResponses(api, baseUrl, modelId) {
  if (api !== 'openai-responses' || !['deepseek-flash', 'deepseek-v4-pro'].includes(modelId)) return false;
  try {
    const endpoint = new URL(baseUrl);
    return endpoint.origin === 'https://api.deepseek.com' && !endpoint.username && !endpoint.password &&
      !endpoint.search && !endpoint.hash && ['/', '/v1', '/v1/'].includes(endpoint.pathname);
  } catch {
    return false;
  }
}

function somnusDeepSeekDefault(model, configured) {
  if (configured !== undefined) return configured;
  if (model.reasoning && model.thinkingLevelMap?.high === 'high' &&
      isSomnusDeepSeekResponses(model.api, model.baseUrl, model.id)) return 'high';
}

export function buildNativeDeepSeekReasoningOverlay(read) {
  const adapter = 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
  const responses = 'dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js';
  const reason = (source, pairs, file) => Buffer.from(pairs.reduce((current, [anchor, replacement]) =>
    replaceExact(current, anchor, replacement, file), source.toString('utf8')));

  return new Map([
    [adapter, reason(read(adapter), [
      ['function resolveModelReasoning(provider, entry, base) {\n\tconst efforts = entry.reasoningEfforts;',
        `${isSomnusDeepSeekResponses}\n${somnusDeepSeekDefault}\nfunction resolveModelReasoning(provider, entry, base, api, baseUrl) {\n` +
        '\tconst efforts = entry.reasoningEfforts === void 0 && isSomnusDeepSeekResponses(api, baseUrl, entry.id)\n' +
        '\t\t? { off: "none", low: "low", high: "high", max: "max" } : entry.reasoningEfforts;'],
      ['...resolveModelReasoning(provider, entry, base),', '...resolveModelReasoning(provider, entry, base, api, baseUrl),'],
      ['describableReasoningLevel(resolvedModel, profile.reasoning)',
        'describableReasoningLevel(resolvedModel, somnusDeepSeekDefault(resolvedModel, profile.reasoning))'],
      ['resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning)',
        'resolveReasoningLevel(model, options.reasoningEffort ?? somnusDeepSeekDefault(model, profile.reasoning))'],
    ], adapter)],
    [responses, reason(read(responses), [
      ['function buildParams(model, context, options, compat, grammarToolInputProperties, configurationUpdateEffort) {',
        `${isSomnusDeepSeekResponses}\nfunction buildParams(model, context, options, compat, grammarToolInputProperties, configurationUpdateEffort) {`],
      ['            params.include = ["reasoning.encrypted_content"];\n        }\n        else if',
        '            if (!isSomnusDeepSeekResponses(model.api, model.baseUrl, model.id))\n' +
        '                params.include = ["reasoning.encrypted_content"];\n        }\n        else if'],
    ], responses)],
  ]);
}
