import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile, lstat, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, session, shell } from 'electron';
import { PRODUCT_APP_ID } from './product-profile.mjs';
import { configureSomnusPaths, createSomnusDesktop } from './somnus-desktop.mjs';

const require = createRequire(import.meta.url);

async function engineHome(profileDir) {
  const engine = join(profileDir, 'engine');
  const home = join(engine, 'harness');
  for (const directory of [engine, home]) {
    await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Somnus engine requires its own profile directory');
  }
  return home;
}

export function startSomnus({ DesktopHostProcess, DesktopBackendController, DesktopProjectManager,
  resolveDesktopPaths, desktopClientVersion, readDeviceInfo, resolveDesktopLocale }) {
  app.setName('SomnusNext');
  if (!app.commandLine.hasSwitch('lang')) app.commandLine.appendSwitch('lang', 'zh-CN');
  configureSomnusPaths();
  app.setAppLogsPath();
  if (process.platform === 'win32') app.setAppUserModelId(PRODUCT_APP_ID);
  // No inherited DSH Desktop settings participate in either Somnus app process.
  for (const key of Object.keys(process.env)) if (/^DSH_/i.test(key)) delete process.env[key];
  const workbench = createSomnusDesktop();
  const { chromeWindowOptions, chromeFallbackFill, registerNativeChrome } = require(join(process.resourcesPath, 'somnus', 'somnus-native-chrome.cjs'));
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }

  let engine;
  let acpHost;
  let acpHostInfo;
  let engineOpening;
  let stopping = false;
  let closed = false;
  let dshWindow;
  let dshUrl;
  let somnusOrigin;
  let activeProfileDir;
  let somnusToken;
  let somnusApiRegistered = false;
  let configurationDispatch;
  let configurationAgents;
  let configurationWindow;
  let somnusAccessInstalled = false;
  const installSomnusAccess = async () => {
    if (somnusAccessInstalled || !somnusOrigin || !somnusToken) return;
    somnusAccessInstalled = true;
    // Domain pages are iframes on the launcher origin. Mark their requests as
    // the local Windows desktop so the Python service accepts desktop-only
    // endpoints such as model configuration without a separate login.
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [somnusOrigin + '/*'] }, (details, callback) => {
      details.requestHeaders['X-Data-Agent-Native'] = somnusToken;
      callback({ requestHeaders: details.requestHeaders });
    });
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: [somnusOrigin + '/workbench-assets/embed.html*'] },
      (details, callback) => callback({ responseHeaders: {
        ...details.responseHeaders, 'Cache-Control': ['no-store, no-cache, must-revalidate'],
      } }),
    );
    const browser = createHmac('sha256', somnusToken).update('vvman-project-browser-session').digest('hex');
    await session.defaultSession.cookies.set({
      url: somnusOrigin, name: 'respiratory_desktop', value: browser,
      path: '/', httpOnly: true, sameSite: 'lax',
    }).catch(() => {});
  };
  const configureAgentBridge = service => {
    const window = ensureDshWindow();
    if (configurationWindow === window) return;
    const handlers = new Map();
    const { CONFIG_METHODS, createConfigurationDispatcher } = require(join(service.modules, 'dsh-config-bridge.cjs'));
    const { registerAcpAgents } = require(join(service.modules, 'acp-ipc.cjs'));
    configurationAgents = registerAcpAgents({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      app, dialog, shell, window, origin: service.origin, token: service.token,
      profileDir: service.profileDir, dshRuntimeDir: service.baseDir, version: app.getVersion(),
      trustedOrigin: new URL(dshUrl).origin, configurationOnly: true,
      allowedActions: new Set(Object.values(CONFIG_METHODS)),
    });
    configurationWindow = window;
    configurationDispatch = createConfigurationDispatcher({
      window, rendererOrigin: () => dshUrl ? new URL(dshUrl).origin : '', handlers,
      onNativeConfigChanged: () => ({ state: 'scheduled' }),
      onRefreshNativeModels: () => ({ state: 'scheduled' }),
    });
    window.once('closed', () => {
      if (configurationWindow !== window) return;
      configurationDispatch = undefined; configurationWindow = undefined;
      configurationAgents = undefined; handlers.clear();
    });
  };
  const registerSomnusApi = () => {
    if (somnusApiRegistered) return;
    somnusApiRegistered = true;
    registerNativeChrome({ ipcMain, getWindow: () => dshWindow, rendererOrigin: () => dshUrl ? new URL(dshUrl).origin : '',
      nativeTheme, Menu, app, readDeviceInfo, resolveDesktopLocale });
    ipcMain.handle('somnus:configuration', (event, method, args) => {
      if (!configurationDispatch) throw new Error('Somnus configuration is not ready');
      return configurationDispatch(event, method, args);
    });
    ipcMain.handle('somnus:origin', event => {
      if (!dshWindow || dshWindow.isDestroyed() || event.sender !== dshWindow.webContents) {
        throw new Error('Somnus API bridge rejected an unowned renderer');
      }
      if (!somnusOrigin) throw new Error('Somnus app is not ready');
      return somnusOrigin;
    });
    ipcMain.handle('somnus:acp:info', event => {
      if (!dshWindow || dshWindow.isDestroyed() || event.sender !== dshWindow.webContents) {
        throw new Error('Somnus ACP bridge rejected an unowned renderer');
      }
      if (!acpHostInfo) throw new Error('ACP Host is not ready');
      return acpHostInfo;
    });
    ipcMain.handle('somnus:acp:model', (event, modelId) => {
      if (!dshWindow || dshWindow.isDestroyed() || event.sender !== dshWindow.webContents) {
        throw new Error('Somnus ACP bridge rejected an unowned renderer');
      }
      const file = join(activeProfileDir || app.getPath('userData'), 'acp-model-selection.json');
      writeFileSync(file, JSON.stringify({ modelId: typeof modelId === 'string' ? modelId : '' }));
      return true;
    });
    ipcMain.handle('somnus:acp:approval', (event, mode) => {
      if (!dshWindow || dshWindow.isDestroyed() || event.sender !== dshWindow.webContents) {
        throw new Error('Somnus ACP bridge rejected an unowned renderer');
      }
      const file = join(activeProfileDir || app.getPath('userData'), 'acp-approval.json');
      const safe = mode === 'readonly' || mode === 'ask' ? mode : 'auto';
      writeFileSync(file, JSON.stringify({ mode: safe }));
      return true;
    });
    ipcMain.handle('somnus:session:purge', (event, sessionId) => {
      if (!dshWindow || dshWindow.isDestroyed() || event.sender !== dshWindow.webContents) {
        throw new Error('Somnus session bridge rejected an unowned renderer');
      }
      if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(sessionId)) {
        throw new Error('Invalid session id');
      }
      if (!activeProfileDir) throw new Error('SomnusNext profile is not ready');
      const roots = [
        join(activeProfileDir, 'dsh-home', 'sessions'),
        join(activeProfileDir, 'engine', 'harness', 'profiles', 'desktop', 'sessions'),
      ];
      const names = new Set([sessionId, sessionId.replace(/^session-/, '')]);
      let removed = 0;
      const walk = directory => {
        let entries;
        try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const target = join(directory, entry.name);
          if (entry.isDirectory() && names.has(entry.name)) {
            try { rmSync(target, { recursive: true, force: true }); removed += 1; } catch { /* ignore locked */ }
          } else if (entry.isDirectory()) {
            walk(target);
          }
        }
      };
      for (const root of roots) if (existsSync(root)) walk(root);
      return removed;
    });
    ipcMain.handle('somnus:api:request', async (event, payload) => {
      if (!dshWindow || dshWindow.isDestroyed() || event.sender !== dshWindow.webContents) {
        throw new Error('Somnus API bridge rejected an unowned renderer');
      }
      const target = typeof payload?.path === 'string' ? payload.path : '';
      if (!target.startsWith('/api/') || target.startsWith('//') || target.includes('\\') || target.length > 2048) {
        throw new Error('Invalid Somnus API path');
      }
      if (!somnusOrigin || !somnusToken) throw new Error('Somnus API is not ready');
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(payload?.method) ? payload.method : 'GET';
      const headers = { ...(payload?.headers && typeof payload.headers === 'object' ? payload.headers : {}) };
      headers['X-Data-Agent-Native'] = somnusToken;
      const response = await net.fetch(somnusOrigin + target, {
        method, headers, redirect: 'error',
        ...(method === 'GET' || method === 'HEAD' ? {} : payload?.body === undefined ? {} : { body: payload.body }),
      });
      const body = await response.arrayBuffer();
      const responseHeaders = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      return { status: response.status, headers: responseHeaders, body };
    });
  };
  const openWorkbench = () => workbench.openHome().catch(reportWorkbenchError);
  const reportWorkbenchError = error => workbench.openRecovery(error).catch(recoveryError => {
    dialog.showErrorBox('Somnus', recoveryError?.message ?? error?.message ?? 'Somnus could not start.');
  });
  const engineLog = message => {
    const line = `${new Date().toISOString()} ${message}\n`;
    void appendFile(join(app.getPath('logs'), 'somnus-engine.log'), line).catch(error => console.error(error));
  };
  const splashPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>Somnus</title>
<style>
  :root{color-scheme:light dark;--muted:#49665d;--track:#d7e6df;--accent:#176b60}
  html,body{height:100%;margin:0;font:14px "Segoe UI","Microsoft YaHei",sans-serif;background:${chromeFallbackFill(false)};color:#183630}
  body{display:grid;place-items:center}
  main{display:flex;align-items:center;gap:14px}
  .dot{width:10px;height:10px;border:2px solid var(--track);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
  @media(prefers-color-scheme:dark){
    :root{--muted:#b0c4bd;--track:#3f514b;--accent:#81c5b4}
    html,body{background:${chromeFallbackFill(true)};color:#f9fafb}
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  h1{font-size:18px;margin:0 0 4px}p{margin:0;color:var(--muted)}
</style>
<body><main><span class="dot"></span><div><h1>Somnus</h1><p>正在启动工作台…</p></div></main>`)}`;
  const ensureDshWindow = () => {
    if (dshWindow && !dshWindow.isDestroyed()) return dshWindow;
    const window = new BrowserWindow({
      ...chromeWindowOptions(process.platform, nativeTheme.shouldUseDarkColors),
      show: false, autoHideMenuBar: true, title: 'Somnus',
      icon: join(process.resourcesPath, 'somnus.ico'),
      webPreferences: {
        preload: join(app.getAppPath(), 'lib', 'somnus-preload.cjs'),
        contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false,
      },
    });
    dshWindow = window;
    window.once('ready-to-show', () => { if (!stopping) window.show(); });
    window.on('page-title-updated', event => event.preventDefault());
    window.setTitle('Somnus');
    window.on('close', event => {
      if (!stopping) { event.preventDefault(); window.hide(); }
    });
    window.on('closed', () => { if (dshWindow === window) dshWindow = undefined; });
    window.webContents.setWindowOpenHandler(({ url }) => {
      const target = URL.parse(url);
      const localModule = target && target.origin === somnusOrigin && /^\/module\/[a-z][a-z0-9-]*\//.test(target.pathname);
      if ((target?.protocol === 'https:' || localModule) && !target.username && !target.password) void shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    const sendFullscreen = () => { if (!window.isDestroyed()) window.webContents.send('dsh-desktop:window-fullscreen', window.isFullScreen()); };
    window.on('enter-full-screen', sendFullscreen); window.on('leave-full-screen', sendFullscreen);
    window.webContents.on('did-finish-load', sendFullscreen);
    const updateBackground = () => { if (!window.isDestroyed()) window.setBackgroundColor(chromeFallbackFill(nativeTheme.shouldUseDarkColors)); };
    nativeTheme.on('updated', updateBackground);
    window.once('closed', () => nativeTheme.removeListener('updated', updateBackground));
    void window.loadURL(splashPage).catch(() => {});
    return window;
  };
  const focusDsh = () => {
    if (!dshWindow || dshWindow.isDestroyed()) return false;
    if (dshWindow.isMinimized()) dshWindow.restore();
    dshWindow.show();
    dshWindow.focus();
    return true;
  };
  const openDsh = async url => {
    dshUrl = url;
    await session.defaultSession.clearCache().catch(() => {});
    const window = ensureDshWindow();
    await window.loadURL(url);
    if (stopping) return;
    window.show();
    window.focus();
  };
  const startAcpHost = async profileDir => {
    if (acpHostInfo) return acpHostInfo;
    writeFileSync(join(activeProfileDir || app.getPath('userData'), 'acp-approval.json'), JSON.stringify({ mode: 'auto' }));
    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, [join(app.getAppPath(), 'lib', 'acp-host.mjs')], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SOMNUS_RESOURCES: process.resourcesPath,
        SOMNUS_ACP_REGISTRY: join(profileDir, 'external-acp-agents.json'),
        SOMNUS_ACP_CWD: join(profileDir, 'workspace'),
        SOMNUS_ACP_APPROVAL_FILE: join(profileDir, 'acp-approval.json'),
        SOMNUS_CODEX_HOME: join(profileDir, 'codex-home'),
        SOMNUS_ACP_TOKEN: token,
      },
    });
    acpHost = child;
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', chunk => engineLog(`ACP host: ${String(chunk).trim()}`));
    child.once('exit', () => {
      if (acpHost !== child) return;
      acpHost = undefined;
      acpHostInfo = undefined;
    });
    const info = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('ACP Host startup timed out')), 25_000);
      child.stdout.on('data', chunk => {
        if (acpHostInfo) return;
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        try {
          const ready = JSON.parse(buffer.slice(0, newline));
          if (typeof ready?.url !== 'string') return;
          clearTimeout(timer);
          acpHostInfo = { url: ready.url, token };
          resolve(acpHostInfo);
        } catch (error) {
          engineLog(`ACP host handshake failed: ${error.message}`);
        }
      });
    });
    return info;
  };
  const startEngine = async () => {
    if (stopping || !workbench.engineEnabled()) return;
    const service = await workbench.start();
    activeProfileDir = service.profileDir;
    let acp;
    try {
      acp = await startAcpHost(service.profileDir);
      process.env.SOMNUS_ACP_URL = acp.url;
      process.env.SOMNUS_ACP_TOKEN = acp.token;
    } catch (error) { engineLog(`ACP host unavailable: ${error.message}`); }
    somnusOrigin = service.origin;
    somnusToken = service.token;
    registerSomnusApi();
    void installSomnusAccess();
    const home = await engineHome(service.profileDir);
    if (stopping) return;
    const runtime = join(process.resourcesPath, 'runtime');
    const primary = join(runtime, 'primary-runtime');
    const resources = { node: process.execPath, dsh: join(app.getAppPath(), 'dsh'), nodeBin: join(runtime, 'bin'),
      pnpm: join(primary, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
    const paths = resolveDesktopPaths(home);
    const manager = new DesktopProjectManager(paths, resources);
    const { processEnvironment } = require(join(service.modules, 'acp-stdio.cjs'));
    const environment = { ...processEnvironment(), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
      DSH_CLIENT_VERSION: desktopClientVersion(), ...service.env,
      SOMNUS_DOCUMENTS_DIR: join(service.profileDir, 'documents'),
      SOMNUS_SHARED_DOCUMENTS_DIR: join(process.resourcesPath, 'shared-documents'),
      ...(acp ? { SOMNUS_ACP_URL: acp.url, SOMNUS_ACP_TOKEN: acp.token } : {}) };
    engine = new DesktopBackendController(onFailure => {
      const host = new DesktopHostProcess(resources.node, resources.dsh,
        paths.profile, undefined, environment, onFailure, primary, resources);
      const startHost = host.start.bind(host);
      host.start = async () => {
        const ready = await startHost();
        dshUrl = ready.url;
        return ready;
      };
      return host;
    }, state => {
      if (state.phase === 'ready') engineLog('Somnus engine ready');
      if (state.phase === 'error') engineLog(`Somnus engine error: ${state.failure?.message ?? 'engine unavailable'}`);
    });
    let startupTimer;
    try {
      await Promise.race([
        engine.start(() => manager.applyRelease()),
        new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('Somnus workspace startup timed out after 60 seconds')), 60000); }),
      ]);
    } finally { clearTimeout(startupTimer); }
    if (!dshUrl || stopping) return;
    configureAgentBridge(service);
    try {
      await openDsh(dshUrl);
    } catch (error) {
      engineLog(`Somnus engine window: ${error?.message ?? error}`);
      openWorkbench();
    }
  };

  app.on('second-instance', (_event, argv, cwd) => {
    if (stopping || !app.isReady()) return;
    workbench.launchFolder(argv, cwd);
    if (!focusDsh()) void openWorkbench();
  });
  app.on('activate', () => { if (!stopping && !focusDsh()) void openWorkbench(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (closed) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    void (async () => {
      try { acpHost?.kill(); } catch (error) { engineLog(`ACP host shutdown: ${error.message}`); }
      try { await engine?.close(); } catch (error) { engineLog(`Somnus engine shutdown: ${error.message}`); }
      try { await workbench.close(); } catch (error) { console.error(error); }
      await engineOpening;
    })().finally(() => { closed = true; app.quit(); });
  });

  void app.whenReady().then(async () => {
    if (stopping) return;
    await workbench.setupTray().catch(error => console.error('Somnus tray:', error));
    workbench.launchFolder(process.argv, process.cwd());
    // Default product UI is the Somnus workbench itself: no DSH sidebar, no
    // DeepSeek account. The DSH shell remains available behind an explicit
    // opt-in for later integration work.
    if (process.env.SOMNUS_DSH_UI !== '0' && workbench.engineEnabled()) {
      workbench.setPrimaryFocus(() => focusDsh());
      ensureDshWindow();
      engineOpening = startEngine().catch(error => {
        if (stopping) return;
        engineLog(`Somnus engine startup: ${error.message}`);
        reportWorkbenchError(error);
      });
      return;
    }
    await workbench.openHome();
  }).catch(reportWorkbenchError);
}
