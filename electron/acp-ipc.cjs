const path = require('node:path');
const { AcpAgents } = require('./acp-agents.cjs');
const { detectAdapter, detectManagedCodex, matchesLaunch } = require('./acp-discovery.cjs');
const { trustWorkbench } = require('./project-folders.cjs');
const { createProjectClient } = require('./acp-project.cjs');
const { ProjectWorkflow } = require('./acp-project-workflow.cjs');
const { registerWorkspaceTerminal } = require('./workspace-terminal.cjs');
const { registerDshImView, registerDshPluginPage } = require('./acp-dsh-im-view.cjs');
const { registerOwnedDshPages } = require('./acp-dsh-plugin-pages.cjs');
const { DshPluginMarket } = require('./acp-dsh-market.cjs');
const { NativeDshChat } = require('./acp-native-dsh-chat.cjs');
const { draftStore, queueStore } = require('./acp-dsh-recovery.cjs');
const { createQueueSteering } = require('./acp-dsh-queue-steer.cjs');
const { createDshPluginSettings } = require('./acp-dsh-plugin-settings.cjs');
const { createChatAddonInstaller } = require('./acp-chat-addon.cjs');
const { listDshSkills } = require('./acp-dsh-skills.cjs');
const { readDshMcpInventory } = require('./acp-dsh-mcp-inventory.cjs');
const { createExecutionSettings } = require('./acp-execution-settings.cjs');
const { createOarIntegration } = require('./acp-dsh-oar.cjs');
const { initializeDesktopMcpDefault } = require('./acp-desktop-mcp-default.cjs');
const { AGENT_ID: COMPANY_AGENT_ID } = require('./acp-company.cjs');

function eligibleAuthUrl(target, input) {
  if (typeof input !== 'string' || !input || input.length > 4096 || /[\x00-\x20\x7f]/.test(input)) return null;
  const url = URL.parse(input);
  if (!url || url.username || url.password) return null;
  if (target === 'codebuddy' &&
      ['https://copilot.tencent.com', 'https://codebuddy.ai', 'https://www.codebuddy.ai'].includes(url.origin)) return url;
  return null;
}

function registerAcpAgents({ ipcMain, app, dialog, shell, window, origin, token, profileDir, version,
  dshRuntimeDir = profileDir, resourcesPath = process.resourcesPath, WebContentsView, session }) {
  let confirmingAuthUrl = false;
  const openAuthUrl = shell && (async (profile, target, params, isPending) => {
    const url = eligibleAuthUrl(target, params.url);
    if (!url || confirmingAuthUrl || !isPending() || window.isDestroyed()) return 'decline';
    confirmingAuthUrl = true;
    try {
      const result = await dialog.showMessageBox(window, {
        type: 'question', title: '在浏览器打开登录',
        message: `${profile.name} 请求打开 ${url.host}`,
        detail: `请在浏览器中完成账号授权。\n\n${url.href}`,
        buttons: ['取消', '打开浏览器'], cancelId: 0, defaultId: 0, noLink: true,
      });
      if (result.response !== 1 || !isPending() || window.isDestroyed()) return 'cancel';
      await shell.openExternal(url.href);
      return 'accept';
    } finally {
      confirmingAuthUrl = false;
    }
  });
  const projectClient = token ? createProjectClient(origin, token) : undefined;
  const executionSettings = createExecutionSettings(profileDir);
  const workflow = token && process.platform === 'win32'
    ? new ProjectWorkflow({ ipcMain, dialog, shell, window, origin, token, profileDir, executionSettings }) : undefined;
  const dshMarket = new DshPluginMarket(profileDir, resourcesPath, dshRuntimeDir,
    projectClient?.openCompanyWeb, executionSettings, projectClient?.companyRuntime);
  dshMarket.oar = createOarIntegration(dshMarket);
  void initializeDesktopMcpDefault(profileDir, resourcesPath).catch(error => console.warn('Somnus desktop MCP initialization:', error.message));
  void dshMarket.initializeDefaultIm();
  const installChatAddon = createChatAddonInstaller(dshMarket, origin, workflow && (async (id, conversationId) => {
    if (typeof conversationId !== 'string') throw new Error('请选择当前工作区聊天。');
    return (await workflow.target(id, 'project_git_diff', { source: 'source_1' },
      AbortSignal.timeout(7000), conversationId)).root;
  }));
  if (WebContentsView && session) {
    const dshView = { ipcMain, window, origin, WebContentsView, session, market: dshMarket, workflow };
    registerDshImView(dshView);
    registerDshPluginPage(dshView);
    registerOwnedDshPages(dshView);
  }
  if (workflow) registerWorkspaceTerminal({ ipcMain, window, origin, workflow, resourcesPath,
    dshStartup: () => dshMarket.terminalStartup() });
  const agents = new AcpAgents(path.join(profileDir, 'external-acp-agents.json'), version, resourcesPath,
    openAuthUrl, projectClient, workflow, dshMarket, executionSettings);
  const handle = (action, use) => ipcMain.handle('vvman-acp:' + action, (event, ...args) => {
    trustWorkbench(event, window, origin);
    return use(event, ...args);
  });
  if (projectClient && workflow) {
    const nativeChat = new NativeDshChat(dshMarket, projectClient, workflow);
    handle('teamwork', (_event, conversationId) => dshMarket.teamwork(conversationId));
    handle('set-teamwork', (event, conversationId, enabled) =>
      nativeChat.setTeamwork(conversationId, enabled, () => trustWorkbench(event, window, origin)));
    handle('native-dsh-prompt', (event, input) => nativeChat.prompt(input,
      () => trustWorkbench(event, window, origin), update => {
        if (!event.senderFrame?.detached) event.senderFrame?.send('vvman-acp:native-dsh-update', update);
      }));
    handle('native-dsh-cancel', (_event, id) => nativeChat.cancel(id));
    handle('native-dsh-steer', (event, input) =>
      nativeChat.steer(input, () => trustWorkbench(event, window, origin)));
    handle('native-dsh-list-commands', (event, input) =>
      nativeChat.listCommands(input, () => trustWorkbench(event, window, origin)));
    handle('native-dsh-task-state', (event, input) =>
      nativeChat.taskState(input, () => trustWorkbench(event, window, origin)));
    handle('native-dsh-execute-command', (event, input) =>
      nativeChat.executeCommand(input, () => trustWorkbench(event, window, origin), update => {
        if (!event.senderFrame?.detached) event.senderFrame?.send('vvman-acp:native-dsh-update', update);
      }));
    handle('native-dsh-subagent-detail', (event, input) =>
      nativeChat.subagentDetail(input, () => trustWorkbench(event, window, origin)));
    handle('native-dsh-subagent-tool', (event, input) =>
      nativeChat.subagentDetail(input, () => trustWorkbench(event, window, origin), true));
    handle('native-dsh-respond-permission', (_event, id, requestId, optionId) =>
      nativeChat.respondPermission(id, requestId, optionId));
    handle('native-dsh-respond-question', (_event, id, requestId, answers) =>
      nativeChat.respondQuestion(id, requestId, answers));
    handle('native-dsh-hold-question', (_event, id, requestId, held) =>
      nativeChat.holdQuestion(id, requestId, held));
    handle('native-dsh-recover-questions', (event, id) =>
      nativeChat.recoverQuestions(id, () => trustWorkbench(event, window, origin)));
    const drafts = draftStore(profileDir, require('electron').safeStorage);
    handle('native-dsh-read-draft', (_event, id) => drafts.read(id));
    handle('native-dsh-save-draft', (_event, id, draft) => drafts.save(id, draft));
    const queues = createQueueSteering(queueStore(profileDir, require('electron').safeStorage), projectClient, nativeChat);
    handle('native-dsh-read-queue', (_event, id) => queues.read(id));
    handle('native-dsh-save-queue', (_event, id, items) => queues.save(id, items));
    handle('native-dsh-steer-queue', (event, input) => queues.steer(input, () => trustWorkbench(event, window, origin)));
  }
  handle('list', () => agents.list());
  handle('agent-execution-settings', () => executionSettings.get());
  handle('set-agent-execution-settings', (_event, settings) => executionSettings.set(settings));
  handle('company-runtime', async (event, modelId) => {
    if (!projectClient || (modelId != null && (typeof modelId !== 'string' || modelId.length > 120))) return null;
    const [launch, profile, config] = await Promise.all([dshMarket.launch(), dshMarket.webProfile(),
      projectClient.companyRuntime(modelId).catch(() => null)]);
    trustWorkbench(event, window, origin);
    return launch && profile && config?.ready ? { agentId: COMPANY_AGENT_ID } : null;
  });
  handle('dsh-plugin-market', () => dshMarket.status());
  handle('dsh-installed-plugins', () => dshMarket.installedPlugins());
  handle('dsh-oar-status', () => dshMarket.oar.status());
  handle('set-dsh-oar-enabled', (event, enabled) => {
    const validateSender = () => trustWorkbench(event, window, origin);
    return agents.changeDshPlugins(null, true, validateSender, 'chat', {
      install: () => dshMarket.oar.setEnabled(enabled, validateSender),
    });
  });
  const pluginSettings = createDshPluginSettings(dshMarket);
  handle('dsh-plugin-settings', (event, id, source) =>
    pluginSettings.read(id, source, () => trustWorkbench(event, window, origin)));
  handle('save-dsh-plugin-settings', (event, id, source, section, revision, edits) =>
    pluginSettings.save(id, source, section, revision, edits, () => trustWorkbench(event, window, origin)));
  handle('dsh-skills', () => listDshSkills(dshMarket.home));
  handle('dsh-mcp-connections', event => readDshMcpInventory(dshMarket, () => trustWorkbench(event, window, origin)));
  handle('install-chat-addon', (event, input) => {
    const validateSender = () => trustWorkbench(event, window, origin);
    const install = () => installChatAddon(input, validateSender, stage => {
      if (!event.senderFrame?.detached) event.senderFrame.send('vvman-acp:chat-addon-progress', stage);
    });
    return input?.kind === 'plugin' ? agents.changeDshPlugins(null, true, validateSender, 'chat', { install }) : install();
  });
  handle('dsh-community-market', (_event, query, refresh, sourceId, options) => dshMarket.communityStatus(query, refresh, sourceId, options));
  handle('set-dsh-community-market-sources', (event, urls) =>
    dshMarket.community.setSources(urls, () => trustWorkbench(event, window, origin)));
  const confirmDshCommunityPlugin = async ({ id, version, sourceUrl, installing, build, profile }) => {
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: installing ? '安装 DSH 社区插件' : '启用 DSH 社区插件',
      message: id + '@' + version,
      detail: '来源：' + sourceUrl + (installing
        ? (profile ? '\n配置：' + profile.toUpperCase() : '') + (build
          ? '\n此提交需要构建。继续将以当前 Windows 用户权限在独立临时目录执行此插件的 build 脚本，再把构建产物安装到 Somnus。'
          : '\n将下载到 Somnus 的 DSH 插件目录。安装过程跳过包构建脚本。')
        : '\n启用后，插件可在托管 DSH 中以当前 Windows 用户权限运行。'),
      buttons: ['取消', installing ? '安装' : '启用'], defaultId: 0, cancelId: 0, noLink: true,
    });
    return result.response === 1;
  };
  handle('install-dsh-plugin-source', (event, reference) => {
    const validateSender = () => trustWorkbench(event, window, origin);
    return agents.changeDshPlugins(null, true, validateSender, 'chat', {
      install: () => dshMarket.community.installSource(reference, validateSender, confirmDshCommunityPlugin),
    });
  });
  handle('change-dsh-community-plugin', (event, id, action, query, marketSource) => {
    return agents.changeDshPlugins(id, action, () => trustWorkbench(event, window, origin), 'community',
      { query, marketSource, confirm: confirmDshCommunityPlugin });
  });
  handle('install-dsh-community-plugin-version', (event, id, requestedVersion, marketSource, query) =>
    agents.changeDshPlugins(id, 'version', () => trustWorkbench(event, window, origin), 'community',
      { requestedVersion, marketSource, query, confirm: confirmDshCommunityPlugin }));
  handle('set-dsh-installed-plugin-enabled', (event, id, source, enabled) => {
    return agents.changeDshPlugins(id, enabled, () => trustWorkbench(event, window, origin), 'installed', { source, confirm: confirmDshCommunityPlugin });
  });
  handle('uninstall-dsh-plugin', (event, id, source) => agents.changeDshPlugins(id, false,
    () => trustWorkbench(event, window, origin), 'uninstall', { source, confirm: async ({ id, versions }) => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning', title: '卸载插件', message: id + ' · ' + versions.join(', '),
        detail: '将从当前 Somnus 配置卸载此插件。原始项目文件会保留。',
        buttons: ['取消', '卸载'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return result.response === 1;
    } }));
  handle('install-dsh-plugin', (event, id) => agents.changeDshPlugins(id, true, () => trustWorkbench(event, window, origin)));
  handle('remove-dsh-plugin', (event, id) => agents.changeDshPlugins(id, false, () => trustWorkbench(event, window, origin)));
  let dshAccountState;
  const observeDshAccount = status => {
    if ((status.state === 'signed-in' || status.state === 'signed-out') && status.state !== dshAccountState) {
      agents.refreshManagedDshAccount();
    }
    if (status.state !== 'unavailable') dshAccountState = status.state;
    return status;
  };
  handle('managed-dsh-account-status', async event => observeDshAccount(
    await dshMarket.accountStatus(() => trustWorkbench(event, window, origin))));
  handle('sign-in-managed-dsh-account', async event => observeDshAccount(
    await dshMarket.signInAccount(shell, () => trustWorkbench(event, window, origin))));
  handle('detect-adapter', async (event, provider) => {
    const profile = provider === 'deepseek-harness-native'
      ? await dshMarket.launch() : await detectAdapter(provider, process.env, resourcesPath);
    trustWorkbench(event, window, origin);
    return profile;
  });
  handle('choose-executable', async event => {
    const result = await dialog.showOpenDialog(window, {
      title: '选择外部 ACP Agent 程序',
      filters: [{ name: 'Windows 程序', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    trustWorkbench(event, window, origin);
    return result.canceled ? null : result.filePaths[0] || null;
  });
  let confirming = false;
  async function confirmProfile(event, profile, managedCodex = false) {
    if (confirming) throw new Error('请先完成正在打开的代理确认。');
    confirming = true;
    try {
      const saved = await agents.validate(profile);
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: managedCodex ? '连接 Codex' : '信任外部 Agent',
        message: managedCodex ? '使用 ChatGPT 登录 Codex' : '只连接你信任的程序',
        detail: `程序：${saved.executable}\n启动参数：${JSON.stringify(saved.args)}\n\n${managedCodex
          ? 'Somnus 将启动随附的 Codex。需要登录时，Codex 会在默认浏览器打开 ChatGPT 授权。'
          : '程序会以当前 Windows 用户权限运行。仅通过设置中的登录入口或该程序自己的登录方式输入凭据。'}`,
        buttons: ['取消', managedCodex ? '继续登录' : '信任并保存'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      trustWorkbench(event, window, origin);
      if (result.response !== 1) throw new Error('已取消保存外部 Agent。');
      return agents.save(saved);
    } finally {
      confirming = false;
    }
  }
  handle('save', (event, profile) => confirmProfile(event, profile));
  let connectingCodex = false;
  handle('connect-codex', async event => {
    if (connectingCodex) throw new Error('Codex 登录正在进行。');
    connectingCodex = true;
    try {
      const profile = await detectManagedCodex(resourcesPath);
      if (!profile) throw new Error('此版本缺少随附的 Codex 组件。可使用本机检测或手动接入。');
      const saved = (await agents.list()).find(agent => matchesLaunch(agent, profile));
      trustWorkbench(event, window, origin);
      const agent = saved ?? await confirmProfile(event, profile, true);
      trustWorkbench(event, window, origin);
      const info = await agents.connectCodex(agent.id, profile);
      return { agent, info };
    } finally {
      connectingCodex = false;
    }
  });
  let connectingDsh = false;
  handle('connect-managed-dsh', async event => {
    if (connectingDsh) throw new Error('官方 DSH 正在连接。');
    connectingDsh = true;
    try {
      const profile = await dshMarket.launch();
      if (!profile || !await dshMarket.profile()) throw new Error('独立的 DeepSeek Harness ACP 运行时尚未安装。');
      const profiles = await agents.list();
      const saved = profiles.find(agent => matchesLaunch(agent, profile));
      let relocated;
      if (!saved) {
        const candidates = [];
        for (const agent of profiles) {
          if (agent.name === profile.name &&
              agent.executable.toLowerCase().endsWith('\\resources\\agents\\codex\\node.exe') &&
              agent.args.length === profile.args.length && agent.args.slice(1).every((arg, i) => arg === profile.args[i + 1]) &&
              await dshMarket.ownsLaunch(agent)) candidates.push(agent);
        }
        if (candidates.length > 1) throw new Error('存在多条旧的托管 DSH 配置，请保留要重新连接的条目。');
        [relocated] = candidates;
      }
      trustWorkbench(event, window, origin);
      const agent = saved ?? await agents.save(relocated ? { ...profile, id: relocated.id } : profile);
      trustWorkbench(event, window, origin);
      const info = await agents.probe(agent.id);
      return { agent, info };
    } finally {
      connectingDsh = false;
    }
  });
  handle('remove', (_event, id) => agents.remove(id));
  handle('probe', (_event, id) => agents.probe(id));
  handle('save-configuration-checkpoint', async (event, id, revision) => {
    if (!token || typeof id !== 'string' || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
      throw new Error('检查点验证请求无效。');
    }
    const profile = (await agents.list()).find(item => item.id === id);
    if (!profile) throw new Error('ACP Agent 已移除，请重新选择。');
    const probe = await agents.probe(id);
    // Managed DSH reports its account state separately from the ACP session.
    const validateSender = () => trustWorkbench(event, window, origin);
    const dshAccountVerified = probe.authentication === 'unverified' &&
      matchesLaunch(profile, await dshMarket.launch()) &&
      (await dshMarket.accountStatus(validateSender)).state === 'signed-in';
    if (probe.authentication !== 'ready' && !dshAccountVerified) {
      throw new Error('ACP 账号尚未通过验证，请在 Agent 配置中检查登录状态。');
    }
    const current = (await agents.list()).find(item => item.id === id);
    if (JSON.stringify(profile) !== JSON.stringify(current)) throw new Error('ACP 配置已变更，请重新验证。');
    trustWorkbench(event, window, origin);
    const response = await fetch(new URL('/api/assistant/configuration-checkpoints', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'X-Data-Agent-Native': token, 'X-Data-Agent-Local': '1' },
      body: JSON.stringify({ revision, agent: { id, name: profile.name } }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || '无法保存配置检查点。');
    return result;
  });
  handle('authenticate', (_event, ...args) => agents.authenticate(...args));
  handle('cancel-authentication', () => agents.cancelAuthentication());
  function updateHandler(event) {
    const frame = event.senderFrame;
    return update => {
      if (window.isDestroyed() || frame.detached || frame !== window.webContents.mainFrame ||
          URL.parse(frame.url)?.origin !== origin) return;
      try {
        frame.send('vvman-acp:update', update);
      } catch {
        agents.reset();
      }
    };
  }
  handle('prompt', (event, id, text) => agents.prompt(id, text, updateHandler(event)));
  handle('list-delegation-agents', () => agents.listDelegationAgents());
  handle('run-delegation', (_event, input) => agents.runDelegation(input));
  handle('cancel-delegation', (_event, conversationId, requestId) => agents.cancelDelegation(conversationId, requestId));
  handle('discover-models', (_event, id, modelId) => agents.discoverModels(id, modelId));
  handle('prompt-conversation', (event, input) => agents.promptConversation(input, updateHandler(event)));
  handle('cancel-conversation', (_event, id) => agents.cancelConversation(id));
  handle('reset-conversation', (_event, id) => agents.resetConversation(id));
  handle('respond-permission', (_event, conversationId, requestId, optionId) =>
    agents.respondPermission(conversationId, requestId, optionId));
  handle('cancel', () => agents.cancel());
  handle('reset', () => agents.reset());
  window.on('closed', () => { workflow?.reset(); agents.close(); dshMarket.closeSettings(); });
  window.webContents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) { workflow?.reset(); agents.reset(); }
  });
  window.webContents.on('render-process-gone', () => { workflow?.reset(); agents.reset(); });
  return agents;
}

module.exports = { registerAcpAgents, eligibleAuthUrl };

