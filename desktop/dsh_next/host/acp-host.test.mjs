import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import readinessModule from '../../../electron/acp-agent-readiness.cjs';

test('ACP host advertises only configured enabled agents and refuses unknown routes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnus-acp-registry-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = join(directory, 'agents.json');
  await writeFile(registry, JSON.stringify([{ id: 'active', name: 'Configured', executable: 'agent.exe', args: [] },
    { id: 'disabled', name: 'Disabled', enabled: false, executable: 'agent.exe', args: [] }]));
  const source = (await readFile(new URL('./acp-host.mjs', import.meta.url), 'utf8')).replace(/^import .+;$/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL('./acp-host.mjs', import.meta.url).href));
  const handle = vm.runInNewContext(source + '\nhandle;', {
    createRequire, fileURLToPath, createHash, randomUUID, existsSync, mkdirSync, readFileSync, tmpdir, homedir, dirname, join, URL, console, Buffer,
    spawn() { assert.fail('Unknown agent must never launch another process'); },
    createServer() { return { listen() {}, close() {} }; },
    process: { env: { SOMNUS_ACP_REGISTRY: registry, SOMNUS_ACP_CWD: directory, SOMNUS_ACP_TOKEN: 'test-token' },
      cwd: () => directory, on() {} },
  });
  async function request(url, body) {
    let status, value;
    const req = { method: body ? 'POST' : 'GET', url, headers: { 'x-somnus-acp-token': 'test-token' },
      async *[Symbol.asyncIterator]() { if (body) yield JSON.stringify(body); } };
    const res = { setHeader() {}, writeHead(code) { status = code; return this; },
      end(text) { if (text) value = JSON.parse(text); } };
    await handle(req, res); return { status, value };
  }
  let reply = await request('/agents');
  assert.deepEqual(reply.value.agents, []);
  const profiles = JSON.parse(await readFile(registry, 'utf8'));
  readinessModule.readinessStore(registry).set(profiles[0], 'ready', [{ id: 'real', name: 'Real' }]);
  reply = await request('/agents');
  assert.deepEqual(reply.value.agents.map(({ id, name }) => ({ id, name })), [{ id: 'active', name: 'Configured' }]);
  assert.equal(reply.value.agents[0].executable, undefined);
  assert.equal((await request('/models?agentId=missing')).status, 404);
  assert.equal((await request('/chat', { agentId: 'missing', text: 'hello' })).status, 404);
  await writeFile(registry, '[]'); reply = await request('/agents');
  assert.deepEqual(reply.value.agents, []);
});

test('model changes refresh authoritative per-model reasoning options before the main turn', async () => {
  const original = await readFile(new URL('./acp-host.mjs', import.meta.url), 'utf8');
  const start = original.indexOf('function validId(');
  const end = original.indexOf('\nconst sessions =');
  assert.ok(end > start);
  const AcpProcess = vm.runInNewContext(original.slice(start, end) + '\nAcpProcess;', { console, Map, Set });
  const process = new AcpProcess({ id: 'test' });
  process.sessionId = 'session';
  process.modelSelection = { configId: 'model', modelId: 'old', models: [{ id: 'old' }, { id: 'new' }] };
  process.reasoningSelection = { configId: 'old-effort', current: 'high', options: [{ id: 'high' }] };
  const options = [
    { type: 'select', id: 'model', category: 'model', currentValue: 'new', options: [{ value: 'new', name: 'New' }] },
    { type: 'select', id: 'new-effort', category: 'thought_level', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }] },
  ];
  const requests = [];
  process.request = async (method, params) => { requests.push({ method, params }); return { configOptions: options }; };
  await process.setModel('new');
  await process.setReasoning('low');
  assert.equal(requests[1].params.configId, 'new-effort');
  assert.equal(requests[1].params.value, 'low');
});
