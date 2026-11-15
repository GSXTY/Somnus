const { randomBytes } = require('node:crypto');
const { mkdirSync, readFileSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { backendCommand, startBackend } = require('./backend.cjs');
const { registerProjectFolders } = require('./project-folders.cjs');
const { registerAcpAgents } = require('./acp-ipc.cjs');
const { registerSomnusUpdater } = require('./acp-somnus-updater.cjs');

const sourceRoot = path.resolve(__dirname, '..');
const showStartupPage = process.platform === 'win32';
const APP_TITLE = require('./package.json').productName;
const STARTUP_BACKGROUND = '#F4F8F6';
const STARTUP_FOREGROUND = '#183630';
// Let workspace surfaces and backdrops show through the native button background.
// Leave the bottom pixel of the 42px workspace header to its CSS separator.
const WORKSPACE_CAPTION = { color: 'rgba(0, 0, 0, 0)', symbolColor: '#202A28', height: 41 };
const BRAND_DIRECTORY = path.join(__dirname, 'brand');
const startupMark = showStartupPage ? readFileSync(path.join(BRAND_DIRECTORY, 'somnus.png')).toString('base64') : '';
const startupPage = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${APP_TITLE}</title>
<style>
  html { font: 14px "Segoe UI", "Microsoft YaHei", sans-serif; background: ${STARTUP_BACKGROUND}; color: ${STARTUP_FOREGROUND}; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
  header { position: fixed; inset: 0 0 auto; height: 50px; app-region: drag; -webkit-app-region: drag; }
  main { display: flex; align-items: center; gap: 16px; padding: 24px; }
  h1 { font-size: 19px; font-weight: 600; margin: 0 0 6px; }
  p { margin: 0; color: #547068; }
  .mark { width: 42px; height: 42px; flex: none; }
  .mark img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .spinner { display: inline-block; width: 9px; height: 9px; margin-right: 6px;
    border: 1.5px solid #CBE0D9; border-top-color: #176D61; vertical-align: -1px;
    border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
<header aria-hidden="true"></header>
<main role="status">
  <span class="mark" aria-hidden="true"><img src="data:image/png;base64,${startupMark}" alt=""></span>
  <div><h1>${APP_TITLE}</h1><p><span class="spinner" aria-hidden="true"></span>正在启动本机分析服务…</p></div>
</main>
</html>`;
const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webviewTag: false,
};

let window;
let backend;
let origin;
let quitting = false;
let canQuit = false;
let stoppingBackend = false;

function focusWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function restrictNavigation(contents) {
  function keepLocal(event, legacyUrl) {
    if (!origin || parseUrl(event.url ?? legacyUrl)?.origin !== origin) event.preventDefault();
  }

  contents.on('will-frame-navigate', keepLocal);
  contents.on('will-redirect', keepLocal);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url, disposition }) => {
    const target = parseUrl(url);
    if (origin && target?.origin === origin) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences } };
    }
    // External web links opened by the workbench go to the user's browser.
    if (origin && target?.protocol === 'https:' && !target.username && !target.password &&
        ['foreground-tab', 'background-tab', 'new-window'].includes(disposition)) {
      void shell.openExternal(target.href).catch(() => {});
    }
    return { action: 'deny' };
  });
}

function createWorkspaceWindow() {
  const activeSession = session.defaultSession;
  activeSession.setPermissionCheckHandler(() => false);
  activeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  app.on('web-contents-created', (_event, contents) => restrictNavigation(contents));

  const titleBar = process.platform === 'win32' ? {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: STARTUP_BACKGROUND, symbolColor: STARTUP_FOREGROUND, height: 50 },
    icon: path.join(BRAND_DIRECTORY, 'somnus.ico'),
  } : process.platform === 'darwin' ? {
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 18 },
  } : {};

  const workspace = new BrowserWindow({
    ...titleBar,
    title: APP_TITLE,
    width: 1360,
    height: 900,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: STARTUP_BACKGROUND,
    autoHideMenuBar: true,
    show: showStartupPage,
    webPreferences: showStartupPage
      ? { ...webPreferences, preload: path.join(__dirname, 'project-preload.cjs') }
      : webPreferences,
  });
  workspace.on('closed', () => { window = null; });
  const contents = workspace.webContents;
  contents.on('page-title-updated', event => event.preventDefault());
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isComposing || input.key.toLowerCase() !== 'k' ||
        !(input.control || input.meta) || input.shift || input.alt) return;
    if (!origin || parseUrl(contents.getURL())?.origin !== origin) return;
    event.preventDefault();
    if (!input.isAutoRepeat) {
      void contents.executeJavaScript("window.dispatchEvent(new Event('workbench:open-command'))").catch(() => {});
    }
  });
  return workspace;
}

async function openWorkspace(logFile, timings) {
  let loadingPage;
  if (showStartupPage) {
    window = createWorkspaceWindow();
    timings.windowCreatedMs = Math.round(process.uptime() * 1000);
    loadingPage = window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPage)}`).then(() => {
      timings.loadingPageLoadedMs = Math.round(process.uptime() * 1000);
    });
  }

  const command = backendCommand({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    sourceRoot,
  });
  const projectToken = showStartupPage ? randomBytes(32).toString('hex') : '';
  const env = projectToken ? { ...process.env, RESPIRATORY_VIEWER_PROJECT_TOKEN: projectToken } : process.env;
  backend = startBackend(command, logFile, { env });
  timings.backendSpawnedMs = Math.round(process.uptime() * 1000);
  const service = backend.ready.then(url => {
    timings.backendReadyMs = Math.round(process.uptime() * 1000);
    return url;
  });
  [origin] = await Promise.all([service, loadingPage]);
  if (quitting) return;

  if (!window) window = createWorkspaceWindow();
  if (projectToken) {
    await registerProjectFolders({ ipcMain, dialog, shell, window, origin, token: projectToken });
    if (quitting) return;
    registerAcpAgents({ ipcMain, app, dialog, shell, window, origin, token: projectToken,
      profileDir: app.getPath('userData'), version: app.getVersion() });
    registerSomnusUpdater({ ipcMain, app, window, origin, prepareInstall: stopBackendForUpdate });
  }
  void backend.exited.then(error => {
    if (!quitting) reportFailure(error, logFile);
  });
  await window.loadURL(origin);
  if (showStartupPage && window && !quitting) window.setTitleBarOverlay(WORKSPACE_CAPTION);
  timings.workspaceLoadedMs = Math.round(process.uptime() * 1000);
  if (!showStartupPage && !quitting) focusWindow();
}

async function stopBackendForUpdate() {
  if (quitting || stoppingBackend) throw new Error('Somnus is already closing.');
  stoppingBackend = true;
  quitting = true;
  try {
    await backend.stop();
    canQuit = true;
  } catch (error) {
    quitting = false;
    throw error;
  } finally {
    stoppingBackend = false;
  }
}

function reportFailure(error, logFile) {
  if (quitting) return;
  quitting = true;
  if (window && !window.isDestroyed()) window.hide();
  dialog.showErrorBox(APP_TITLE, `${error.message}\n\n本机服务日志：${logFile}`);
  app.quit();
}

if (process.platform === 'win32' || process.platform === 'darwin') {
  // Keep browser state and the instance lock in the existing profile when the app name changes.
  const override = app.commandLine.getSwitchValue('user-data-dir');
  const profileName = process.platform === 'win32' ? 'RespiratoryViewer' : 'VV MAN';
  const profile = override ? path.resolve(override) : path.join(app.getPath('appData'), profileName);
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  if (process.platform === 'win32') app.setAppUserModelId('com.vvfly.respiratoryviewer');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  app.on('activate', focusWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (canQuit || !backend) return;
    event.preventDefault();
    if (stoppingBackend) return;
    stoppingBackend = true;
    quitting = true;
    void backend.stop().catch(error => console.error(error)).then(() => {
      canQuit = true;
      app.quit();
    });
  });
  void app.whenReady().then(async () => {
    const logFile = path.join(app.getPath('logs'), 'backend.log');
    const timings = { electronReadyMs: Math.round(process.uptime() * 1000) };
    try {
      await openWorkspace(logFile, timings);
    } catch (error) {
      reportFailure(error, logFile);
    } finally {
      if (showStartupPage) {
        await writeFile(path.join(path.dirname(logFile), 'startup-timing.json'), JSON.stringify(timings, null, 2)).catch(() => {});
      }
    }
  });
}
