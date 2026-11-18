const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');

const NPM = 'https://registry.npmjs.org';
const GITHUB = 'https://github.com';
const GITHUB_API = 'https://api.github.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com';
const RELEASE_ORIGINS = new Set([GITHUB, 'https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']);
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;
const OWNER = /^[a-z\d][a-z\d-]{0,38}$/i;
const REPOSITORY = /^[a-z\d._-]{1,100}$/i;
const COMPONENT = /^[a-z\d._-]{1,160}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const ARCHIVE_MAX = 64 * 1024 * 1024;

const ordinary = term => COMPONENT.test(term) && term !== '.' && term !== '..';
const relative = parts => parts.length <= 20 && parts.every(ordinary) ? parts.join('/') : undefined;
const validPackage = name => typeof name === 'string' && name.length <= 214 && PACKAGE.test(name) &&
  !name.startsWith('@deepseek-ai/');

function parsePackageSource(input) {
  if (typeof input !== 'string' || input.length > 1024) {
    throw new Error('请提供有效的 npm 包名、GitHub 仓库或 Release 存档。');
  }
  input = input.trim();
  if (!input || /[\x00-\x20\\]/.test(input)) {
    throw new Error('请提供有效的 npm 包名、GitHub 仓库或 Release 存档。');
  }
  const npm = /^((?:@[^/]+\/)?[^@/]+)(?:@([^/]+))?$/.exec(input);
  if (npm && validPackage(npm[1]) && (npm[2] === undefined || VERSION.test(npm[2]))) {
    return { kind: 'npm', id: npm[1], revision: npm[2] ?? 'latest' };
  }

  const normalized = input.startsWith('github:') ? GITHUB + '/' + input.slice(7) :
    input.startsWith('git+') ? input.slice(4) : /^[a-z\d._-]+\/[a-z\d._-]+(?:#.*)?$/i.test(input) ? GITHUB + '/' + input : input;
  const url = URL.parse(normalized);
  if (!url || url.origin !== GITHUB || url.username || url.password || url.search) throw new Error('此插件来源不受支持。');
  const [owner, repository, ...tail] = url.pathname.replace(/^\/|\/$/g, '').split('/').map(decodeURIComponent);
  const repo = repository?.replace(/\.git$/i, '');
  if (!owner || !repo || !OWNER.test(owner) || !REPOSITORY.test(repo) || !ordinary(repo)) throw new Error('GitHub 仓库地址无效。');
  const release = tail[0] === 'releases' && tail.length === 4 &&
    (tail[1] === 'download' && ordinary(tail[2]) || tail[1] === 'latest' && tail[2] === 'download');
  if (release && !url.hash && ordinary(tail[3]) && /\.(?:tgz|tar\.gz)$/i.test(tail[3])) {
    return { kind: 'release', url: url.href };
  }

  let ref = 'HEAD';
  let directory = '';
  if (tail[0] === 'tree' && tail.length >= 2 && !url.hash) {
    ref = tail[1];
    directory = relative(tail.slice(2));
  } else if (!tail.length && url.hash) {
    const fragment = decodeURIComponent(url.hash.slice(1));
    const [hashRef, pathClause, extra] = fragment.startsWith('path:') ? ['', fragment] : fragment.split('&');
    if (extra !== undefined || (pathClause !== undefined && !pathClause.startsWith('path:'))) throw new Error('GitHub 引用无效。');
    ref = hashRef || 'HEAD';
    if (pathClause !== undefined) directory = relative(pathClause.slice(5).replace(/^\//, '').split('/'));
  } else if (tail.length) throw new Error('请提供 GitHub 仓库、子目录或 Release 下载地址。');
  if (!relative(ref.split('/')) || directory === undefined) throw new Error('GitHub 引用或包目录无效。');
  return { kind: 'git', owner, repo, ref, directory };
}

async function releaseBytes(fetcher, input) {
  let url = input;
  const signal = AbortSignal.timeout(90_000);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetcher(url, { signal, redirect: 'manual', credentials: 'omit' });
    if (response.status >= 300 && response.status < 400) {
      const next = URL.parse(response.headers.get('location'), url);
      if (!next || !RELEASE_ORIGINS.has(next.origin) || next.username || next.password || next.hash) break;
      await response.body?.cancel();
      url = next.href;
      continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > ARCHIVE_MAX) break;
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > ARCHIVE_MAX) throw new Error('GitHub Release 存档超过大小限制。');
      chunks.push(chunk);
    }
    if (size) return Buffer.concat(chunks, size);
    break;
  }
  throw new Error('无法从 GitHub Release 下载可核对的存档。');
}

function archiveManifest(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  let candidate;
  let root;
  const names = new Set();
  const stringField = (header, start, end) => header.subarray(start, end).toString('utf8').split('\0', 1)[0];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const type = header[156];
    const prefix = stringField(header, 345, 500);
    const name = (prefix ? prefix + '/' : '') + stringField(header, 0, 100).replace(/^\.\//, '').replace(/\/$/, '');
    const parts = name.split('/');
    const sizeField = stringField(header, 124, 136).trim();
    const crc = stringField(header, 148, 156).trim();
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    const size = /^[0-7]{1,12}$/.test(sizeField) ? Number.parseInt(sizeField, 8) : -1;
    const contentStart = offset + 512;
    if (![0, 48, 53].includes(type) || !name || /[\\:\x00-\x1f]/.test(name) ||
        parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)) ||
        names.has(name.toLowerCase()) || size < 0 || contentStart + size > tar.length ||
        !/^[0-7]+$/.test(crc) || Number.parseInt(crc, 8) !== checksum || (root && parts[0] !== root)) {
      throw new Error('Release 存档不是安全的单根 npm 包存档。');
    }
    root ||= parts[0];
    names.add(name.toLowerCase());
    if ((type === 0 || type === 48) && parts.length === 2 && parts[1] === 'package.json') {
      if (size > 64 * 1024) throw new Error('Release 包清单超过大小限制。');
      candidate = JSON.parse(tar.subarray(contentStart, contentStart + size).toString('utf8'));
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  if (!candidate) throw new Error('Release 存档未找到可核对的 package.json。');
  return candidate;
}

async function resolvePackageSource(reference, { fetch, fetchJson, tools }) {
  const source = parsePackageSource(reference);
  const json = url => fetchJson(fetch, url, 512 * 1024, 25_000);
  if (source.kind === 'npm') {
    const metadata = await json(`${NPM}/${encodeURIComponent(source.id)}/${encodeURIComponent(source.revision)}`);
    const tarball = URL.parse(metadata?.dist?.tarball);
    if (metadata?.name !== source.id || (source.revision !== 'latest' && metadata.version !== source.revision) ||
        tarball?.origin !== NPM || tarball.username || tarball.password || !/^sha512-[a-z0-9+/]+=*$/i.test(metadata.dist?.integrity || '')) {
      throw new Error('无法核对 npm 发布来源。');
    }
    return { ...source, metadata, spec: `${metadata.name}@${metadata.version}`, sourceUrl: tarball.href };
  }
  if (source.kind === 'release') {
    const bytes = await releaseBytes(fetch, source.url);
    return { ...source, metadata: archiveManifest(bytes), bytes, hash: createHash('sha256').update(bytes).digest('hex'), sourceUrl: source.url };
  }
  const { owner, repo, ref, directory } = source;
  const base = `${owner}/${repo}`;
  const { sha } = COMMIT.test(ref) ? { sha: ref } : await json(`${GITHUB_API}/repos/${base}/commits/${encodeURIComponent(ref)}`);
  if (typeof sha !== 'string' || !COMMIT.test(sha)) throw new Error('GitHub 未返回可核对的提交。');
  const raw = `${GITHUB_RAW}/${base}/${sha}${directory ? '/' + directory : ''}`;
  const metadata = await json(raw + '/package.json');
  const { marketInstallTarget } = await tools();
  const { spec } = marketInstallTarget(metadata?.name, { source: { type: 'git', url: `${GITHUB}/${base}`,
    commit: sha, ...(directory ? { path: directory } : {}) } });
  return { ...source, metadata, spec, sha, raw, sourceUrl: `${GITHUB}/${base}/tree/${sha}${directory ? '/' + directory : ''}` };
}

function assertSourceBundle(metadata) {
  const patch = metadata?.dsh?.bundle?.patch;
  const patches = typeof patch === 'string' ? [patch] : patch;
  if (!validPackage(metadata?.name) || typeof metadata.version !== 'string' || !VERSION.test(metadata.version) ||
      !Array.isArray(patches) || !patches.length || patches.length > 20 || patches.some(file =>
        typeof file !== 'string' || !relative(file.replace(/^\.\//, '').split('/')))) {
    throw new Error('此来源没有可验证的第三方 DSH 插件清单。');
  }
}

function assertProtectedMcpUnchanged(value, visited = new WeakSet()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  const name = input => typeof input === 'string' ? input.trim().toLowerCase().replaceAll('_', '-') : '';
  const protectedName = input => ['database', 'text-to-sql'].includes(name(input));
  if (['somnus-database', 'somnus-text-to-sql'].includes(name(value.id)) ||
      ((value.name === '@deepseek-ai/dsh-mcp-client' || value.name === undefined) && protectedName(value.config?.serverName)) ||
      ((value.name === '@deepseek-ai/dsh-mcp-manager' || value.id === 'mcp-manager') &&
        Object.keys(value.config?.servers ?? {}).some(protectedName))) throw new Error('插件尝试覆盖 Somnus 内置 MCP。');
  for (const nested of Object.values(value)) assertProtectedMcpUnchanged(nested, visited);
}

function runtimeEntrypoints(metadata) {
  const entries = new Set();
  function scan(target) {
    if (typeof target === 'string') {
      const filename = relative(target.replace(/^\.\//, '').split('/'));
      if (filename && /\.(?:[cm]?js|node)$/.test(filename)) entries.add(filename);
    } else if (target && typeof target === 'object') {
      for (const [condition, value] of Object.entries(target)) if (condition !== 'types') scan(value);
    }
  }
  scan(metadata.main);
  scan(metadata.exports);
  if (entries.size > 32) throw new Error('插件声明了过多入口。');
  return [...entries];
}

async function sourceNeedsBuild(source, fetcher) {
  if (source.kind !== 'git') return false;
  const entries = runtimeEntrypoints(source.metadata);
  const found = await Promise.all(entries.map(async entry => {
    const response = await fetcher(`${source.raw}/${entry}`, { method: 'HEAD', redirect: 'error',
      credentials: 'omit', signal: AbortSignal.timeout(20_000) });
    if (!response.ok && response.status !== 404) throw new Error('无法核对 GitHub 插件入口。');
    return response.ok;
  }));
  if (found.every(Boolean)) return false;
  if (typeof source.metadata?.scripts?.build !== 'string' || !source.metadata.scripts.build.trim()) {
    throw new Error('该 GitHub 源码缺少预构建入口，也未声明 build 脚本。请选择作者发布的 npm 包或 Release 存档。');
  }
  return true;
}

function runStep(executable, args, cwd, env, stage) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: 'ignore',
      detached: process.platform !== 'win32' });
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      if (process.platform === 'win32' && child.pid) {
        const taskkill = path.join(env.SYSTEMROOT ?? env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
        const stop = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        stop.once('error', () => child.kill());
        stop.once('close', code => { if (code !== 0) child.kill(); });
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); }
      }
    }, 180_000);
    deadline.unref();
    child.once('error', () => {
      clearTimeout(deadline);
      reject(new Error(`${stage}无法启动。`));
    });
    child.once('close', code => {
      clearTimeout(deadline);
      if (expired) reject(new Error(`${stage}超时，未写入 Somnus 插件配置。`));
      else if (code === 0) resolve();
      else reject(new Error(`${stage}未完成，未写入 Somnus 插件配置。`));
    });
  });
}

async function buildSourceArchive(source, launch, installer, run = runStep) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(path.join(temporaryRoot, 'somnus-plugin-source-')));
  if (path.dirname(root) !== temporaryRoot || !path.basename(root).startsWith('somnus-plugin-source-')) {
    throw new Error('插件构建临时目录无效。');
  }
  const checkout = path.join(root, 'source');
  const outputs = path.join(root, 'archives');
  const account = path.join(root, 'home');
  const temporary = path.join(root, 'tmp');
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|PROGRAMFILES(?:\(X86\))?|PROCESSOR_ARCHITECTURE)$/i.test(key)));
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = [path.dirname(launch.executable), env[pathKey]].filter(Boolean).join(path.delimiter);
  Object.assign(env, { HOME: account, USERPROFILE: account, APPDATA: account, LOCALAPPDATA: account,
    TEMP: temporary, TMP: temporary, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nullDevice,
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', NPM_CONFIG_USERCONFIG: nullDevice,
    NPM_CONFIG_GLOBALCONFIG: nullDevice, NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_REGISTRY: NPM + '/', NPM_CONFIG_IGNORE_PNPMFILE: 'true',
    NPM_CONFIG_ENABLE_PRE_POST_SCRIPTS: 'false', NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
    NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false', pnpm_config_ignore_scripts: 'true',
    pnpm_config_ignore_pnpmfile: 'true', pnpm_config_verify_deps_before_run: 'false',
    pnpm_config_enable_pre_post_scripts: 'false', pnpm_config_manage_package_manager_versions: 'false', CI: '1' });
  const buildEnv = { ...env, DSH_HOME: path.join(root, 'dsh-home') };
  const git = args => run('git', ['-c', 'credential.helper=', '-c', 'core.hooksPath=' + nullDevice,
    '-c', 'protocol.file.allow=never', ...args], checkout, env, '获取固定 GitHub 提交');
  const pnpm = (args, cwd, stage) => run(launch.executable, [installer, ...args], cwd, buildEnv, stage);
  try {
    await Promise.all([checkout, outputs, account, temporary].map(dir => mkdir(dir)));
    await git(['init', '--quiet']);
    await git(['fetch', '--quiet', '--no-tags', '--depth=1', `${GITHUB}/${source.owner}/${source.repo}.git`, source.sha]);
    await git(['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    const packageDir = source.directory ? path.join(checkout, ...source.directory.split('/')) : checkout;
    let location = checkout;
    for (const part of source.directory ? source.directory.split('/') : []) {
      location = path.join(location, part);
      const info = await lstat(location);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('构建目录不是固定仓库中的普通目录。');
    }
    const manifestFile = path.join(packageDir, 'package.json');
    const manifestInfo = await lstat(manifestFile);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024) throw new Error('无法核对源码构建清单。');
    const metadata = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (metadata.name !== source.metadata.name || metadata.version !== source.metadata.version ||
        metadata.scripts?.build !== source.metadata.scripts.build) throw new Error('GitHub 源码与确认时的包清单不同。');
    const workspace = await lstat(path.join(checkout, 'pnpm-workspace.yaml')).catch(() => null);
    const installAt = workspace?.isFile() ? checkout : packageDir;
    const store = path.join(installAt, '.somnus-build-store');
    Object.assign(buildEnv, { pnpm_config_store_dir: store, pnpm_config_node_linker: 'hoisted' });
    const filter = workspace?.isFile() ? ['--filter', metadata.name + '...'] : [];
    const lockfile = await lstat(path.join(installAt, 'pnpm-lock.yaml')).catch(() => null);
    await pnpm([...filter, 'install', '--ignore-scripts', '--config.ignore-pnpmfile=true', '--config.manage-package-manager-versions=false',
      '--store-dir=' + store, '--config.node-linker=hoisted', '--registry=' + NPM,
      lockfile?.isFile() ? '--frozen-lockfile' : '--no-frozen-lockfile'], installAt, '准备插件构建依赖');
    await pnpm(['run', 'build'], packageDir, '构建插件');
    for (const entry of runtimeEntrypoints(metadata)) {
      if (!(await lstat(path.join(packageDir, entry)).catch(() => null))?.isFile()) throw new Error('构建未生成插件声明的入口。');
    }
    await pnpm(['pack', '--pack-destination', outputs], packageDir, '打包插件');
    const names = await readdir(outputs);
    if (names.length !== 1 || !/\.tgz$/i.test(names[0])) throw new Error('未生成唯一的插件包。');
    const artifact = path.join(outputs, names[0]);
    const info = await lstat(artifact);
    if (!info.isFile() || info.isSymbolicLink() || info.size > ARCHIVE_MAX) throw new Error('插件构建存档无效。');
    const bytes = await readFile(artifact);
    return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

module.exports = { archiveManifest, assertSourceBundle, assertProtectedMcpUnchanged, buildSourceArchive, parsePackageSource, resolvePackageSource,
  sourceNeedsBuild, runtimeEntrypoints };
