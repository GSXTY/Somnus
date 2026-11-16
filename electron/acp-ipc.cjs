const path = require('node:path');
const { AcpAgents } = require('./acp-agents.cjs');
const { detectAdapter, detectManagedCodex, matchesLaunch } = require('./acp-discovery.cjs');
const { trustWorkbench } = require('./project-folders.cjs');
const { createProjectClient } = require('./acp-project.cjs');
const { ProjectWorkflow } = require('./acp-project-workflow.cjs');
const { DshPluginMarket } = require('./acp-dsh-market.cjs');
const { AGENT_ID: COMPANY_AGENT_ID } = require('./acp-company.cjs');

function eligibleAuthUrl(target, input) {
  if (typeof input !== 'string' || !input || input.length > 4096 || /[\x00-\x20\x7f]/.test(input)) return null;
  const url = URL.parse(input);
  if (!url || url.username || url.password) return null;
  if (target === 'codebuddy' &&
      ['https://copilot.tencent.com', 'https://codebuddy.ai', 'https://www.codebuddy.ai'].includes(url.origin)) return url;
  return null;
}

async function openDeepSeekHarness(app, shell) {
  const desktopUri = 'dsh://open';
  if (app.getApplicationNameForProtocol(desktopUri)) {
    try {
      await shell.openExternal(desktopUri);
      return 'desktop';
    } catch {
      // The registered app may have been moved or uninstalled.
    }
  }
  await shell.openExternal('https://www.deepseek.com/harness/');
  return 'website';
}

function registerAcpAgents({ ipcMain, app, dialog, shell, window, origin, token, profileDir, version,
  dshRuntimeDir = profileDir, resourcesPath = process.resourcesPath }) {
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
  const workflow = token && process.platform === 'win32'
    ? new ProjectWorkflow({ ipcMain, dialog, shell, window, origin, token, profileDir }) : undefined;
  const dshMarket = new DshPluginMarket(profileDir, resourcesPath, dshRuntimeDir);
  const agents = new AcpAgents(path.join(profileDir, 'external-acp-agents.json'), version, resourcesPath,
    openAuthUrl, projectClient, workflow, dshMarket);
  const handle = (action, use) => ipcMain.handle('vvman-acp:' + action, (event, ...args) => {
    trustWorkbench(event, window, origin);
    return use(event, ...args);
  });
  handle('list', () => agents.list());
  handle('company-runtime', async (event, modelId) => {
    if (!projectClient || (modelId != null && (typeof modelId !== 'string' || modelId.length > 120))) return null;
    const [launch, profile, ready] = await Promise.all([dshMarket.launch(), dshMarket.profile(), projectClient.companyReady(modelId)]);
    trustWorkbench(event, window, origin);
    return launch && profile && ready ? { agentId: COMPANY_AGENT_ID } : null;
  });
  handle('open-deepseek-harness', () => openDeepSeekHarness(app, shell));
  handle('dsh-plugin-market', () => dshMarket.status());
  handle('dsh-installed-plugins', () => dshMarket.installedPlugins());
  handle('dsh-community-market', (_event, query, refresh) => dshMarket.communityStatus(query, refresh));
  const confirmDshCommunityPlugin = async ({ id, version, sourceUrl, installing }) => {
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: installing ? '安装 DSH 社区插件' : '启用 DSH 社区插件',
      message: id + '@' + version,
      detail: '来源：' + sourceUrl + (installing
        ? '\n将下载到 Somnus 的 DSH 插件目录。安装过程跳过包构建脚本。'
        : '\n启用后，插件可在托管 DSH 中以当前 Windows 用户权限运行。'),
      buttons: ['取消', installing ? '安装' : '启用'], defaultId: 0, cancelId: 0, noLink: true,
    });
    return result.response === 1;
  };
  handle('change-dsh-community-plugin', (event, id, action, query) => {
    return agents.changeDshPlugins(id, action, () => trustWorkbench(event, window, origin), 'community', { query, confirm: confirmDshCommunityPlugin });
  });
  handle('set-dsh-installed-plugin-enabled', (event, id, source, enabled) => {
    return agents.changeDshPlugins(id, enabled, () => trustWorkbench(event, window, origin), 'installed', { source, confirm: confirmDshCommunityPlugin });
  });
  handle('install-dsh-plugin', (event, id) => agents.changeDshPlugins(id, true, () => trustWorkbench(event, window, origin)));
  handle('remove-dsh-plugin', (event, id) => agents.changeDshPlugins(id, false, () => trustWorkbench(event, window, origin)));
  handle('open-managed-dsh-terminal', event => dshMarket.openTerminal(() => trustWorkbench(event, window, origin)));
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
    const managed = provider === 'deepseek-harness-native' ? await dshMarket.launch() : null;
    const profile = managed ?? await detectAdapter(provider, process.env, resourcesPath);
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

module.exports = { registerAcpAgents, eligibleAuthUrl, openDeepSeekHarness };
