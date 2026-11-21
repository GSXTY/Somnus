const http = require('node:http');
const { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { AcpError } = require('./acp-stdio.cjs');

const PROJECT_TEXT_LIMIT = 48 * 1024;
const MAX_CONTEXT_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FILE_LIMIT = 12;
const MIRROR_LIMIT = 256 * 1024;
const SOURCE = /^source_[1-9][0-9]?$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const READ_FILE = 'read_project_file';
const PROPOSE_FILE = 'propose_project_file_edit';
const CREATE_FILE = 'propose_project_file_create';
const FILE_TOOLS = new Set([READ_FILE, PROPOSE_FILE, CREATE_FILE]);
const pathFields = {
  source: { type: 'string', description: '项目来源，例如 source_1。' },
  path: { type: 'string', description: '相对于该项目来源的文件路径，使用 / 分隔。' },
};

function projectFileTools(prepared) {
  if (!prepared?.workspace_id || !prepared.project?.available || !prepared.project_sources?.length) return [];
  const schema = (name, description, properties, required) => ({
    name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
  });
  const tools = [schema(READ_FILE, '读取已授权项目的 UTF-8 文本。返回原文和版本 sha256。',
    pathFields, ['source', 'path'])];
  tools.push(schema(PROPOSE_FILE,
    '请求用户批准修改现有文件，只读模式也可提交。等待用户在 Somnus 审核应用，先读取原文和 sha256。',
    { ...pathFields, expected_sha256: { type: 'string' }, new_content: { type: 'string', description: '完整的文件替换文本。' } },
    ['source', 'path', 'expected_sha256', 'new_content']));
  if (prepared.project.supports_create === true) tools.push(schema(CREATE_FILE,
    '请求用户批准新建文本文件，只读模式也可提交。目标必须不存在且父目录已存在。获批后才会保存。',
    { ...pathFields, new_content: { type: 'string', description: '新文件的完整 UTF-8 文本。' } },
    ['source', 'path', 'new_content']));
  return tools;
}

function mayPropose(prepared) {
  return ['workspace_write', 'workspace_direct', 'full'].includes(prepared?.permission_mode);
}

function backendRequest(origin, token, conversationId, turnId, action, payload, signal) {
  const address = new URL('/api/assistant/conversations/' + encodeURIComponent(conversationId) +
    '/external-turns/' + encodeURIComponent(turnId) + '/' + action, origin);
  const body = JSON.stringify(payload);
  const deadline = AbortSignal.timeout(action === 'prepare' ? 40_000 : action === 'tool' ? 105_000 : 8_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  return new Promise((resolve, reject) => {
    const request = http.request(address, {
      agent: false, method: 'POST', signal: requestSignal,
      headers: { 'X-Data-Agent-Native': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        ...(action === 'steers' ? { 'X-Data-Agent-Local': '1' } : {}) },
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new AcpError(action === 'prepare'
          ? '本机服务无法准备附件、Skill 或项目上下文，请检查当前对话授权。'
          : action.startsWith('steers/') ? '本机服务未能确认这条追加消息仍属于当前任务。'
          : '本机服务未授权该项目文件操作，文件也可能已变更。'));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('error', reject);
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_CONTEXT_BYTES) {
          request.destroy(new AcpError('外部 Agent 上下文超出大小限制。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new AcpError('本机服务返回了无效的外部 Agent 上下文。'));
        }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function createProjectClient(origin, token) {
  const companyEndpoint = (conversationId, turnId) => new URL('/api/assistant/conversations/' +
    encodeURIComponent(conversationId) + '/external-turns/' + encodeURIComponent(turnId) + '/company-provider', origin).href;
  const companyWebEndpoint = new URL('/api/assistant/company-web-runtime', origin).href;
  async function runtimeRequest(route, action, body) {
    const endpoint = new URL('/api/assistant/conversations/' + encodeURIComponent(route.conversationId) +
      '/runtime-tasks/' + encodeURIComponent(route.taskId) + '/' + action, origin);
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'X-Data-Agent-Native': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new AcpError(result.error?.message || '无法确认 Agent 任务状态。'),
      { code: result.error?.code, task: result.task, epoch: result.epoch });
    return result;
  }
  async function nativeRequest(suffix, body, method) {
    const endpoint = new URL('/api/assistant/' + suffix, origin);
    const response = await fetch(endpoint, {method:method||(body===undefined?'GET':'POST'),redirect:'error',signal:AbortSignal.timeout(8000),headers:{'X-Data-Agent-Native':token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();if(!response.ok)throw Object.assign(new AcpError(data.error?.message||'原生会话操作未能完成。'),{code:data.error?.code});return data;
  }
  return {
    archiveNativeForkPage: (rid,body) => nativeRequest('native-forks/'+encodeURIComponent(rid)+'/history/pages',body),
    inheritedHistory: (cid,after,limit=50) => nativeRequest('conversations/'+encodeURIComponent(cid)+'/inherited-history?limit='+encodeURIComponent(limit)+(after?'&after='+encodeURIComponent(after):'')),
    nativePreferences: cid => nativeRequest('conversations/'+encodeURIComponent(cid)+'/native-preferences'),
    saveNativePreferences: (cid,body) => nativeRequest('conversations/'+encodeURIComponent(cid)+'/native-preferences',body,'PUT'),
    nativeSession: (cid, agentId = 'fbbce833-544a-42a1-8579-cba2a817383e') => nativeRequest('conversations/'+encodeURIComponent(cid)+'/native-sessions?agent_id='+encodeURIComponent(agentId)),
    childConversation: (cid,turnId,childId) => nativeRequest('conversations/'+encodeURIComponent(cid)+'/child-conversations?turn_id='+encodeURIComponent(turnId)+'&child_id='+encodeURIComponent(childId)),
    authorizeNativeHistory: (cid,body) => nativeRequest('conversations/'+encodeURIComponent(cid)+'/native-history/authorize',body),
    bindNativeSession: (cid,body) => nativeRequest('conversations/'+encodeURIComponent(cid)+'/native-sessions',body),
    reserveNativeFork: (cid,body) => nativeRequest('conversations/'+encodeURIComponent(cid)+'/native-forks',body),
    commitNativeFork: (rid,body) => nativeRequest('native-forks/'+encodeURIComponent(rid)+'/commit',body),
    abortNativeFork: rid => nativeRequest('native-forks/'+encodeURIComponent(rid)+'/abort',{}),
    companyEndpoint,
    runtimeTaskState: (route, body) => runtimeRequest(route, 'state', body),
    finishRuntimeTask: (route, body) => runtimeRequest(route, 'finish', body),
    abandonRuntimeTask: (route, body) => runtimeRequest(route, 'abandon', body),
    async agentMode(conversationId, mode) {
      const endpoint = new URL('/api/assistant/conversations/' + encodeURIComponent(conversationId) + '/agent-mode', origin);
      const response = await fetch(endpoint, { method: mode === undefined ? 'GET' : 'POST',
        headers: { 'X-Data-Agent-Native': token, ...(mode === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(mode === undefined ? {} : { body: JSON.stringify({ agent_mode: mode }) }),
        redirect: 'error', signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (!response.ok) throw new AcpError(result.error?.message || '无法确认当前会话的工作模式。');
      return result;
    },
    async steerMessage(conversationId, steerId) {
      const endpoint = new URL('/api/assistant/conversations/' + encodeURIComponent(conversationId), origin);
      const response = await fetch(endpoint, {
        headers: { 'X-Data-Agent-Native': token }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new AcpError('无法确认队列引导结果。');
      const { messages } = await response.json();
      if (!Array.isArray(messages)) throw new AcpError('队列引导回执格式无效。');
      return messages.find(message => message.id === steerId && message.role === 'user' && message.status === 'complete') ?? null;
    },
    async nativeTurnIds(conversationId) {
      const endpoint = new URL('/api/assistant/conversations/' + encodeURIComponent(conversationId), origin);
      const response = await fetch(endpoint, {
        headers: { 'X-Data-Agent-Native': token }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return new Set();
      const { messages } = await response.json();
      return new Set((messages ?? []).filter(message =>
        message.role === 'assistant' && message.reply_meta?.transport === 'dsh-native').map(message => message.id));
    },
    async hasNativeSubagent(conversationId, turnId, subagentId) {
      const endpoint = new URL('/api/assistant/conversations/' + encodeURIComponent(conversationId), origin);
      const response = await fetch(endpoint, {
        headers: { 'X-Data-Agent-Native': token }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      const { messages } = await response.json();
      return messages?.some(message => message.id === turnId && message.role === 'assistant' &&
        message.reply_meta?.transport === 'dsh-native' &&
        message.reply_meta.execution?.steps?.some(step => step.id === subagentId && step.kind === 'subagent')) === true;
    },
    async openCompanyWeb(expectedRevision) {
      const headers = { 'X-Data-Agent-Native': token, 'Content-Type': 'application/json' };
      const response = await fetch(companyWebEndpoint, {
        method: 'POST', headers, body: JSON.stringify(expectedRevision ? { revision: expectedRevision } : {}),
        redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (response.status === 503) return null;
      if (!response.ok) throw new AcpError('本机服务未能授权公司默认模型。');
      const config = await response.json();
      if (typeof config?.id !== 'string' || !/^[a-f0-9]{32}$/.test(config.id)) {
        throw new AcpError('本机服务返回了无效的公司模型授权。');
      }
      const endpoint = companyWebEndpoint + '/' + config.id;
      const dispose = async () => {
        await fetch(endpoint, { method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
      };
      if (typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token) ||
          typeof config.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/.test(config.model) ||
          (expectedRevision && config.revision !== expectedRevision)) {
        await dispose().catch(() => {});
        throw new AcpError('本机服务返回了无效的公司模型授权。');
      }
      const { data_servers: dataServersConfig, data: legacyData, ...modelConfig } = config;
      let dataServers;
      if (dataServersConfig !== undefined) {
        const ids = new Set(['database', 'text-to-sql']);
        if (!Array.isArray(dataServersConfig) || ![0, 2].includes(dataServersConfig.length) ||
            dataServersConfig.some(server => !server || !ids.delete(server.id) ||
              typeof server.token !== 'string' || !/^[a-f0-9]{64}$/.test(server.token)) ||
            new Set([config.token, ...dataServersConfig.map(server => server.token)]).size !== dataServersConfig.length + 1) {
          await dispose().catch(() => {});
          throw new AcpError('公司数据 MCP 启动参数无效。');
        }
        dataServers = dataServersConfig.map(({ id, token: serverToken }) =>
          ({ id, endpoint: endpoint + '/mcp/' + id, token: serverToken }));
      }
      const data = !dataServers && legacyData?.available === true && /^[a-f0-9]{64}$/.test(legacyData.token ?? '')
        ? { endpoint: endpoint + '/mcp', token: legacyData.token } : undefined;
      return { ...modelConfig, data, dataServers, endpoint: endpoint + '/provider', dispose };
    },
    async companyRuntime(modelId) {
      const endpoint = new URL('/api/assistant/company-runtime', origin);
      if (modelId != null) endpoint.searchParams.set('model_id', modelId);
      const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(3000),
        headers: { 'X-Data-Agent-Native': token } });
      if (!response.ok) throw new AcpError('暂时无法读取公司默认模型的当前配置。');
      const config = await response.json();
      const revision = config?.ready === true ? config.revision : null;
      if (typeof config?.ready !== 'boolean' ||
          (config.ready && (typeof revision !== 'string' || !/^[a-f0-9-]{32,36}$/.test(revision)))) {
        throw new AcpError('本机服务返回了无效的公司默认模型配置。');
      }
      return { ready: config.ready, revision, ...(config.personal === true ? { personal: true } : {}) };
    },
    prepare: ({ agentId, conversationId, turnId }, signal) =>
      backendRequest(origin, token, conversationId, turnId, 'prepare', { agent_id: agentId }, signal),
    reserveSteer: (conversationId, turnId, content) =>
      backendRequest(origin, token, conversationId, turnId, 'steers', { content }),
    prepareSteer: ({ agentId, conversationId, turnId }, steerId, signal) =>
      backendRequest(origin, token, conversationId, turnId, 'steers/' + steerId + '/prepare', { agent_id: agentId }, signal),
    finishSteer: ({ agentId, conversationId, turnId }, steerId, accepted) =>
      backendRequest(origin, token, conversationId, turnId, 'steers/' + steerId + '/finish', { agent_id: agentId, accepted }),
    file: ({ agentId, conversationId, turnId }, params, signal) =>
      backendRequest(origin, token, conversationId, turnId, 'project-file', { ...params, agent_id: agentId }, signal),
    tool: ({ agentId, conversationId, turnId }, params, signal) =>
      backendRequest(origin, token, conversationId, turnId, 'tool', { ...params, agent_id: agentId }, signal),
    projectRoot: ({ agentId, conversationId, turnId }, params, signal) =>
      backendRequest(origin, token, conversationId, turnId, 'project-root', { ...params, agent_id: agentId }, signal),
  };
}

function projectPath(source, relativePath) {
  if (typeof source !== 'string' || !SOURCE.test(source) || typeof relativePath !== 'string' ||
      !relativePath || relativePath.length > 500 || relativePath.includes('\\')) return null;
  const pieces = relativePath.split('/');
  if (pieces.some(piece => !piece || piece === '.' || piece === '..' || /[\x00-\x1f<>:"|?*]|[. ]$/.test(piece) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(piece))) return null;
  return { source, path: relativePath, parts: [source, ...pieces] };
}

function projectRequestPath(root, requested) {
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.length > 2048 ||
      requested.startsWith('\\\\') || requested.split(/[\\/]/).includes('..')) return null;
  const relative = path.relative(root, requested);
  if (path.isAbsolute(relative)) return null;
  const [source, ...parts] = relative.split(path.sep);
  return projectPath(source, parts.join('/'));
}

function promptBlocks(context, capabilities) {
  if (typeof context?.text !== 'string' || context.text.length > 100_000 ||
      !Array.isArray(context.images) || context.images.length > 4) throw new AcpError('本机服务返回了无效的提示或附件。');
  if (context.images.length && !capabilities?.image) {
    throw new AcpError('此 Agent 不支持图片附件。请移除图片或选择支持图片的 Agent。');
  }
  let imageTotal = 0;
  return [{ type: 'text', text: context.text }, ...context.images.map(image => {
    if (!IMAGE_MIME.has(image?.mimeType) || typeof image.data !== 'string' || image.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new AcpError('本机服务返回了无效的图片附件。');
    const bytes = Buffer.byteLength(image.data, 'base64');
    imageTotal += bytes;
    if (bytes > 5 * 1024 * 1024 || imageTotal > MAX_IMAGE_BYTES) throw new AcpError('图片附件超出大小限制。');
    return { type: 'image', mimeType: image.mimeType, data: image.data };
  })];
}

async function mirroredText(root, relative) {
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) return null;
  let candidate = root;
  for (const piece of relative.parts) {
    candidate = path.join(candidate, piece);
    if ((await lstat(candidate)).isSymbolicLink()) return null;
  }
  if (await realpath(candidate) !== candidate) return null;
  const file = await open(candidate, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > PROJECT_TEXT_LIMIT) return null;
    const buffer = Buffer.alloc(PROJECT_TEXT_LIMIT + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > PROJECT_TEXT_LIMIT) return null;
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}

class AcpProjectTurn {
  constructor(client, turn, prepared) {
    this.client = client;
    this.turn = turn;
    this.prepared = prepared;
    this.proposals = [];
    this.proposed = new Set();
    this.mirrors = new Map();
    this.operations = 0;
    this.queue = Promise.resolve();
  }

  async stage(cwd) {
    if (!this.prepared.project?.available) return '';
    if ((await lstat(cwd)).isSymbolicLink() || await realpath(cwd) !== cwd) throw new AcpError('外部 Agent 临时目录已变更。');
    this.root = await mkdtemp(path.join(cwd, 'project-'));
    const files = Array.isArray(this.prepared.project.files) ? this.prepared.project.files.slice(0, 80) : [];
    const question = this.prepared.text.split('\n\n', 1)[0].toLowerCase();
    const entries = files.map(item => projectPath(item?.source, item?.path)).filter(Boolean);
    const priority = file => question.includes(file.path.toLowerCase()) ||
      (file.parts.at(-1).length >= 3 && question.includes(file.parts.at(-1).toLowerCase()));
    entries.sort((left, right) => Number(priority(right)) - Number(priority(left)));
    let bytes = 0;
    for (const entry of entries.slice(0, FILE_LIMIT)) {
      if (this.turn.signal.aborted) break;
      try {
        const reply = await this.file('read', entry);
        if (typeof reply.content !== 'string' || !SHA256.test(reply.sha256)) continue;
        const size = Buffer.byteLength(reply.content);
        if (size > PROJECT_TEXT_LIMIT || bytes + size > MIRROR_LIMIT) continue;
        const destination = path.join(this.root, ...entry.parts);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, reply.content, { flag: 'wx' });
        this.mirrors.set(this.key(entry), { entry, ...reply });
        bytes += size;
      } catch {
        // A source may disappear or become unavailable between listing and staging.
      }
    }
    const sources = Array.isArray(this.prepared.project.sources)
      ? this.prepared.project.sources.map(item => item?.source).filter(value => typeof value === 'string' && SOURCE.test(value))
      : [];
    for (const source of sources) await mkdir(path.join(this.root, source), { recursive: true });
    return '\n\nSomnus 项目临时视图：' + this.root +
      '\n路径格式为该目录下的 source_N/相对路径。清单中的其他文件可使用 ACP 读取。' +
      '\n临时视图最多包含 12 个文件。对现有副本的修改会在授权允许时提交候选。' +
      '在临时目录新建的文件只存在于临时目录，结束后会清理，请勿把它描述为已保存到真实项目。';
  }

  key(entry) {
    return entry.source + '/' + entry.path;
  }

  async permissionFiles(locations) {
    if (!this.root || !mayPropose(this.prepared) || !Array.isArray(locations) || !locations.length ||
        locations.length > FILE_LIMIT || this.turn.signal.aborted) return [];
    const verified = [];
    for (const location of locations) {
      const entry = projectRequestPath(this.root, location?.path);
      if (!entry || !this.mirrors.has(this.key(entry))) return [];
      try {
        if (await mirroredText(this.root, entry) === null) return [];
      } catch {
        return [];
      }
      verified.push(this.key(entry));
    }
    return [...new Set(verified)];
  }

  file(action, entry, details = {}, signal = this.turn.signal) {
    return this.client.file(this.turn, { action, source: entry.source, path: entry.path, ...details }, signal);
  }

  keepProposal(reply, entry) {
    if (!reply?.proposal || typeof reply.proposal.id !== 'string') throw new AcpError('项目修改候选未能保存。');
    this.proposals.push(reply.proposal);
    this.proposed.add(this.key(entry));
    this.turn.onUpdate?.({
      agentId: this.turn.agentId, conversationId: this.turn.conversationId, text: '',
      projectProposal: reply.proposal,
    });
  }

  async mcpFile(name, args, signal) {
    const allowed = ['source', 'path'];
    if (name !== READ_FILE) allowed.push('new_content');
    if (name === PROPOSE_FILE) allowed.push('expected_sha256');
    const entry = projectPath(args.source, args.path);
    if (!FILE_TOOLS.has(name) || !entry || !this.prepared.project_sources?.some(item => item.source === entry.source) ||
        Object.keys(args).some(key => !allowed.includes(key))) throw new AcpError('项目文件路径超出授权范围。');
    const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
    if (name === READ_FILE) {
      const reply = await this.file('read', entry, {}, signal);
      return result({ source: entry.source, path: entry.path, content: reply.content, sha256: reply.sha256 });
    }
    if (typeof args.new_content !== 'string' ||
        Buffer.byteLength(args.new_content) > PROJECT_TEXT_LIMIT) {
      throw new AcpError('当前权限或文本大小不支持文件候选。');
    }
    const create = name === CREATE_FILE;
    if (create && this.prepared.project?.supports_create !== true) throw new AcpError('当前项目不支持创建文件候选。');
    if (!create && (typeof args.expected_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(args.expected_sha256))) {
      throw new AcpError('请先读取项目文件，并提交完整替换文本和对应版本。');
    }
    const work = this.queue.then(async () => {
      signal.throwIfAborted();
      if (this.proposed.has(this.key(entry))) throw new AcpError('此文件已有本轮待审批候选。');
      const fields = { content: args.new_content };
      if (!create) fields.expected_sha256 = args.expected_sha256;
      this.keepProposal(await this.file(create ? 'propose_create' : 'propose', entry, fields, signal), entry);
      return result({ source: entry.source, path: entry.path, proposal_id: this.proposals.at(-1).id, status: 'pending',
        ...(create ? { operation: 'create' } : {}) });
    });
    this.queue = work.catch(() => {});
    return work;
  }

  request(method, params) {
    const reply = this.queue.then(() => this.handleFile(method, params));
    this.queue = reply.catch(() => {});
    return reply;
  }

  async handleFile(method, params) {
    if (!this.root || this.turn.signal.aborted || ++this.operations > 24) throw new AcpError('项目文件当前不可用。');
    const entry = projectRequestPath(this.root, params.path);
    if (!entry) throw new AcpError('项目文件路径超出授权范围。');
    if (method === 'fs/read_text_file') {
      const { line, limit } = params;
      if ([line, limit].some(value => value != null && (!Number.isSafeInteger(value) || value < 1 || value > 100_000))) {
        throw new AcpError('项目文件行号无效。');
      }
      const reply = await this.file('read', entry, { line, limit });
      return { content: reply.content };
    }
    if (!mayPropose(this.prepared) || typeof params.content !== 'string' ||
        Buffer.byteLength(params.content) > PROJECT_TEXT_LIMIT) throw new AcpError('当前权限或文件类型不支持修改候选。');
    const key = this.key(entry);
    if (this.proposed.has(key)) throw new AcpError('此文件已有本轮待审批候选。');
    const base = this.mirrors.get(key) || await this.file('read', entry);
    if (!SHA256.test(base.sha256)) throw new AcpError('无法验证原项目文件。');
    this.keepProposal(await this.file('propose', entry, { content: params.content, expected_sha256: base.sha256 }), entry);
    throw new AcpError('修改已提交 Somnus 审批，原文件尚未修改。');
  }

  async capture() {
    await this.queue;
    if (!this.root || this.turn.signal.aborted || !mayPropose(this.prepared)) return;
    for (const { entry, content, sha256 } of this.mirrors.values()) {
      if (this.proposed.has(this.key(entry))) continue;
      try {
        const changed = await mirroredText(this.root, entry);
        if (changed !== null && changed !== content) {
          this.keepProposal(await this.file('propose', entry, { content: changed, expected_sha256: sha256 }), entry);
        }
      } catch {
        // Missing, moved, or concurrently changed sources cannot become proposals.
      }
    }
  }

  async dispose() {
    await this.queue;
    if (!this.root) return;
    try {
      if (await realpath(this.root) === this.root) await rm(this.root, { recursive: true, force: true });
    } catch {
      // Exposed scratch may have been removed or redirected by the adapter.
    }
  }
}

module.exports = { AcpProjectTurn, createProjectClient, mayPropose, promptBlocks, projectFileTools, projectPath,
  FILE_TOOLS, READ_FILE, PROPOSE_FILE, CREATE_FILE };
