import assert from 'node:assert/strict';
import test from 'node:test';
import { agentReadinessLabel } from '../src/configuration/agentReadiness.ts';

test('saved or unverified Agent records never claim connected readiness', () => {
  assert.equal(agentReadinessLabel(), '已保存 · 未验证');
  assert.equal(agentReadinessLabel({ state: 'unverified' }), '已保存 · 未验证');
  assert.equal(agentReadinessLabel({ state: 'required' }), '待登录');
  assert.equal(agentReadinessLabel({ state: 'error' }), '不可用');
  assert.equal(agentReadinessLabel({ state: 'ready' }), '已连接');
});
