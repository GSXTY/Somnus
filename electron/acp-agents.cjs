const { randomBytes, randomUUID } = require('node:crypto');
const { mkdir, mkdtemp, readFile, realpath, rename, rmdir, stat, unlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AcpStdio, AcpError } = require('./acp-stdio.cjs');
const { detectManagedCodex, detectManagedCodeBuddy, matchesLaunch } = require('./acp-discovery.cjs');
const { modelSummary, reasoningCatalog, sessionModels, setSessionModel, setSessionReasoning, updateSessionConfig,
  validEffort, validId } = require('./acp-models.cjs');
const { AcpProjectTurn, mayPropose, promptBlocks, projectFileTools, FILE_TOOLS, READ_FILE, PROPOSE_FILE } = require('./acp-project.cjs');
const { SessionMcp, toolCatalog, catalogSignature, MAX_CALLS } = require('./acp-mcp.cjs');
const { AcpLive, permissionOptions, priorTranscript, APPROVAL_QUEUE_LIMIT } = require('./acp-live.cjs');
const { AcpDeadline } = require('./acp-deadline.cjs');
const { TEST_TOOL, DIFF_TOOL } = require('./acp-project-workflow.cjs');
const { DshRecommendation, RECOMMENDATIONS } = require('./acp-dsh-recommendations.cjs');
const { AGENT_ID: COMPANY_AGENT_ID, companyProfile, removeCompanyProfile } = require('./acp-company.cjs');

const STARTUP_TIMEOUT = 20_000;
const BROWSER_LOGIN_TIMEOUT = 5 * 60_000;
const IDLE_TIMEOUT = 10 * 60_000;
const MAX_REPLY = 1024 * 1024;
const MAX_CONVERSATIONS = 8;
const MAX_CONCURRENT_TURNS = 4;
const DELEGATION_TIMEOUT = 55_000;
const MAX_DELEGATION_REPLY = 12_000;
const EXTERNAL_WORKSPACE_POLICY = '\n\nSomnus 不会批准任意终端或 Shell 命令。请使用本轮获授权的项目文件工具，并通过修改候选提交对原文件的更改。';
const PROJECT_PREFLIGHT_TOOLS = new Set([TEST_TOOL, DIFF_TOOL, READ_FILE, PROPOSE_FILE, 'search_project_files']);

const tokenCount = value => Number.isSafeInteger(value) && value >= 0;

function acpPromptUsage(usage) {
  const { inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens } = usage || {};
  if (!tokenCount(inputTokens) || !tokenCount(outputTokens)) return undefined;
  const cached = tokenCount(cachedReadTokens) ? cachedReadTokens : undefined;
  const written = tokenCount(cachedWriteTokens) ? cachedWriteTokens : 0;
  // ACP reports cache reads and writes separately from uncached input.
  const input = inputTokens + (cached ?? 0) + written;
  if (!tokenCount(input)) return undefined;
  return { input_tokens: input, output_tokens: outputTokens,
    ...(cached !== undefined ? { cached_input_tokens: cached } : {}) };
}

async function executablePath(input) {
  if (typeof input !== 'string' || input.length > 1024 || !path.isAbsolute(input) ||
      !input.toLowerCase().endsWith('.exe') || input.startsWith('\\\\')) {
    throw new AcpError('请选择已安装的本机 .exe 程序。');
  }
  try {
    const resolved = await realpath(input);
    if (resolved.startsWith('\\\\') || !resolved.toLowerCase().endsWith('.exe') || !(await stat(resolved)).isFile()) {
      throw new Error('Local executable required');
    }
    return resolved;
  } catch {
    throw new AcpError('无法访问选中的本机程序。');
  }
}

function cleanProfile(profile, id, executable) {
  const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
  const args = profile?.args;
  if (!name || name.length > 80 || !Array.isArray(args) || args.length > 32 ||
      args.some(argument => typeof argument !== 'string' || argument.length > 1000 || /[\0\r\n]/.test(argument))) {
    throw new AcpError('请输入代理名称，每个启动参数单独一项。');
  }
  return { id, name, executable, args: args.slice() };
}

function agentProvider(name) {
  if (['@agentclientprotocol/codex-acp', '@zed-industries/codex-acp', 'codex-acp', 'codex'].includes(name)) return 'codex';
  if (name === 'dsh-acp' || name === 'deepseek-harness-acp') return 'deepseek-harness';
  return 'custom';
}

function offeredLoginMethods(methods, provider, codeBuddy) {
  const loginMethods = new Map();
  for (const method of methods) {
    const id = method?.id;
    if (typeof id !== 'string' || !/^[\w.:-]{1,96}$/.test(id) || loginMethods.has(id)) continue;
    if (method.type && method.type !== 'agent') continue;
    if (id === 'gateway' || id === 'terminal-login' || id.startsWith('terminal-login:')) continue;
    if (id === 'api-key' || id.startsWith('api-key:') || Object.hasOwn(method._meta ?? {}, 'api-key')) continue;
    let kind;
    if (provider === 'codex' && (id === 'chat-gpt' || id === 'chatgpt')) kind = 'browser';
    if (provider === 'custom') kind = codeBuddy && ['internal', 'external'].includes(id) ? 'browser' : 'agent';
    if (!kind) continue;
    loginMethods.set(id, {
      id,
      name: typeof method.name === 'string' ? method.name.slice(0, 120) : id,
      kind,
      ...(typeof method.description === 'string' ? { description: method.description.slice(0, 240) } : {}),
    });
  }
  return [...loginMethods.values()];
}

class AcpAgents {
  constructor(profileFile, version, resourcesPath = process.resourcesPath, openAuthUrl, projectClient, workflow, dshMarket) {
    this.file = profileFile;
    this.version = version;
    this.resourcesPath = resourcesPath;
    this.openAuthUrl = openAuthUrl;
    this.projectClient = projectClient;
    this.workflow = workflow;
    this.dshMarket = dshMarket;
    this.queue = Promise.resolve();
    this.active = null;
    this.conversations = new Map();
    this.turns = new Map();
    this.accountOperation = null;
    this.discoveries = new Map();
    this.discoveryQueue = Promise.resolve();
  }

  async readProfiles() {
    try {
      const info = await stat(this.file);
      if (info.size > 1024 * 1024) throw new Error('Profile file too large');
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length > 24) throw new Error('Invalid ACP profile file');
      return parsed.map(profile => cleanProfile(profile, profile.id, profile.executable));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new AcpError('无法读取外部 Agent 配置，请检查本机设置文件。');
    }
  }

  list() {
    return this.queue.then(() => this.readProfiles());
  }

  async listDelegationAgents() {
    const [profiles, codex, dsh] = await Promise.all([
      this.list(), detectManagedCodex(this.resourcesPath), this.dshMarket?.launch(),
    ]);
    return profiles.filter(profile => profile.id !== COMPANY_AGENT_ID &&
      (matchesLaunch(profile, codex) || matchesLaunch(profile, dsh)))
      .map(({ id, name }) => ({ id, name }));
  }

  change(update) {
    const operation = this.queue.then(async () => {
      const profiles = await this.readProfiles();
      const result = await update(profiles);
      const candidate = this.file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(candidate, JSON.stringify(profiles, null, 2), { flag: 'wx' });
        await rename(candidate, this.file);
      } finally {
        await unlink(candidate).catch(() => {});
      }
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  save(profile) {
    return this.change(async profiles => {
      const id = profile?.id ?? randomUUID();
      const index = profiles.findIndex(item => item.id === id);
      if (profile?.id !== undefined && index === -1) throw new AcpError('找不到外部 Agent。');
      if (this.turns.size || this.accountOperation) {
        throw new AcpError('请等当前请求完成后再修改代理。');
      }
      const saved = cleanProfile(profile, id, await executablePath(profile?.executable));
      if (this.turns.size || this.accountOperation) {
        throw new AcpError('请等当前请求完成后再修改代理。');
      }
      if (index >= 0) profiles.splice(index, 1, saved);
      else if (profiles.length < 24) profiles.push(saved);
      else throw new AcpError('自定义代理已达到 24 项上限。');
      this.closeAgentSessions(id);
      return saved;
    });
  }

  async validate(profile) {
    return cleanProfile(profile, profile?.id, await executablePath(profile?.executable));
  }

  remove(id) {
    return this.change(profiles => {
      const index = profiles.findIndex(item => item.id === id);
      if (index < 0) throw new AcpError('找不到外部 Agent。');
      if (this.turns.size || this.accountOperation) {
        throw new AcpError('请等当前请求完成后再移除代理。');
      }
      profiles.splice(index, 1);
      this.closeAgentSessions(id);
    });
  }

  async profile(id) {
    if (id === COMPANY_AGENT_ID) {
      const profile = await this.dshMarket?.launch();
      if (!profile) throw new AcpError('公司 Agent 运行时未就绪。');
      return { ...profile, id, name: '公司默认' };
    }
    const profile = (await this.list()).find(item => item.id === id);
    if (!profile) throw new AcpError('找不到外部 Agent。');
    const resolved = await executablePath(profile.executable);
    if (resolved.toLowerCase() !== profile.executable.toLowerCase()) {
      throw new AcpError('外部 Agent 的程序位置已变更，请重新选择。');
    }
    return profile;
  }

  async connect(profile, owner, requireManaged = false) {
    const isCompany = profile.id === COMPANY_AGENT_ID;
    const [managed, managedCodeBuddy, managedDsh] = await Promise.all([
      detectManagedCodex(this.resourcesPath), detectManagedCodeBuddy(this.resourcesPath), this.dshMarket?.launch(),
    ]);
    const isManaged = matchesLaunch(profile, managed);
    const isManagedDsh = matchesLaunch(profile, managedDsh);
    const dshProfile = isManagedDsh ? await this.dshMarket.profile() : null;
    if ((isManagedDsh || await this.dshMarket?.ownsLaunch(profile)) && !dshProfile) {
      throw new AcpError('独立的 DeepSeek Harness ACP 配置不可用，请检查托管运行时。');
    }
    const projectAccess = Boolean(owner.project?.prepared.project?.available);
    const workspaceWrite = projectAccess && mayPropose(owner.project.prepared);
    const codeBuddy = profile.args.includes('--acp') &&
      (path.basename(profile.executable).toLowerCase() === 'codebuddy.exe' ||
       /[\\/]@tencent-ai[\\/]codebuddy-code[\\/]bin[\\/]codebuddy$/i.test(profile.args[0] || ''));
    if (requireManaged && !isManaged) throw new AcpError('随附的 Codex 组件已变更，请重新连接。');
    const codexHome = isManaged ? path.join(path.dirname(this.file), 'codex-home') : undefined;
    const codeBuddyHome = matchesLaunch(profile, managedCodeBuddy) ?
      path.join(path.dirname(this.file), 'codebuddy-home') : undefined;
    if (codexHome) await mkdir(codexHome, { recursive: true });
    if (codeBuddyHome) await mkdir(codeBuddyHome, { recursive: true });
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-')));
    if (this.closed || owner.cancelled) {
      await rmdir(cwd).catch(() => {});
      throw new AcpError('已取消外部 Agent 请求。');
    }
    let company;
    if (isCompany) {
      try {
        company = await companyProfile(cwd, dshProfile, owner.project?.prepared.company_model,
          this.projectClient.companyEndpoint(owner.conversationId, owner.turnId));
      } catch (error) {
        await removeCompanyProfile(cwd).catch(() => {});
        await rmdir(cwd).catch(() => {});
        throw error;
      }
    }
    const current = { agentId: profile.id, conversationId: owner.conversationId, cwd, sessionId: null, idle: null,
      projectAccess, workspaceWrite, managedCodex: isManaged, managedDsh: isManagedDsh,
      dshRecommendations: (company?.bundles ?? dshProfile?.bundles)?.includes(RECOMMENDATIONS) === true };
    current.connection = new AcpStdio(profile.executable, profile.args, cwd, params => this.update(current, params), () => {
      current.mcp?.close();
      if (this.active === current) this.active = null;
      if (this.conversations.get(current.conversationId) === current) {
        this.conversations.delete(current.conversationId);
      }
      clearTimeout(current.idle);
    }, {
      codexHome, codeBuddyHome,
      dshHome: company?.home ?? (isManagedDsh ? this.dshMarket.home : undefined),
      companyModelToken: company?.token,
      codexMode: isManaged && owner.turnId ? (workspaceWrite ? 'workspace-write' : 'read-only') : undefined,
      onFile: projectAccess && ((method, params) => {
        const active = this.activeTurn(current);
        if (!active || !current.sessionId || params?.sessionId !== current.sessionId ||
            !active.project || active.cancelled || !active.projectRequestsReady) {
          throw new AcpError('当前会话没有项目文件授权。');
        }
        return active.project.request(method, params);
      }),
      onAuthUrl: !owner.delegation && this.openAuthUrl && ((params, isPending) =>
        this.openAuthUrl(profile, current.authTarget, params, isPending)),
      onPermission: (id, params) => this.requestPermission(current, id, params),
      onCancelPermission: id => {
        this.activeTurn(current)?.wirePermissions?.get(id)?.abort();
      },
    });
    void current.connection.exited.then(async () => {
      if (company) await removeCompanyProfile(cwd).catch(() => {});
      await rmdir(cwd).catch(() => {});
    });
    owner.current = current;
    try {
      const reply = await current.connection.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          ...(!owner.delegation && this.openAuthUrl ? { elicitation: { url: {} } } : {}),
          ...(projectAccess ? { fs: { readTextFile: true, writeTextFile: workspaceWrite } } : {}),
        },
        clientInfo: { name: 'vv-man', title: 'Somnus', version: this.version },
      }, STARTUP_TIMEOUT);
      if (reply?.protocolVersion !== 1) throw new AcpError('程序没有协商到 ACP v1。');
      const agentName = reply.agentInfo?.name;
      const provider = agentProvider(agentName);
      const methods = Array.isArray(reply.authMethods) ? reply.authMethods.slice(0, 20) : [];
      current.promptCapabilities = reply.agentCapabilities?.promptCapabilities;
      current.mcpHttp = reply.agentCapabilities?.mcpCapabilities?.http === true;
      current.authTarget = codeBuddy ? 'codebuddy' : null;
      const loginMethods = offeredLoginMethods(methods, provider, codeBuddy);
      return {
        current,
        accountCheck: agentName === 'deepseek-harness-acp' && methods.length === 0 ? 'unverified' : 'ready',
        info: {
          name: typeof reply.agentInfo?.title === 'string' ? reply.agentInfo.title.slice(0, 160) :
            (typeof reply.agentInfo?.name === 'string' ? reply.agentInfo.name.slice(0, 160) : profile.name),
          version: typeof reply.agentInfo?.version === 'string' ? reply.agentInfo.version.slice(0, 80) : '',
          provider,
          authMethods: loginMethods.map(method => method.name),
          loginMethods,
        },
      };
    } catch (error) {
      current.connection.stop();
      throw error;
    }
  }

  async startSession(current, openingTurn) {
    const mcpServers = [];
    if (openingTurn?.tools.length) {
      const owner = () => {
        const turn = this.activeTurn(current);
        return turn?.toolsReady && !turn.cancelled ? turn : null;
      };
      const mcp = new SessionMcp(openingTurn.tools, owner, (turn, params, signal) => {
        if (FILE_TOOLS.has(params.name)) return turn.project.mcpFile(params.name, params.arguments, signal);
        if ([TEST_TOOL, DIFF_TOOL].includes(params.name)) return this.workflow.tool(turn, this.projectClient, params, signal);
        return this.projectClient.tool(turn, params, signal);
      }, openingTurn.signal);
      current.mcp = mcp;
      await mcp.listen();
      // Codex can prefer a same-named server from its own config. Scope the
      // preflight exception to this session's newly assigned endpoint name.
      current.mcpName = current.managedCodex && openingTurn.tools.some(tool => PROJECT_PREFLIGHT_TOOLS.has(tool.name))
        ? 'vv_man_' + randomBytes(12).toString('hex') : 'vv_man';
      mcpServers.push(mcp.descriptor(current.mcpHttp, current.mcpName));
    }
    const reply = await current.connection.request('session/new', { cwd: current.cwd, mcpServers }, STARTUP_TIMEOUT);
    if (typeof reply?.sessionId !== 'string' || !reply.sessionId || reply.sessionId.length > 4096) {
      throw new AcpError('外部 Agent 未返回有效的会话。');
    }
    current.sessionId = reply.sessionId;
    current.modelSelection = sessionModels(reply);
    updateSessionConfig(current, reply.configOptions);
  }

  async checkAccount(id, authenticate, expectedLaunch, discovery) {
    if (this.closed || this.turns.size || this.accountOperation || this.changingDshPlugins) {
      throw new AcpError('已有外部 Agent 请求正在运行。');
    }
    const operation = { cancelled: false, interactive: Boolean(authenticate) };
    this.accountOperation = operation;
    let current;
    try {
      const profile = await this.profile(id);
      if (expectedLaunch && !matchesLaunch(profile, expectedLaunch)) {
        throw new AcpError('Codex 启动配置已变更，请重新连接。');
      }
      const connection = await this.connect(profile, operation, Boolean(expectedLaunch));
      current = connection.current;
      if (operation.cancelled) throw new AcpError('已取消外部 Agent 登录或检查。');
      if (discovery) {
        await this.startSession(current);
        await setSessionModel(current, discovery.modelId, STARTUP_TIMEOUT);
        const { modelId, models } = current.modelSelection;
        return { agentId: id, modelId, models, ...reasoningCatalog(current) };
      }
      if (authenticate) await authenticate(current, connection.info);
      if (operation.cancelled) throw new AcpError('已取消外部 Agent 登录或检查。');
      try {
        await this.startSession(current);
        return { ...connection.info, authentication: connection.accountCheck };
      } catch (error) {
        if (error.code !== -32000 || operation.cancelled) throw error;
        return { ...connection.info, authentication: 'required' };
      }
    } catch (error) {
      if (operation.cancelled) throw new AcpError('已取消外部 Agent 登录或检查。');
      throw error;
    } finally {
      current?.connection.stop();
      if (this.accountOperation === operation) this.accountOperation = null;
    }
  }

  probe(id) {
    return this.checkAccount(id);
  }

  discoverModels(id, modelId) {
    if (!validId(id) || (modelId != null && !validId(modelId))) throw new AcpError('无效的外部 Agent 或模型。');
    const key = JSON.stringify([id, modelId ?? null]);
    if (this.discoveries.has(key)) return this.discoveries.get(key);
    const operation = this.discoveryQueue.then(() => this.checkAccount(id, undefined, undefined, { modelId }));
    this.discoveries.set(key, operation);
    this.discoveryQueue = operation.then(() => {}, () => {});
    const clear = () => this.discoveries.delete(key);
    void operation.then(clear, clear);
    return operation;
  }

  async authenticate(id, methodId, ...extra) {
    if (extra.length) throw new AcpError('请在 Provider 配置 API 密钥。');
    return this.authenticateWith(id, info => info.loginMethods.find(item => item.id === methodId));
  }

  connectCodex(id, expectedLaunch) {
    return this.authenticateWith(id, info => info.provider === 'codex'
      ? info.loginMethods.find(item => item.kind === 'browser' && ['chat-gpt', 'chatgpt'].includes(item.id))
      : undefined, expectedLaunch);
  }

  authenticateWith(id, selectMethod, expectedLaunch) {
    return this.checkAccount(id, async (current, info) => {
      const method = selectMethod(info);
      if (!method) throw new AcpError('当前 Agent 未提供此登录方式。');
      await current.connection.request('authenticate', { methodId: method.id }, BROWSER_LOGIN_TIMEOUT);
      this.closeAgentSessions(id);
    }, expectedLaunch);
  }

  cancelAuthentication() {
    const operation = this.accountOperation;
    if (!operation?.interactive) return;
    operation.cancelled = true;
    operation.current?.connection.stop();
  }

  activeTurn(current) {
    const turn = this.turns.get(current.conversationId);
    return turn?.current === current ? turn : undefined;
  }

  update(current, params) {
    if (!current.sessionId || params?.sessionId !== current.sessionId) return;
    const update = params.update;
    if (update?.sessionUpdate === 'config_option_update') {
      updateSessionConfig(current, update.configOptions);
      return;
    }
    const turn = this.activeTurn(current);
    if (!turn?.promptActive || turn.cancelled) return;
    if (update?.sessionUpdate === 'usage_update') {
      const { used, size } = update;
      if (turn.conversationId && tokenCount(used) && tokenCount(size) && size > 0 &&
          (turn.contextUsage?.used_tokens !== used || turn.contextUsage?.max_tokens !== size)) {
        turn.contextUsage = { used_tokens: used, max_tokens: size };
        turn.onUpdate({ agentId: turn.agentId, conversationId: turn.conversationId, text: '', contextUsage: turn.contextUsage });
      }
      return;
    }
    if (update?.sessionUpdate !== 'agent_message_chunk') {
      turn.recommendation?.observe(update);
      this.trackProjectPreflight(current, turn, update);
      turn.live?.update(update);
      return;
    }
    if (params.update.content?.type !== 'text') return;
    const text = params.update.content.text;
    if (typeof text !== 'string' || !text) return;
    if (turn.text.length + text.length > (turn.delegation ? MAX_DELEGATION_REPLY : MAX_REPLY)) {
      current.connection.stop(new AcpError('外部 Agent 回复超出大小限制。'));
      return;
    }
    turn.text += text;
    if (text.trim()) turn.deadline?.progress();
    turn.onUpdate({ agentId: turn.agentId, text,
      ...(turn.conversationId ? { conversationId: turn.conversationId } : {}) });
  }

  trackProjectPreflight(current, turn, update) {
    if (!current.managedCodex || !current.mcpName?.startsWith('vv_man_') ||
        !turn.toolsReady || !validId(update?.toolCallId)) return;
    const calls = turn.projectPreflights ||= new Map();
    const id = update.toolCallId;
    if (calls.has(id)) {
      if (update.status === 'completed' || update.status === 'failed') calls.set(id, false);
      return;
    }
    if (calls.size >= MAX_CALLS || update.sessionUpdate !== 'tool_call' || update.kind !== 'execute' ||
        !['pending', 'in_progress'].includes(update.status) || update._meta?.is_mcp_tool_call !== true ||
        update._meta.terminal_info != null) return;
    const input = update.rawInput;
    if (input?.server !== current.mcpName || !PROJECT_PREFLIGHT_TOOLS.has(input.tool) ||
        update.title !== `mcp.${current.mcpName}.${input.tool}`) return;
    const schema = current.mcp?.catalog.get(input.tool)?.inputSchema;
    const args = input.arguments;
    if (!schema || !args || typeof args !== 'object' || Array.isArray(args) ||
        (schema.required || []).some(key => !Object.hasOwn(args, key)) ||
        Object.entries(args).some(([key, value]) => !Object.hasOwn(schema.properties || {}, key) || typeof value !== 'string')) return;
    if (input.tool === TEST_TOOL && !schema.properties.preset_id?.oneOf?.some(preset => preset.const === args.preset_id)) return;
    calls.set(id, true);
  }

  async requestPermission(current, id, params) {
    const turn = this.activeTurn(current);
    if (!current.sessionId || !turn?.promptActive || !turn.projectRequestsReady ||
        !turn.live || turn.signal.aborted || turn.cancelled || current.connection.failure ||
        params?.sessionId !== current.sessionId || !['string', 'number'].includes(typeof id)) return null;
    const tool = params.toolCall;
    if (!validId(tool?.toolCallId)) return null;
    if (tool.kind === 'execute') {
      const isMcpApproval = params._meta?.is_mcp_tool_approval === true;
      if (isMcpApproval) {
        if (!current.managedCodex || !turn.toolsReady || tool.status !== 'pending' ||
            tool.rawInput != null || tool.locations != null || tool.content != null ||
            tool.title != null || tool.name != null || tool._meta != null ||
            turn.projectPreflights?.get(tool.toolCallId) !== true) return null;
        const allow = permissionOptions(params.options).some(option => option.id === 'allow_once' && option.kind === 'allow_once');
        if (!allow) return null;
        turn.projectPreflights.set(tool.toolCallId, false);
        // Passing the adapter's preflight only permits the loopback tool call.
        // Project tools still enforce authorization, apply review and test confirmation.
        return { outcome: 'selected', optionId: 'allow_once' };
      }
      if (!/[\u202a-\u202e\u2066-\u2069]/.test(tool.toolCallId)) turn.live.denyExecution(tool.toolCallId);
      return null;
    }
    if (!current.managedCodex || !current.workspaceWrite || !turn.project || tool.kind !== 'edit' ||
        tool.rawInput != null) return null;
    const options = permissionOptions(params.options);
    if (!options.some(option => option.kind === 'allow_once')) return null;
    const wirePermissions = turn.wirePermissions ||= new Map();
    if (wirePermissions.has(id) || wirePermissions.size >= APPROVAL_QUEUE_LIMIT) return null;
    const abort = new AbortController();
    wirePermissions.set(id, abort);
    const signal = AbortSignal.any([abort.signal, turn.signal]);
    const active = () => this.activeTurn(current) === turn && turn.promptActive && !signal.aborted && !current.connection.failure;
    let allowed = false;
    try {
      const paths = await turn.project.permissionFiles(tool.locations);
      if (!paths.length || !active()) return null;
      const title = '允许本次修改临时副本？' + ' ' + paths.join('、').slice(0, 290);
      const optionId = await turn.live.request({ title, kind: 'edit', options }, signal);
      if (!optionId || !active()) return null;
      const granting = options.find(option => option.id === optionId)?.kind === 'allow_once';
      if (granting && !(await turn.project.permissionFiles(tool.locations)).length) return null;
      if (!active()) return null;
      allowed = granting;
      return { outcome: 'selected', optionId };
    } finally {
      wirePermissions.delete(id);
      if (!allowed && active()) turn.live.update({
        sessionUpdate: 'tool_call_update', toolCallId: tool.toolCallId, title: '临时副本修改未获授权',
        kind: 'edit', status: 'failed',
      });
    }
  }

  respondPermission(conversationId, requestId, optionId) {
    const turn = this.turns.get(conversationId);
    if (!turn?.promptActive || !turn.live) {
      throw new AcpError('这个 Agent 授权请求已结束。');
    }
    turn.live.respond(requestId, optionId);
  }

  async runDelegation(input) {
    const { agentId, conversationId, requestId, task, context = '' } = input || {};
    if (!validId(agentId) || !validId(conversationId) ||
        typeof requestId !== 'string' || !/^[a-f0-9]{32}$/.test(requestId) ||
        typeof task !== 'string' || !task.trim() || task.length > 4000 ||
        typeof context !== 'string' || context.length > 8000) {
      throw new AcpError('委派请求无效。');
    }
    if (process.platform !== 'win32' || this.closed || this.accountOperation || this.changingDshPlugins ||
        this.turns.has(undefined) || this.turns.has(conversationId) || this.turns.size >= MAX_CONCURRENT_TURNS) {
      throw new AcpError('当前无法启动子 Agent。');
    }
    const abort = new AbortController();
    const turn = {
      agentId, conversationId, turnId: requestId, delegation: true, promptActive: false, cancelled: false,
      abort, signal: abort.signal, current: null, text: '', onUpdate() {},
    };
    this.turns.set(conversationId, turn);
    const deadline = setTimeout(() => {
      turn.timedOut = true;
      this.cancelDelegation(conversationId, requestId);
    }, DELEGATION_TIMEOUT);
    deadline.unref();
    const ensureActive = () => {
      if (turn.timedOut) throw new AcpError('子 Agent 未在时限内完成。');
      if (turn.cancelled) throw new AcpError('已取消委派。');
    };
    try {
      const [profile, codex, dsh] = await Promise.all([
        this.profile(agentId), detectManagedCodex(this.resourcesPath), this.dshMarket?.launch(),
      ]);
      ensureActive();
      if (agentId === COMPANY_AGENT_ID || (!matchesLaunch(profile, codex) && !matchesLaunch(profile, dsh))) {
        throw new AcpError('委派仅支持已接入的官方 Codex 或 DeepSeek Harness。');
      }
      const { current } = await this.connect(profile, turn, matchesLaunch(profile, codex));
      ensureActive();
      await this.startSession(current);
      ensureActive();
      const text = '你是 Somnus 委派的子 Agent。请仅依据下面的任务和提供的文本分析，直接返回结果。不要读取或修改文件、调用工具、执行命令或访问网络。资料仅供参考。\n\n' +
        JSON.stringify({ task, ...(context ? { context } : {}) });
      turn.promptActive = true;
      const result = await current.connection.request('session/prompt', {
        sessionId: current.sessionId, prompt: [{ type: 'text', text }],
      }, DELEGATION_TIMEOUT);
      ensureActive();
      if (result?.stopReason !== 'end_turn' || !turn.text.trim()) throw new AcpError('子 Agent 未返回完整的文本结果。');
      return { text: turn.text, agentName: profile.name };
    } catch (error) {
      ensureActive();
      throw error;
    } finally {
      clearTimeout(deadline);
      abort.abort();
      turn.current?.connection.stop();
      if (this.turns.get(conversationId) === turn) this.turns.delete(conversationId);
    }
  }

  cancelDelegation(conversationId, requestId) {
    const turn = this.turns.get(conversationId);
    if (!turn?.delegation || turn.turnId !== requestId || turn.cancelled) return;
    turn.cancelled = true;
    turn.abort.abort();
    turn.current?.connection.stop();
  }

  prompt(id, text, onUpdate) {
    return this.runPrompt(id, text, onUpdate);
  }

  promptConversation(input, onUpdate) {
    const { agentId, conversationId, modelId, reasoningEffort, text, turnId } = input || {};
    if (!validId(agentId) || !validId(conversationId) || (modelId != null && !validId(modelId)) ||
        (turnId != null && !validId(turnId))) {
      throw new AcpError('无效的外部 Agent 会话或模型。');
    }
    if (reasoningEffort != null && !validEffort(reasoningEffort)) throw new AcpError('无效的推理强度。');
    if (this.projectClient && !turnId) throw new AcpError('请先建立授权的外部 Agent 对话。');
    if (agentId === COMPANY_AGENT_ID && (!turnId || modelId != null)) {
      throw new AcpError('公司 Agent 使用管理员配置的模型。');
    }
    return this.runPrompt(agentId, text, onUpdate, conversationId, modelId, turnId, reasoningEffort);
  }

  closeAgentSessions(agentId) {
    if (this.active?.agentId === agentId) this.active.connection.stop();
    for (const session of this.conversations.values()) {
      if (session.agentId === agentId) session.connection.stop();
    }
  }

  async changeDshPlugins(id, enabled, validateSender, market = 'official', communityOptions) {
    if (this.closed || this.turns.size || this.accountOperation || this.changingDshPlugins) {
      throw new AcpError('请等当前外部 Agent 请求完成后再修改插件。');
    }
    this.changingDshPlugins = true;
    try {
      const sessions = [this.active, ...this.conversations.values()].filter(session => session?.managedDsh);
      for (const session of sessions) session.connection.stop();
      await Promise.all(sessions.map(session => session.connection.exited));
      validateSender();
      if (market === 'community') return await this.dshMarket.communitySetEnabled(id, enabled, validateSender, communityOptions);
      if (market === 'installed') {
        return await this.dshMarket.setInstalledEnabled(id, communityOptions.source, enabled, validateSender, communityOptions);
      }
      return await this.dshMarket.setEnabled(id, enabled, validateSender);
    } finally {
      this.changingDshPlugins = false;
    }
  }

  refreshManagedDshAccount() {
    for (const current of [this.active, ...this.conversations.values()]) {
      if (!current?.managedDsh || current.agentId === COMPANY_AGENT_ID) continue;
      if (this.activeTurn(current)) current.refreshAccountAfterTurn = true;
      else current.connection.stop();
    }
  }

  keepSession(conversationId, current) {
    if (!conversationId) {
      this.active = current;
      return;
    }
    this.conversations.delete(conversationId);
    this.conversations.set(conversationId, current);
    if (this.conversations.size <= MAX_CONVERSATIONS) return;
    for (const [id, session] of this.conversations) {
      if (this.turns.has(id)) continue;
      session.connection.stop();
      break;
    }
  }

  async runPrompt(id, text, onUpdate, conversationId, modelId, turnId, reasoningEffort) {
    if (id === COMPANY_AGENT_ID && (!conversationId || !turnId)) throw new AcpError('公司 Agent 仅用于已授权的会话。');
    if (!turnId && (typeof text !== 'string' || !text.trim() || text.length > 16_000)) {
      throw new AcpError('请输入 1 至 16000 字的消息。');
    }
    if (this.closed || this.accountOperation || this.changingDshPlugins || this.turns.has(undefined) ||
        (!conversationId && this.turns.size)) {
      throw new AcpError('已有外部 Agent 请求正在运行。');
    }
    if (this.turns.has(conversationId)) throw new AcpError('此聊天已有外部 Agent 请求在运行。');
    if (this.turns.size >= MAX_CONCURRENT_TURNS) throw new AcpError('最多同时运行 4 条外部 Agent 聊天。');
    const abort = new AbortController();
    const turn = { agentId: id, conversationId, turnId, text: '', onUpdate, cancelled: false, current: null, abort, signal: abort.signal };
    if (conversationId && turnId) turn.live = new AcpLive(turn, MAX_CALLS);
    let promptUsage;
    const resultWith = (stopReason, model = { modelId: null, modelName: null }) => ({
      text: turn.text, stopReason, ...(conversationId ? model : {}),
      ...(promptUsage ? { usage: { ...promptUsage, ...(stopReason !== 'end_turn' ? { partial: true } : {}) } } : {}),
      ...(turn.contextUsage ? { contextUsage: turn.contextUsage } : {}),
      ...(turn.project?.proposals.length ? { projectProposals: turn.project.proposals } : {}),
      ...(stopReason === 'end_turn' && turn.recommendation?.card ? { recommendations: [turn.recommendation.card] } : {}),
    });
    let current = conversationId ? this.conversations.get(conversationId) : this.active;
    turn.current = current || null;
    this.turns.set(conversationId, turn);
    clearTimeout(current?.idle);
    let ready = Boolean(current);
    let sent = false;
    try {
      if (turnId) {
        if (!this.projectClient) throw new AcpError('本机服务无法验证此外部 Agent 请求。');
        const prepared = await this.projectClient.prepare(turn, turn.signal);
        if (turn.cancelled) return resultWith('cancelled');
        if (typeof prepared?.text !== 'string') throw new AcpError('本机服务未返回授权上下文。');
        turn.project = new AcpProjectTurn(this.projectClient, turn, prepared);
      }
      const prepared = turn.project?.prepared;
      turn.tools = toolCatalog([...projectFileTools(prepared), ...(prepared?.tools || [])]);
      turn.tools = this.workflow
        ? await this.workflow.prepareTools(turn.project?.prepared, turn.tools)
        : turn.tools.filter(tool => ![TEST_TOOL, DIFF_TOOL].includes(tool.name));
      if (turn.cancelled) return resultWith('cancelled');
      const toolSignature = catalogSignature(turn.tools);
      const projectAccess = Boolean(turn.project?.prepared.project?.available);
      // An intervening Somnus or ACP reply means this process no longer holds the
      // latest transcript. A fresh session receives the bounded persisted history.
      if (current && (current.connection.failure || current.projectAccess !== projectAccess ||
          current.workspaceWrite !== (projectAccess && mayPropose(turn.project.prepared)) ||
          current.toolSignature !== toolSignature ||
          (prepared?.history_predecessor !== undefined && prepared.history_predecessor !== current.lastCompletedTurnId))) {
        current.connection.stop();
        current = null;
        turn.current = null;
        ready = false;
      }
      if (!current || current.agentId !== id) {
        current?.connection.stop();
        current = null;
        turn.current = null;
        ready = false;
        const profile = await this.profile(id);
        if (turn.cancelled) return resultWith('cancelled');
        const connected = await this.connect(profile, turn);
        current = connected.current;
        if (turn.cancelled) return resultWith('cancelled');
        await this.startSession(current, turn);
        if (turn.cancelled) return resultWith('cancelled');
        current.toolSignature = toolSignature;
      }
      this.keepSession(conversationId, current);
      ready = true;
      turn.settingConfig = Boolean(modelId && modelId !== current.modelSelection.modelId) ||
        (reasoningEffort != null && reasoningEffort !== current.reasoningSelection?.value);
      try {
        await setSessionModel(current, modelId, STARTUP_TIMEOUT);
        if (!turn.cancelled && reasoningEffort != null) await setSessionReasoning(current, reasoningEffort, STARTUP_TIMEOUT);
      } finally {
        turn.settingConfig = false;
      }
      if (turn.cancelled) return resultWith('cancelled');
      const prompt = turn.project ? promptBlocks(turn.project.prepared, current.promptCapabilities) : [{ type: 'text', text }];
      if (turn.project) prompt[0].text += await turn.project.stage(current.cwd);
      if (turn.tools.length) prompt[0].text += `\n\n本轮获授权的 Somnus 工具由 ${current.mcpName} MCP 提供。需要数据或分析时，请实际调用相应工具。`;
      if (turn.live) prompt[0].text += EXTERNAL_WORKSPACE_POLICY;
      if (turn.tools.some(tool => tool.name === TEST_TOOL)) {
        prompt[0].text += `\n\n需要运行项目测试或检查时，使用 ${current.mcpName} 的 run_project_tests 选择已配置的运行器。每次调用由用户在当前聊天中确认。测试读取实际项目目录，待审批的修改候选尚未应用。`;
      }
      if (turn.tools.some(tool => tool.name === DIFF_TOOL)) {
        prompt[0].text += `\n\n使用 ${current.mcpName} 的 project_git_diff 查看授权项目内已暂存和未暂存的 Git 差异。仅查看指定文件时，请传入精确的仓库相对路径 path。`;
      }
      if (projectAccess && turn.tools.some(tool => tool.name === 'search_project_files')) {
        prompt[0].text += `\n\n使用 ${current.mcpName} 的 search_project_files 按文件名（mode: name）或文本内容（mode: content）搜索已授权的项目文件，搜索范围可超出项目临时视图。`;
      }
      if (turn.tools.some(tool => tool.name === READ_FILE)) {
        prompt[0].text += `\n\n使用 ${current.mcpName} 的 read_project_file 读取项目文件。指定来源（如 source_1）和相对文件路径。不要尝试通过终端读取。`;
      }
      if (turn.tools.some(tool => tool.name === PROPOSE_FILE)) {
        prompt[0].text += `\n\n修改现有文件时，使用 ${current.mcpName} 的 propose_project_file_edit，传入读取返回的 sha256 和新文件全文。候选创建后请告知用户在 Somnus 审核应用。用户应用前，原文件、Git 差异和测试仍反映磁盘旧内容。`;
      }
      if (!current.hasPrompted) {
        const prepared = turn.project?.prepared;
        const history = priorTranscript(prepared?.history, prepared?.history_summary);
        if (history) prompt[0].text = history + '\n\n本轮请求及获授权上下文：\n' + prompt[0].text;
      }
      if (turn.cancelled) return resultWith('cancelled');
      const model = modelSummary(current);
      sent = true;
      if (conversationId && current.dshRecommendations) turn.recommendation = new DshRecommendation();
      turn.promptActive = true;
      turn.projectRequestsReady = true;
      turn.toolsReady = true;
      turn.deadline = new AcpDeadline(reason => {
        turn.live?.close();
        current.connection.stop(new AcpError(reason === 'hard'
          ? '外部 Agent 已达到本轮最长处理时间。'
          : '外部 Agent 长时间没有有效进度，已结束本轮。'));
      });
      const response = await current.connection.request('session/prompt', {
        sessionId: current.sessionId,
        prompt,
      });
      turn.deadline.close();
      current.hasPrompted = true;
      turn.promptActive = false;
      turn.live?.close();
      turn.projectRequestsReady = false;
      turn.toolsReady = false;
      if (typeof response?.stopReason !== 'string') throw new AcpError('外部 Agent 未报告会话结束原因。');
      if (conversationId) promptUsage = acpPromptUsage(response.usage);
      if (current.connection.failure) throw current.connection.failure;
      if (turn.project && response.stopReason === 'end_turn') await turn.project.capture();
      if (turnId) {
        if (!turn.cancelled && response.stopReason === 'end_turn') current.lastCompletedTurnId = turnId;
        else current.connection.stop();
      }
      return resultWith(turn.cancelled ? 'cancelled' : response.stopReason.slice(0, 100), model);
    } catch (error) {
      if (!ready || sent) current?.connection.stop();
      if (turn.cancelled) return resultWith('cancelled');
      throw error;
    } finally {
      clearTimeout(turn.cancelTimer);
      turn.deadline?.close();
      turn.promptActive = false;
      turn.live?.close();
      turn.projectRequestsReady = false;
      turn.toolsReady = false;
      if (!turn.signal.aborted) turn.abort.abort();
      await turn.project?.dispose();
      if (current) {
        if (id === COMPANY_AGENT_ID || current.refreshAccountAfterTurn) current.connection.stop();
        else if (ready && !current.connection.failure) {
          current.idle = setTimeout(() => current.connection.stop(), IDLE_TIMEOUT);
          current.idle.unref();
        } else if (!ready) current.connection.stop();
      }
      if (this.turns.get(conversationId) === turn) this.turns.delete(conversationId);
    }
  }

  cancel() {
    this.cancelTurn();
  }

  cancelConversation(conversationId) {
    if (validId(conversationId)) this.cancelTurn(conversationId);
  }

  cancelTurn(conversationId) {
    const turn = this.turns.get(conversationId);
    if (!turn || turn.cancelled) return;
    turn.cancelled = true;
    turn.abort.abort();
    const active = turn.current;
    if (!turn.promptActive) {
      if (active && (!active.sessionId || turn.settingConfig)) active.connection.stop();
      return;
    }
    active.connection.send({ method: 'session/cancel', params: { sessionId: active.sessionId } });
    turn.cancelTimer = setTimeout(() => {
      if (this.turns.get(conversationId) === turn) active.connection.stop();
    }, 2500);
    turn.cancelTimer.unref();
  }

  resetConversation(conversationId) {
    if (!validId(conversationId)) return;
    this.cancelConversation(conversationId);
    this.conversations.get(conversationId)?.connection.stop();
  }

  close() {
    this.closed = true;
    this.reset();
  }

  reset() {
    for (const turn of this.turns.values()) {
      turn.cancelled = true;
      turn.abort.abort();
      clearTimeout(turn.cancelTimer);
      turn.current?.connection.stop();
    }
    if (this.accountOperation) {
      this.accountOperation.cancelled = true;
      this.accountOperation.current?.connection.stop();
    }
    this.active?.connection.stop();
    for (const session of this.conversations.values()) session.connection.stop();
  }
}

module.exports = { AcpAgents };
