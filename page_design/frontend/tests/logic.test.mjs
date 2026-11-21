import test from 'node:test';
import assert from 'node:assert/strict';
import { comparison, createLatestGate, criticalAlerts, filterUsers, formatNumber, knownMean, reportText, validateDashboard, scenarioDistribution, candidateAreas } from '../src/shared/logic.mjs';

test('unknown values stay unknown and observed zero is retained', () => {
  assert.equal(formatNumber(null), '—'); assert.equal(formatNumber(undefined), '—'); assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber('0'), '—'); assert.equal(knownMean([null, undefined]), null); assert.equal(knownMean([0, 6, null]), 3);
});
test('comparison handles zero denominators and never invents change', () => {
  assert.equal(comparison(null, 7).direction, 'unknown'); assert.equal(comparison(7, 0).text, '前日为 0');
  assert.equal(comparison(0, 0).text, '与前日持平'); assert.equal(comparison(12, 10).text, '+20% 较前日'); assert.equal(comparison(5, 10).direction, 'down');
});
test('priority and state filters compose without altering the source', () => {
  const rows = [{ id: 'a', priority: 'high', state: 'therapy' }, { id: 'b', priority: 'high', state: 'offline' }, { id: 'c', priority: 'low', state: 'therapy' }];
  assert.deepEqual(filterUsers(rows, 'high', 'therapy').map(row => row.id), ['a']); assert.equal(filterUsers(rows, 'all', 'all').length, 3); assert.equal(rows.length, 3);
});
test('alert snapshots are critical engineering alerts only, at most three', () => {
  const alerts = [{ severity: 'warning' }, ...Array.from({ length: 5 }, (_, id) => ({ id, severity: 'critical' }))];
  assert.equal(criticalAlerts(alerts).length, 3); assert(criticalAlerts(alerts).every(item => item.severity === 'critical'));
});
test('no-critical local scenario excludes severe alerts and counts mutually exclusive types', () => {
  const values = scenarioDistribution([{ severity: 'critical', type: 'upload_gap' }, { severity: 'warning', type: 'leak_hint' }, { severity: 'info', type: 'review_pending' }, { severity: 'warning', type: 'leak_hint' }]);
  assert.deepEqual(values, [{ name: '漏气字段', value: 2 }, { name: '复核待办', value: 1 }]);
});
test('candidate annotations use time intervals and never invent a pressure zero coordinate', () => {
  const bands = candidateAreas([{ start: 123, end: 145, type: '测试候选' }, { start: 500, end: 499, type: '无效' }]);
  assert.deepEqual(bands, [[{ name: '测试候选', xAxis: 123 }, { xAxis: 145 }]]);
  assert.equal('yAxis' in bands[0][0], false);
});
test('late response tokens cannot commit after selection change or teardown', async () => {
  const gate = createLatestGate(), first = gate.next(), second = gate.next();
  let committed = '';
  await Promise.resolve(); if (gate.current(second)) committed = 'latest';
  await Promise.resolve(); if (gate.current(first)) committed = 'stale';
  assert.equal(committed, 'latest'); gate.invalidate(); assert.equal(gate.current(second), false);
});
const metric = { value: null, previous: null, trend: [], label: '未知指标', unit: '小时' };
const blank = () => ({ schema_version: 1, data_quality: { expected_records: null, received_records: null, lost_records: null, loss_rate: null, unit: 'records', basis: '未接入记录计数' }, source: { mode: 'unconfigured', connected: false, label: '未连接' }, kpis: Object.fromEntries(['active_users', 'treatment_hours', 'reported_events', 'online_rate'].map(k => [k, { ...metric }])), daily: [], users: [], alerts: [], insights: [], constraints: [], alert_distribution: [], fleet: {}, generated_at: 'example', period: { kpi_date: '2026-01-01', start_date: '2025-12-26', end_date: '2026-01-01', time_zone: 'Asia/Shanghai', date_basis: '合成日期' } });
test('API validation enforces the declared source mode', () => {
  assert.equal(validateDashboard(blank(), 'live').source.mode, 'unconfigured');
  assert.throws(() => validateDashboard(blank(), 'demo'), /来源/);
  const invalidUnconfigured = blank();
  invalidUnconfigured.kpis.reported_events.value = 0;
  assert.throws(() => validateDashboard(invalidUnconfigured, 'live'), /未连接来源/);
  const live = blank(); live.source = { mode: 'live', connected: true, label: '真实数据' };
  live.kpis.active_users.value = 81;
  live.kpis.avg_ahi = { ...metric };
  assert.equal(validateDashboard(live, 'live').source.mode, 'live');
  const disconnected = blank(); disconnected.source = { mode: 'live', connected: false, label: '未连接' };
  assert.throws(() => validateDashboard(disconnected, 'live'), /连接状态/);
  const partial = blank(); partial.source = { mode: 'demo', connected: false, label: '演示' };
  delete partial.kpis.online_rate;
  assert.throws(() => validateDashboard(partial, 'demo'), /指标/);
});
test('download report includes a traceable complete snapshot and local-only limits', () => {
  const report = reportText(blank(), 'all'); assert.match(report, /完整快照/); assert.match(report, /未外发/); assert.match(report, /未知指标: —/); assert.match(report, /合成日期/); assert.match(report, /unconfigured/);
  assert(report.includes(String.fromCharCode(10)), 'Report must contain real line breaks');
  assert(report.split(String.fromCharCode(10)).length > 10, 'Report is a usable multiline document');
  assert.equal(report.includes(String.fromCharCode(92) + 'n'), false, 'No literal escaped line separators');
});
