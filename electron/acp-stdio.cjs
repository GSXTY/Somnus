const { spawn } = require('node:child_process');

const MAX_LINE = 4 * 1024 * 1024;

function requestTimeoutError(method) {
  const stage = {
    initialize: '启动外部 Agent 超时，请稍后重试或在配置中心检查运行时。',
    'session/new': '外部 Agent 创建会话超时，请检查本机运行时和 MCP 连接后重试。',
    'session/set_model': '外部 Agent 切换模型超时，请检查模型是否可用后重试。',
    'session/set_config_option': '外部 Agent 应用会话设置超时，请重试。',
    authenticate: '外部 Agent 登录等待超时，请重新登录。',
  };
  return new AcpError(stage[method] || '等待外部 Agent 响应超时。', 'ACP_REQUEST_TIMEOUT');
}

function processEnvironment() {
  // Pass system settings here. Managed adapters receive their own authentication scope below.
  const allowed = new Set([
    'ALLUSERSPROFILE', 'APPDATA', 'COMSPEC', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
    'LANG', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'OS', 'PATH', 'PATHEXT',
    'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA', 'PROGRAMFILES',
    'PROGRAMFILES(X86)', 'PROGRAMW6432', 'SYSTEMDRIVE', 'SYSTEMROOT',
    'TEMP', 'TMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR',
  ]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}

class AcpError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

class AcpStdio {
  constructor(executable, args, cwd, onUpdate, onExit = () => {},
    { codexHome, codexMode, codeBuddyHome, dshHome, companyModelToken, onAuthUrl, onFile, onPermission, onCancelPermission } = {}) {
    this.pending = new Map();
    this.sequence = 0;
    this.onUpdate = onUpdate;
    this.onExit = onExit;
    this.onAuthUrl = onAuthUrl;
    this.onFile = onFile;
    this.onPermission = onPermission;
    this.onCancelPermission = onCancelPermission;
    this.buffer = '';
    this.child = spawn(executable, args, {
      cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        ...processEnvironment(),
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        ...(codexMode ? { INITIAL_AGENT_MODE: codexMode } : {}),
        ...(codeBuddyHome ? { CODEBUDDY_CONFIG_DIR: codeBuddyHome } : {}),
        ...(dshHome ? {
          DSH_HOME: dshHome,
          DSH_TELEMETRY_DISABLED: '1',
          ...(companyModelToken ? { VVMAN_COMPANY_MODEL_TOKEN: companyModelToken } : {}),
        } : {}),
      },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.read(chunk));
    this.child.stdin.on('error', () => this.stop(new AcpError('外部 Agent 连接已断开。')));
    this.child.once('error', () => this.stop(new AcpError('无法启动外部 Agent，请确认程序仍在原位置。')));
    this.child.once('exit', () => this.stop(new AcpError('外部 Agent 已退出，请检查它的登录状态和启动参数。')));
    this.exited = new Promise(resolve => this.child.once('close', resolve));
  }

  read(chunk) {
    if (this.failure) return;
    this.buffer += chunk;
    while (this.buffer.length) {
      const next = this.buffer.indexOf('\n');
      if (next > MAX_LINE || (next < 0 && this.buffer.length > MAX_LINE)) {
        this.stop(new AcpError('ACP 消息超出大小限制。'));
        return;
      }
      if (next < 0) return;
      const line = this.buffer.slice(0, next).trimEnd();
      this.buffer = this.buffer.slice(next + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.stop(new AcpError('程序输出不是 ACP v1 JSON-RPC，请确认已启用 ACP 模式。'));
        return;
      }
      if (!message || message.jsonrpc !== '2.0') {
        this.stop(new AcpError('程序返回了无效的 ACP 消息。'));
        return;
      }
      this.handle(message);
      if (this.failure) return;
    }
  }

  handle(message) {
    if (typeof message.method === 'string') {
      if (!Object.hasOwn(message, 'id')) {
        if (message.method === 'session/update') this.onUpdate(message.params);
        else if (message.method === '$/cancel_request' || message.method === '$/cancelRequest') {
          this.onCancelPermission?.(message.params?.requestId ?? message.params?.id);
        }
      } else if (message.method === 'session/request_permission') {
        const refused = { outcome: 'cancelled' };
        void Promise.resolve().then(() => this.onPermission?.(message.id, message.params)).then(
          outcome => this.send({ id: message.id, result: { outcome: outcome || refused } }),
          () => this.send({ id: message.id, result: { outcome: refused } }),
        );
      } else if (this.onFile && ['fs/read_text_file', 'fs/write_text_file'].includes(message.method)) {
        void Promise.resolve().then(() => this.onFile(message.method, message.params)).then(
          result => this.send({ id: message.id, result }),
          error => this.send({ id: message.id, error: {
            code: -32001, message: error instanceof AcpError ? error.message : 'Project file operation unavailable',
          } }),
        );
      } else if (message.method === 'elicitation/create' && this.onAuthUrl) {
        const { params, id } = message;
        if (params?.mode !== 'url') {
          this.send({ id, error: { code: -32602, message: 'Only URL elicitation is available' } });
        } else if (params.sessionId != null || this.pending.get(params.requestId)?.method !== 'authenticate') {
          this.send({ id, result: { action: 'decline' } });
        } else {
          void Promise.resolve().then(() => this.onAuthUrl(params, () =>
            !this.failure && this.pending.get(params.requestId)?.method === 'authenticate')).then(
            action => this.send({ id, result: { action } }),
            () => this.send({ id, result: { action: 'cancel' } }),
          );
        }
      } else {
        this.send({ id: message.id, error: { code: -32601, message: 'Client capability unavailable' } });
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.deadline);
    if (message.error) {
      const code = message.error.code;
      const missingDshKey = /no API key for provider route/.test(String(message.error.message || ''));
      const label = missingDshKey
        ? 'DSH 当前模型路由缺少授权。请在 Agent 配置中刷新 DeepSeek 登录账户并选择账户模型。'
        : code === -32000
        ? '外部 Agent 需要登录或重新验证。请在 Agent 设置中检查登录方式。'
        : '外部 Agent 未完成此请求，请检查它的启动参数和登录状态。';
      pending.reject(new AcpError(label, code));
    } else {
      pending.resolve(message.result);
    }
  }

  send(fields) {
    if (this.failure) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...fields }) + '\n');
  }

  request(method, params, timeout) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const deadline = timeout == null ? undefined :
        setTimeout(() => this.stop(requestTimeoutError(method)), timeout);
      this.pending.set(id, { resolve, reject, deadline, method });
      this.send({ id, method, params });
    });
  }

  stop(error = new AcpError('外部 Agent 连接已关闭。')) {
    if (this.failure) return;
    this.failure = error;
    for (const request of this.pending.values()) {
      clearTimeout(request.deadline);
      request.reject(error);
    }
    this.pending.clear();
    this.child.stdin.destroy();
    if (this.child.exitCode === null) this.child.kill();
    this.onExit();
  }
}

module.exports = { AcpStdio, AcpError, processEnvironment };
