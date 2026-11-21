const { randomBytes, timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');
const { projectFileTools } = require('./acp-project.cjs');
const { approvalPreview } = require('./acp-native-approval.cjs');
const { TEAM_CLAIM } = require('./acp-dsh-teamwork.cjs');

const TOKEN_VARIABLE = 'DSH_SOMNUS_PROJECT_TOKEN';
const ENDPOINT_VARIABLE = 'DSH_SOMNUS_PROJECT_ENDPOINT';
const MAX_BODY = 128 * 1024;
const SHELL_APPROVAL = 'native_shell_approval';
const NATIVE_APPROVAL = 'native_tool_approval';
const USER_QUESTION = 'native_user_question';
const STEER_CLAIM = 'native_steer_claim';
const SESSION_CHECK = 'native_session_identity';
const STEER_COMMAND = 'somnus-running-input';
const definitions = projectFileTools({
  workspace_id: 'workspace', project: { available: true, supports_create: true },
  project_sources: [{ source: 'source_1' }],
});
definitions.push({
  name: 'call_somnus_tool',
  description: '调用本轮明确授权的 Somnus 数据分析或个人 MCP 工具。name 与 arguments 使用当前消息所附工具清单中的名称和参数。',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' }, arguments: { type: 'object' } },
    required: ['name', 'arguments'], additionalProperties: false,
  },
});

const plugin = `
import { isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const inject = ['tools', 'workingDirectory', 'shell', 'commands'];

${approvalPreview.toString()}

function requestContext(agent) {
  const session = agent?.session;
  const events = session?.snapshotEvents(Math.max(0, session.seq - 2000)) ?? [];
  const user = events.findLast(event => event.type === 'user/message' &&
    ['user', 'user-question-reply', 'goal'].includes(event.data?.source?.kind));
  const source = user?.data?.source;
  const requestId = source?.kind === 'user-question-reply' ? 'late-question:' + source.callId
    : source?.kind === 'goal' && typeof source.goalId === 'string' ? 'goal:' + source.goalId : source?.rpcId;
  return { session, events, requestId };
}

async function somnusCall(session, requestId, name, args, signal) {
  if (typeof requestId !== 'string') throw new Error('当前没有已授权的 Somnus 请求。');
  const response = await fetch(process.env.${ENDPOINT_VARIABLE}, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.${TOKEN_VARIABLE} },
    body: JSON.stringify({ sessionId: session.id, requestId, name, args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Somnus 工具未完成。');
  return result;
}

async function managedSession(context) {
  if (context.session?.id.startsWith('somnus-')) return true;
  try { return (await somnusCall(context.session, context.requestId, '${SESSION_CHECK}', {})).allowed === true; } catch { return false; }
}

async function shellApproval(ctx, request, sessionContext) {
  const { session, events, requestId } = sessionContext;
  const call = events.findLast(event => event.type === 'tool/call' && event.data?.callId === request.callId);
  if (!call || call.data.name !== 'pwsh' || !request.signal || request.signal.aborted) return 'rejected';
  try {
    const args = JSON.parse(call.data.arguments);
    const mode = args.sandbox_permissions;
    const reason = args.justification;
    if (!['workspace-write', 'danger-full-access'].includes(mode) || typeof reason !== 'string' ||
        request.reason !== 'escalate sandbox to ' + mode + ': ' + reason || args.run_in_background === true) {
      return 'rejected';
    }
    const sessionCwd = await ctx.workingDirectory.ensure(request.agent, request.signal);
    const workdir = args.workdir === undefined ? sessionCwd
      : isAbsolute(args.workdir) ? args.workdir : resolve(sessionCwd, args.workdir);
    const spec = ctx.shell.resolve({ command: args.command, workdir, timeoutMs: args.timeoutMs });
    const approved = await somnusCall(session, requestId, '${SHELL_APPROVAL}', {
      callId: request.callId, command: args.command, cwd: spec.workdir, timeoutMs: spec.timeoutMs,
      mode, justification: reason,
    }, request.signal);
    return approved.outcome === 'allowed-once' && !request.signal.aborted ? 'allowed-once' : 'rejected';
  } catch {
    return request.signal.aborted ? 'cancelled' : 'rejected';
  }
}

export function apply(ctx) {
  const pendingSteers = new WeakMap();
  ctx.on('agent/status', ({ status, agent }) => {
    if (status !== 'idle') return;
    const pending = pendingSteers.get(agent);
    if (!pending) return;
    for (const id of pending) agent.inbox.remove(id);
    pendingSteers.delete(agent);
  });
  ctx.commands.register({
    definitionId: 'somnus:running-input',
    name: '${STEER_COMMAND}',
    description: 'Somnus running-task input',
    recordInput: false,
    async handler({ agent, rawInput }) {
      const steerId = rawInput.trim();
      const { session, events, requestId } = requestContext(agent);
      const start = events.findLast(event => event.type === 'turn/start');
      const decline = { kind: 'error', text: 'Task is no longer accepting input' };
      if (agent.status !== 'running' || !start || !await managedSession({session,requestId}) ||
          !/^[a-f0-9]{32}$/.test(steerId) ||
          events.some(event => event.type === 'turn/end' && event.seq > start.seq)) return decline;
      const claim = await somnusCall(session, requestId, '${STEER_CLAIM}', { steerId });
      if (agent.status !== 'running' || claim.afterSeq >= start.seq ||
          session.snapshotEvents(start.seq).some(event => event.seq > start.seq &&
            (event.type === 'turn/end' || event.type === 'turn/start'))) return decline;
      const message = { id: randomUUID(), role: 'user',
        content: [{ type: 'text', text: claim.content }], source: { kind: 'user', rpcId: steerId } };
      let pending = pendingSteers.get(agent);
      if (!pending) pendingSteers.set(agent, pending = new Set());
      pending.add(message.id);
      // A next-step injection cannot wake an idle task or schedule an independent turn.
      agent.inject(message);
      return { kind: 'success', text: 'accepted' };
    },
  });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    const sessionId = context.agent?.session.id;
    if (typeof sessionId !== 'string' || !await managedSession(requestContext(context.agent))) {
      return assembly;
    }
    const identity = {
      name: 'harness:identity',
      text: 'You are Somnus, the assistant in the Somnus desktop app. When asked who you are, introduce yourself as Somnus in the user’s language. If asked about the implementation, DeepSeek Harness is the underlying execution runtime and the configured model is the model used by Somnus.',
    };
    const sections = assembly.sections.some(section => section.name === identity.name)
      ? assembly.sections.map(section => section.name === identity.name ? identity : section)
      : [identity, ...assembly.sections];
    return { ...assembly, sections };
  });
  ctx.on('user-questions/request', async (request, next) => {
    const { session, requestId } = requestContext(request.agent);
    if (!await managedSession({session,requestId})) return next();
    const hold = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, hold.signal]) : hold.signal;
    const stream = request.wait?.timed && ctx.get('userQuestions')?.attachWait(request.agent, request.wait.callId, signal);
    try {
      let countdown;
      if (stream) {
        const { done, value } = await stream.next();
        if (done) return next();
        countdown = { callId: request.wait.callId, remainingMs: value.remainingMs };
      }
      const result = await somnusCall(session, requestId, '${USER_QUESTION}', {
        questions: request.questions, ...(countdown ? { countdown } : {}),
        ...(request.wait?.callId ? { durableCallId: request.wait.callId } : {}),
      }, request.signal);
      if (result.cancelled || result.expired) {
        const error = new Error(result.expired ? 'The question countdown elapsed.' : 'The user dismissed the Somnus question.');
        error.name = 'UserQuestionError';
        error.code = result.expired ? 'ASK_TIMED_OUT' : 'ASK_CANCELLED';
        throw error;
      }
      return { answers: result.answers };
    } finally {
      hold.abort();
      await stream?.return?.();
    }
  }, { prepend: true });
  ctx.on('approval/request', async (request, next) => {
    const context = requestContext(request.agent);
    if (!await managedSession(context)) return next();
    if (request.toolName === 'pwsh') return shellApproval(ctx, request, context);
    const approvalSignal = request.signal ?? new AbortController().signal;
    if (approvalSignal.aborted || typeof request.toolName !== 'string' ||
        !/^[a-zA-Z0-9_.:/-]{1,160}$/.test(request.toolName)) return 'rejected';
    const call = typeof request.callId === 'string' ? context.events.findLast(event =>
      event.type === 'tool/call' && event.data?.callId === request.callId && event.data?.name === request.toolName) : null;
    if (request.callId && !call) return 'rejected';
    return somnusCall(context.session, context.requestId, '${NATIVE_APPROVAL}', {
      approvalId: randomUUID(), toolName: request.toolName,
      reason: approvalPreview(request.displayReason?.['zh-CN'] || request.reason || '此工具请求本次操作授权。').slice(0, 2000),
      argumentsPreview: approvalPreview(call?.data.arguments ?? {}),
    }, approvalSignal).then(result => approvalSignal.aborted || result.outcome === 'cancelled' ? 'cancelled'
      : result.outcome === 'allowed-once' ? 'allowed-once' : 'rejected',
      () => approvalSignal.aborted ? 'cancelled' : 'rejected');
  }, { prepend: true });
  const tools = ${JSON.stringify(definitions)};
  for (const { name, description, inputSchema } of tools) ctx.tools.register({
    name, description, parameters: inputSchema,
    output: { schema: { type: 'object', properties: { text: { type: 'string' } },
      required: ['text'], additionalProperties: false },
      render(_args, result) { return [{ type: 'text', text: result.text }]; } },
    async execute(args, exec) {
      const { session, requestId } = requestContext(exec.agent);
      const result = await somnusCall(session, requestId, name, args, exec.signal);
      return { text: result.text };
    },
  });
}
`;

async function projectToolHost(dispatch) {
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from('Bearer ' + token);
  const send = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000, maxHeaderSize: 8192 }, (request, response) => {
    void (async () => {
      const header = Buffer.from(request.headers.authorization || '');
      if (request.method !== 'POST' || request.url !== '/' || request.headers.host !== host ||
          header.length !== authorization.length || !timingSafeEqual(header, authorization)) {
        return send(response, 403, { error: '未授权的 Somnus 项目工具请求。' });
      }
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > MAX_BODY) return send(response, 413, { error: '项目工具内容过大。' });
        chunks.push(chunk);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(response, 400, { error: '无效的 Somnus 项目工具请求。' });
      }
      const interaction = [SESSION_CHECK, SHELL_APPROVAL, NATIVE_APPROVAL, USER_QUESTION, STEER_CLAIM, TEAM_CLAIM].includes(input?.name);
      if (!input || (!interaction && !definitions.some(item => item.name === input.name))) {
        return send(response, 400, { error: '无效的 Somnus 项目工具。' });
      }
      const controller = new AbortController();
      response.on('close', () => controller.abort());
      try {
        const result = await dispatch(input, controller.signal);
        send(response, 200, interaction ? result : { text: result.content[0].text });
      } catch (error) {
        send(response, 409, { error: typeof error?.message === 'string'
          ? error.message.slice(0, 200) : 'Somnus 项目工具未完成。' });
      }
    })().catch(() => response.destroy());
  });
  server.maxConnections = 20;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const host = '127.0.0.1:' + server.address().port;
  return {
    plugin,
    env: { [TOKEN_VARIABLE]: token, [ENDPOINT_VARIABLE]: 'http://' + host + '/' },
    dispose: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

module.exports = { SESSION_CHECK, projectToolHost, SHELL_APPROVAL, NATIVE_APPROVAL, USER_QUESTION, STEER_CLAIM, STEER_COMMAND, TOKEN_VARIABLE, ENDPOINT_VARIABLE };
