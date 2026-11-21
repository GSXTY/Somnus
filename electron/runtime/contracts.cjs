const RUNTIMES = Object.freeze({
  'dsh-native': Object.freeze({ runtime: 'dsh-native', identity: 'Somnus', capabilities: Object.freeze({ cancel: 'supported', approval: 'supported', agentModes: 'supported', nativeFork: 'supported', sameSessionEdit: 'unsupported', trajectory: 'supported', continuation: 'new-turn', childConversation: 'fork-required', subagents: 'supported', images: 'provider-dependent', reasoning: 'provider-dependent', resume: 'unsupported', persistentConnection: 'supported', tools: 'permission-scoped' }) }),
  acp: Object.freeze({ runtime: 'acp', identity: 'external-agent', capabilities: Object.freeze({ cancel: 'supported', approval: 'supported', agentModes: 'unsupported', sameSessionEdit: 'unknown', subagents: 'unknown', images: 'negotiated', reasoning: 'negotiated', resume: 'unsupported', persistentConnection: 'supported', tools: 'negotiated' }) }),
});
const ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const STAGES = new Set(['preparing', 'connecting', 'working', 'thinking', 'responding']);
function label(value, max = 160) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[link]').trim().slice(0, max) : '';
}
function capabilities(input) {
  const value = RUNTIMES[input?.runtime];
  if (!value) throw new Error('未知的 Agent 运行时。');
  return { ...value, capabilities: { ...value.capabilities } };
}
function route(input, runtime) {
  if (!RUNTIMES[runtime] || !input || !ID.test(input.conversationId || '') ||
      !ID.test(input.turnId || '') || typeof input.agentId !== 'string' || !input.agentId || input.agentId.length > 160) {
    throw new Error('Agent 任务归属无效。');
  }
  return { runtime, conversationId: input.conversationId, taskId: input.turnId, agentId: input.agentId };
}
module.exports = { capabilities, route, label, STAGES };
