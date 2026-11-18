const { lstat, mkdir, realpath, readFile, writeFile, rename, unlink } = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { processEnvironment } = require('./acp-stdio.cjs');
const { archiveManifest, assertSourceBundle, assertProtectedMcpUnchanged, buildSourceArchive,
  parsePackageSource, resolvePackageSource, runtimeEntrypoints, sourceNeedsBuild } = require('./acp-dsh-package-source.cjs');

const INDEX = 'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json';
const RICH_CATALOGS = [
  { url: 'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/plugins.json', timeout: 45_000 },
  { url: 'https://awesome-dsh-plugin.com/plugins.json', timeout: 45_000 },
];
const RICH_CATALOG_ORIGIN = 'https://awesome-dsh-plugin.com';
const RICH_CATALOG_MAX_BYTES = 32 * 1024 * 1024;
const RICH_CATALOG_MEDIA = new Set(['raw.githubusercontent.com', 'user-images.githubusercontent.com',
  'camo.githubusercontent.com', 'github.com']);
const REGISTRY = 'https://registry.npmjs.org/';
const TOOL_VERSION = '11.25.0';
const MARKET_TTL = 5 * 60_000;
const RICH_CATALOG_TTL = 30 * 60_000;
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 80;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;
const safePackage = name => typeof name === 'string' && name.length <= 214 && PACKAGE.test(name);
const safeCatalogId = name => safePackage(name) || (typeof name === 'string' && /^rich:[a-f0-9]{40}$/.test(name));
const translated = value => [value?.['zh-cn'], value?.zh, value?.en].find(text => typeof text === 'string' && text) || '';
const packagePage = (name, version) => 'https://www.npmjs.com/package/' + name + '/v/' + version;
const COMMUNITY_SOURCE = { id: 'community', name: '社区插件市场', url: '' };
const DESKTOP_MARKET = { id: 'dsh-market', name: 'DSH Market', url: INDEX };
const PARTNER_SOURCES = [
  { id: 'dsh-1024store', name: 'DSH 1024Store', url: 'https://deepseek1024.com/api/v2/plugins', builtin: true },
  { id: 'dshfind', name: 'dshfind', url: 'https://api.dshfind.com/market/v1/plugins', builtin: true },
];
const DSHFIND_CATALOG = 'https://api.dshfind.com/v1/catalog';

function marketSource(value) {
  const url = typeof value === 'string' && value.length <= 1024 && !/[\\\s]/.test(value) ? URL.parse(value) : null;
  if (url?.protocol !== 'https:' || !url.hostname.includes('.') || url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || isIP(url.hostname) ||
      url.username || url.password || url.search || url.hash) throw new Error('请提供有效的 HTTPS 市场索引地址。');
  return { id: 'source-' + createHash('sha256').update(url.href).digest('hex').slice(0, 20),
    name: url.hostname, url: url.href };
}

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

function catalogWebUrl(value) {
  const url = typeof value === 'string' && value.length <= 4_096 ? URL.parse(value) : null;
  if (url?.protocol !== 'https:' || url.username || url.password) return undefined;
  return url.href;
}

function catalogIconUrl(value) {
  if (typeof value === 'string' && value.length <= 44_000 &&
      /^data:image\/(?:svg\+xml|png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)) return value;
  const icon = catalogWebUrl(value);
  if (!icon) return undefined;
  const host = new URL(icon).hostname.toLowerCase().replace(/\.$/, '');
  return host.includes('.') && !/(?:^|\.)(?:localhost|local|internal)$/.test(host) && !isIP(host) ? icon : undefined;
}

function catalogMediaUrl(value) {
  const valid = catalogWebUrl(value);
  if (!valid) return undefined;
  const { host, pathname } = new URL(valid);
  if (RICH_CATALOG_MEDIA.has(host) && !/\.svg$/i.test(pathname)) return valid;
}

function catalogProjectUrl(value) {
  const valid = catalogWebUrl(value);
  if (!valid) return undefined;
  const { origin, pathname } = new URL(valid);
  if (origin === RICH_CATALOG_ORIGIN && pathname.startsWith('/p/') && pathname.length > 3) {
    return origin + pathname.replace(/\/+$/, '') + '/';
  }
}

function catalogRepository(value) {
  const valid = catalogWebUrl(value);
  if (!valid) return undefined;
  const { host, pathname } = new URL(valid);
  if (host !== 'github.com') return undefined;
  const [, owner, repo] = pathname.split('/');
  if (!owner || !repo || !/^[a-z\d-]{1,39}$/i.test(owner) || !/^[a-z\d._-]{1,100}$/i.test(repo)) return undefined;
  return { owner, key: `${owner}/${repo.replace(/\.git$/i, '')}`.toLowerCase() };
}

function richCatalogIndex({ plugins } = {}) {
  if (!Array.isArray(plugins) || plugins.length > 25_000 || !plugins.length) throw new Error('插件市场扩展目录格式无效。');
  const pages = new Map();
  const npm = new Map();
  for (const entry of plugins) {
    const page = catalogProjectUrl(entry?.page);
    const repo = catalogRepository(entry?.url);
    if (!page || !repo) continue;
    const row = { entry, page, repo };
    pages.set(page, pages.has(page) ? null : row);
    if (safePackage(entry.npm)) npm.set(entry.npm, npm.has(entry.npm) ? null : row);
  }
  if (!pages.size) throw new Error('插件市场扩展目录没有可识别条目。');
  return { pages, npm };
}

function richCatalogEntry(index, item) {
  if (!index) return undefined;
  const page = catalogProjectUrl(item.homepage);
  const repository = catalogRepository(item.repository?.url);
  // The publisher emits the same project URL in both formats, including its monorepo slug.
  const row = page ? index.pages.get(page) : index.npm.get(item.name);
  if (!row || (!page && !repository) || (repository && repository.key !== row.repo.key) ||
      (safePackage(row.entry.npm) && row.entry.npm !== item.name)) return undefined;
  return row;
}

const catalogCount = count => Number.isSafeInteger(count) && count >= 0 ? count : undefined;
const catalogDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) ? date : undefined;

function richCatalogFields(row, item) {
  if (!row) return {};
  const { entry, repo } = row;
  const npmCount = catalogCount(entry.downloads);
  const githubCount = catalogCount(entry.githubReleaseDownloads);
  const iconUrl = catalogMediaUrl(entry.icon);
  const release = catalogWebUrl(entry.tarball);
  const installReference = release && new URL(release).origin === 'https://github.com' &&
    /\/releases\/(?:download\/[^/]+|latest\/download)\/[^/]+\.(?:tgz|tar\.gz)$/i.test(new URL(release).pathname) ?
    release : catalogWebUrl(entry.url);
  const screenshots = Array.isArray(entry.screenshots) ?
    [...new Set(entry.screenshots.slice(0, 24).map(catalogMediaUrl).filter(Boolean))].slice(0, 6).map(url => ({ url })) : [];
  return {
    author: item.author?.slice(0, 160) || repo.owner,
    authorAvatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(repo.owner)}?size=96`,
    iconUrl,
    repositoryUrl: catalogWebUrl(entry.url),
    installReference,
    commentsUrl: row.page,
    addedAt: catalogDate(entry.added),
    stars: catalogCount(entry.stars),
    ...(typeof entry.install === 'string' && entry.install.startsWith('dsh plugin --profile web add ') ? { hostRequirement: 'web' } : {}),
    ...(npmCount !== undefined ? { downloads: npmCount, downloadSource: 'npm' } :
      githubCount !== undefined ? { downloads: githubCount, downloadSource: 'github' } : {}),
    ...(screenshots.length ? { screenshots } : {}),
  };
}

function communityCatalogRows(plugins, rich) {
  if (!rich) return plugins;
  const representedPages = new Set();
  const rows = [];
  for (const item of plugins) {
    if (item.name === 'dshmarket') continue;
    const storefront = richCatalogEntry(rich, item);
    if (storefront) representedPages.add(storefront.page);
    rows.push({ ...item, storefront });
  }
  for (const storefront of rich.pages.values()) {
    if (!storefront || representedPages.has(storefront.page)) continue;
    const { entry, page } = storefront;
    if (entry.npm === 'dshmarket' || entry.name === 'dsh-market') continue;
    const name = 'rich:' + createHash('sha256').update(page).digest('hex').slice(0, 40);
    rows.push({ name, title: { en: typeof entry.name === 'string' ? entry.name : storefront.repo.key },
      description: entry.description, author: storefront.repo.owner,
      metadata: { category: typeof entry.category === 'string' ? entry.category : undefined },
      homepage: page, storefront, browseOnly: true, versions: [] });
  }
  return rows;
}

function providerCatalogPlugin(entry, sourceId) {
  const isDshfind = sourceId === 'dshfind';
  if (!entry || (isDshfind && (entry.is_plugin !== true || entry.is_risky === true))) return undefined;
  const id = isDshfind ? entry.full_name : entry.id;
  const repositoryUrl = catalogWebUrl(isDshfind ? entry.repository_url : entry.url);
  const repository = catalogRepository(repositoryUrl);
  if (!repository || typeof id !== 'string' || !id || id.length > 200 ||
      (isDshfind && id.toLowerCase() !== repository.key) || typeof entry.name !== 'string' || !entry.name) return undefined;
  const category = typeof entry.category === 'string' && /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(entry.category) ? entry.category : undefined;
  const description = isDshfind ? entry.description : translated(entry.description);
  const date = Date.parse(isDshfind ? entry.pushed_at : entry.pushedAt);
  const avatar = `https://avatars.githubusercontent.com/${encodeURIComponent(repository.owner)}?size=96`;
  const icon = catalogWebUrl(entry.media?.icon?.url);
  const iconHost = icon && new URL(icon).host;
  const parts = id.split('/');
  const subdirectory = !isDshfind && parts.slice(0, 2).join('/').toLowerCase() === repository.key &&
    parts.length > 2 && parts.slice(2).every(part => /^[a-z\d._-]+$/i.test(part) && part !== '.' && part !== '..') ?
    parts.slice(2).join('/') : '';
  return {
    id: 'rich:' + createHash('sha256').update(sourceId + '\0' + id).digest('hex').slice(0, 40),
    name: entry.name.slice(0, 160), description: typeof description === 'string' ? description.slice(0, 650) : '',
    sourceUrl: repositoryUrl, repositoryUrl, author: repository.owner, authorAvatarUrl: avatar,
    installReference: subdirectory ? `github:${parts.slice(0, 2).join('/')}#path:${subdirectory}` : repositoryUrl,
    ...(['deepseek1024.com', 'github.com', 'avatars.githubusercontent.com'].includes(iconHost) ? { iconUrl: icon } : {}),
    ...(Number.isFinite(date) ? { updatedAt: new Date(date).toISOString() } : {}),
    ...(category ? { categories: [category] } : {}),
    addedAt: catalogDate((isDshfind ? entry.first_seen_at : entry.added)?.slice?.(0, 10)),
    stars: catalogCount(entry.stars),
    browseOnly: true, version: '', installed: false, available: false,
  };
}

function catalogQuery(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('无效的插件目录选项。');
  const { page = 1, pageSize = DEFAULT_PAGE_SIZE, sort = 'default', category,
    installedOnly = false, includeIds, excludeIds } = options;
  const validIds = ids => ids === undefined || (Array.isArray(ids) && ids.length <= 1_000 && ids.every(safeCatalogId));
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE ||
      !['default', 'name', 'newest'].includes(sort) || (category !== undefined &&
        (typeof category !== 'string' || category.length > 100)) || typeof installedOnly !== 'boolean' ||
      !validIds(includeIds) || !validIds(excludeIds)) throw new Error('无效的插件目录选项。');
  return { page, pageSize, sort, category, installedOnly, included: includeIds && new Set(includeIds), excluded: new Set(excludeIds) };
}

class DshCommunityMarket {
  constructor(market, localFile, readJson, version, fetcher = globalThis.fetch) {
    this.market = market;
    this.localFile = localFile;
    this.readJson = readJson;
    this.version = version;
    this.fetch = fetcher;
    this.sourcesFile = path.join(market.profileDir, 'dsh-market-sources.json');
    this.catalogs = new Map();
    this.pendingCatalogs = new Map();
    this.sourceWrites = Promise.resolve();
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

  async sources() {
    const file = await lstat(this.sourcesFile).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!file) return [...PARTNER_SOURCES];
    if (!file.isFile() || file.isSymbolicLink() || file.size > 8192) throw new Error('本机插件市场来源配置无效。');
    const text = await readFile(this.sourcesFile, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    });
    const rows = text.length <= 8192 ? JSON.parse(text) : null;
    if (!Array.isArray(rows) || rows.length > 6) throw new Error('本机插件市场来源配置无效。');
    return [...PARTNER_SOURCES, ...rows.map(marketSource)];
  }

  setSources(urls, validateSender) {
    if (!Array.isArray(urls) || urls.length > 6) throw new Error('最多可以配置 6 个自定义市场。');
    const entries = [...new Map(urls.map(value => {
      const source = marketSource(value);
      return [source.url, source];
    })).values()].filter(source => source.url !== INDEX && !PARTNER_SOURCES.some(partner => partner.url === source.url));
    const saved = this.sourceWrites.then(async () => {
      validateSender();
      const stage = this.sourcesFile + '.' + randomUUID();
      try {
        await writeFile(stage, JSON.stringify(entries.map(source => source.url)), { flag: 'wx', mode: 0o600 });
        validateSender();
        await rename(stage, this.sourcesFile);
      } finally {
        await unlink(stage).catch(() => {});
      }
      return { sources: [...PARTNER_SOURCES, ...entries] };
    });
    this.sourceWrites = saved.catch(() => {});
    return saved;
  }

  async index(refresh, sourceId = 'dsh-market') {
    const source = sourceId === DESKTOP_MARKET.id ? DESKTOP_MARKET :
      (await this.sources()).find(entry => entry.id === sourceId && !entry.builtin);
    if (!source) throw new Error('此插件市场来源已删除或不可用。');
    const previous = this.catalogs.get(source.id);
    if (!refresh && previous && Date.now() - previous.loaded < MARKET_TTL) return previous;
    if (!this.pendingCatalogs.has(source.id)) this.pendingCatalogs.set(source.id, (async () => {
      const [{ parseMarketIndex, semver }, raw] = await Promise.all([
        this.tools(), fetchJson(this.fetch, source.url, 12 * 1024 * 1024, 18_000),
      ]);
      if (!Array.isArray(raw?.plugins) || raw.plugins.length > 25_000) throw new Error('DSH 社区市场目录格式无效。');
      const { plugins, metadata } = parseMarketIndex(raw, source.url);
      const catalog = { loaded: Date.now(), source, semver, plugins, metadata, byId: new Map(plugins.map(item => [item.name, item])) };
      this.catalogs.set(source.id, catalog);
      return catalog;
    })().finally(() => this.pendingCatalogs.delete(source.id)));
    return this.pendingCatalogs.get(source.id);
  }

  async richIndex(refresh) {
    if (!refresh && this.richCatalog?.until > Date.now()) return this.richCatalog.value;
    if (!this.pendingRichCatalog) this.pendingRichCatalog = (async () => {
      for (const { url, timeout } of RICH_CATALOGS) {
        try {
          const result = await fetchJson(this.fetch, url, RICH_CATALOG_MAX_BYTES, timeout);
          const value = richCatalogIndex(result);
          this.richCatalog = { value, until: Date.now() + RICH_CATALOG_TTL };
          return value;
        } catch {
          // Try the other published endpoint before falling back to the install index.
        }
      }
      const value = this.richCatalog?.value;
      this.richCatalog = { value, until: Date.now() + 60_000 };
      return value;
    })().finally(() => { this.pendingRichCatalog = undefined; });
    return this.pendingRichCatalog;
  }

  async dshfindCatalog(refresh) {
    if (!refresh && this.cachedDshfind?.until > Date.now()) return this.cachedDshfind.rows;
    if (!this.pendingDshfind) this.pendingDshfind = (async () => {
      const raw = await fetchJson(this.fetch, DSHFIND_CATALOG, 48 * 1024 * 1024, 60_000);
      if (!Array.isArray(raw?.data) || raw.data.length !== raw.total || raw.total > 50_000 ||
          !/^sha256:[a-f0-9]{64}$/.test(raw.data_version)) throw new Error('dshfind 目录格式无效。');
      const rows = [...new Map(raw.data.map(item => providerCatalogPlugin(item, 'dshfind')).filter(Boolean)
        .map(item => [item.id, item])).values()];
      this.cachedDshfind = { rows, until: Date.now() + MARKET_TTL };
      return rows;
    })().finally(() => { this.pendingDshfind = undefined; });
    return this.pendingDshfind;
  }

  async partnerStatus(source, query, refresh, { page, pageSize, sort, category, installedOnly, included, excluded }, result) {
    if (installedOnly) return { ...result, plugins: [], categories: [], page: 1, total: 0 };
    if (source.id === 'dshfind') {
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const categories = new Map();
      const matches = (await this.dshfindCatalog(refresh)).filter(item => {
        if ((included && !included.has(item.id)) || excluded.has(item.id) ||
            !terms.every(term => [item.name, item.description, item.author].some(text => text.toLowerCase().includes(term)))) return false;
        const id = item.categories?.[0];
        if (id) categories.set(id, (categories.get(id) ?? 0) + 1);
        return !category || category === id;
      });
      if (sort === 'newest') matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      else if (sort === 'name') matches.sort((a, b) => a.name.localeCompare(b.name));
      const current = Math.min(page, Math.max(1, Math.ceil(matches.length / pageSize)));
      const offset = (current - 1) * pageSize;
      return { ...result, page: current, total: matches.length, plugins: matches.slice(offset, offset + pageSize),
        categories: [...categories].map(([id, count]) => ({ id, label: id, count })) };
    }

    const url = new URL(source.url);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(pageSize));
    if (query.trim()) url.searchParams.set('q', query.trim());
    if (category) url.searchParams.set('category', category);
    if (sort !== 'default') url.searchParams.set('sort', sort === 'newest' ? 'active' : 'name');
    const raw = await fetchJson(this.fetch, url.href, 4 * 1024 * 1024, 25_000);
    if (!Array.isArray(raw?.plugins) || !Number.isSafeInteger(raw.total) || raw.total < 0 || raw.total > 100_000 ||
        raw.limit !== pageSize || raw.plugins.length > pageSize || raw.page !== Math.min(page, Math.max(1, Math.ceil(raw.total / pageSize)))) {
      throw new Error('DSH 1024Store 目录格式无效。');
    }
    const plugins = raw.plugins.map(item => providerCatalogPlugin(item, source.id)).filter(item =>
      item && (!included || included.has(item.id)) && !excluded.has(item.id));
    const categories = Array.isArray(raw.categories) ? raw.categories.slice(0, 100).filter(item =>
      typeof item?.id === 'string' && /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(item.id) && catalogCount(item.count) !== undefined)
      .map(item => ({ id: item.id, label: translated(item.label) || item.id, count: item.count })) : [];
    return { ...result, page: raw.page, total: raw.total, categories, plugins };
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
    return this.compatible(item, semver)[0];
  }

  compatible(item, semver) {
    return item.versions.filter(entry => entry.source.type === 'npm' &&
      (!entry.engines.dsh || semver.satisfies(this.version, entry.engines.dsh, { includePrerelease: true })));
  }

  async installed(profile, name) {
    if (!profile || !Object.hasOwn(profile.data.dependencies ?? {}, name)) return null;
    const packageRoot = await this.packageRoot(profile, name);
    const file = packageRoot && await this.localFile(packageRoot, 'package.json');
    const data = await this.readJson(file).catch(() => null);
    const patch = data?.dsh?.bundle?.patch;
    const files = typeof patch === 'string' ? [patch] : patch;
    if (data?.name !== name || typeof data.version !== 'string' || !VERSION.test(data.version) ||
        !Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || !file ||
          /[:\x00-\x1f]/.test(file) || path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) return null;
    for (const patchFile of files) {
      if (!await this.localFile(packageRoot, patchFile)) return null;
    }
    return data;
  }

  async packageRoot(profile, name) {
    if (!profile || !safePackage(name)) return null;
    const modules = path.join(path.dirname(profile.file), 'node_modules');
    try {
      const info = await lstat(modules);
      if (info.isSymbolicLink() || !info.isDirectory()) return null;
      const resolved = await realpath(path.join(modules, name));
      const relative = path.relative(await realpath(modules), resolved);
      return relative && !path.isAbsolute(relative) && !relative.split(path.sep).includes('..') ? resolved : null;
    } catch {
      return null;
    }
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
    const [launch, legacy, web] = await Promise.all([this.market.launch(), this.market.profile(), this.market.webProfile()]);
    const installedWeb = web && await this.installed(web, id);
    const profile = installedWeb ? web : legacy;
    if (!launch || !profile) throw new Error('DSH 运行时尚未就绪。');
    const metadata = await this.installed(profile, id);
    if (!metadata) throw new Error('未找到已安装的 DSH 社区插件。');
    if (profile.bundles.includes(id) === enabled) return;
    if (!enabled) {
      validateSender();
      await this.market.writeBundleSelection(profile, id, false);
      if (installedWeb) this.market.closeSettings();
      return;
    }
    await this.enable(profile, id, metadata, validateSender, confirm, Boolean(installedWeb));
  }

  async uninstall(id, validateSender, confirm) {
    if (!safePackage(id) || id.startsWith('@deepseek-ai/') || typeof confirm !== 'function') {
      throw new Error('只能卸载个人安装的插件。');
    }
    const [launch, installer] = await Promise.all([this.market.launch(), this.installer()]);
    if (!launch || !installer) throw new Error('当前插件运行环境不可用，无法卸载。');
    const profiles = ['acp', 'web'].map(name => ({ name, read: () => name === 'acp' ? this.market.profile() : this.market.webProfile() }));
    const targets = [];
    for (const profile of profiles) {
      const manifest = await profile.read();
      if (!Object.hasOwn(manifest?.data.dependencies ?? {}, id)) continue;
      const installed = await this.installed(manifest, id);
      if (installed) targets.push({ ...profile, manifest, version: installed.version });
    }
    if (!targets.length) throw new Error('当前配置中没有可以卸载的个人插件。');
    validateSender();
    if (!await confirm({ id, versions: [...new Set(targets.map(target => target.version))] })) return;
    return this.withWebMutation(targets.some(target => target.name === 'web'), async () => {
      for (const target of targets) {
        const manifest = await target.read();
        if (!manifest || manifest.file !== target.manifest.file) throw new Error('插件配置已更改，请刷新后重试。');
        if (!Object.hasOwn(manifest.data.dependencies ?? {}, id)) continue;
        if (manifest.data.dependencies[id] !== target.manifest.data.dependencies[id] ||
            (await this.installed(manifest, id))?.version !== target.version) {
          throw new Error('插件版本已更改，请刷新后重试。');
        }
        validateSender();
        let result, observed, removed;
        try {
          result = await this.runPackageCommand(launch, manifest, installer, target.name, ['remove', id, '--config.ignore-scripts=true']);
        } finally {
          observed = await target.read();
          removed = observed?.file === manifest.file && !Object.hasOwn(observed.data.dependencies ?? {}, id);
          if (removed) await this.market.writeBundleSelection(observed, id, false);
        }
        if (!observed || observed.file !== manifest.file) throw new Error('无法核对卸载后的插件配置。');
        if (result.exitCode !== 0 || !removed) {
          throw new Error(result.timedOut ? '卸载插件超时，请刷新插件列表。' : '未能卸载插件，请刷新插件列表后重试。');
        }
      }
    });
  }

  async status(query = '', refresh = false, sourceId = 'community', options) {
    if (typeof query !== 'string' || query.length > 200 || typeof refresh !== 'boolean') {
      throw new Error('无效的社区插件搜索。');
    }
    const filters = catalogQuery(options);
    const { page: requestedPage, pageSize, sort, category, installedOnly, included, excluded } = filters;
    const [launch, profile, web, installer, sources] = await Promise.all([
      this.market.launch(), this.market.profile(), this.market.webProfile(), this.installer(), this.sources(),
    ]);
    const source = sourceId === COMMUNITY_SOURCE.id ? COMMUNITY_SOURCE : sourceId === DESKTOP_MARKET.id ? DESKTOP_MARKET :
      sources.find(entry => entry.id === sourceId);
    if (!source) throw new Error('此插件市场来源已删除或不可用。');
    const runtime = { installed: Boolean(launch), version: launch ? this.version : null };
    const result = { name: source.name, sourceUrl: source.url, sources, runtime, pageSize };
    if (source.builtin) return this.partnerStatus(source, query, refresh, filters, result);
    if (sourceId === COMMUNITY_SOURCE.id || !launch || (!profile && !web)) {
      return { ...result, plugins: [], categories: [], page: 1, total: 0 };
    }
    const [catalog, rich] = await Promise.all([
      this.index(refresh, sourceId), sourceId === DESKTOP_MARKET.id ? this.richIndex(refresh) : undefined,
    ]);
    if (this.browseCatalog?.catalog !== catalog || this.browseCatalog.rich !== rich) {
      this.browseCatalog = { catalog, rich, rows: communityCatalogRows(catalog.plugins, rich) };
    }
    const { rows: plugins } = this.browseCatalog;
    const { semver, metadata } = catalog;
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const dependencies = { ...profile?.data.dependencies, ...web?.data.dependencies };
    const present = item => Object.hasOwn(dependencies, item.name);
    const categoryCounts = new Map();
    const matches = [];
    for (const item of plugins) {
      if (item.name.startsWith('@deepseek-ai/') || (installedOnly && !present(item)) ||
          (included && !included.has(item.name)) || excluded.has(item.name)) continue;
      const fields = [item.name, translated(item.title), translated(item.description), item.author,
        item.storefront?.repo.key, item.storefront?.entry.npm,
        ...(item.metadata?.keywords ?? []), ...(item.metadata?.labels ?? [])];
      if (!terms.every(term => fields.some(value => typeof value === 'string' && value.toLowerCase().includes(term)))) continue;
      const id = item.metadata?.category;
      if (id) categoryCounts.set(id, (categoryCounts.get(id) ?? 0) + 1);
      if (!category || id === category) matches.push(item);
    }
    const categories = [...categoryCounts].map(([id, count]) => ({
      id, label: (translated(metadata?.categories?.[id]?.title) || id).slice(0, 160), count,
    }));
    if (sort === 'newest') {
      const dates = new Map(matches.map(item => {
        const added = catalogDate(item.storefront?.entry.added);
        const released = (this.selected(item, semver) ?? item.versions[0])?.publishTimestamp ?? -1;
        return [item.name, added ? Date.parse(added) / 1_000 : released];
      }));
      matches.sort((left, right) => dates.get(right.name) - dates.get(left.name));
    } else if (sort === 'name') {
      matches.sort((left, right) => (translated(left.title) || left.name).localeCompare(translated(right.title) || right.name));
    } else if (rich) {
      matches.sort((left, right) => {
        const a = left.storefront?.entry;
        const b = right.storefront?.entry;
        return (catalogCount(b?.downloads) ?? -1) - (catalogCount(a?.downloads) ?? -1) ||
          (catalogCount(b?.stars) ?? -1) - (catalogCount(a?.stars) ?? -1);
      });
    } else if (!terms.length) {
      matches.sort((left, right) => Number(present(right)) - Number(present(left)));
    }
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(matches.length / pageSize)));
    const offset = (page - 1) * pageSize;
    const items = await Promise.all(matches.slice(offset, offset + pageSize).map(async item => {
      const category = item.metadata?.category;
      const presentation = { id: item.name, name: (translated(item.title) || item.name).slice(0, 160),
        description: translated(item.description).slice(0, 650), author: item.author?.slice(0, 160),
        iconUrl: catalogIconUrl(item.icon), homepageUrl: catalogWebUrl(item.homepage),
        repositoryUrl: catalogWebUrl(item.repository?.url), ...(category ? { categories: [category] } : {}),
        ...richCatalogFields(item.storefront, item) };
      if (item.browseOnly) return { ...presentation, browseOnly: true, sourceUrl: item.homepage,
        version: '', available: false, installed: false };
      const versions = this.compatible(item, semver);
      const version = versions[0];
      const currentWeb = web && await this.installed(web, item.name);
      const current = currentWeb || (profile && await this.installed(profile, item.name));
      const installedProfile = currentWeb ? web : profile;
      const offered = version || item.versions[0];
      const compatibility = manifestCompatibility(current);
      return {
        ...presentation,
        version: offered.version,
        sourceUrl: version ? packagePage(item.name, offered.version) : INDEX,
        present: Boolean(current),
        installed: Boolean(current && installedProfile.bundles.includes(item.name)),
        available: Boolean(installer && version),
        compatibility,
        versions: versions.slice(0, 30).map(entry => entry.version),
        ...(Number.isInteger(offered.publishTimestamp) ? { updatedAt: new Date(offered.publishTimestamp * 1_000).toISOString() } : {}),
        canUpdate: Boolean(installer && version && current && semver.gt(version.version, current.version)),
        ...(current ? { installedVersion: current.version } : {}),
        ...(!version ? { reason: '当前 DSH 版本没有可安装的 npm 发行版。' } : {}),
      };
    }));
    return { ...result, plugins: items, categories, page, total: matches.length };
  }

  async change(id, action, validateSender, { query = '', confirm, marketSource: sourceId = 'community', requestedVersion } = {}) {
    if (!safePackage(id) || id.startsWith('@deepseek-ai/') || !['install', 'version', true, false].includes(action) ||
        typeof query !== 'string' || query.length > 200 || typeof confirm !== 'function') {
      throw new Error('无效的社区插件操作。');
    }
    if (id === '@xmanrui/dsh-im' && this.market.ownsDefaultIm?.(await this.market.webProfile())) {
      throw new Error('默认 DSH IM 由 Somnus 管理。');
    }
    const [launch, acp, web, installer, catalog] = await Promise.all([
      this.market.launch(), this.market.profile(), this.market.webProfile(), this.installer(), this.index(false, sourceId),
    ]);
    if (!launch || (!acp && !web)) throw new Error('DSH 运行时尚未就绪。');
    const item = catalog.byId.get(id);
    if (!item) throw new Error('该插件不在当前 DSH 社区目录里。');
    const currentWeb = web && await this.installed(web, id);
    const current = currentWeb || (acp && await this.installed(acp, id));
    const currentProfile = currentWeb ? web : acp;
    if (action === false) {
      if (current && currentProfile.bundles.includes(id)) {
        await this.withWebMutation(Boolean(currentWeb), async () => {
          validateSender();
          await this.market.writeBundleSelection(currentProfile, id, false);
        });
      }
      return this.status(query, false, sourceId);
    }

    const isInstall = action === 'install' || action === 'version';
    const chosen = action === 'version' && typeof requestedVersion === 'string' && VERSION.test(requestedVersion)
      ? this.compatible(item, catalog.semver).find(entry => entry.version === requestedVersion)
      : action === 'version' ? undefined : this.selected(item, catalog.semver);
    const version = action === true ? current?.version : chosen?.version;
    if (!version || (isInstall && !installer)) throw new Error('请选择此来源提供的兼容插件版本。');
    if ((action === 'install' && current) || (action === 'version' && current?.version === version) ||
        (action === true && currentProfile?.bundles.includes(id))) return this.status(query, false, sourceId);
    const sourceUrl = packagePage(id, version);
    const encodedPackage = encodeURIComponent(id);
    const metadata = action === true ? current : await fetchJson(this.fetch, REGISTRY + encodedPackage + '/' +
      encodeURIComponent(version), 512 * 1024, 15_000);
    if (metadata?.name !== id || metadata.version !== version || !metadata.dsh?.bundle?.patch) {
      throw new Error('该发行版未声明有效的 DSH 插件包。');
    }
    if (isInstall) {
      const distribution = URL.parse(metadata.dist?.tarball);
      if (distribution?.origin !== new URL(REGISTRY).origin || distribution.username || distribution.password ||
          !/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist?.integrity || '')) {
        throw new Error('无法核对社区插件的 npm 发布来源。');
      }
    }
    if (action === true) {
      await this.enable(currentProfile, id, metadata, validateSender, confirm, Boolean(currentWeb));
      return this.status(query, false, sourceId);
    }
    const webOnly = manifestCompatibility(metadata) === 'dsh-web' ||
      metadata.dsh.compatibility?.profiles?.includes('web') && !metadata.dsh.compatibility.profiles.includes('acp');
    const supported = metadata.dsh.compatibility?.profiles;
    const webSupported = !Array.isArray(supported) || supported.includes('web');
    const target = current ? currentProfile : webOnly ? web : webSupported && web ? web : acp;
    const profileName = target === web ? 'web' : 'acp';
    if (!target || (webOnly && profileName !== 'web') ||
        (Array.isArray(metadata.dsh.compatibility?.profiles) && !metadata.dsh.compatibility.profiles.includes(profileName))) {
      throw new Error('此版本与插件当前使用的 DSH 配置不兼容。');
    }
    await this.validateBundle(metadata);
    validateSender();
    if (!await confirm({ id, version, sourceUrl, installing: true })) return this.status(query, false, sourceId);
    validateSender();
    await this.withWebMutation(profileName === 'web', async () => {
      validateSender();
      const active = target.bundles.includes(id);
      const reload = () => profileName === 'web' ? this.market.webProfile() : this.market.profile();
      try {
        await this.install(launch, target, installer, id, version, profileName);
        if (active) {
          const profile = await reload();
          await this.verifyBundle(profile, id, await this.installed(profile, id));
        }
      } catch (error) {
        if (!current) throw error;
        const profile = await reload().catch(() => null);
        const installed = profile && await this.installed(profile, id).catch(() => null);
        if (installed?.version === current.version) throw error;
        try {
          await this.install(launch, target, installer, id, current.version, profileName);
        } catch {
          throw new Error('更新未完成，恢复原插件版本也失败。请在插件市场重新安装 ' + current.version + '。');
        }
        throw new Error('更新未完成，已恢复原插件版本 ' + current.version + '。');
      }
    });
    return this.status(query, false, sourceId);
  }

  async withWebMutation(active, operation) {
    if (!active) return operation();
    if (this.market.settingsServer?.chatUsers || this.market.webPluginMutation) {
      throw new Error('请先结束正在运行的 DSH 聊天或插件操作。');
    }
    this.market.webPluginMutation = true;
    try {
      await this.market.closeSettings();
      return await operation();
    } finally {
      this.market.webPluginMutation = false;
    }
  }

  async installSource(reference, validateSender, confirm) {
    if (typeof confirm !== 'function') throw new Error('需要确认插件来源。');
    validateSender();
    const [launch, acp, web, installer] = await Promise.all([
      this.market.launch(), this.market.profile(), this.market.webProfile(), this.installer(),
    ]);
    if (!launch || !installer || (!acp && !web)) throw new Error('Somnus 托管的 DSH 安装器尚未就绪。');
    const resolved = await resolvePackageSource(reference, { fetch: this.fetch, fetchJson, tools: () => this.tools() });
    assertSourceBundle(resolved.metadata);
    await this.validateBundle(resolved.metadata);
    const { name: id, version, dsh } = resolved.metadata;
    if (id === '@xmanrui/dsh-im' && this.market.ownsDefaultIm?.(web)) throw new Error('默认 DSH IM 由 Somnus 管理。');
    const allowed = dsh.compatibility?.profiles;
    const supports = profile => !Array.isArray(allowed) || allowed.includes(profile);
    const webOnly = manifestCompatibility(resolved.metadata) === 'dsh-web';
    const target = web && supports('web') ? web : !webOnly && supports('acp') ? acp : null;
    if (!target) throw new Error('此插件与当前 Somnus DSH 配置不兼容。');
    const profileName = target === web ? 'web' : 'acp';
    const loadProfile = () => profileName === 'web' ? this.market.webProfile() : this.market.profile();
    const current = await this.installed(target, id);
    const sourceKey = createHash('sha256').update(resolved.sourceUrl).digest('hex');
    const archiveDirectory = '.somnus-plugin-archives';
    if (Object.hasOwn(target.data.dependencies ?? {}, id)) {
      const previous = target.data.dependencies[id];
      const archiveRoot = path.join(path.dirname(target.file), archiveDirectory);
      let same = resolved.kind === 'npm' && previous === version;
      if (typeof previous === 'string' && previous.startsWith('file:')) {
        const file = path.resolve(path.dirname(target.file), previous.slice(5));
        same = path.dirname(file) === archiveRoot &&
          new RegExp(`^${sourceKey}-${resolved.hash ?? '[a-f0-9]{64}'}\\.tgz$`).test(path.basename(file));
      } else if (resolved.kind === 'git') {
        try {
          const git = parsePackageSource(previous);
          same = git.kind === 'git' && git.ref.toLowerCase() === resolved.sha.toLowerCase() &&
            git.owner.toLowerCase() === resolved.owner.toLowerCase() && git.repo.toLowerCase() === resolved.repo.toLowerCase() &&
            git.directory === resolved.directory;
        } catch { /* This profile contains an unrelated spec. */ }
      }
      if (!current || current.version !== version || !same) {
        throw new Error('当前配置已使用同名插件或不同版本。请在个人插件中卸载后再安装此来源。');
      }
      return { id, version: current.version, profile: profileName, installed: true, alreadyInstalled: true };
    }
    const build = await sourceNeedsBuild(resolved, this.fetch);
    validateSender();
    if (!await confirm({ id, version, sourceUrl: resolved.sourceUrl, installing: true, build, profile: profileName })) {
      return { id, version, profile: profileName, installed: false, cancelled: true };
    }
    validateSender();
    const artifact = build ? await buildSourceArchive(resolved, launch, installer) : resolved.bytes ? resolved : null;
    if (artifact) {
      const metadata = archiveManifest(artifact.bytes);
      assertSourceBundle(metadata);
      if (metadata.name !== id || metadata.version !== version) throw new Error('存档的插件身份与确认不符。');
      await this.validateBundle(metadata);
    }
    return this.withWebMutation(profileName === 'web', async () => {
      const latest = await loadProfile();
      if (!latest || latest.file !== target.file || Object.hasOwn(latest.data.dependencies ?? {}, id)) {
        throw new Error('插件配置已变更，请刷新后重试。');
      }
      validateSender();
      let spec = resolved.spec;
      let createdArchive;
      if (artifact) {
        const directory = path.join(path.dirname(latest.file), archiveDirectory);
        await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const dirInfo = await lstat(directory);
        if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new Error('插件存档目录无效。');
        const file = path.join(directory, `${sourceKey}-${artifact.hash}.tgz`);
        try {
          await writeFile(file, artifact.bytes, { flag: 'wx', mode: 0o600 });
          createdArchive = file;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.bytes.length ||
              !(await readFile(file)).equals(artifact.bytes)) throw new Error('插件存档已被修改。');
        }
        spec = 'file:' + file;
      }
      try {
        validateSender();
        await this.addPackageSpec(launch, latest, installer, spec, profileName);
        const observed = await loadProfile();
        const metadata = await this.installed(observed, id);
        if (metadata?.name !== id || metadata.version !== version || observed.bundles.includes(id)) {
          throw new Error('未能核对插件的身份或启用状态。');
        }
        await this.verifyBundle(observed, id, metadata, true);
        const packageRoot = await this.packageRoot(observed, id);
        for (const entry of runtimeEntrypoints(metadata)) {
          if (!await this.localFile(packageRoot, entry)) throw new Error('安装后的插件缺少运行入口。');
        }
      } catch (error) {
        const observed = await loadProfile().catch(() => null);
        if (Object.hasOwn(observed?.data.dependencies ?? {}, id)) {
          const removed = await this.runPackageCommand(launch, observed, installer, profileName, ['remove', id, '--ignore-scripts']).catch(() => null);
          const remaining = await loadProfile().catch(() => null);
          if (removed?.exitCode !== 0 || !remaining || Object.hasOwn(remaining.data.dependencies ?? {}, id)) {
            throw new Error('安装失败，无法自动恢复配置。请在个人插件列表卸载该插件后重试。');
          }
        }
        if (createdArchive && observed) await unlink(createdArchive).catch(() => {});
        throw error;
      }
      return { id, version, profile: profileName, installed: true };
    });
  }

  async validateBundle(metadata) {
    const appBoot = await this.market.runtimeFile('@deepseek-ai/dsh-app-boot', 'lib/index.js');
    if (!appBoot) throw new Error('DSH 运行时缺少插件验证组件。');
    const api = await import(pathToFileURL(appBoot).href);
    if (api.evaluatePluginCompatibility(metadata, {}, this.version)) throw new Error('插件声明的版本要求与当前 DSH 运行时不匹配。');
    api.assertBundlePlatform(metadata.dsh.bundle.platforms, process.platform);
    return api;
  }

  async enable(profile, id, metadata, validateSender, confirm, web = false) {
    if (!web && manifestCompatibility(metadata) === 'dsh-web') {
      throw new Error('此插件声明了 DSH 网页或桌面客户端组件，请在官方 DSH 的插件页启用。');
    }
    await this.verifyBundle(profile, id, metadata, true);
    validateSender();
    if (!await confirm({ id, version: metadata.version, sourceUrl: packagePage(id, metadata.version), installing: false })) return;
    return this.withWebMutation(web, async () => {
      validateSender();
      await this.market.writeBundleSelection(profile, id, true);
    });
  }

  async verifyBundle(profile, id, metadata, protectBuiltins = false) {
    if (!profile || !metadata) throw new Error('社区插件安装文件已变更。');
    const { bundlePatchPaths, loadOverlayPatches } = await this.validateBundle(metadata);
    const packageRoot = await this.packageRoot(profile, id);
    if (!packageRoot) throw new Error('社区插件没有可加载的本地配置。');
    for (const patch of bundlePatchPaths(packageRoot, metadata.dsh.bundle)) {
      const relative = path.relative(packageRoot, patch);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !await this.localFile(packageRoot, relative)) {
        throw new Error('社区插件没有可加载的本地配置。');
      }
      const loaded = loadOverlayPatches('dsh', patch);
      if (protectBuiltins) assertProtectedMcpUnchanged(loaded);
    }
  }

  async runPackageCommand(launch, profile, installer, profileName, args) {
    const [operations, anchor] = await Promise.all([
      this.market.runtimeFile('@deepseek-ai/dsh-plugin-manager', 'lib/types/operations.js'),
      this.market.runtimeFile('@deepseek-ai/dsh', 'package.json'),
    ]);
    if (!operations || !anchor) throw new Error('托管 DSH 安装器不完整。');
    const dir = path.dirname(profile.file);
    const candidate = await lstat(dir);
    if (!candidate.isDirectory() || candidate.isSymbolicLink()) throw new Error('DSH 插件目录无效。');
    const { runPluginCommand } = await import(pathToFileURL(operations).href);
    return runPluginCommand({
      profile: profileName, dir, installAnchor: anchor, cwd: dir, home: this.market.home,
    }, args, {
      command: launch.executable, args: [installer], execution: 'service',
      activateNewBundles: false, outputBytes: 2_048, lockWaitMs: 10_000, idleTimeoutMs: 45_000,
      lookupTimeoutMs: 15_000, signal: AbortSignal.timeout(120_000),
      env: { ...processEnvironment(), NPM_CONFIG_USERCONFIG: 'NUL', NPM_CONFIG_GLOBALCONFIG: 'NUL',
        NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_REGISTRY: REGISTRY,
        NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', CI: '1' },
    });
  }

  async install(launch, profile, installer, id, version, profileName = 'acp') {
    await this.addPackageSpec(launch, profile, installer, id + '@' + version, profileName);
    const observedProfile = profileName === 'web' ? await this.market.webProfile() : await this.market.profile();
    const observed = await this.installed(observedProfile, id);
    if (!observed || observed.version !== version) throw new Error('未能验证安装后的 DSH 插件版本。');
  }

  async addPackageSpec(launch, profile, installer, spec, profileName) {
    const result = await this.runPackageCommand(launch, profile, installer, profileName,
      ['add', spec, '--save-exact', '--ignore-scripts', '--registry=' + REGISTRY]);
    if (result.exitCode !== 0) throw new Error(result.timedOut ? 'DSH 社区插件安装超时。' : 'DSH 社区插件安装失败。请检查网络和插件兼容性。');
  }
}

module.exports = { DshCommunityMarket, fetchJson, safePackage };


