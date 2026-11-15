const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DshRecommendation } = require('./acp-dsh-recommendations.cjs');

const admitted = {
  sessionUpdate: 'tool_call_update', status: 'completed', toolCallId: 'call-01',
  content: [{ type: 'content', content: { type: 'text', text: 'Card shown below your answer. Do not restate it. Invite the user.' } }],
};
const propose = {
  sessionUpdate: 'tool_call', title: 'propose_action', status: 'in_progress', toolCallId: 'call-01',
  rawInput: { action: 'enable_official_plugin', title: ' Badge  Skill ', brief: 'Offer the\nofficial badge.',
    details: { name: '@deepseek-ai/dsh-experimental-badge-skill-bundle', untrusted: 'ignored' } },
};

test('pairs accepted calls and persists only the safe projection', () => {
  const parser = new DshRecommendation();
  parser.observe(propose);
  parser.observe({ ...admitted, toolCallId: 'unrelated' });
  assert.equal(parser.card, null);
  parser.observe(admitted);
  assert.match(parser.card.id, /^[a-f0-9]{32}$/);
  assert.deepEqual(parser.card, {
    id: parser.card.id, kind: 'plugin', title: 'Badge Skill', description: 'Offer the official badge.',
    pluginId: '@deepseek-ai/dsh-experimental-badge-skill-bundle',
  });
});

test('refused and merely textual success cannot create a card', () => {
  const parser = new DshRecommendation();
  parser.observe(admitted);
  parser.observe({ sessionUpdate: 'agent_message_chunk', toolCallId: 'call-01', content: admitted.content });
  assert.equal(parser.card, null);
  for (const reply of [
    { ...admitted, status: 'failed' },
    { ...admitted, content: [{ type: 'content', content: { type: 'text', text: 'Card not shown.' } }] },
    { ...admitted, content: ['Card shown below your answer. Do not restate it. '] },
  ]) {
    parser.observe(propose);
    parser.observe(reply);
    assert.equal(parser.card, null);
  }
  parser.observe({ ...propose, title: 'arbitrary_tool' });
  parser.observe(admitted);
  assert.equal(parser.card, null);
});

test('page cards never carry package or executable details', () => {
  const parser = new DshRecommendation();
  parser.observe({ ...propose, rawInput: {
    ...propose.rawInput, action: 'create_personalized_page', details: { initialContent: 'untrusted', slot: 'page', name: '@deepseek-ai/dsh-test' },
  } });
  parser.observe(admitted);
  assert.equal(parser.card.kind, 'page');
  assert.deepEqual(Object.keys(parser.card), ['id', 'kind', 'title', 'description']);
});
