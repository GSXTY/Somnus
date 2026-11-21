import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataQuality } from '../src/shared/logic.mjs';

const quality = (expected, received, rate) => ({ expected_records: expected, received_records: received, lost_records: expected - received, loss_rate: rate, unit: 'records', basis: '缺失上报量 / 应上报量 × 100%；所选型号合成记录计数' });

test('loss rate uses additive expected and received counts, not online rate or alert count', () => {
  const data = quality(540000, 531480, 8520 / 540000 * 100);
  assert.equal(validateDataQuality(data, 'demo'), data);
  assert.throws(() => validateDataQuality({ ...data, loss_rate: 22 }, 'demo'), /丢失率/);
  assert.throws(() => validateDataQuality({ ...data, lost_records: 1 }, 'demo'), /计数/);
  assert.throws(() => validateDataQuality(quality(100, 110, -10), 'demo'), /计数/);
  assert.throws(() => validateDataQuality({ ...data, expected_records: null }, 'demo'), /计数/);
});

test('unknown, observed zero loss, empty denominator and total loss remain distinct', () => {
  const unknown = { expected_records: null, received_records: null, lost_records: null, loss_rate: null, unit: 'records', basis: '真实来源未接入' };
  assert.equal(validateDataQuality(unknown, 'live').loss_rate, null);
  assert.equal(validateDataQuality(quality(100, 100, 0), 'demo').loss_rate, 0);
  assert.equal(validateDataQuality(quality(100, 0, 100), 'demo').loss_rate, 100);
  assert.equal(validateDataQuality(quality(0, 0, null), 'demo').loss_rate, null);
  assert.throws(() => validateDataQuality(quality(0, 0, 0), 'demo'), /丢失率/);
  assert.throws(() => validateDataQuality(quality(100, 100, 0), 'live'), /未连接/);
});

test('donut contains received/lost records; unavailable ratios never become a zero-loss segment', async () => {
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  const { dataLossOption } = await import('../src/analysis/chartOptions.ts');
  const known = dataLossOption(quality(100, 98, 2));
  assert.deepEqual(known.series[0].data, [{ name: '已接收', value: 98 }, { name: '数据丢失', value: 2 }]);
  for (const input of [undefined, quality(0, 0, null)]) {
    const result = dataLossOption(input);
    assert.equal(result.tooltip.show, false);
    assert.equal(result.series[0].silent, true);
    assert(!result.series[0].data.some(item => ['已接收', '数据丢失'].includes(item.name)));
  }
});
