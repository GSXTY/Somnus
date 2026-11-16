const { createHash, randomUUID } = require('node:crypto');
const { readFile, rename, rm, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { trustWorkbench } = require('./project-folders.cjs');

const requestTimeout = 12000;
const responseLimit = 4_000_000;
const maxPrompt = 4000;
const taskId = /^task_[A-Za-z0-9_-]{6,128}$/;

function relayOrigin(value, localDev = false) {
  const url = typeof value === 'string' && value.length <= 2048 ? URL.parse(value.trim()) : null;
  const local = url?.hostname === '127.0.0.1' || url?.hostname === '[::1]';
  if (!url || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(localDev && local && url.protocol === 'http:'))) {
    return null;
  }
  return url.origin;
}

async function readLocalJson(filename, maxBytes) {
  try {
    if ((await stat(filename)).size > maxBytes) throw new Error('Dot 配置文件过大。');
    return JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function resolveRelayConfig(profileDir, env = process.env) {
  const saved = await readLocalJson(path.join(profileDir, 'somnus-dot-relay.json'), 4096);
  const configured = env.SOMNUS_DOT_RELAY_URL || saved?.url;
  if (!configured) return null;
  const origin = relayOrigin(configured, env.SOMNUS_DOT_RELAY_LOCAL_DEV === '1');
  if (!origin) throw new Error('Dot 中继地址需要使用 HTTPS。');
  const install = URL.parse(env.SOMNUS_DOT_INSTALL_URL || saved?.install_url || '');
  const installUrl = install?.origin === 'https://chatgpt.com' && !install.username && !install.password ? install.href : undefined;
  return { origin, installUrl, localDev: origin.startsWith('http:') };
}

async function readRelayJson(response) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > responseLimit) throw new Error('Dot 响应过大。');
      chunks.push(value);
    }
    const body = Buffer.concat(chunks, total).toString('utf8');
    return body ? JSON.parse(body) : {};
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function publicTask(task) {
  if (!task || !taskId.test(task.id) || typeof task.status !== 'string') throw new Error('Dot 返回了无效任务。');
  return {
    id: task.id, status: task.status,
    prompt: typeof task.prompt === 'string' ? task.prompt.slice(0, maxPrompt) : '',
    result: typeof task.result === 'string' ? task.result.slice(0, 20000) : null,
    error: typeof task.error === 'string' ? task.error.slice(0, 300) : null,
    created_at: typeof task.created_at === 'string' ? task.created_at : '',
  };
}

function createRelayClient({ profileDir, origin, installUrl, localDev = false, safeStorage, fetchRequest = fetch }) {
  const digest = createHash('sha256').update(origin).digest('hex').slice(0, 24);
  const filename = path.join(profileDir, `somnus-dot-relay-${digest}.json`);
  let tail = Promise.resolve();
  let state;

  async function load() {
    if (!state) {
      try {
        state = await readLocalJson(filename, responseLimit) ?? { paused: false, links: {} };
      } catch {
        throw new Error('无法读取本机 Dot 配对存储。');
      }
    }
    return state;
  }

  function assertSecureStorage() {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('系统凭据存储暂不可用，无法保存 Dot 配对。');
    }
  }

  function seal(value) {
    assertSecureStorage();
    return safeStorage.encryptString(value).toString('base64');
  }

  function unseal(value) {
    assertSecureStorage();
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      throw new Error('无法读取本机 Dot 配对，请重新连接。');
    }
  }

  async function save(next) {
    const temp = filename + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      await rename(temp, filename);
      state = next;
    } catch {
      throw new Error('无法保存本机 Dot 配对。');
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }

  async function request(endpoint, { method = 'GET', token, payload } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetchRequest(origin + endpoint, {
        method, headers, redirect: 'error', signal: AbortSignal.timeout(requestTimeout),
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if ([401, 403].includes(response.status)) throw new Error('auth');
        if (response.status === 429) throw new Error('rate');
        throw new Error('request');
      }
      return await readRelayJson(response);
    } catch (error) {
      if (error.message === 'auth') throw Object.assign(new Error('Dot 配对已失效，请断开后重新连接。'), { code: 'DOT_AUTH' });
      if (error.message === 'rate') throw new Error('Dot 请求较多，请稍后重试。');
      throw new Error('暂时无法连接 Dot 中继，请稍后重试。');
    }
  }

  function localStatus(current, paired = false, ready = false) {
    return {
      mode: 'hosted', endpoint: origin + '/mcp',
      local_dev: localDev,
      ...(installUrl ? { install_url: installUrl } : {}),
      enabled: Boolean(current.token) && !current.paused,
      ready: ready && !current.paused,
      paused: current.paused === true,
      paired,
    };
  }

  async function getState() {
    const current = await load();
    if (!current.token) return localStatus(current);
    try {
      const { paired, ready, paused } = await request('/api/status', { token: unseal(current.token) });
      const status = localStatus({ ...current, paused: paused === true }, paired === true, ready === true);
      if (!status.paired && current.pairingCode && Number.isFinite(Date.parse(current.expiresAt)) &&
          Date.parse(current.expiresAt) > Date.now()) {
        status.pairing_code = unseal(current.pairingCode);
        status.expires_at = current.expiresAt;
      }
      return status;
    } catch (error) {
      return { ...localStatus(current), error: error.message };
    }
  }

  function conversation(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('无效的 Dot 会话。');
    return value;
  }

  const actions = {
    getState,
    async startPairing() {
      const current = await load();
      assertSecureStorage();
      if (current.token && (await getState()).paired) throw new Error('Dot 已连接。请先断开现有配对。');
      const token = current.token ? unseal(current.token) : undefined;
      const pair = await request(current.token ? '/api/pairs/code' : '/api/pairs',
        { method: 'POST', token, payload: {} });
      const newToken = pair.desktop_token ?? token;
      if (typeof newToken !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(newToken) ||
          typeof pair.pairing_code !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(pair.pairing_code) ||
          typeof pair.expires_at !== 'string' || !Number.isFinite(Date.parse(pair.expires_at))) {
        throw new Error('Dot 中继返回了无效配对。');
      }
      const next = { ...current, token: seal(newToken), paused: false,
        pairingCode: seal(pair.pairing_code), expiresAt: pair.expires_at };
      await save(next);
      return { ...localStatus(next), pairing_code: pair.pairing_code, expires_at: pair.expires_at };
    },
    async setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('无效的 Dot 设置。');
      const current = await load();
      if (!current.token) return localStatus(current);
      const { paused, paired, ready } = await request('/api/enabled', {
        method: 'POST', token: unseal(current.token), payload: { enabled },
      });
      const next = { ...current, paused: paused === true };
      await save(next);
      return localStatus(next, paired === true, ready === true);
    },
    async listTasks(conversationId) {
      const id = conversation(conversationId);
      const current = await load();
      const status = await getState();
      if (!current.token || !status.paired || !Object.values(current.links).includes(id)) return { ...status, tasks: [] };
      const data = await request('/api/tasks', { token: unseal(current.token) });
      if (!Array.isArray(data.tasks)) throw new Error('Dot 返回了无效任务列表。');
      const tasks = data.tasks.filter(task => task && current.links[task.id] === id).map(publicTask);
      return { ...status, tasks };
    },
    async createTask(conversationId, input) {
      const id = conversation(conversationId);
      const prompt = typeof input === 'string' ? input.trim() : '';
      if (!prompt || prompt.length > maxPrompt) throw new Error('请输入 1–4000 个字符的 Dot 任务。');
      const current = await load();
      if (!current.token || current.paused) throw new Error('请先连接并开启 Dot。');
      const result = await request('/api/tasks', { method: 'POST', token: unseal(current.token), payload: { prompt } });
      const task = publicTask(result.task);
      await save({ ...current, links: { ...current.links, [task.id]: id } });
      return { task };
    },
    async disconnect() {
      const current = await load();
      if (current.token) {
        try {
          await request('/api/pairs/current', { method: 'DELETE', token: unseal(current.token) });
        } catch (error) {
          if (error.code !== 'DOT_AUTH') throw error;
        }
      }
      await save({ paused: false, links: {} });
      return localStatus(state);
    },
  };

  return Object.fromEntries(Object.entries(actions).map(([action, perform]) => [action, (...args) => {
    const pending = tail.then(() => perform(...args));
    tail = pending.catch(() => {});
    return pending;
  }]));
}

function registerDotRelay({ ipcMain, window, origin, profileDir, safeStorage }) {
  let client;
  const unconfigured = { mode: 'unconfigured', enabled: false, ready: false, paused: false, paired: false };
  const resolve = async () => {
    const config = await resolveRelayConfig(profileDir);
    if (!config) return null;
    const key = JSON.stringify(config);
    if (client?.key !== key) client = { key, actions: createRelayClient({ profileDir, ...config, safeStorage }) };
    return client.actions;
  };
  for (const action of ['getState', 'startPairing', 'setEnabled', 'listTasks', 'createTask', 'disconnect']) {
    const channel = 'somnus-dot-relay:' + action;
    ipcMain.handle(channel, async (event, ...args) => {
      trustWorkbench(event, window, origin);
      const adapter = await resolve();
      if (adapter) return adapter[action](...args);
      if (action === 'getState') return unconfigured;
      throw new Error('尚未配置 Dot 中继地址。');
    });
    window.once('closed', () => ipcMain.removeHandler(channel));
  }
}

module.exports = { createRelayClient, registerDotRelay, relayOrigin, resolveRelayConfig };
