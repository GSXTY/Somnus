const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readinessStore } = require('./acp-agent-readiness.cjs');
const { AcpAgents } = require('./acp-agents.cjs');

test('saved profiles are unverified, launch edits invalidate readiness, rename preserves identity, removal clears', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnusnext-readiness-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = readinessStore(join(directory, 'external-acp-agents.json'));
  const profile = { id: 'agent-uuid', name: 'Codex', executable: 'C:/agent.exe', args: ['--acp'] };
  assert.equal(store.list([profile])[0].state, 'unverified');
  store.set(profile, 'ready', [{ id: 'advertised-model', name: 'Advertised model' }]);
  assert.equal(store.list([{ ...profile, name: 'Renamed' }])[0].state, 'ready');
  assert.equal(store.list([{ ...profile, args: ['--different'] }])[0].state, 'unverified');
  assert.equal(store.list([{ ...profile, executable: 'C:/other.exe' }])[0].state, 'unverified');
  const data = await readFile(store.file, 'utf8');
  assert.ok(!data.includes(profile.executable));
  assert.ok(!data.includes('--acp'));
  store.remove(profile.id); assert.equal(store.list([profile])[0].state, 'unverified');
});

test('explicit probes share authoritative ready, login-required, unverified and failed states with picker', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnusnext-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = { id: 'profile-id', name: 'Configured', executable: 'C:/agent.exe', args: [] };
  const agents = new AcpAgents(join(directory, 'external-acp-agents.json'), 'test');
  agents.profile = async () => profile;
  agents.list = async () => [profile];
  let accountCheck = 'ready', failure;
  agents.connect = async () => ({ current: { connection: { stop() {} },
    modelSelection: { models: [{ id: 'real', name: 'Real' }] } }, accountCheck, info: { name: profile.name } });
  agents.startSession = async () => { if (failure) throw failure; };
  await agents.probe(profile.id);
  assert.equal((await agents.readinessStates())[0].state, 'ready');
  assert.deepEqual((await agents.readinessStates())[0].models, [{ id: 'real', name: 'Real' }]);
  failure = Object.assign(new Error('login required'), { code: -32000 });
  assert.equal((await agents.probe(profile.id)).authentication, 'required');
  assert.equal((await agents.readinessStates())[0].state, 'required');
  assert.deepEqual((await agents.readinessStates())[0].models, []);
  failure = new Error('probe failed');
  await assert.rejects(agents.probe(profile.id), /probe failed/);
  assert.equal((await agents.readinessStates())[0].state, 'error');
  failure = undefined; accountCheck = 'unverified';
  assert.equal((await agents.probe(profile.id)).authentication, 'unverified');
  assert.equal((await agents.readinessStates())[0].state, 'unverified');
});
