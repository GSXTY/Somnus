const { lstat, open, realpath, rename, unlink, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { timedQuestionPresets } = require('./acp-dsh-question-presets.cjs');
const path = require('node:path');
const { DshCommunityMarket, fetchJson } = require('./acp-dsh-community.cjs');
const { DshAccount, accountState } = require('./acp-dsh-account.cjs');
const { companyWebOverlay, TEAM_PLUGINS } = require('./acp-dsh-web-model.cjs');
const { createImPanelOverlay, supportsImPanel } = require('./acp-dsh-im-panel.cjs');
const { processEnvironment } = require('./acp-stdio.cjs');

const RUNTIME = '@deepseek-ai/dsh';
const VERSION = '0.2.2-rc.1';
const DEFAULT_IM_ID = '@xmanrui/dsh-im';
const DEFAULT_IM_VERSION = '5.10.0';
const REGISTRY = 'https://registry.npmjs.org';
const ENTRY = 'lib/bin.js';
const WEB_STARTUP_TIMEOUT_MS = 30_000;
// On Windows, the IM bundle can finish initializing after the ordinary Web deadline.
const IM_WEB_STARTUP_TIMEOUT_MS = 60_000;
const MANAGED_CLI = [
  "import { pathToFileURL } from 'node:url';",
  'const [entry, pnpm, ...args] = process.argv.slice(1);',
  'process.argv = [process.execPath, entry, ...args];',
  'const { runCli } = await import(pathToFileURL(entry));',
  'await runCli({ packageManager: { command: process.execPath, args: [pnpm] } });',
].join('\n');
const BADGE = {
  id: 'badge-skill',
  packageName: '@deepseek-ai/dsh-experimental-badge-skill-bundle',
  name: 'Badge Skill',
  description: '让 DSH 会话可以加载官方 Powered by DSH 徽章技能。',
};
const PERSONALIZED = {
  id: '@deepseek-ai/dsh-personalized-recommendations',
  packageName: '@deepseek-ai/dsh-personalized-recommendations',
  name: '个性化推荐',
  description: '在 Somnus 的 DSH 回复下方显示官方个性化推荐卡片。',
};
const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'];
const OFFICIAL_PLUGINS = [BADGE, PERSONALIZED];

function isOfficialInstalled(profile, name) {
  const remembered = profile?.data.vvman?.installedOfficialPlugins;
  return Boolean(profile?.bundles.includes(name) || (Array.isArray(remembered) && remembered.includes(name)));
}

function isLocal(file) {
  return typeof file === 'string' && /^[A-Za-z]:[\\/]/.test(file) && !/[\x00-\x1f]/.test(file);
}

async function localFile(root, ...parts) {
  if (!isLocal(root)) return null;
  try {
    const base = await realpath(root);
    if (!isLocal(base)) return null;
    const expected = path.join(base, ...parts);
    const chain = path.relative(base, expected).split(path.sep);
    let current = base;
    for (const [index, part] of chain.entries()) {
      current = path.join(current, part);
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (index === chain.length - 1 ? !stat.isFile() : !stat.isDirectory())) return null;
    }
    const resolved = await realpath(expected);
    return resolved.toLowerCase() === expected.toLowerCase() ? resolved : null;
  } catch {
    return null;
  }
}

async function readJson(file) {
  if (!file) return null;
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) return null;
    return JSON.parse(bytes.toString('utf8', 0, bytesRead));
  } finally {
    await handle.close();
  }
}

class DshPluginMarket {
  constructor(profileDir, resourcesPath, runtimeRoot = profileDir, openCompanyWeb, executionSettings, companyRuntime) {
    this.profileDir = profileDir;
    this.resourcesPath = resourcesPath;
    this.runtimeRoot = runtimeRoot;
    this.home = path.join(profileDir, 'dsh-home');
    this.community = new DshCommunityMarket(this, localFile, readJson, VERSION);
    this.account = new DshAccount();
    this.openCompanyWeb = openCompanyWeb;
    this.executionSettings = executionSettings;
    this.companyRuntime = companyRuntime;
    this.settingsQueue = Promise.resolve();
  }

  runtimeFile(packageName, relative) {
    return localFile(this.runtimeRoot, 'dsh-runtime', VERSION, 'node_modules', packageName, relative);
  }

  get runtimeDir() {
    return path.join(this.runtimeRoot, 'dsh-runtime', VERSION);
  }

  async ownsLaunch(profile) {
    const script = path.join('dsh-runtime', VERSION, 'node_modules', RUNTIME, ENTRY);
    const argument = path.normalize(profile.args[0] || '').toLowerCase();
    if (argument === path.join(this.runtimeRoot, script).toLowerCase()) return true;
    const root = await realpath(this.runtimeRoot).catch(() => null);
    return Boolean(root && argument === path.join(root, script).toLowerCase());
  }

  async launch() {
    if (process.platform !== 'win32') return null;
    const [executable, script, metadata] = await Promise.all([
      localFile(this.resourcesPath, 'agents', 'codex', 'node.exe'),
      this.runtimeFile(RUNTIME, ENTRY),
      this.runtimeFile(RUNTIME, 'package.json').then(readJson).catch(() => null),
    ]);
    const entry = typeof metadata?.bin === 'string' ? metadata.bin : metadata?.bin?.dsh;
    if (!executable || !script || metadata?.name !== RUNTIME || metadata.version !== VERSION ||
        typeof entry !== 'string' || entry.replace(/^\.\//, '') !== ENTRY) return null;
    return { name: 'DeepSeek Harness 官方 ACP', executable, args: [script, '--profile', 'acp'] };
  }

  async profile() {
    const file = await localFile(this.profileDir, 'dsh-home', 'profiles', 'acp', 'package.json');
    if (!file) return null;
    const data = await readJson(file).catch(() => null);
    const bundles = data?.dsh?.profile?.bundles;
    if (data?.name !== 'dsh-profile-acp' || data.private !== true || !Array.isArray(bundles) ||
        PROFILE_BUNDLES.some(name => !bundles.includes(name))) return null;
    return { file, data, bundles };
  }

  async webProfile() {
    const file = await localFile(this.profileDir, 'dsh-home', 'profiles', 'web', 'package.json');
    const data = await readJson(file).catch(() => null);
    const bundles = data?.dsh?.profile?.bundles;
    if (data?.name !== 'dsh-profile-web' || data.private !== true || !Array.isArray(bundles) ||
        !bundles.includes('@deepseek-ai/dsh-base') || !bundles.includes('@deepseek-ai/dsh-web-app')) return null;
    return { file, data, bundles };
  }

  async available(plugin) {
    if (plugin !== BADGE && plugin !== PERSONALIZED) return false;
    const metadata = await this.runtimeFile(plugin.packageName, 'package.json').then(readJson).catch(() => null);
    return metadata?.name === plugin.packageName && metadata.version === VERSION &&
      metadata.dsh?.bundle?.patch === './cordis.patch.yml' &&
      Boolean(await this.runtimeFile(plugin.packageName, 'cordis.patch.yml'));
  }

  async catalog() {
    const data = await localFile(this.runtimeRoot, 'dsh-runtime', VERSION, 'official-catalog.json').then(readJson).catch(() => null);
    const rows = [...OFFICIAL_PLUGINS];
    if (data?.version !== VERSION || !Array.isArray(data.plugins) || data.plugins.length > 40) return rows;
    for (const row of data.plugins) {
      const { packageName, name, description } = row ?? {};
      if (typeof packageName !== 'string' || !/^@deepseek-ai\/dsh-[a-z0-9-]{1,80}$/.test(packageName) ||
          typeof name !== 'string' || !name || name.length > 140 ||
          typeof description !== 'string' || description.length > 750 ||
          rows.some(row => row.packageName === packageName)) continue;
      rows.push({ id: packageName, packageName, name, description });
    }
    return rows;
  }

  async status() {
    const [launch, profile, catalog] = await Promise.all([this.launch(), this.profile(), this.catalog()]);
    const plugins = await Promise.all(catalog.map(async plugin => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      version: VERSION,
      sourceUrl: 'https://www.npmjs.com/package/' + plugin.packageName + '/v/' + VERSION,
      available: Boolean(launch && profile && await this.available(plugin)),
      installed: Boolean(launch && profile?.bundles.includes(plugin.packageName)),
    })));
    return { runtime: { installed: Boolean(launch), version: launch ? VERSION : null }, plugins };
  }

  async installedPlugins() {
    const startup = this.initialDefaultIm && await this.initialDefaultIm;
    const defaultIm = (await this.ensureDefaultIm()) ?? (startup?.status === 'failed' ? startup : undefined);
    const [launch, profile, web] = await Promise.all([this.launch(), this.profile(), this.webProfile()]);
    const official = OFFICIAL_PLUGINS.filter(plugin => isOfficialInstalled(profile, plugin.packageName));
    const [officialRows, communityRows] = await Promise.all([
      Promise.all(official.map(async plugin => ({
        id: plugin.id, name: plugin.name, description: plugin.description, version: VERSION, source: 'official',
        enabled: profile.bundles.includes(plugin.packageName), available: Boolean(launch && await this.available(plugin)),
      }))),
      profile ? this.community.installedPlugins(profile, Boolean(launch)) : [],
    ]);
    const webRows = web ? await this.community.installedPlugins(web, Boolean(launch)) : [];
    const community = new Map(communityRows.map(row => [row.id, row]));
    for (const row of webRows) community.set(row.id, { ...row, available: Boolean(launch),
      ...(row.id === DEFAULT_IM_ID && this.isDefaultIm(web) ? { managedDefault: true } : {}) });
    const officialIds = new Set(officialRows.map(plugin => plugin.id));
    return { plugins: [...officialRows, ...[...community.values()].filter(plugin => !officialIds.has(plugin.id))],
      ...(defaultIm ? { defaultIm } : {}) };
  }

  isDefaultIm(profile) {
    return profile?.data?.vvman?.defaultIm === 'ready' && profile.bundles.includes(DEFAULT_IM_ID);
  }

  ownsDefaultIm(profile) {
    return ['pending', 'ready'].includes(profile?.data?.vvman?.defaultIm);
  }

  initializeDefaultIm() {
    this.initialDefaultIm ??= (async () => {
      const web = await this.webProfile();
      if (web && web.data.vvman?.defaultIm === undefined) {
        const selected = web.bundles.includes(DEFAULT_IM_ID);
        const present = Object.hasOwn(web.data.dependencies ?? {}, DEFAULT_IM_ID);
        let state;
        if (!selected && !present) state = 'pending';
        if (selected && present && await this.community.installed(web, DEFAULT_IM_ID)) state = 'ready';
        if (state) {
          const current = await this.webProfile();
          if (current?.file === web.file && current.data.vvman?.defaultIm === undefined &&
              current.bundles.includes(DEFAULT_IM_ID) === selected &&
              Object.hasOwn(current.data.dependencies ?? {}, DEFAULT_IM_ID) === present &&
              current.data.dependencies?.[DEFAULT_IM_ID] === web.data.dependencies?.[DEFAULT_IM_ID]) {
            current.data.vvman = { ...current.data.vvman, defaultIm: state };
            await this.writeProfileManifest(current.file, current.data);
          }
        }
      }
      return this.ensureDefaultIm();
    })().catch(() => ({ status: 'failed', message: '无法更新默认 DSH IM 配置。' }));
    return this.initialDefaultIm;
  }

  async ensureDefaultIm() {
    if (this.defaultImAttempt) return this.defaultImAttempt;
    if (this.defaultImFailure?.retryAfter > Date.now()) return this.defaultImFailure.state;
    this.defaultImAttempt = this.installDefaultIm().catch(error => {
      const state = { status: 'failed', message: error instanceof Error ? error.message : '无法准备默认 DSH IM。' };
      this.defaultImFailure = { state, retryAfter: Date.now() + 60_000 };
      return state;
    }).finally(() => { this.defaultImAttempt = undefined; });
    return this.defaultImAttempt;
  }

  async installDefaultIm() {
    const web = await this.webProfile();
    if (this.isDefaultIm(web)) return await this.community.installed(web, DEFAULT_IM_ID) ? { status: 'ready' } :
      { status: 'failed', message: '默认 DSH IM 的安装文件不完整。' };
    if (web?.data.vvman?.defaultIm !== 'pending') return undefined;
    const [launch, installer] = await Promise.all([this.launch(), this.community.installer()]);
    if (!launch || !installer) return { status: 'pending', message: '等待 Somnus 托管 DSH 运行时和安装器。' };
    const current = await this.community.installed(web, DEFAULT_IM_ID);
    let version = current?.version;
    if (!current) {
      if (Object.hasOwn(web.data.dependencies ?? {}, DEFAULT_IM_ID)) throw new Error('已有的 DSH IM 安装不完整，已保留原有配置。');
      const metadata = await fetchJson(this.community.fetch,
        `${REGISTRY}/${encodeURIComponent(DEFAULT_IM_ID)}/${DEFAULT_IM_VERSION}`, 512 * 1024, 15_000)
        .catch(() => { throw new Error('无法连接 npm 下载默认 DSH IM，请联网后重试。'); });
      const tarball = URL.parse(metadata?.dist?.tarball);
      if (metadata?.name !== DEFAULT_IM_ID || metadata.version !== DEFAULT_IM_VERSION || !metadata.dsh?.bundle?.patch ||
          tarball?.origin !== REGISTRY || tarball.username || tarball.password || !/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist.integrity ?? '')) {
        throw new Error('无法验证默认 DSH IM 的发行来源。');
      }
      await this.community.validateBundle(metadata);
      version = DEFAULT_IM_VERSION;
    }
    await this.community.withWebMutation(true, async () => {
      let latest = await this.webProfile();
      if (latest?.file !== web.file || latest.data.vvman?.defaultIm !== 'pending') return;
      const installed = await this.community.installed(latest, DEFAULT_IM_ID);
      if (!installed) {
        if (Object.hasOwn(latest.data.dependencies ?? {}, DEFAULT_IM_ID)) throw new Error('默认 DSH IM 的目标配置已更改。');
        await this.community.install(launch, latest, installer, DEFAULT_IM_ID, version, 'web');
        latest = await this.webProfile();
      }
      const verified = await this.community.installed(latest, DEFAULT_IM_ID);
      await this.community.verifyBundle(latest, DEFAULT_IM_ID, verified, true);
      if (!latest.bundles.includes(DEFAULT_IM_ID)) latest.data.dsh.profile.bundles = [...latest.bundles, DEFAULT_IM_ID];
      latest.data.vvman.defaultIm = 'ready';
      await this.writeProfileManifest(latest.file, latest.data);
    });
    return this.isDefaultIm(await this.webProfile()) ? { status: 'ready' } :
      { status: 'pending', message: '默认 DSH IM 的目标配置已更改。' };
  }

  communityStatus(query, refresh, sourceId, options) {
    return this.community.status(query, refresh, sourceId, options);
  }

  communitySetEnabled(id, action, validateSender, options) {
    return this.community.change(id, action, validateSender, options);
  }

  async setInstalledEnabled(id, source, enabled, validateSender, options) {
    if (typeof enabled !== 'boolean' || (source !== 'official' && source !== 'community')) {
      throw new Error('无效的个人插件操作。');
    }
    if (id === DEFAULT_IM_ID && this.ownsDefaultIm(await this.webProfile())) throw new Error('默认 DSH IM 由 Somnus 管理。');
    if (source === 'community') await this.community.setInstalledEnabled(id, enabled, validateSender, options);
    else await this.setOfficialEnabled(id, enabled, validateSender);
    return this.installedPlugins();
  }

  async uninstallInstalledPlugin(id, source, validateSender, { confirm } = {}) {
    if (id === DEFAULT_IM_ID && this.ownsDefaultIm(await this.webProfile())) throw new Error('默认 DSH IM 由 Somnus 管理。');
    if (source === 'community') await this.community.uninstall(id, validateSender, confirm);
    else if (source === 'official') await this.uninstallOfficialPlugin(id, validateSender, confirm);
    else throw new Error('无法卸载此插件');
    return this.installedPlugins();
  }

  async uninstallOfficialPlugin(id, validateSender, confirm) {
    const plugin = OFFICIAL_PLUGINS.find(item => item.id === id);
    if (!plugin || typeof confirm !== 'function') throw new Error('无法卸载此官方插件');
    const { packageName } = plugin;
    const profile = await this.profile();
    if (!isOfficialInstalled(profile, packageName)) return;
    validateSender();
    if (!await confirm({ id, versions: [VERSION] })) return;

    const current = await this.profile();
    if (current?.file !== profile.file) throw new Error('插件配置已变更，请刷新后重试');
    validateSender();
    if (!isOfficialInstalled(current, packageName)) return;
    const { file, data, bundles } = current;
    data.dsh.profile.bundles = bundles.filter(bundle => bundle !== packageName);
    const remembered = data.vvman?.installedOfficialPlugins;
    if (Array.isArray(remembered)) {
      data.vvman.installedOfficialPlugins = remembered.filter(name => name !== packageName);
    }
    await this.writeProfileManifest(file, data);
  }

  async setEnabled(id, enabled, validateSender) {
    await this.setOfficialEnabled(id, enabled, validateSender);
    return this.status();
  }

  async setOfficialEnabled(id, enabled, validateSender = () => {}) {
    const plugin = OFFICIAL_PLUGINS.find(item => item.id === id);
    if (!plugin || typeof enabled !== 'boolean') throw new Error('此插件暂无法在 Somnus 中启用。');
    const [launch, profile, available] = await Promise.all([this.launch(), this.profile(), this.available(plugin)]);
    if (!launch || !profile) throw new Error('独立的 DeepSeek Harness ACP 运行时尚未安装。');
    if (!available) throw new Error('此插件暂无法在 Somnus 中启用。');
    validateSender();
    await this.writeBundleSelection(profile, plugin.packageName, enabled, true);
  }

  async writeBundleSelection({ file, data, bundles }, name, enabled, official = false) {
    if (bundles.includes(name) === enabled) return;
    data.dsh.profile.bundles = enabled ? [...bundles, name] : bundles.filter(bundle => bundle !== name);
    if (official) {
      // Capture previously enabled bundles too, so disabling an older installation keeps it visible.
      const installed = data.vvman?.installedOfficialPlugins;
      const remembered = OFFICIAL_PLUGINS.filter(plugin => plugin.packageName === name ||
        (Array.isArray(installed) && installed.includes(plugin.packageName)));
      data.vvman = { ...data.vvman, installedOfficialPlugins: remembered.map(plugin => plugin.packageName) };
    }
    await this.writeProfileManifest(file, data);
  }

  async writeProfileManifest(file, data) {
    const candidate = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(candidate, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
      await rename(candidate, file);
    } finally {
      await unlink(candidate).catch(() => {});
    }
  }

  settings(validateSender, forChat = false) {
    const resolved = this.settingsQueue.then(() => this.resolveSettings(validateSender, forChat));
    this.settingsQueue = resolved.catch(() => {});
    return resolved;
  }

  async teamToolModule() {
    const installed = await Promise.all(TEAM_PLUGINS.map(async ({ name }) => {
      const metadata = await this.runtimeFile(name, 'package.json').then(readJson).catch(() => null);
      return metadata?.name === name && metadata.version === VERSION;
    }));
    return installed.every(Boolean) ? this.runtimeFile(TEAM_PLUGINS[1].name, 'lib/index.js') : null;
  }

  async teamwork(id) {
    const available = Boolean(this.executionSettings?.setTeamwork) && Boolean(await this.launch()) &&
      Boolean(await this.teamToolModule());
    return { available, enabled: available && this.executionSettings.teamwork(id) === true };
  }

  async resolveSettings(validateSender, forChat) {
    if (this.initialDefaultIm) await this.initialDefaultIm;
    if (this.defaultImAttempt) await this.defaultImAttempt;
    if (this.webPluginMutation) throw new Error('正在更新 DSH 网页插件，请稍后重试。');
    const [launch, web] = await Promise.all([this.launch(), this.webProfile()]);
    if (!launch || !web) throw new Error('托管 DSH Web 运行时或配置不可用。');
    validateSender();
    const imBundle = web.bundles.includes('@xmanrui/dsh-im');
    const [installer, config, installedIm] = await Promise.all([this.community.installer(), this.companyRuntime?.(),
      imBundle ? this.community.installed(web, '@xmanrui/dsh-im') : null]);
    validateSender();
    if (this.webPluginMutation) throw new Error('正在更新 DSH 网页插件，请稍后重试。');
    const imPanel = supportsImPanel(installedIm?.version);
    const current = this.settingsServer;
    if (current && (current.imBundle !== imBundle || current.imPanel !== imPanel || current.config?.revision !== config?.revision ||
        current.config?.ready !== config?.ready)) {
      if (current.chatUsers) throw new Error('DSH 模型配置已变更，请等正在运行的聊天结束，或停止后重试。');
      await this.closeSettings();
    }
    if (forChat && config?.ready === false) {
      throw new Error('请先在设置中填写公司签发给你的 DeepSeek API Key。');
    }
    const server = this.settingsServer ?? this.startSettings(launch, installer, imBundle, config, imPanel);
    await server.ready;
    validateSender();
    if (server !== this.settingsServer) throw new Error('官方 DSH 设置已关闭，请重试。');
    if (forChat) {
      if (config?.ready && !server.companyModel) {
        if (!server.chatUsers) await this.closeSettings();
        throw new Error('托管 DSH 未能启用当前模型配置，请稍后重试。');
      }
      if (this.companyRuntime) {
        const latest = await this.companyRuntime();
        validateSender();
        if (server !== this.settingsServer || latest.revision !== config.revision || latest.ready !== config.ready) {
          if (server === this.settingsServer && !server.chatUsers) await this.closeSettings();
          throw new Error('DSH 模型配置刚刚变更，请重新发送消息。');
        }
      }
      server.chatUsers++;
    }
    return server;
  }

  releaseChatSettings(server) {
    if (server?.chatUsers > 0) server.chatUsers--;
  }

  async accountStatus(validateSender) {
    let server;
    try {
      server = await this.settings(validateSender);
      const status = accountState(await this.account.request(server, 'account/getState'));
      validateSender();
      return { ...status, version: VERSION };
    } catch {
      validateSender();
      return { state: 'unavailable', version: VERSION, message: server ? '暂时无法读取 DeepSeek 账号状态。' : '托管 DSH 账号服务未就绪。' };
    }
  }

  async signInAccount(shell, validateSender) {
    const server = await this.settings(validateSender);
    const status = await this.account.signIn(server, VERSION, validateSender, url => shell.openExternal(url));
    validateSender();
    return { ...status, version: VERSION };
  }

  startSettings(launch, installer, imBundle = false, config, imPanel = false) {
    const server = { imBundle, imPanel, config, chatUsers: 0 };
    this.settingsServer = server;
    server.ready = (async () => {
      const lease = config?.ready === false ? null : await this.openCompanyWeb?.(config?.revision).catch(() => null);
      if (this.settingsServer !== server) {
        await lease?.dispose().catch(() => {});
        throw new Error('官方 DSH 设置已关闭，请重试。');
      }
      const overlay = lease && await (async () => {
        const project = await this.openNativeProjectTools?.();
        const managedProviders = lease.api === 'openai-completions';
        const presetPatch = () => timedQuestionPresets(launch, {
          ...processEnvironment(), DSH_HOME: this.home, DSH_TELEMETRY_DISABLED: '1',
        }, this.home, { managedProviders, models: lease.models ?? [] });
        const questionPresets = managedProviders ? await presetPatch() : project && await presetPatch().catch(() => '');
        return companyWebOverlay(lease, this.executionSettings?.get().loop.maxConcurrent, project, questionPresets,
          await this.teamToolModule(), this.oar)
          .catch(error => { project?.dispose(); throw error; });
      })().catch(async () => { await lease.dispose().catch(() => {}); return null; });
      if (this.settingsServer !== server) {
        await overlay?.dispose();
        throw new Error('官方 DSH 设置已关闭，请重试。');
      }
      server.companyModel = overlay?.model ?? null;
      server.companyModels = overlay?.models ?? [];
      server.modelRevision = lease?.revision;
      server.projectTools = overlay?.projectTools === true;
      server.teamwork = overlay?.teamwork === true;
      server.oar = overlay?.oar === true;
      let panelOverlay;
      server.dispose = () => Promise.allSettled([overlay?.dispose(), panelOverlay?.dispose()]);
      if (imPanel) panelOverlay = await createImPanelOverlay();
      if (this.settingsServer !== server) throw new Error('托管 DSH Web 服务已关闭，请重试。');
      return this.spawnSettings(server, launch, installer, overlay, panelOverlay);
    })().catch(error => {
      if (this.settingsServer === server) this.settingsServer = null;
      void server.dispose?.();
      throw error;
    });
    return server;
  }

  spawnSettings(server, launch, installer, overlay, panelOverlay) {
    const [entry] = launch.args;
    const launcher = installer ? ['--input-type=module', '-e', MANAGED_CLI, '--', entry, installer] : [entry];
    const child = spawn(launch.executable, [
      ...launcher, '--profile', 'web', ...(overlay ? ['--patch', overlay.file] : []),
      ...(panelOverlay ? ['--patch', panelOverlay.file] : []),
      '--host', '127.0.0.1', '--port', '0', '--no-open',
    ], {
      cwd: this.home, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...processEnvironment(), DSH_HOME: this.home, DSH_TELEMETRY_DISABLED: '1', ...overlay?.env },
    });
    server.child = child;
    server.closed = new Promise(resolve => child.once('close', resolve));
    return new Promise((resolve, reject) => {
      const fail = () => {
        clearTimeout(deadline);
        if (this.settingsServer === server) this.settingsServer = null;
        void server.dispose?.();
        reject(new Error('无法启动托管 DSH Web 服务，请稍后重试。'));
      };
      const deadline = setTimeout(() => { child.kill(); fail(); },
        server.imBundle ? IM_WEB_STARTUP_TIMEOUT_MS : WEB_STARTUP_TIMEOUT_MS);
      deadline.unref();
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.setEncoding('utf8');
      let pending = '';
      function read(chunk) {
        pending += chunk;
        let lineEnd = pending.indexOf('\n');
        while (lineEnd >= 0) {
          const line = pending.slice(0, lineEnd).trim();
          pending = pending.slice(lineEnd + 1);
          const match = /^dsh web: (http:\/\/127\.0\.0\.1:(\d{1,5})\/\?token=[A-Za-z0-9_-]{15,256})$/.exec(line);
          if (match && Number(match[2]) > 0 && Number(match[2]) <= 65535) {
            clearTimeout(deadline);
            child.stdout.off('data', read);
            child.stdout.resume();
            resolve(match[1]);
            return;
          }
          lineEnd = pending.indexOf('\n');
        }
        if (pending.length > 4_096) { child.kill(); fail(); }
      }
      child.stdout.on('data', read);
    });
  }

  closeSettings() {
    const server = this.settingsServer;
    this.settingsServer = null;
    server?.child?.kill();
    return Promise.allSettled([server?.closed, server?.dispose?.()]);
  }

  async terminalStartup() {
    const [launch, installer] = await Promise.all([this.launch(), this.community.installer()]);
    if (!launch) return null;
    const script = [
      'function global:dsh {',
      "  $dshArgs = @($args)",
      "  if ($dshArgs.Count -gt 0 -and $dshArgs[0] -eq 'plugin' -and",
      "      -not ($dshArgs | Where-Object { $_ -cmatch '^--profile(?:=|$)' })) {",
      "    $dshArgs = @('plugin', '--profile', 'web') + @($dshArgs | Select-Object -Skip 1)",
      '  }',
      '  if ($env:SOMNUS_DSH_PNPM) {',
      '    & $env:SOMNUS_DSH_NODE --input-type=module -e $env:SOMNUS_DSH_CLI -- $env:SOMNUS_DSH_ENTRY $env:SOMNUS_DSH_PNPM @dshArgs',
      '  } else {',
      '    & $env:SOMNUS_DSH_NODE $env:SOMNUS_DSH_ENTRY @dshArgs',
      '  }',
      '}',
    ].join('\n');
    return {
      args: ['-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      env: {
        DSH_HOME: this.home, DSH_TELEMETRY_DISABLED: '1', SOMNUS_DSH_NODE: launch.executable,
        SOMNUS_DSH_ENTRY: launch.args[0], SOMNUS_DSH_PNPM: installer || '', SOMNUS_DSH_CLI: MANAGED_CLI,
      },
    };
  }

}

module.exports = { DshPluginMarket };

