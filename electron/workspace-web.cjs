const { randomUUID } = require('node:crypto');
const { trustWorkbench } = require('./project-folders.cjs');

function isLocalHost(name) {
  const host = name.toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost') ||
    /^127\.(?:\d+\.){2}\d+$/.test(host) || host === '0.0.0.0' || host === '[::1]' ||
    host === '[::]' || /^\[::ffff:(?:7f[0-9a-f]{2}:|0:)/.test(host);
}

function pageUrl(value, origin) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const url = URL.parse(value);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.origin === origin || isLocalHost(url.hostname)) return null;
  return url.href;
}

function panelBounds(rect, window) {
  const fields = ['x', 'y', 'width', 'height'];
  if (!rect || !fields.every(key => Number.isFinite(rect[key]))) throw new Error('网页区域无效。');
  const [width, height] = window.getContentSize();
  const zoom = window.webContents.getZoomFactor();
  const clamp = (value, max) => Math.max(0, Math.min(max, Math.round(value * zoom)));
  const x = clamp(rect.x, width);
  const y = clamp(rect.y, height);
  return { x, y, width: Math.max(0, clamp(rect.x + rect.width, width) - x),
    height: Math.max(0, clamp(rect.y + rect.height, height) - y) };
}

function registerWorkspaceWeb({ ipcMain, window, origin, WebContentsView, session }) {
  const channels = ['show', 'bounds', 'close'].map(name => 'somnus-workspace-web:' + name);
  let view;
  let browserSession;
  function close() {
    if (!view) return;
    const current = view;
    view = undefined;
    if (!window.isDestroyed()) window.contentView.removeChildView(current);
    if (!current.webContents.isDestroyed()) current.webContents.close();
  }
  function updateBounds(current, bounds) {
    if (!bounds.width || !bounds.height) {
      current.setVisible(false);
      return;
    }
    current.setBounds(bounds);
    current.setVisible(true);
  }
  function getSession() {
    if (browserSession) return browserSession;
    browserSession = session.fromPartition('somnus-workspace-web-' + randomUUID(), { cache: false });
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on('will-download', event => event.preventDefault());
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const url = URL.parse(details.url);
      callback({ cancel: Boolean(url && (url.origin === origin || isLocalHost(url.hostname))) });
    });
    return browserSession;
  }
  ipcMain.handle(channels[0], async (event, value, rect) => {
    trustWorkbench(event, window, origin);
    const url = pageUrl(value, origin);
    if (!url) throw new Error('请输入可访问的 HTTP 或 HTTPS 网页地址。');
    const bounds = panelBounds(rect, window);
    close();
    const current = new WebContentsView({
      webPreferences: {
        session: getSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        devTools: false,
        disableDialogs: true,
      },
    });
    view = current;
    const blockUnsafe = (event, legacyUrl) => {
      if (!pageUrl(event.url ?? legacyUrl, origin)) event.preventDefault();
    };
    current.webContents.on('will-frame-navigate', blockUnsafe);
    current.webContents.on('will-redirect', blockUnsafe);
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      window.contentView.addChildView(current);
      updateBounds(current, bounds);
      await current.webContents.loadURL(url);
    } catch {
      if (view !== current) return;
      close();
      throw new Error('无法加载网页。请检查地址或网络后重试。');
    }
  });
  ipcMain.handle(channels[1], (event, rect) => {
    trustWorkbench(event, window, origin);
    if (view) updateBounds(view, panelBounds(rect, window));
  });
  ipcMain.handle(channels[2], event => {
    trustWorkbench(event, window, origin);
    close();
  });
  window.webContents.on('did-start-navigation', (event, _legacyUrl, isInPlace, isMainFrame) => {
    if ((event.isMainFrame ?? isMainFrame) && !(event.isSameDocument ?? isInPlace)) close();
  });
  window.webContents.on('render-process-gone', close);
  window.once('closed', () => {
    close();
    for (const channel of channels) ipcMain.removeHandler(channel);
  });
}

module.exports = { registerWorkspaceWeb, isLocalHost, panelBounds };
