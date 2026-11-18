const path = require('node:path');
const { readFile, stat, writeFile } = require('node:fs/promises');
const { trustWorkbench } = require('./project-folders.cjs');

const errors = {
  config: '更新源配置无效，请检查 HTTPS 地址。',
  check: '无法检查更新，请确认更新源和网络连接。',
  download: '无法下载或验证更新，请重试。',
  install: '无法启动安装程序，请重新打开 Somnus 后重试。',
  publisher: '本机缺少预期的签名发布者。请从 Somnus 发布页手动安装已签名的版本。',
};

const publicFeed = {
  provider: 'github',
  owner: 'GSXTY',
  repo: 'Somnus-Releases',
  private: false,
  protocol: 'https',
};
const releasePage = 'https://github.com/GSXTY/Somnus-Releases/releases';
const releaseApi = 'https://api.github.com/repos/GSXTY/Somnus-Releases/releases?per_page=30';
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-beta\.(0|[1-9]\d{0,8}))?$/;

function releaseVersion(value) {
  const match = typeof value === 'string' && versionPattern.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? Infinity : Number(match[4])];
}

function compareVersions(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function newerRelease(tag, current, prerelease = false) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return null;
  const version = tag.slice(1);
  const parsed = releaseVersion(version);
  if (!parsed || (current[3] === Infinity && (prerelease || parsed[3] !== Infinity)) ||
      compareVersions(parsed, current) <= 0) return null;
  return { tag, version, parsed, installer: `Somnus-Setup-${version}-windows-x64.exe` };
}

function manualRelease(release) {
  return release && { version: release.version, url: `${releasePage}/tag/${release.tag}` };
}

async function publicReleaseFromApi(current, request) {
  const response = await request(releaseApi, {
    headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(errors.check);
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error(errors.check);
  let best;
  for (const release of releases) {
    if (release?.draft !== false) continue;
    const candidate = newerRelease(release.tag_name, current, release.prerelease);
    if (!candidate || (best && compareVersions(candidate.parsed, best.parsed) <= 0)) continue;
    if (!Array.isArray(release.assets) ||
        !release.assets.some(asset => asset?.name === candidate.installer && asset.state === 'uploaded')) continue;
    best = candidate;
  }
  return manualRelease(best);
}

async function publicReleaseFromAtom(current, request) {
  // Public GitHub API requests can hit a shared rate limit. The repository's
  // Atom feed lists published tags independently, but does not list assets.
  const signal = AbortSignal.timeout(12000);
  const response = await request(`${releasePage}.atom`, {
    headers: { Accept: 'application/atom+xml' }, credentials: 'omit', signal,
  });
  if (!response.ok) throw new Error(errors.check);
  const atom = await response.text();
  const feedId = `<id>tag:github.com,2008:${releasePage}</id>`;
  if (atom.length > 1024 * 1024 || !atom.includes(feedId) || !/<\/feed>\s*$/.test(atom)) throw new Error(errors.check);
  const candidates = new Map();
  for (const match of atom.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const tag = /<id>tag:github\.com,2008:Repository\/\d+\/(v[\d.a-z-]+)<\/id>/.exec(match[1])?.[1];
    const release = newerRelease(tag, current);
    if (release) candidates.set(tag, release);
  }
  for (const release of [...candidates.values()].sort((a, b) => compareVersions(b.parsed, a.parsed))) {
    const asset = await request(`${releasePage}/download/${release.tag}/${release.installer}`, {
      method: 'HEAD', credentials: 'omit', signal,
    });
    if (asset.ok) return manualRelease(release);
    if (asset.status !== 404) throw new Error(errors.check);
  }
}

async function findPublicRelease(currentVersion, request = fetch) {
  const current = releaseVersion(currentVersion);
  if (!current) return undefined;
  try {
    return await publicReleaseFromApi(current, request);
  } catch {
    return publicReleaseFromAtom(current, request);
  }
}

function updateUrl(value, allowLoopback = false) {
  const url = typeof value === 'string' && value.length <= 2048 ? URL.parse(value.trim()) : null;
  if (!url || url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' &&
        !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) {
    return null;
  }
  url.pathname = url.pathname.replace(/\/*$/, '/');
  return url.href;
}

async function readUpdateConfig(profileDir) {
  const filename = path.join(profileDir, 'somnus-updates.json');
  try {
    if ((await stat(filename)).size > 8192) throw new Error(errors.config);
    const data = JSON.parse(await readFile(filename, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(errors.config);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function createUpdaterState({ currentVersion, supported, resolveUpdater, publish = () => {}, prepareInstall }) {
  let state = { phase: supported ? 'unconfigured' : 'unsupported', currentVersion };
  let updater;
  let checkEmptyFeed;
  let publicRelease;
  let requiresPublisher = false;
  let installing = false;
  function set(phase, fields) {
    state = { phase, currentVersion, ...fields };
    publish(state);
  }
  const ready = !supported ? Promise.resolve() : Promise.resolve().then(resolveUpdater).then(next => {
    if (!next) return;
    ({ updater, checkEmptyFeed, publicRelease, requiresPublisher } = next);
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.on('update-available', info => {
      if (requiresPublisher) set('error', { version: info.version, error: errors.publisher });
      else set('available', { version: info.version });
    });
    updater.on('update-not-available', () => set('current'));
    updater.on('download-progress', data => {
      if (state.phase === 'downloading' && Number.isFinite(data.percent)) {
        set('downloading', { version: state.version, percent: Math.max(0, Math.min(100, data.percent)) });
      }
    });
    updater.on('update-downloaded', info => set('downloaded', { version: info.version, percent: 100 }));
    updater.on('error', () => {
      if (state.phase === 'downloading') set('error', { error: errors.download });
      else if (installing) {
        installing = false;
        set('error', { error: errors.install });
      }
    });
    set('idle');
  }).catch(() => set('error', { error: errors.config }));

  return {
    async getState() {
      await ready;
      return state;
    },
    async check() {
      await ready;
      if (!updater || !['idle', 'current', 'error', 'available', 'no-release', 'manual'].includes(state.phase)) return state;
      set('checking');
      try {
        if (requiresPublisher && publicRelease) {
          const release = await publicRelease();
          if (release) set('manual', release);
          else set('current');
          return state;
        }
        await updater.checkForUpdates();
        if (state.phase === 'checking') set('current');
      } catch (error) {
        if (publicRelease && ['ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
          'ERR_UPDATER_INVALID_RELEASE_FEED', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'].includes(error.code)) {
          try {
            const release = await publicRelease();
            if (release) set('manual', release);
            else if (error.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') set('current');
            if (state.phase !== 'checking') return state;
          } catch {
            // Keep the standard update-check error when the release list is inaccessible.
          }
        }
        const empty = checkEmptyFeed && await checkEmptyFeed(error);
        if (empty) set('no-release');
        else set('error', { error: errors.check });
      }
      return state;
    },
    async download() {
      await ready;
      if (!updater || state.phase !== 'available') return state;
      set('downloading', { version: state.version, percent: 0 });
      try {
        await updater.downloadUpdate();
        if (state.phase === 'downloading') set('error', { error: errors.download });
      } catch {
        set('error', { error: errors.download });
      }
      return state;
    },
    async install() {
      await ready;
      if (!updater || state.phase !== 'downloaded' || installing) return state;
      installing = true;
      try {
        await prepareInstall();
        updater.quitAndInstall(false, true);
      } catch {
        installing = false;
        set('error', { error: errors.install });
      }
      return state;
    },
  };
}

function selectUpdateFeed(configured, releaseConfig, allowLoopback) {
  if (releaseConfig.provider && !['generic', 'github'].includes(releaseConfig.provider)) throw new Error(errors.config);
  if (configured || releaseConfig.provider === 'generic') {
    const url = updateUrl(configured || releaseConfig.url, allowLoopback);
    if (!url) throw new Error(errors.config);
    return { provider: 'generic', url, ...(releaseConfig.channel && { channel: releaseConfig.channel }) };
  }
  if (releaseConfig.provider === 'github' &&
      (releaseConfig.owner !== publicFeed.owner || releaseConfig.repo !== publicFeed.repo)) throw new Error(errors.config);
  return { ...publicFeed };
}

async function isPublicFeedEmpty(error, request = fetch) {
  // GitHubProvider parsed the Atom feed successfully but found no release entry.
  if (error.code === 'ERR_XML_MISSED_ELEMENT' && error.message === 'No published versions on GitHub') return true;
  // Ambiguous errors require confirmation from the public releases API.
  if (!['ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_INVALID_RELEASE_FEED',
    'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'].includes(error.code)
      && error.statusCode !== 404) return false;
  try {
    const response = await request(`https://api.github.com/repos/${publicFeed.owner}/${publicFeed.repo}/releases?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const releases = await response.json();
    return Array.isArray(releases) && releases.length === 0;
  } catch {
    return false;
  }
}

async function resolveWindowsUpdater({ app, profileDir, env = process.env, resourcesPath = process.resourcesPath,
  createUpdater = () => new (require('electron-updater').NsisUpdater)() }) {
  const config = await readUpdateConfig(profileDir);
  const configured = env.SOMNUS_UPDATE_URL || config.url;
  const generated = path.join(resourcesPath ?? profileDir, 'app-update.yml');
  const generatedExists = app.isPackaged && await stat(generated).then(info => info.isFile(), error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  const updater = createUpdater();
  if (!app.isPackaged) updater.forceDevUpdateConfig = true;
  const releaseConfig = generatedExists ? await updater.loadUpdateConfig() : {};
  if (releaseConfig.verifyUpdateCodeSignature === false) throw new Error(errors.config);
  const allowLoopback = !app.isPackaged && env.SOMNUS_UPDATE_DEV_LOOPBACK === '1';
  const feed = selectUpdateFeed(configured, releaseConfig, allowLoopback);
  const usesPublicFeed = feed.provider === 'github';
  const localDevelopmentFeed = allowLoopback && feed.provider === 'generic' && new URL(feed.url).protocol === 'http:';
  let publisherName = releaseConfig.publisherName;

  // Local directory builds have no electron-builder cache or publisher configuration.
  if (!generatedExists) {
    const runtimeConfig = path.join(profileDir, 'somnus-update-runtime.yml');
    if (!usesPublicFeed && typeof config.publisherName === 'string' && config.publisherName.trim()) {
      publisherName = [config.publisherName.trim()];
    }
    const settings = { ...feed, publisherName, updaterCacheDirName: 'somnus-updater' };
    await writeFile(runtimeConfig, JSON.stringify(settings), { mode: 0o600 });
    updater.updateConfigPath = runtimeConfig;
  }
  const currentVersion = typeof app.getVersion === 'function' ? app.getVersion() : '';
  if (usesPublicFeed) updater.allowPrerelease = Number.isFinite(releaseVersion(currentVersion)?.[3]);
  updater.setFeedURL(feed);
  const publishers = Array.isArray(publisherName) ? publisherName : [publisherName];
  return {
    updater,
    checkEmptyFeed: usesPublicFeed ? isPublicFeedEmpty : undefined,
    publicRelease: usesPublicFeed ? () => findPublicRelease(currentVersion) : undefined,
    requiresPublisher: !localDevelopmentFeed && !publishers.some(name => typeof name === 'string' && name.trim()),
  };
}

function registerSomnusUpdater({ ipcMain, app, window, origin, prepareInstall }) {
  const actions = createUpdaterState({
    currentVersion: app.getVersion(),
    supported: process.platform === 'win32',
    resolveUpdater: () => resolveWindowsUpdater({ app, profileDir: app.getPath('userData') }),
    publish: state => {
      if (window.isDestroyed()) return;
      const frame = window.webContents.mainFrame;
      const url = frame && URL.parse(frame.url);
      if (!frame?.detached && url?.origin === origin && url.pathname === '/') frame.send('somnus-updater:state', state);
    },
    prepareInstall,
  });
  for (const [action, perform] of Object.entries(actions)) {
    const channel = 'somnus-updater:' + action;
    ipcMain.handle(channel, event => {
      trustWorkbench(event, window, origin);
      return perform();
    });
    window.once('closed', () => ipcMain.removeHandler(channel));
  }
}

module.exports = { createUpdaterState, findPublicRelease, isPublicFeedEmpty, registerSomnusUpdater, resolveWindowsUpdater, updateUrl };
