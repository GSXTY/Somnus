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
const FILE_TOOLS = new Set([READ_FILE, PROPOSE_FILE]);
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
  if (mayPropose(prepared)) tools.push(schema(PROPOSE_FILE,
    '保存现有文件的修改候选，等待用户在 Somnus 审核应用。返回待审核状态。先读取原文和 sha256。',
    { ...pathFields, expected_sha256: { type: 'string' }, new_content: { type: 'string', description: '完整的文件替换文本。' } },
    ['source', 'path', 'expected_sha256', 'new_content']));
  return tools;
}

function mayPropose(prepared) {
  return ['workspace_write', 'full'].includes(prepared?.permission_mode);
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
      headers: { 'X-Data-Agent-Native': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new AcpError(action === 'prepare'
          ? '本机服务无法准备附件、Skill 或项目上下文，请检查当前对话授权。'
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
  return {
    companyEndpoint,
    async companyReady(modelId) {
      const endpoint = new URL('/api/assistant/company-runtime', origin);
      if (modelId != null) endpoint.searchParams.set('model_id', modelId);
      try {
        const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(3000),
          headers: { 'X-Data-Agent-Native': token } });
        return response.ok && (await response.json()).ready === true;
      } catch {
        return false;
      }
    },
    prepare: ({ agentId, conversationId, turnId }, signal) =>
      backendRequest(origin, token, conversationId, turnId, 'prepare', { agent_id: agentId }, signal),
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
      '\n临时视图最多包含 12 个文件。对现有副本的修改会在授权允许时提交候选，实际项目文件需在 Somnus 审批。';
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
  }

  async mcpFile(name, args, signal) {
    const allowed = name === READ_FILE ? ['source', 'path'] : ['source', 'path', 'expected_sha256', 'new_content'];
    const entry = projectPath(args.source, args.path);
    if (!entry || !this.prepared.project_sources?.some(item => item.source === entry.source) ||
        Object.keys(args).some(key => !allowed.includes(key))) throw new AcpError('项目文件路径超出授权范围。');
    const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
    if (name === READ_FILE) {
      const reply = await this.file('read', entry, {}, signal);
      return result({ source: entry.source, path: entry.path, content: reply.content, sha256: reply.sha256 });
    }
    if (!mayPropose(this.prepared) || typeof args.new_content !== 'string' ||
        Buffer.byteLength(args.new_content) > PROJECT_TEXT_LIMIT ||
        typeof args.expected_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(args.expected_sha256)) {
      throw new AcpError('请先读取项目文件，并提交完整替换文本和对应版本。');
    }
    const work = this.queue.then(async () => {
      signal.throwIfAborted();
      if (this.proposed.has(this.key(entry))) throw new AcpError('此文件已有本轮待审批候选。');
      this.keepProposal(await this.file('propose', entry, { content: args.new_content, expected_sha256: args.expected_sha256 }, signal), entry);
      return result({ source: entry.source, path: entry.path, proposal_id: this.proposals.at(-1).id, status: 'pending' });
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
  FILE_TOOLS, READ_FILE, PROPOSE_FILE };
