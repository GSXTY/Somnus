import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, repairNativeDefault } from './somnus-provider-policy.mjs';

test('builtin default falls back only to a configured native Provider', async () => {
  let selected = { provider: 'deepseek-official', model: 'deepseek-flash' };
  const ctx = {
    agentDefaultModel: { currentSelection: () => selected, saveSelection: async next => { selected = next; } },
    llm: { listProviders: () => [{ id: 'deepseek-account' }, { id: 'somnus-acp-codex' }, { id: 'my-provider' }],
      listModels: async id => { assert.equal(id, 'my-provider'); return [{ id: 'my-real-model' }]; } },
  };
  await repairNativeDefault(ctx);
  assert.deepEqual(selected, { provider: 'my-provider', model: 'my-real-model' });
});

test('valid user Provider and explicit ACP default are preserved', async () => {
  for (const provider of ['my-provider', 'somnus-acp-codex']) {
    await repairNativeDefault({ agentDefaultModel: { currentSelection: () => ({ provider, model: 'selected' }),
      saveSelection: assert.fail }, llm: { listProviders: assert.fail } });
  }
});

test('empty configured catalog has no fabricated model and policy does not block boot', async () => {
  let current = { provider: 'deepseek-official', model: 'deepseek-flash' }, writes = 0, boot;
  const ready = new Promise(resolve => { boot = resolve; });
  const ctx = { agentDefaultModel: { currentSelection: () => current, async saveSelection(next) { writes++; current = next; } },
    llm: { listProviders: () => [] }, root: { loader: { await: () => ready } }, on() {}, effect() {}, logger: { warn: assert.fail } };
  assert.equal(apply(ctx), undefined);
  assert.equal(writes, 0);
  boot(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(current, { provider: '', model: '' });
  assert.equal(writes, 1);
});


test('a concurrent manual native selection wins while model metadata resolves', async () => {
  let current = { provider: 'deepseek-official', model: 'deepseek-flash' }, resolveModels;
  const models = new Promise(resolve => { resolveModels = resolve; });
  const ctx = { agentDefaultModel: { currentSelection: () => current, saveSelection: assert.fail },
    llm: { listProviders: () => [{ id: 'my-provider' }], listModels: () => models } };
  const pending = repairNativeDefault(ctx);
  current = { provider: 'chosen-provider', model: 'my-choice' };
  resolveModels([{ id: 'first-model' }]); await pending;
  assert.equal(current.model, 'my-choice');
});
