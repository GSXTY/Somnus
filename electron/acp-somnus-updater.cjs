const path = require('node:path');
const { readFile, stat, writeFile } = require('node:fs/promises');
const { trustWorkbench } = require('./project-folders.cjs');

const errors = {
  config: '更新源配置无效，请检查 HTTPS 地址。',
  check: '无法检查更新，请确认更新源和网络连接。',
  download: '无法下载或验证更新，请重试。',
  install: '无法启动安装程序，请重新打开 Somnus 后重试。',
};

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
  let installing = false;
  function set(phase, fields) {
    state = { phase, currentVersion, ...fields };
    publish(state);
  }
  const ready = !supported ? Promise.resolve() : Promise.resolve().then(resolveUpdater).then(next => {
    if (!next) return;
    updater = next;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.on('update-available', info => set('available', { version: info.version }));
    updater.on('update-not-available', () => set('current'));
    updater.on('download-progress', data => {
      if (state.phase === 'downloading' && Number.isFinite(data.percent)) {
        set('downloading', { version: state.version, percent: Math.max(0, Math.min(100, data.percent)) });
      }
    });
    updater.on('update-downloaded', info => set('downloaded', { version: info.version, percent: 100 }));
    updater.on('error', () => {
      if (state.phase === 'checking') set('error', { error: errors.check });
      else if (state.phase === 'downloading') set('error', { error: errors.download });
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
      if (!updater || !['idle', 'current', 'error', 'available'].includes(state.phase)) return state;
      set('checking');
      try {
        await updater.checkForUpdates();
        if (state.phase === 'checking') set('current');
      } catch {
        set('error', { error: errors.check });
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

async function resolveWindowsUpdater({ app, profileDir, env = process.env }) {
  const config = await readUpdateConfig(profileDir);
  const configured = env.SOMNUS_UPDATE_URL || config.url;
  const generated = path.join(process.resourcesPath ?? profileDir, 'app-update.yml');
  const generatedExists = app.isPackaged && await stat(generated).then(info => info.isFile(), error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (!configured && !generatedExists) return null;

  const { NsisUpdater } = require('electron-updater');
  const updater = new NsisUpdater();
  if (!app.isPackaged) updater.forceDevUpdateConfig = true;
  const releaseConfig = generatedExists ? await updater.loadUpdateConfig() : {};
  const allowLoopback = !app.isPackaged && env.SOMNUS_UPDATE_DEV_LOOPBACK === '1';
  const url = updateUrl(configured || releaseConfig.url, allowLoopback);
  if (!url || (generatedExists && releaseConfig.provider !== 'generic')) throw new Error(errors.config);

  // Local directory builds have no electron-builder cache or publisher configuration.
  if (!generatedExists) {
    const runtimeConfig = path.join(profileDir, 'somnus-update-runtime.yml');
    const settings = { provider: 'generic', url, updaterCacheDirName: 'somnus-updater' };
    if (typeof config.publisherName === 'string' && config.publisherName.trim()) {
      settings.publisherName = [config.publisherName.trim()];
    }
    await writeFile(runtimeConfig, JSON.stringify(settings), { mode: 0o600 });
    updater.updateConfigPath = runtimeConfig;
  }
  updater.setFeedURL({ provider: 'generic', url, ...(releaseConfig.channel && { channel: releaseConfig.channel }) });
  return updater;
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

module.exports = { createUpdaterState, registerSomnusUpdater, resolveWindowsUpdater, updateUrl };
