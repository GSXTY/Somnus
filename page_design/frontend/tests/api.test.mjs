import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDashboard, fetchUser } from '../src/api.ts';

const blank = () => ({ schema_version: 1, data_quality: { expected_records: null, received_records: null, lost_records: null, loss_rate: null, unit: 'records', basis: '未接入记录计数' }, source: { mode: 'unconfigured', connected: false, label: '未连接' }, period: {}, fleet: {}, users: [], daily: [], alerts: [], alert_distribution: [], insights: [], constraints: [], kpis: Object.fromEntries(['active_users', 'treatment_hours', 'reported_events', 'online_rate'].map(key => [key, { value: null, previous: null, trend: [] }])) });

test('dashboard makes a real scoped HTTP request; live nulls are not replaced with mock values', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const controller = new AbortController(); let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return { ok: true, json: async () => blank() }; };
  const result = await fetchDashboard('live', 'YA70B30/YA70Pro', controller.signal);
  assert.equal(new URL(request.url, 'http://local').searchParams.get('model'), 'YA70B30/YA70Pro');
  assert.equal(new URL(request.url, 'http://local').searchParams.get('source'), 'live');
  assert.equal(request.options.signal, controller.signal); assert.equal(request.options.cache, 'no-store');
  assert.equal(result.kpis.active_users.value, null); assert.deepEqual(result.users, []);
});
test('HTTP and abort failures propagate without requesting a demo fallback', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; }); let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 503, json: async () => ({ error: '测试失败' }) }; };
  await assert.rejects(fetchDashboard('live', 'all', new AbortController().signal), /503.*测试失败/); assert.equal(calls, 1);
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(fetchDashboard('demo', 'all', new AbortController().signal), error => error.name === 'AbortError');
});
test('user detail validates the selected identity, synthetic source, and complete timeline count', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  let fixture = { source: { mode: 'demo', connected: false }, user: { id: 'demo-001', events_24h: 1 }, waveform: { origin: 'synthetic', channels: [] }, event_count: 1, events: [{ id: 'event-a' }] };
  globalThis.fetch = async () => ({ ok: true, json: async () => fixture });
  const signal = new AbortController().signal;
  assert.equal((await fetchUser('demo-001', 'demo', signal)).user.id, 'demo-001');
  await assert.rejects(fetchUser('demo-002', 'demo', signal), /目标/);
  fixture = { ...fixture, event_count: 2 };
  await assert.rejects(fetchUser('demo-001', 'demo', signal), /数量/);
  fixture = { ...fixture, event_count: 1, waveform: { origin: 'real', channels: [] } };
  await assert.rejects(fetchUser('demo-001', 'demo', signal), /来源/);
});
