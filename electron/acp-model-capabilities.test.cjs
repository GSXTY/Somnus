const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');
const { companyWebOverlay } = require('./acp-dsh-web-model.cjs');

test('per-model window/output/cache/compat settings produce isolated native profiles', async () => {
  const base = { api: 'openai-responses', display_model: 'synthetic-model', retry_policy: { mode: 'normal', maxRetries: 2 } };
  const overlay = await companyWebOverlay({ api: 'openai-completions', model: 'm_0123456789', endpoint: 'http://127.0.0.1:8801/provider', token: 'd'.repeat(64),
    models: [{ ...base, model: 'm_0123456789', context_window: 200000, max_output_tokens: 32000,
      supports_developer_role: true, supports_long_cache_retention: true, cache_retention: 'long' },
      { ...base, model: 'm_1123456789', context_window: 4096, supports_developer_role: false, cache_retention: 'none' }], dispose: async () => {} });
  try {
    const providers = JSON.parse(await readFile(overlay.file, 'utf8')).find(row => row.id === 'llm-pi-ai').config.providers;
    assert.equal(Object.keys(providers).length, 2);
    const [a, b] = Object.values(providers);
    assert.equal(a.models[0].contextWindow, 200000); assert.equal(a.models[0].maxTokens, 32000);
    assert.equal(a.compat.supportsDeveloperRole, true); assert.equal(a.compat.supportsLongCacheRetention, true);
    assert.equal(a.cacheRetention, 'long'); assert.equal(a.retryPolicy.maxRetries, 2);
    assert.equal(b.models[0].contextWindow, 4096); assert.equal(b.models[0].maxTokens, 1024);
    assert.equal(b.compat.supportsDeveloperRole, false); assert.equal(b.cacheRetention, 'none');
  } finally { await overlay.dispose(); }
});

test('invalid declared limits and unsupported long cache fail before starting runtime', async () => {
  const base = { api: 'openai-completions', model: 'm_0123456789', endpoint: 'http://127.0.0.1:8801/provider', token: 'd'.repeat(64), dispose: async () => {} };
  await assert.rejects(companyWebOverlay({ ...base, models: [{ model: base.model, context_window: 4096, max_output_tokens: 4096 }] }), /输出/);
  await assert.rejects(companyWebOverlay({ ...base, models: [{ model: base.model, cache_retention: 'long' }] }), /缓存/);
});


test('small model budgets reserve input and shrink compaction headroom instead of overflowing', () => {
  const { compactionBudget } = require('./acp-dsh-question-presets.cjs');
  assert.deepEqual(compactionBudget([{ model: 'small', context_window: 4096 }]), { headroom: 768, summaryTokens: 768 });
  assert.deepEqual(compactionBudget([{ model: 'tiny', context_window: 1024 }]), { headroom: 192, summaryTokens: 192 });
  assert.deepEqual(compactionBudget([{ model: 'normal', context_window: 200000 }, { model: 'small', context_window: 4096 }]), { headroom: 768, summaryTokens: 768 });
  assert.throws(() => compactionBudget([{ model: 'small', context_window: 4096, max_output_tokens: 4095 }]), /输出/);
});
