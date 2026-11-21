import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 256 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const NAME = /^[A-Za-z0-9_.:/-]{1,160}$/;
const VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const WRAPPERS = [
  { name: 'somnus_list_tools', description: 'List the DSH tools admitted for this conversation turn. UI-only plugins are not tools.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'somnus_call_tool', description: 'Call one listed DSH tool. Somnus enforces the original conversation permissions, approvals and workspace. Unlisted tools cannot be called.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name', 'arguments'], additionalProperties: false } },
];

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function jsonValue(value, limit = MAX_OUTPUT) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > limit) throw new Error('Somnus tool payload is too large');
  return JSON.parse(encoded);
}
function errorResult(message) { return { content: [{ type: 'text', text: message }], isError: true }; }
function resultContent(result) {
  return (Array.isArray(result?.content) ? result.content : []).map(block => {
    if (block?.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text };
    if (block?.type === 'image' && block.source?.type === 'base64' && typeof block.source.data === 'string') {
      return { type: 'image', data: block.source.data, mimeType: block.source.mediaType || 'application/octet-stream' };
    }
    return { type: 'text', text: JSON.stringify({ native_content: block }) };
  });
}
function audit(turn, phase, detail) {
  // Separate journal events: these are real externally requested tool operations,
  // never fabricated assistant tool-call blocks in the native model transcript.
  turn.agent.session.append('somnus/acp-tool', jsonValue({ version: 1, source: 'external-acp',
    externalAgentId: turn.externalAgentId, turnId: turn.id, phase, ...detail }));
}
function assertActive(entry, ctx) {
  const turn = entry.active;
  if (!turn || turn.closed || turn.signal.aborted || ctx.agents.get(entry.sessionId) !== turn.agent) {
    throw new Error('Somnus tool access is not active for this conversation turn');
  }
  return turn;
}
function nativeSchemas(ctx, turn) {
  const definitions = ctx.tools.definitions(turn.agent, turn.toolSet);
  const described = ctx.tools.selectExecutor(turn.agent).describe(definitions)?.schemas || [];
  return described.filter(schema => NAME.test(schema?.name || '') && turn.admitted.has(schema.name))
    .map(schema => ({ name: schema.name, description: schema.description || '',
      inputSchema: schema.parameters || schema.inputSchema || { type: 'object' } }));
}

/** Per-conversation MCP capabilities, active only during an owning native turn. */
export function createDshPluginInterop(ctx, options = {}) {
  const entries = new Map();
  const byIdentity = new Map();
  let server, address, starting, disposed = false;
  const listen = async () => {
    if (address) return;
    if (starting) return starting;
    starting = (async () => {
      server = (options.createServer || createServer)((request, response) => {
        void handle(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ error: 'Somnus tool transport failed' }));
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      server.unref?.();
      const port = server.address().port;
      address = `http://127.0.0.1:${port}`;
    })();
    try { await starting; } finally { starting = undefined; }
  };
  async function dispatch(entry, message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    }
    const reply = result => ({ jsonrpc: '2.0', id: message.id ?? null, result });
    if (!Object.hasOwn(message, 'id')) return null;
    try {
      const turn = assertActive(entry, ctx);
      if (message.method === 'initialize') return reply({ protocolVersion: VERSIONS.has(message.params?.protocolVersion) ? message.params.protocolVersion : '2025-11-25',
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'somnus-dsh-tools', version: '1.0.0' } });
      if (message.method === 'ping') return reply({});
      if (message.method === 'tools/list') return reply({ tools: jsonValue(WRAPPERS) });
      if (message.method !== 'tools/call') return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
      if (message.params?.name === 'somnus_list_tools') return reply({ content: [{ type: 'text', text: JSON.stringify({
        tools: nativeSchemas(ctx, turn), compatibility: { nativeTools: true, uiPlugins: 'shell-only', runtimeHooks: 'native-only' },
      }) }] });
      if (message.params?.name !== 'somnus_call_tool') return reply(errorResult('Unknown Somnus MCP tool'));
      const input = message.params.arguments;
      if (!input || !NAME.test(input.name || '') || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) {
        return reply(errorResult('A listed native tool name and JSON object arguments are required'));
      }
      const signature = JSON.stringify(message.params);
      const requestIdentity = JSON.stringify([typeof message.id, message.id]);
      const prior = turn.calls.get(requestIdentity);
      if (prior) {
        if (prior.signature !== signature) return reply(errorResult('MCP request id was reused with different arguments'));
        return reply(await prior.result);
      }
      if (turn.calls.size >= 256) return reply(errorResult('Too many tool calls in one conversation turn'));
      const execution = (async () => {
        assertActive(entry, ctx);
        if (turn.concluded) return errorResult('A native tool has concluded this DSH turn');
        if (!nativeSchemas(ctx, turn).some(tool => tool.name === input.name)) return errorResult('This tool is not admitted for the current DSH conversation turn');
        const callId = `acp-${turn.id}-${turn.calls.size + 1}`;
        audit(turn, 'start', { callId, name: input.name, arguments: input.arguments });
        let result;
        try {
          const batch = await ctx.tools.execute({ agent: turn.agent, signal: turn.signal, toolSet: turn.toolSet,
            calls: [{ type: 'tool-call', id: callId, name: input.name, arguments: JSON.stringify(input.arguments) }],
            maxParallelToolCalls: 1 });
          result = batch.results?.find(item => item.callId === callId)?.result;
          if (!result) throw new Error('Native tool returned no settled result');
          const contexts = Array.isArray(batch.additionalContexts) ? batch.additionalContexts : [];
          if (contexts.length && typeof turn.agent.inbox?.splice === 'function') {
            turn.agent.inbox.splice('next-step', turn.agent.inbox.nextStep.length, 0, contexts);
          }
          turn.concluded ||= batch.concluded === true;
          audit(turn, 'result', { callId, name: input.name, result: { content: result.content,
            isError: Boolean(result.isError), ...(result.meta !== undefined ? { meta: result.meta } : {}),
            ...(result.error !== undefined ? { error: result.error } : {}) } });
          const content = resultContent(result);
          if (contexts.length) content.push({ type: 'text', text: JSON.stringify({ dsh_tool_context: contexts }) });
          return jsonValue({ content, isError: Boolean(result.isError) });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Native tool execution failed';
          audit(turn, 'error', { callId, name: input.name, message });
          return errorResult(message);
        }
      })();
      turn.calls.set(requestIdentity, { signature, result: execution });
      return reply(await execution);
    } catch (error) { return { jsonrpc: '2.0', id: message.id ?? null,
      error: { code: -32002, message: error instanceof Error ? error.message : 'Somnus tools unavailable' } }; }
  }
  async function handle(request, response) {
    const route = /^\/somnus-tools\/([a-f0-9]{32})$/.exec(request.url || '');
    const entry = route && entries.get(route[1]);
    const origin = request.headers.origin;
    if (!entry || request.method !== 'POST' || origin && origin !== address ||
        !sameSecret(request.headers.authorization, `Bearer ${entry.token}`)) {
      response.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return response.end(JSON.stringify({ error: 'forbidden' }));
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) {
        response.writeHead(413, { 'Content-Type': 'application/json' }); return response.end('{}');
      }
    }
    let message;
    try { message = JSON.parse(body); } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' }); return response.end('{}');
    }
    const result = await dispatch(entry, message);
    response.writeHead(result === null ? 202 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(result === null ? '' : JSON.stringify(result));
  }
  return {
    async openTurn(call, externalAgentId) {
      if (disposed || typeof call.sessionId !== 'string' || !call.signal || call.signal.aborted) throw new Error('A live DSH conversation turn is required for plugin tools');
      const agent = ctx.agents.get(call.sessionId);
      if (!agent || typeof agent.session?.append !== 'function') throw new Error('The owning DSH conversation is unavailable');
      const identity = JSON.stringify([call.sessionId, externalAgentId]);
      let entry = byIdentity.get(identity);
      if (entry?.active) throw new Error('Somnus plugin tools already have an active turn for this Agent');
      const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider: call.provider, model: call.model }, signal: call.signal });
      const requestId = typeof call.requestId === 'string' && call.requestId.length <= 256 ? call.requestId : undefined;
      const retainedRequest = requestId && entry?.lastRequest?.requestId === requestId ? entry.lastRequest :
        { requestId, id: randomUUID(), calls: new Map() };
      const cancellation = new AbortController();
      const turn = { id: retainedRequest.id, externalAgentId, agent, toolSet, cancellation,
        signal: AbortSignal.any([call.signal, cancellation.signal]),
        admitted: new Set((call.tools || []).map(tool => tool.name)), calls: retainedRequest.calls, closed: false, concluded: false };
      try {
        if (!entry) {
          entry = { id: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex'), sessionId: call.sessionId };
          entries.set(entry.id, entry); byIdentity.set(identity, entry);
        }
        entry.lastRequest = retainedRequest;
        entry.active = turn;
        await listen();
        const close = () => { if (entry.active === turn) entry.active = undefined; turn.closed = true; cancellation.abort(); toolSet.dispose(); call.signal.removeEventListener('abort', close); };
        call.signal.addEventListener('abort', close, { once: true });
        if (call.signal.aborted) close();
        return { descriptor: { name: 'somnus-dsh-tools', url: `${address}/somnus-tools/${entry.id}`, token: entry.token },
          compatibility: { mode: 'native-tool-mcp', uiPlugins: 'shell-only', runtimeHooks: 'native-only' }, close,
          reportCompatibility(value) {
            assertActive(entry, ctx);
            const transport = ['http', 'stdio', 'unavailable', 'not-requested'].includes(value?.transport) ? value.transport : 'unavailable';
            turn.agent.session.append('somnus/acp-plugin-compatibility', { version: 1, source: 'external-acp',
              externalAgentId, transport, tools: transport === 'http' || transport === 'stdio' ? 'native-mcp' : 'unavailable',
              uiPlugins: 'shell-only', runtimeHooks: 'native-only',
              ...(typeof value?.reason === 'string' ? { reason: value.reason.slice(0, 512) } : {}) });
          },
          // Internal direct dispatcher lets deterministic tests exercise the real boundary without binding sockets.
          dispatch: message => dispatch(entry, message) };
      } catch (error) { if (entry?.active === turn) entry.active = undefined; toolSet.dispose(); throw error; }
    },
    async close() {
      disposed = true;
      for (const entry of entries.values()) { if (entry.active) { entry.active.closed = true; entry.active.cancellation.abort(); entry.active.toolSet.dispose(); entry.active = undefined; } }
      entries.clear(); byIdentity.clear();
      if (server) await new Promise(resolve => server.close(resolve));
    },
  };
}

/** A trusted Host accepts only descriptors minted by the native adapter boundary. */
export function pluginMcpServers(descriptor, agentCapabilities, relay) {
  if (!descriptor) return { mcpServers: [], compatibility: 'not-requested' };
  const url = URL.parse(descriptor.url || '');
  if (descriptor.name !== 'somnus-dsh-tools' || !url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.port === '0' || url.username || url.password || url.search || url.hash || !/^\/somnus-tools\/[a-f0-9]{32}$/.test(url.pathname) ||
      !/^[a-f0-9]{64}$/.test(descriptor.token || '')) throw new Error('Invalid Somnus plugin tool capability');
  if (agentCapabilities?.mcpCapabilities?.http === true) return { mcpServers: [{ type: 'http', name: descriptor.name, url: url.href,
    headers: [{ name: 'Authorization', value: 'Bearer ' + descriptor.token }] }], compatibility: 'http' };
  if (relay?.command && relay?.script) return { mcpServers: [{ name: descriptor.name, command: relay.command, args: [relay.script],
    env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }, { name: 'SOMNUS_PLUGIN_MCP_URL', value: url.href },
      { name: 'SOMNUS_PLUGIN_MCP_TOKEN', value: descriptor.token }] }], compatibility: 'stdio' };
  return { mcpServers: [], compatibility: 'unavailable', reason: 'This Agent does not support the available MCP transport; DSH-only tools are unavailable.' };
}
