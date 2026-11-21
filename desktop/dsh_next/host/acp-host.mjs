/**
 * Somnus ACP Host: a small local service that owns ACP agent processes and
 * exposes a line-oriented HTTP/SSE API to the DSH shell.
 *
 * The first supported agent is the bundled Codex ACP adapter. It deliberately
 * keeps project/tool work out of this layer: this is the chat transport that
 * the DSH session adapter will call.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';

const resources = process.env.SOMNUS_RESOURCES || process.cwd();
const registryPath = process.env.SOMNUS_ACP_REGISTRY || '';
const require = createRequire(import.meta.url);
const readinessModule = join(resources, 'somnus', 'acp-agent-readiness.cjs');
const { readinessStore } = require(existsSync(readinessModule) ? readinessModule :
  fileURLToPath(new URL('../../../electron/acp-agent-readiness.cjs', import.meta.url)));
const readiness = registryPath ? readinessStore(registryPath) : null;
const contextModule = join(resources, 'somnus', 'somnus-acp-context.cjs');
const { transcript, validateTranscript, promptFor, ContextLedger, agentEnvironment } = require(existsSync(contextModule) ? contextModule :
  fileURLToPath(new URL('../../../electron/somnus-acp-context.cjs', import.meta.url)));
let pluginHelpers;
async function pluginServers(descriptor, capabilities) {
  if (!descriptor) return { mcpServers: [], compatibility: 'not-requested' };
  const module = join(resources, 'somnus', 'somnus-plugin-interop.mjs');
  pluginHelpers ||= import(existsSync(module) ? pathToFileURL(module).href :
    new URL('../../../electron/somnus-plugin-interop.mjs', import.meta.url).href);
  const bundledRelay = join(resources, 'somnus', 'somnus-plugin-relay.cjs');
  return (await pluginHelpers).pluginMcpServers(descriptor, capabilities, {
    command: process.execPath, script: existsSync(bundledRelay) ? bundledRelay :
      fileURLToPath(new URL('../../../electron/somnus-plugin-relay.cjs', import.meta.url)),
  });
}
const approvalFile = process.env.SOMNUS_ACP_APPROVAL_FILE || join(registryPath ? dirname(registryPath) : tmpdir(), 'somnusnext-acp-approval.json');

function approvalMode() {
  try {
    const value = JSON.parse(readFileSync(approvalFile, 'utf8'));
    const mode = value?.mode;
    return mode === 'readonly' ? 'readonly' : mode === 'ask' ? 'ask' : 'auto';
  } catch {
    return 'auto';
  }
}
const workspace = process.env.SOMNUS_ACP_CWD ||
  join(registryPath ? dirname(registryPath) : tmpdir(), 'somnusnext-workspace');
mkdirSync(workspace, { recursive: true });
const codexHome = process.env.SOMNUS_CODEX_HOME || join(tmpdir(), 'somnus-codex-home');
const token = process.env.SOMNUS_ACP_TOKEN || '';
const port = Number(process.env.SOMNUS_ACP_PORT || 0);
const host = '127.0.0.1';

function savedAgents() {
  if (!registryPath || !existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string') : [];
  } catch {
    return [];
  }
}

function agentList() {
  // Settings owns this registry. Bundled binaries do not imply user configuration.
  return savedAgents().filter(item => item.enabled !== false && item.disabled !== true &&
    typeof item.executable === 'string' && Array.isArray(item.args) && readiness?.get(item)?.state === 'ready')
    .map(item => ({ id: item.id, name: item.name || 'ACP Agent', executable: item.executable, args: item.args,
      revision: createHash('sha256').update(JSON.stringify([item.executable, item.args])).digest('hex') }));
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
}

function configSelect(options, category, fallbackId) {
  if (!Array.isArray(options)) return null;
  const selects = options.slice(0, 80).filter(option =>
    option?.type === 'select' && validId(option.id) && Array.isArray(option.options));
  return selects.find(option => option.category === category) ||
    selects.find(option => option.id === fallbackId && !option.category);
}

function selectValues(choice) {
  return (choice?.options || []).slice(0, 200).flatMap(item =>
    Array.isArray(item?.options) ? item.options.slice(0, 200) : [item]);
}

function listedOptions(options, identifier) {
  const models = new Map();
  for (const option of Array.isArray(options) ? options.slice(0, 200) : []) {
    const id = option?.[identifier];
    if (!validId(id) || models.has(id)) continue;
    models.set(id, { id, name: typeof option.name === 'string' && option.name ? option.name.slice(0, 160) : id });
  }
  return [...models.values()];
}

function sessionModels(reply) {
  const choice = configSelect(reply?.configOptions, 'model', 'model');
  if (choice) {
    return { configId: choice.id, modelId: validId(choice.currentValue) ? choice.currentValue : null,
      models: listedOptions(selectValues(choice), 'value') };
  }
  return { configId: null,
    modelId: validId(reply?.models?.currentModelId) ? reply.models.currentModelId : null,
    models: listedOptions(reply?.models?.availableModels, 'modelId') };
}

function sessionReasoning(reply) {
  const choice = configSelect(reply?.configOptions, 'thought_level', 'reasoning_effort');
  if (!choice) return { configId: null, current: null, options: [] };
  const options = listedOptions(selectValues(choice), 'value');
  return {
    configId: choice.id,
    current: options.some(option => option.id === choice.currentValue) ? choice.currentValue : null,
    options,
  };
}

class AcpProcess {
  constructor(agent) {
    this.agent = agent;
    this.child = undefined;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = undefined;
    this.closed = false;
  }

  start() {
    if (this.child) return;
    mkdirSync(codexHome, { recursive: true });
    this.child = spawn(this.agent.executable, this.agent.args, {
      cwd: tmpdir(),
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: agentEnvironment(process.env, codexHome),
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.read(chunk));
    this.child.once('exit', () => this.fail(new Error('ACP agent exited')));
    this.child.once('error', error => this.fail(error));
  }

  read(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(Object.assign(new Error(message.error.message || 'ACP error'), { code: message.error.code }));
          else pending.resolve(message.result);
        }
        continue;
      }
      if (message.method === 'session/request_permission' && message.id !== undefined) {
        void decidePermission(this, message).catch(() => {});
        continue;
      }
      if (message.method === 'session/update') {
        if (process.env.SOMNUS_ACP_DEBUG) console.error('UPDATE ' + JSON.stringify(message.params).slice(0, 2000));
        this.onUpdate?.(message.params);
      }
    }
  }

  request(method, params, timeout = 60_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP ${method} timeout`));
      }, timeout);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  send(message) {
    if (!this.child?.stdin.writable) throw new Error('ACP agent is not running');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  respond(id, result) {
    this.send({ jsonrpc: '2.0', id, result });
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  async initialize() {
    this.start();
    const reply = await this.request('initialize', {
      protocolVersion: 1,
      // Filesystem access is not implemented by this chat transport. Tools are
      // supplied separately through an explicitly admitted MCP bridge.
      clientCapabilities: {},
      clientInfo: { name: 'somnus', title: 'Somnus', version: '0.2.2' },
    });
    if (reply?.protocolVersion !== 1) throw new Error('ACP v1 negotiation failed');
    this.agentName = reply.agentInfo?.name;
    this.agentCapabilities = reply.agentCapabilities || {};
  }

  async newSession(cwd, mcpServers = []) {
    const reply = await this.request('session/new', { cwd, mcpServers });
    if (!reply?.sessionId) throw new Error('ACP session was not created');
    this.sessionId = reply.sessionId;
    this.configOptions = Array.isArray(reply.configOptions) ? reply.configOptions : [];
    this.modelSelection = sessionModels(reply);
    this.reasoningSelection = sessionReasoning(reply);
  }

  async setReasoning(effort) {
    if (!effort || !this.reasoningSelection?.configId) return;
    if (effort === this.reasoningSelection.current) return;
    if (!this.reasoningSelection.options.some(option => option.id === effort)) {
      throw new Error('这个推理强度不在 Agent 的选项中。');
    }
    const reply = await this.request('session/set_config_option', {
      sessionId: this.sessionId, configId: this.reasoningSelection.configId, value: effort,
    });
    const next = sessionReasoning(reply);
    this.reasoningSelection = next;
    this.configOptions = Array.isArray(reply.configOptions) ? reply.configOptions : this.configOptions;
    if (Array.isArray(reply.configOptions)) this.modelSelection = sessionModels(reply);
  }

  async setModel(modelId) {
    if (!modelId || modelId === this.modelSelection?.modelId) return;
    if (!this.modelSelection?.models.some(model => model.id === modelId)) {
      throw new Error('这个模型不在 Codex 的模型列表中。');
    }
    if (this.modelSelection.configId) {
      const reply = await this.request('session/set_config_option', {
        sessionId: this.sessionId, configId: this.modelSelection.configId, value: modelId,
      });
      const next = sessionModels(reply);
      if (next.modelId !== modelId) throw new Error('Codex 未确认切换模型。');
      this.modelSelection = next;
      this.configOptions = Array.isArray(reply.configOptions) ? reply.configOptions : this.configOptions;
      this.reasoningSelection = sessionReasoning(reply);
      return;
    }
    await this.request('session/set_model', { sessionId: this.sessionId, modelId });
    this.modelSelection.modelId = modelId;
  }

  async prompt(content, onUpdate) {
    this.toolEvents = [];
    this.onUpdate = params => {
      if (params?.sessionId && params.sessionId !== this.sessionId) return;
      const update = params?.update || {};
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        const id = update.toolCallId || update.tool_call_id;
        if (id) {
          const current = this.toolEvents.find(item => item.id === id) || { id };
          Object.assign(current, {
            title: update.title || current.title,
            kind: update.kind || current.kind,
            status: update.status || current.status,
            ...(update.rawInput?.command ? { command: update.rawInput.command } : {}),
          });
          this.toolEvents ??= [];
          if (!this.toolEvents.includes(current)) this.toolEvents.push(current);
        }
      }
      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        onUpdate({ text: update.content.text });
      }
    };
    const result = await this.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: Array.isArray(content) ? content : [{ type: 'text', text: content }],
    }, 300_000);
    return { ...result, tools: this.toolEvents };
  }

  stop() {
    this.fail(new Error('ACP session closed'));
    for (const [id, pending] of pendingApprovals) {
      if (pending.owner === this) { pendingApprovals.delete(id); pending.resolve(false); }
    }
    this.child?.kill();
    this.child = undefined;
  }

  cancel() {
    try { this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sessionId } }); } catch {}
    this.stop();
  }
}

const sessions = new Map();
const pendingApprovals = new Map();

async function decidePermission(process, message) {
  const mode = approvalMode();
  const tool = message.params?.toolCall || {};
  const title = typeof tool.title === 'string' ? tool.title : 'Codex 请求权限';
  const command = typeof tool.rawInput?.command === 'string' ? tool.rawInput.command : '';
  const allowOnce = message.params?.options?.find(option => option.kind === 'allow_once' && typeof option.optionId === 'string');
  if (mode === 'auto') {
    process.toolEvents?.push({ id: `approval-${message.id}`, title, kind: 'approval', status: allowOnce ? 'auto-approved' : 'denied' });
    process.respond(message.id, { outcome: allowOnce
      ? { outcome: 'selected', optionId: allowOnce.optionId } : { outcome: 'cancelled' } });
    return;
  }
  if (mode === 'readonly') {
    process.toolEvents?.push({ id: `approval-${message.id}`, title, kind: 'approval', status: 'denied' });
    process.respond(message.id, { outcome: { outcome: 'cancelled' } });
    return;
  }
  const id = randomUUID();
  const allowed = await new Promise(resolve => {
    pendingApprovals.set(id, { id, title, command, owner: process, resolve, createdAt: Date.now() });
  });
  pendingApprovals.delete(id);
  process.toolEvents?.push({ id: `approval-${message.id}`, title, kind: 'approval',
    status: allowed ? 'approved' : 'denied' });
  process.respond(message.id, { outcome: allowed && allowOnce
    ? { outcome: 'selected', optionId: allowOnce.optionId }
    : { outcome: 'cancelled' } });
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  if (!token) return true;
  if (request.headers['x-somnus-acp-token'] === token) return true;
  const authorization = request.headers.authorization || '';
  return authorization === `Bearer ${token}`;
}

const server = createServer((request, response) => {
  void handle(request, response).catch(error => {
    try {
      if (!response.headersSent) json(response, 502, { error: error.message });
      else response.end();
    } catch { /* connection already closed */ }
  });
});

async function handle(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type,x-somnus-acp-token');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') return response.writeHead(204).end();
  if (!authorized(request)) return json(response, 403, { error: 'forbidden' });
  const url = new URL(request.url || '/', `http://${host}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(response, 200, { ok: true, agents: agentList().map(({ id, name, revision }) => ({ id, name, revision })) });
  }
  if (request.method === 'GET' && url.pathname === '/agents') {
    return json(response, 200, { agents: agentList().map(({ id, name, revision }) => ({ id, name, revision })) });
  }
  if (request.method === 'GET' && url.pathname === '/approvals') {
    return json(response, 200, { approvals: [...pendingApprovals.values()].map(({ id, title, command }) => ({ id, title, command })) });
  }
  if (request.method === 'POST' && url.pathname.startsWith('/approvals/')) {
    const id = url.pathname.slice('/approvals/'.length);
    const pending = pendingApprovals.get(id);
    if (!pending) return json(response, 404, { error: 'approval not found' });
    let raw = '';
    for await (const chunk of request) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* default deny */ }
    pendingApprovals.delete(id);
    pending.resolve(body.allow === true);
    return json(response, 200, { ok: true });
  }
  if (request.method === 'GET' && url.pathname === '/models') {
    const agentId = url.searchParams.get('agentId');
    const agent = agentList().find(item => item.id === agentId);
    if (!agent) return json(response, 404, { error: 'no agent' });
    let session = sessions.get('models:' + agent.id);
    if (!session || session.agent.revision !== agent.revision) {
      session?.process.stop();
      session = { agent, process: new AcpProcess(agent) };
      sessions.set('models:' + agent.id, session);
      session.ready = (async () => {
        try {
          await session.process.initialize();
          await session.process.newSession(workspace);
        } catch (error) {
          session.process.stop();
          readiness?.set(agent, 'error');
          sessions.delete('models:' + agent.id);
          throw error;
        }
      })();
    }
    await session.ready;
    return json(response, 200, {
      current: session.process.modelSelection?.modelId || null,
      models: session.process.modelSelection?.models || [],
      reasoning: {
        current: session.process.reasoningSelection?.current || null,
        options: session.process.reasoningSelection?.options || [],
      },
      configOptions: session.process.configOptions || [],
    });
  }
  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    let body;
    try { body = JSON.parse(raw); } catch { return json(response, 400, { error: { message: 'invalid json' } }); }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const prompt = messages.map(message => {
      const content = typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.map(part => part?.text || '').join('') : '';
      return `${message.role || 'user'}: ${content}`;
    }).join('\n\n');
    if (!prompt.trim()) return json(response, 400, { error: { message: 'messages required' } });
    const agent = agentList().find(item => item.id === 'codex' || item.name === 'Codex');
    if (!agent) return json(response, 404, { error: { message: 'no agent' } });
    const session = { agent, process: new AcpProcess(agent) };
    const id = `chatcmpl-${randomUUID()}`;
    try {
      await session.process.initialize();
      await session.process.newSession(workspace);
      let text = '';
      const result = await session.process.prompt(`请用简体中文回答。\n\n${prompt}`, update => { text += update.text || ''; });
      const usage = result?.usage || {};
      const payload = {
        id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model || 'codex',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: usage.inputTokens || 0, completion_tokens: usage.outputTokens || 0,
          total_tokens: usage.totalTokens || 0 },
      };
      session.process.stop();
      return json(response, 200, payload);
    } catch (error) {
      session.process.stop();
      return json(response, 502, { error: { message: error.message } });
    }
  }
  if (request.method === 'POST' && url.pathname === '/chat') {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 3 * 1024 * 1024) return json(response, 413, { error: 'conversation too large' });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return json(response, 400, { error: 'invalid json' }); }
    const agentId = body.agentId;
    const conversationId = body.conversationId || randomUUID();
    if (!validId(conversationId)) return json(response, 400, { error: 'invalid conversation' });
    let context;
    try {
      context = body.transcript ? validateTranscript(body.transcript) : validateTranscript(transcript([
        { role: 'user', content: typeof body.text === 'string' ? body.text.trim() : '' },
      ]));
    } catch (error) { return json(response, 400, { error: error.message }); }
    const agent = agentList().find(item => item.id === agentId);
    if (!agent) return json(response, 404, { error: 'no agent' });
    const key = 'chat:' + conversationId;
    const auxiliary = typeof body.purpose === 'string' && body.purpose.length > 0;
    const pluginKey = body.pluginTools ? createHash('sha256').update(JSON.stringify(body.pluginTools)).digest('hex') : '';
    let session = sessions.get(key);
    if (session?.busy) return json(response, 409, { error: 'This conversation already has an active Agent turn' });
    if (!session || session.agent.id !== agent.id || session.agent.revision !== agent.revision || session.pluginKey !== pluginKey) {
      session?.process.stop();
      session = { agent, process: new AcpProcess(agent), ledger: new ContextLedger(), pluginKey };
      sessions.set(key, session);
    }
    const requestId = validId(body.requestId) ? body.requestId : randomUUID();
    const turnKey = JSON.stringify([requestId, body.modelId || '', body.reasoningEffort || '']);
    let plan;
    try { plan = session.ledger.plan(context, turnKey); }
    catch (error) { return json(response, 400, { error: error.message }); }
    session.busy = true;
    let aborted = false;
    const abort = () => {
      if (response.writableEnded) return;
      aborted = true;
      session.process.cancel();
      if (sessions.get(key) === session) sessions.delete(key);
    };
    request.once?.('aborted', abort);
    response.once?.('close', abort);
    const send = event => response.write(`data: ${JSON.stringify(event)}\n\n`);
    let phase = 'context';
    try {
      if (plan.reset) {
        session.process.stop();
        session.process = new AcpProcess(agent);
      }
      if (!session.process.sessionId) {
        phase = 'initialize';
        await session.process.initialize();
        phase = 'plugin-capability';
        const plugins = await pluginServers(auxiliary ? undefined : body.pluginTools, session.process.agentCapabilities);
        session.pluginCompatibility = plugins.compatibility;
        phase = 'newSession';
        await session.process.newSession(workspace, plugins.mcpServers);
      }
      if (aborted) throw new Error('Agent turn cancelled');
      phase = 'setModel';
      if (body.modelId) await session.process.setModel(body.modelId);
      phase = 'setReasoning';
      if (body.reasoningEffort) await session.process.setReasoning(body.reasoningEffort);
      response.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive',
      });
      if (!auxiliary && body.pluginTools) send({ pluginCompatibility: { transport: session.pluginCompatibility,
        nativeTools: session.pluginCompatibility === 'http' || session.pluginCompatibility === 'stdio',
        uiPlugins: 'shell-only', runtimeHooks: 'native-only' } });
      if (plan.replay) {
        if (plan.replay.text) send({ text: plan.replay.text });
        send({ done: true, modelId: session.process.modelSelection?.modelId, ...plan.replay.result,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, replayed: true });
      } else {
        let answer = '';
        const blocks = promptFor(plan.messages, session.process.agentCapabilities?.promptCapabilities);
        phase = 'prompt';
        const result = await session.process.prompt(blocks, update => {
          if (!aborted && sessions.get(key) === session) {
            answer += update.text || '';
            send(update);
          }
        });
        if (!aborted && result?.stopReason !== 'cancelled') {
          session.ledger.commit(plan, answer, result);
          send({ done: true, modelId: session.process.modelSelection?.modelId, ...result });
        } else {
          session.process.stop();
          if (sessions.get(key) === session) sessions.delete(key);
          if (!aborted) send({ error: 'Agent turn cancelled' });
        }
      }
    } catch (error) {
      // Never log prompt text, capability tokens, credentials or upstream bodies.
      console.error('Somnus ACP turn failed ' + JSON.stringify({ phase,
        code: Number.isSafeInteger(error.code) ? error.code : 'UNKNOWN' }));
      session.process.stop();
      if (sessions.get(key) === session) sessions.delete(key);
      if (!aborted) {
        if (error.code === -32000) readiness?.set(agent, 'required');
        if (response.headersSent) send({ error: error.message });
        else json(response, 502, { error: error.message });
      }
    } finally {
      session.busy = false;
      // Auxiliary title generations have no conversation continuity or tools.
      // Reclaim their process and transcript even on cancellation/failure.
      if (auxiliary) {
        session.process.stop();
        if (sessions.get(key) === session) sessions.delete(key);
      }
      request.off?.('aborted', abort);
      response.off?.('close', abort);
      if (!response.writableEnded) response.end();
    }
    return;
  }
  return json(response, 404, { error: 'not found' });
}

server.listen(port, host, () => {
  const address = server.address();
  console.log(JSON.stringify({ port: address.port, url: `http://${host}:${address.port}` }));
});

process.on('SIGTERM', () => { for (const session of sessions.values()) session.process.stop(); server.close(() => process.exit(0)); });
