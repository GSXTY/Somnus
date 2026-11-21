import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import readinessModule from '../../../electron/acp-agent-readiness.cjs';
import contextModule from '../../../electron/somnus-acp-context.cjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'somnus-handoff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = join(directory, 'agents.json');
  const agents = ['agent-a', 'agent-b'].map(id => ({ id, name: id, executable: 'fixture.exe', args: [] }));
  await writeFile(registry, JSON.stringify(agents));
  for (const agent of agents) readinessModule.readinessStore(registry).set(agent, 'ready', [{ id: 'real-model', name: 'Real model' }]);
  const children = [], prompts = [], notifications = [];
  let sequence = 0, hold = false, pendingPrompt;
  const spawn = (_exe, _args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
    child.stdin = { writable: true, write(line) {
      const request = JSON.parse(line);
      const reply = result => queueMicrotask(() => child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n'));
      if (request.method === 'initialize') return reply({ protocolVersion: 1, agentInfo: { name: 'fixture' },
        agentCapabilities: { promptCapabilities: { image: true }, mcpCapabilities: { http: true } } });
      if (request.method === 'session/new') { child.sessionId = 'fixture-' + ++sequence;
        child.mcpServers = request.params.mcpServers;
        return reply({ sessionId: child.sessionId, models: { currentModelId: 'real-model', availableModels: [{ modelId: 'real-model', name: 'Real model' }] } }); }
      if (request.method === 'session/prompt') {
        prompts.push({ session: child.sessionId, blocks: request.params.prompt });
        const finish = () => {
          child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
            sessionId: 'another-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'WRONG SESSION' } } } }) + '\n');
          child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
            sessionId: child.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer-' + prompts.length } } } }) + '\n');
          reply({ stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } });
        };
        if (hold) pendingPrompt = finish; else queueMicrotask(finish);
        return;
      }
      notifications.push(request);
    } };
    child.kill = () => { child.killed = true; child.emit('exit', 0); };
    child.options = options; children.push(child); return child;
  };
  const source = (await readFile(new URL('./acp-host.mjs', import.meta.url), 'utf8'))
    .replace(/^import .+;$/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL('./acp-host.mjs', import.meta.url).href));
  const handle = vm.runInNewContext(source + '\nhandle;', {
    createRequire, fileURLToPath, pathToFileURL, createHash, randomUUID, existsSync, mkdirSync, readFileSync, tmpdir, homedir, dirname, join,
    URL, console, Buffer, setTimeout, clearTimeout, spawn,
    createServer() { return { listen() {}, close() {} }; },
    process: { env: { SOMNUS_ACP_REGISTRY: registry, SOMNUS_ACP_CWD: directory, SOMNUS_ACP_TOKEN: 'private-host',
      DSH_SOMNUS_NATIVE_CATALOG_TOKEN: 'private-native', PATH: 'fixture-path' }, execPath: process.execPath, cwd: () => directory, on() {} },
  }, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  function request(body) {
    const req = new EventEmitter();
    Object.assign(req, { method: 'POST', url: '/chat', headers: { 'x-somnus-acp-token': 'private-host' },
      async *[Symbol.asyncIterator]() { yield JSON.stringify(body); } });
    const res = new EventEmitter();
    Object.assign(res, { writableEnded: false, headersSent: false, chunks: [], setHeader() {},
      writeHead(code) { this.status = code; this.headersSent = true; return this; },
      write(value) { this.chunks.push(value); }, end(value) { if (value) this.chunks.push(value); this.writableEnded = true; } });
    const done = handle(req, res);
    return { req, res, done };
  }
  async function chat(messages, { agentId = 'agent-a', requestId = randomUUID(), conversationId = 'same-conversation', pluginTools } = {}) {
    const call = request({ agentId, requestId, conversationId, modelId: 'real-model', transcript: contextModule.transcript(messages), pluginTools });
    await call.done; return call.res;
  }
  return { chat, request, prompts, children, notifications, agents, registry, setHold(value) { hold = value; },
    finish() { pendingPrompt?.(); } };
}

test('actual ACP host transfers native history, sends delta continuously and carries context across Agent switches', async t => {
  const f = await fixture(t);
  const history = [{ role: 'user', content: 'Native question' }, { role: 'assistant', content: 'Native evidence' },
    { role: 'user', content: 'First external question' }];
  const first = await f.chat(history, { requestId: 'turn-1' });
  assert.equal(first.status, 200);
  assert.ok(JSON.stringify(f.prompts[0].blocks).includes('Native evidence'));
  assert.ok(!first.chunks.join('').includes('WRONG SESSION'));
  assert.equal(f.children[0].options.env.SOMNUS_ACP_TOKEN, undefined);
  assert.equal(f.children[0].options.env.DSH_SOMNUS_NATIVE_CATALOG_TOKEN, undefined);
  const next = [...history, { role: 'assistant', content: 'answer-1' }, { role: 'user', content: 'Second external question' }];
  await f.chat(next, { requestId: 'turn-2' });
  assert.equal(f.children.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.prompts[1].blocks)), [{ type: 'text', text: 'Second external question' }]);
  await f.chat(next, { requestId: 'turn-2' });
  assert.equal(f.prompts.length, 2, 'network retry does not execute Agent tools again');
  await f.chat(next, { requestId: 'regenerate' });
  assert.equal(f.prompts.length, 3, 'explicit regeneration is a distinct request');
  const handoff = [...next, { role: 'assistant', content: 'answer-3' }, { role: 'user', content: 'Switch Agent' }];
  await f.chat(handoff, { agentId: 'agent-b', requestId: 'turn-b' });
  assert.ok(JSON.stringify(f.prompts.at(-1).blocks).includes('Native evidence'));
  assert.ok(JSON.stringify(f.prompts.at(-1).blocks).includes('answer-3'));
  const returned = [...handoff, { role: 'assistant', content: 'answer-4' }, { role: 'user', content: 'Switch back' }];
  await f.chat(returned, { agentId: 'agent-a', requestId: 'turn-a-return' });
  assert.ok(JSON.stringify(f.prompts.at(-1).blocks).includes('answer-4'));
});

test('actual ACP session receives only the scoped plugin descriptor and replaces a changed tool scope with full context', async t => {
  const f = await fixture(t);
  const pluginTools = { name: 'somnus-dsh-tools', url: 'http://127.0.0.1:7777/somnus-tools/' + 'a'.repeat(32), token: 'b'.repeat(64) };
  const first = [{ role: 'user', content: 'Use the configured plugin' }];
  const response = await f.chat(first, { pluginTools });
  assert.equal(response.status, 200);
  assert.equal(f.children[0].mcpServers[0].type, 'http');
  assert.equal(f.children[0].mcpServers[0].headers[0].value, 'Bearer ' + pluginTools.token);
  const second = [...first, { role: 'assistant', content: 'answer-1' }, { role: 'user', content: 'Continue' }];
  await f.chat(second, { pluginTools });
  assert.equal(f.children.length, 1);
  const third = [...second, { role: 'assistant', content: 'answer-2' }, { role: 'user', content: 'Changed tool scope' }];
  await f.chat(third, { pluginTools: { ...pluginTools, token: 'c'.repeat(64) } });
  assert.equal(f.children.length, 2);
  assert.ok(JSON.stringify(f.prompts.at(-1).blocks).includes('Use the configured plugin'));
  assert.ok(response.chunks.join('').includes('pluginCompatibility'));
});

test('actual ACP host rejects concurrent turns and cancels disconnected owner without revoking login readiness', async t => {
  const f = await fixture(t); f.setHold(true);
  const body = { agentId: 'agent-a', requestId: 'held', conversationId: 'busy',
    transcript: contextModule.transcript([{ role: 'user', content: 'Long request' }]) };
  const first = f.request(body);
  await new Promise(resolve => setImmediate(resolve));
  const other = f.request({ ...body, requestId: 'other' }); await other.done;
  assert.equal(other.res.status, 409);
  assert.equal(f.prompts.length, 1);
  first.res.emit('close'); await first.done;
  assert.equal(f.children[0].killed, true);
  assert.ok(f.notifications.some(value => value.method === 'session/cancel'));
  assert.equal(readinessModule.readinessStore(f.registry).get(f.agents[0]).state, 'ready');
  f.setHold(false);
  const resumed = await f.chat([{ role: 'user', content: 'New request after cancel' }], { conversationId: 'busy' });
  assert.equal(resumed.status, 200);
});

test('title/main overlap has independent ACP ownership and auxiliary resources are reclaimed', async t => {
  const f = await fixture(t); f.setHold(true);
  const mainBody = { agentId: 'agent-a', requestId: 'main', conversationId: 'dsh-owning-session',
    transcript: contextModule.transcript([{ role: 'user', content: 'Main conversation input' }]) };
  const main = f.request(mainBody);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.prompts.length, 1);
  f.setHold(false);
  const title = f.request({ ...mainBody, requestId: 'title', conversationId: 'dsh-aux-title', purpose: 'session-title',
    pluginTools: { deliberately: 'ignored-for-auxiliary' },
    transcript: contextModule.transcript([{ role: 'user', content: 'Title only input' }]) });
  await title.done;
  assert.equal(title.res.status, 200);
  assert.equal(f.children[1].killed, true, 'temporary title process is reclaimed');
  assert.deepEqual(JSON.parse(JSON.stringify(f.children[1].mcpServers)), []);
  assert.equal(f.children[0].killed, undefined, 'title must not stop the owning conversation');
  assert.ok(!JSON.stringify(f.prompts[1].blocks).includes('Main conversation input'));
  const conflict = f.request({ ...mainBody, requestId: 'genuine-main-overlap' }); await conflict.done;
  assert.equal(conflict.res.status, 409, 'genuine main concurrency protection remains');
  f.finish(); await main.done;
  assert.equal(main.res.status, 200);
  assert.ok(main.res.chunks.join('').includes('done'));
});

test('independent DSH conversations can overlap on one configured external Agent', async t => {
  const f = await fixture(t); f.setHold(true);
  const first = f.request({ agentId: 'agent-a', requestId: 'one-main', conversationId: 'dsh-session-one',
    transcript: contextModule.transcript([{ role: 'user', content: 'First private history' }]) });
  await new Promise(resolve => setImmediate(resolve));
  f.setHold(false);
  const second = await f.chat([{ role: 'user', content: 'Second private history' }], { conversationId: 'dsh-session-two' });
  assert.equal(second.status, 200);
  assert.equal(f.children.length, 2);
  assert.notEqual(f.prompts[0].session, f.prompts[1].session);
  assert.ok(!JSON.stringify(f.prompts[1].blocks).includes('First private history'));
  f.finish(); await first.done;
  assert.equal(first.res.status, 200);
});
