const { lstat, open, realpath, rename, unlink, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { DshCommunityMarket } = require('./acp-dsh-community.cjs');
const { DshAccount, accountState } = require('./acp-dsh-account.cjs');
const { processEnvironment } = require('./acp-stdio.cjs');

const RUNTIME = '@deepseek-ai/dsh';
const VERSION = '0.2.2-rc.1';
const ENTRY = 'lib/bin.js';
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
  constructor(profileDir, resourcesPath) {
    this.profileDir = profileDir;
    this.resourcesPath = resourcesPath;
    this.home = path.join(profileDir, 'dsh-home');
    this.community = new DshCommunityMarket(this, localFile, readJson, VERSION);
    this.account = new DshAccount();
  }

  runtimeFile(packageName, relative) {
    return localFile(this.profileDir, 'dsh-runtime', VERSION, 'node_modules', packageName, relative);
  }

  get runtimeDir() {
    return path.join(this.profileDir, 'dsh-runtime', VERSION);
  }

  async ownsLaunch(profile) {
    const script = path.join('dsh-runtime', VERSION, 'node_modules', RUNTIME, ENTRY);
    const argument = path.normalize(profile.args[0] || '').toLowerCase();
    if (argument === path.join(this.profileDir, script).toLowerCase()) return true;
    const root = await realpath(this.profileDir).catch(() => null);
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

  async available(plugin) {
    if (plugin !== BADGE && plugin !== PERSONALIZED) return false;
    const metadata = await this.runtimeFile(plugin.packageName, 'package.json').then(readJson).catch(() => null);
    return metadata?.name === plugin.packageName && metadata.version === VERSION &&
      metadata.dsh?.bundle?.patch === './cordis.patch.yml' &&
      Boolean(await this.runtimeFile(plugin.packageName, 'cordis.patch.yml'));
  }

  async catalog() {
    const data = await localFile(this.profileDir, 'dsh-runtime', VERSION, 'official-catalog.json').then(readJson).catch(() => null);
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
    const [launch, profile] = await Promise.all([this.launch(), this.profile()]);
    if (!profile) return { plugins: [] };
    const managed = profile.data.vvman?.installedOfficialPlugins;
    const official = OFFICIAL_PLUGINS.filter(plugin => profile.bundles.includes(plugin.packageName) ||
      (Array.isArray(managed) && managed.includes(plugin.packageName)));
    const [officialRows, communityRows] = await Promise.all([
      Promise.all(official.map(async plugin => ({
        id: plugin.id, name: plugin.name, description: plugin.description, version: VERSION, source: 'official',
        enabled: profile.bundles.includes(plugin.packageName), available: Boolean(launch && await this.available(plugin)),
      }))),
      this.community.installedPlugins(profile, Boolean(launch)),
    ]);
    const officialIds = new Set(officialRows.map(plugin => plugin.id));
    return { plugins: [...officialRows, ...communityRows.filter(plugin => !officialIds.has(plugin.id))] };
  }

  communityStatus(query, refresh) {
    return this.community.status(query, refresh);
  }

  communitySetEnabled(id, action, validateSender, options) {
    return this.community.change(id, action, validateSender, options);
  }

  async setInstalledEnabled(id, source, enabled, validateSender, options) {
    if (typeof enabled !== 'boolean' || (source !== 'official' && source !== 'community')) {
      throw new Error('无效的个人插件操作。');
    }
    if (source === 'community') await this.community.setInstalledEnabled(id, enabled, validateSender, options);
    else await this.setOfficialEnabled(id, enabled, validateSender);
    return this.installedPlugins();
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
    const candidate = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(candidate, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
      await rename(candidate, file);
    } finally {
      await unlink(candidate).catch(() => {});
    }
  }

  async settings(validateSender) {
    const launch = await this.launch();
    if (!launch || !await this.profile()) throw new Error('独立的 DeepSeek Harness ACP 运行时尚未安装。');
    validateSender();
    const server = this.settingsServer ?? this.startSettings(launch);
    await server.ready;
    validateSender();
    if (server !== this.settingsServer) throw new Error('官方 DSH 设置已关闭，请重试。');
    return server;
  }

  async openSettings(shell, validateSender) {
    const server = await this.settings(validateSender);
    await shell.openExternal(await server.ready);
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

  startSettings(launch) {
    const child = spawn(launch.executable, [
      launch.args[0], '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open',
    ], {
      cwd: this.home, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...processEnvironment(), DSH_HOME: this.home, DSH_TELEMETRY_DISABLED: '1' },
    });
    const server = { child };
    this.settingsServer = server;
    server.ready = new Promise((resolve, reject) => {
      const fail = () => {
        clearTimeout(deadline);
        if (this.settingsServer === server) this.settingsServer = null;
        reject(new Error('无法打开独立的官方 DSH 设置，请稍后重试。'));
      };
      const deadline = setTimeout(() => { child.kill(); fail(); }, 30_000);
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
    return server;
  }

  closeSettings() {
    this.settingsServer?.child.kill();
    this.settingsServer = null;
  }
}

module.exports = { DshPluginMarket };

