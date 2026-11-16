const { lstat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { processEnvironment } = require('./acp-stdio.cjs');

const INDEX = 'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json';
const REGISTRY = 'https://registry.npmjs.org/';
const TOOL_VERSION = '11.25.0';
const MARKET_TTL = 5 * 60_000;
const MAX_RESULTS = 40;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;
const safePackage = name => typeof name === 'string' && name.length <= 214 && PACKAGE.test(name);
const translated = value => value?.['zh-cn'] || value?.zh || value?.en || '';
const packagePage = (name, version) => 'https://www.npmjs.com/package/' + name + '/v/' + version;

async function fetchJson(fetcher, url, limit, timeout) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    throw new Error('DSH 市场资源不可用或大小超过限制。');
  }
  const parts = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('DSH 市场资源大小超过限制。');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

function manifestCompatibility(manifest) {
  return manifest?.dsh?.client?.platform === 'web' || manifest?.dsh?.client?.platform === 'desktop'
    ? 'dsh-web' : 'unverified';
}

class DshCommunityMarket {
  constructor(market, localFile, readJson, version, fetcher = globalThis.fetch) {
    this.market = market;
    this.localFile = localFile;
    this.readJson = readJson;
    this.version = version;
    this.fetch = fetcher;
  }

  async tools() {
    const [index, semver] = await Promise.all([
      this.market.runtimeFile('@deepseek-ai/dsh-plugin-market-index', 'lib/index.js'),
      this.market.runtimeFile('semver', 'index.js'),
    ]);
    if (!index || !semver) throw new Error('DSH 社区市场需要 Somnus 托管的 DSH 运行时。');
    const [validator, versions] = await Promise.all([import(pathToFileURL(index).href), import(pathToFileURL(semver).href)]);
    return { ...validator, semver: versions.default };
  }

  async index(refresh) {
    if (!refresh && this.catalog && Date.now() - this.catalog.loaded < MARKET_TTL) return this.catalog;
    if (!this.pending) this.pending = (async () => {
      const [{ parseMarketIndex, semver }, raw] = await Promise.all([
        this.tools(), fetchJson(this.fetch, INDEX, 12 * 1024 * 1024, 18_000),
      ]);
      if (!Array.isArray(raw?.plugins) || raw.plugins.length > 25_000) throw new Error('DSH 社区市场目录格式无效。');
      const { plugins } = parseMarketIndex(raw, INDEX);
      const catalog = { loaded: Date.now(), semver, plugins, byId: new Map(plugins.map(item => [item.name, item])) };
      this.catalog = catalog;
      return catalog;
    })().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async installer() {
    const root = this.market.runtimeRoot ?? this.market.profileDir;
    const tool = 'pnpm-' + TOOL_VERSION;
    const [entry, metadata] = await Promise.all([
      this.localFile(root, 'dsh-tools', tool, 'bin/pnpm.mjs'),
      this.localFile(root, 'dsh-tools', tool, 'package.json').then(this.readJson).catch(() => null),
    ]);
    return entry && metadata?.name === 'pnpm' && metadata.version === TOOL_VERSION ? entry : null;
  }

  selected(item, semver) {
    return item.versions.find(entry => entry.source.type === 'npm' &&
      (!entry.engines.dsh || semver.satisfies(this.version, entry.engines.dsh, { includePrerelease: true })));
  }

  async installed(profile, name) {
    if (!profile || !Object.hasOwn(profile.data.dependencies ?? {}, name)) return null;
    const file = await this.localFile(path.dirname(profile.file), 'node_modules', name, 'package.json');
    const data = await this.readJson(file).catch(() => null);
    const patch = data?.dsh?.bundle?.patch;
    const files = typeof patch === 'string' ? [patch] : patch;
    if (data?.name !== name || typeof data.version !== 'string' || !VERSION.test(data.version) ||
        !Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || !file ||
          /[:\x00-\x1f]/.test(file) || path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) return null;
    const packageRoot = path.dirname(file);
    for (const patchFile of files) {
      if (!await this.localFile(packageRoot, patchFile)) return null;
    }
    return data;
  }

  async installedPlugins(profile, runtimeAvailable) {
    const names = Object.keys(profile.data.dependencies ?? {}).filter(name => safePackage(name) && !name.startsWith('@deepseek-ai/'));
    const plugins = [];
    for (const id of names.sort()) {
      const data = await this.installed(profile, id);
      if (!data) continue;
      const compatibility = manifestCompatibility(data);
      const enabled = profile.bundles.includes(id);
      const title = data.dsh?.title;
      plugins.push({
        id, name: (typeof title === 'string' && title.trim() ? title : id).slice(0, 160),
        description: typeof data.description === 'string' ? data.description.slice(0, 650) : '',
        version: data.version, source: 'community', enabled, compatibility,
        available: runtimeAvailable && (enabled || compatibility !== 'dsh-web'),
      });
    }
    return plugins;
  }

  async setInstalledEnabled(id, enabled, validateSender, { confirm } = {}) {
    if (!safePackage(id) || id.startsWith('@deepseek-ai/') || typeof enabled !== 'boolean' || typeof confirm !== 'function') {
      throw new Error('无效的社区插件操作。');
    }
    const [launch, profile] = await Promise.all([this.market.launch(), this.market.profile()]);
    if (!launch || !profile) throw new Error('DSH 运行时尚未就绪。');
    const metadata = await this.installed(profile, id);
    if (!metadata) throw new Error('未找到已安装的 DSH 社区插件。');
    if (profile.bundles.includes(id) === enabled) return;
    if (!enabled) {
      validateSender();
      await this.market.writeBundleSelection(profile, id, false);
      return;
    }
    await this.enable(profile, id, metadata, validateSender, confirm);
  }

  async status(query = '', refresh = false) {
    if (typeof query !== 'string' || query.length > 200 || typeof refresh !== 'boolean') {
      throw new Error('无效的社区插件搜索。');
    }
    const [launch, profile, installer] = await Promise.all([this.market.launch(), this.market.profile(), this.installer()]);
    const runtime = { installed: Boolean(launch), version: launch ? this.version : null };
    if (!launch || !profile) return { name: 'dsh-market', sourceUrl: INDEX, runtime, plugins: [], total: 0 };
    const { plugins, semver } = await this.index(refresh);
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = plugins.filter(item => !item.name.startsWith('@deepseek-ai/') &&
      terms.every(term => [item.name, translated(item.title), translated(item.description), item.author]
        .some(value => value?.toLowerCase().includes(term))));
    const dependencies = profile.data.dependencies ?? {};
    if (!terms.length) matches.sort((left, right) => Number(Object.hasOwn(dependencies, right.name)) - Number(Object.hasOwn(dependencies, left.name)));
    const items = await Promise.all(matches.slice(0, MAX_RESULTS).map(async item => {
      const version = this.selected(item, semver);
      const current = await this.installed(profile, item.name);
      const offered = version || item.versions[0];
      const compatibility = manifestCompatibility(current);
      return {
        id: item.name,
        name: (translated(item.title) || item.name).slice(0, 160),
        description: translated(item.description).slice(0, 650),
        author: item.author?.slice(0, 160),
        version: offered.version,
        sourceUrl: version ? packagePage(item.name, offered.version) : INDEX,
        present: Boolean(current),
        installed: Boolean(current && profile.bundles.includes(item.name)),
        available: Boolean(installer && version),
        compatibility,
        ...(current ? { installedVersion: current.version } : {}),
        ...(!version ? { reason: '当前 DSH 版本没有可安装的 npm 发行版。' } : {}),
      };
    }));
    return { name: 'dsh-market', sourceUrl: INDEX, runtime, plugins: items, total: matches.length };
  }

  async change(id, action, validateSender, { query = '', confirm } = {}) {
    if (!safePackage(id) || id.startsWith('@deepseek-ai/') || !['install', true, false].includes(action) ||
        typeof query !== 'string' || query.length > 200 || typeof confirm !== 'function') {
      throw new Error('无效的社区插件操作。');
    }
    const [launch, profile, installer, catalog] = await Promise.all([
      this.market.launch(), this.market.profile(), this.installer(), this.index(false),
    ]);
    if (!launch || !profile) throw new Error('DSH 运行时尚未就绪。');
    const item = catalog.byId.get(id);
    if (!item) throw new Error('该插件不在当前 DSH 社区目录里。');
    const current = await this.installed(profile, id);
    if (action === false) {
      if (current && profile.bundles.includes(id)) {
        validateSender();
        await this.market.writeBundleSelection(profile, id, false);
      }
      return this.status(query);
    }

    const chosen = this.selected(item, catalog.semver);
    const version = action === true ? current?.version : chosen?.version;
    if (!version || (action === 'install' && !installer)) throw new Error('请先安装可用的社区插件版本。');
    if (action === 'install' && current) return this.status(query);
    if (action === true && profile.bundles.includes(id)) return this.status(query);
    const sourceUrl = packagePage(id, version);
    const encodedPackage = encodeURIComponent(id);
    const metadata = action === true ? current : await fetchJson(this.fetch, REGISTRY + encodedPackage + '/' +
      encodeURIComponent(version), 512 * 1024, 15_000);
    if (metadata?.name !== id || metadata.version !== version || !metadata.dsh?.bundle?.patch) {
      throw new Error('该发行版未声明有效的 DSH 插件包。');
    }
    if (action === 'install') {
      const distribution = URL.parse(metadata.dist?.tarball);
      if (distribution?.origin !== new URL(REGISTRY).origin || distribution.username || distribution.password ||
          !/^(sha512|sha1)-[A-Za-z0-9+/]+=*$/.test(metadata.dist?.integrity || '')) {
        throw new Error('无法核对社区插件的 npm 发布来源。');
      }
    }
    if (action === true) {
      await this.enable(profile, id, metadata, validateSender, confirm);
      return this.status(query);
    }
    await this.validateBundle(metadata);
    validateSender();
    if (!await confirm({ id, version, sourceUrl, installing: true })) return this.status(query);
    validateSender();
    await this.install(launch, profile, installer, id, version);
    return this.status(query);
  }

  async validateBundle(metadata) {
    const appBoot = await this.market.runtimeFile('@deepseek-ai/dsh-app-boot', 'lib/index.js');
    if (!appBoot) throw new Error('DSH 运行时缺少插件验证组件。');
    const api = await import(pathToFileURL(appBoot).href);
    if (api.evaluatePluginCompatibility(metadata, {}, this.version)) throw new Error('插件声明的版本要求与当前 DSH 运行时不匹配。');
    api.assertBundlePlatform(metadata.dsh.bundle.platforms, process.platform);
    return api;
  }

  async enable(profile, id, metadata, validateSender, confirm) {
    if (manifestCompatibility(metadata) === 'dsh-web') {
      throw new Error('此插件声明了 DSH 网页或桌面客户端组件，请在官方 DSH 的插件页启用。');
    }
    const { bundlePatchPaths, loadOverlayPatches } = await this.validateBundle(metadata);
    validateSender();
    if (!await confirm({ id, version: metadata.version, sourceUrl: packagePage(id, metadata.version), installing: false })) return;
    validateSender();
    const packageRoot = path.join(path.dirname(profile.file), 'node_modules', id);
    for (const patch of bundlePatchPaths(packageRoot, metadata.dsh.bundle)) {
      const relative = path.relative(packageRoot, patch);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !await this.localFile(packageRoot, relative)) {
        throw new Error('社区插件没有可加载的本地配置。');
      }
      loadOverlayPatches('dsh', patch);
    }
    validateSender();
    await this.market.writeBundleSelection(profile, id, true);
  }

  async install(launch, profile, installer, id, version) {
    const [operations, anchor] = await Promise.all([
      this.market.runtimeFile('@deepseek-ai/dsh-plugin-manager', 'lib/types/operations.js'),
      this.market.runtimeFile('@deepseek-ai/dsh', 'package.json'),
    ]);
    if (!operations || !anchor) throw new Error('托管 DSH 安装器不完整。');
    const dir = path.dirname(profile.file);
    const candidate = await lstat(dir);
    if (!candidate.isDirectory() || candidate.isSymbolicLink()) throw new Error('DSH 插件目录无效。');
    const { runPluginCommand } = await import(pathToFileURL(operations).href);
    const result = await runPluginCommand({
      profile: 'acp', dir, installAnchor: anchor, cwd: dir, home: this.market.home,
    }, ['add', id + '@' + version, '--save-exact', '--ignore-scripts', '--registry=' + REGISTRY], {
      command: launch.executable, args: [installer], execution: 'service',
      activateNewBundles: false, outputBytes: 2_048, lockWaitMs: 10_000, idleTimeoutMs: 45_000,
      lookupTimeoutMs: 15_000, signal: AbortSignal.timeout(120_000),
      env: { ...processEnvironment(), NPM_CONFIG_USERCONFIG: 'NUL', NPM_CONFIG_GLOBALCONFIG: 'NUL',
        NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_REGISTRY: REGISTRY,
        NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', CI: '1' },
    });
    if (result.exitCode !== 0) throw new Error(result.timedOut ? 'DSH 社区插件安装超时。' : 'DSH 社区插件安装失败。请检查网络和插件兼容性。');
    const observed = await this.installed(await this.market.profile(), id);
    if (!observed || observed.version !== version) throw new Error('未能验证安装后的 DSH 插件版本。');
  }
}

module.exports = { DshCommunityMarket };
