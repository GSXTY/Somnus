const { randomUUID } = require('node:crypto');
const { trustWorkbench } = require('./project-folders.cjs');
const { isLocalHost, panelBounds } = require('./workspace-web.cjs');
const { DIFF_TOOL } = require('./acp-project-workflow.cjs');

const IM_PACKAGE = '@xmanrui/dsh-im';

function managedUrl(value) {
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.pathname !== '/' || url.hash ||
      !/^[A-Za-z0-9_-]{15,256}$/.test(url.searchParams.get('token') || '')) throw new Error('托管 DSH Web 地址无效。');
  return url;
}

function registerDshView({ ipcMain, window, origin, WebContentsView, session, market },
  { channelPrefix, partitionPrefix, installed, prepare, isolate, reusable = false }) {
  const handlers = new Map();
  let current;
  let currentHost;
  let bounds;
  let generation = 0;
  let showing = false;

  function close() {
    generation++;
    showing = false;
    const view = current;
    current = undefined;
    currentHost = undefined;
    if (!view) return;
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
    const browser = view.webContents.isDestroyed() ? null : view.webContents.session;
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (browser) void browser.clearStorageData().catch(() => {});
  }

  function resize(rect) {
    bounds = panelBounds(rect, window);
    if (!current) return;
    if (bounds.width && bounds.height) current.setBounds(bounds);
    current.setVisible(Boolean(showing && bounds.width && bounds.height));
  }

  function register(name, callback) {
    const channel = channelPrefix + name;
    const handler = (event, ...args) => {
      trustWorkbench(event, window, origin);
      return callback(event, ...args);
    };
    handlers.set(channel, handler);
    ipcMain.handle(channel, handler);
  }

  if (installed) register('status', async (_event, ...args) => {
    const available = await installed(...args);
    return isolate ? { available } : { installed: available };
  });
  register('show', async (event, rect, ...args) => {
    if (!reusable) close();
    const request = ++generation;
    showing = false;
    resize(rect);
    const validate = () => trustWorkbench(event, window, origin);
    if (installed && !await installed(...args)) throw new Error('此插件没有可在 Somnus 打开的原生设置页。');
    if (generation !== request) return;
    const server = await market.settings(validate);
    const url = managedUrl(await server.ready);
    if (generation !== request) return;
    validate();
    const result = await prepare?.(server, args[0], validate);
    if (generation !== request) return;
    validate();
    showing = !isolate;
    if (reusable && current && currentHost === url.origin && !current.webContents.isDestroyed()) {
      resize(rect);
      return result;
    }
    if (current) {
      close();
      showing = true;
    }

    const browser = session.fromPartition(partitionPrefix + randomUUID(), { cache: false });
    browser.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browser.setPermissionCheckHandler(() => false);
    browser.on('will-download', event => event.preventDefault());
    browser.webRequest.onBeforeRequest((details, callback) => {
      const target = URL.parse(details.url);
      const sameHost = target?.origin === url.origin ||
        target?.protocol === 'ws:' && target.host === url.host;
      callback({ cancel: !sameHost && Boolean(target && isLocalHost(target.hostname)) });
    });
    const view = new WebContentsView({
      webPreferences: {
        session: browser, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webviewTag: false, devTools: false, disableDialogs: true,
      },
    });
    current = view;
    currentHost = url.origin;
    const blockUnsafe = (event, legacyUrl) => {
      if (URL.parse(event.url ?? legacyUrl)?.origin !== url.origin) event.preventDefault();
    };
    view.webContents.on('will-frame-navigate', blockUnsafe);
    view.webContents.on('will-redirect', blockUnsafe);
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      window.contentView.addChildView(view);
      if (bounds.width && bounds.height) view.setBounds(bounds);
      view.setVisible(Boolean(showing && bounds.width && bounds.height));
      await view.webContents.loadURL(url.href);
      if (isolate) {
        await isolate(view, args);
        if (current !== view || generation !== request) return;
        validate();
        showing = true;
        resize(rect);
      }
      return result;
    } catch {
      if (current !== view) return;
      close();
      throw new Error('无法加载托管 DSH 页面。');
    }
  });
  register('bounds', (_event, rect) => resize(rect));
  register('close', () => {
    if (!reusable) return close();
    generation++;
    showing = false;
    current?.setVisible(false);
  });
  window.webContents.on('did-start-navigation', (event, _legacyUrl, isInPlace, isMainFrame) => {
    if ((event.isMainFrame ?? isMainFrame) && !(event.isSameDocument ?? isInPlace)) close();
  });
  window.webContents.on('render-process-gone', close);
  window.once('closed', () => {
    close();
    for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
  });
}

// The IM plugin registers this settings section in the pinned Web client.
// No browser URL, selector or script is supplied by the renderer or catalog.
async function isolateImSection() {
  const waitFor = async (find) => {
    const deadline = Date.now() + 10000;
    do {
      const found = find();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error('IM settings section unavailable');
  };
  const findDialog = () => document.querySelector('[data-shortcut-modal="settings"]');
  if (!findDialog()) {
    const button = await waitFor(() => document.querySelector('button[aria-haspopup="dialog"][aria-label="Settings"],button[aria-haspopup="dialog"][aria-label="设置"]'));
    button.click();
  }
  const dialog = await waitFor(findDialog);
  const nav = await waitFor(() => dialog.querySelector('nav'));
  const link = await waitFor(() => [...nav.querySelectorAll('button')].find(button =>
    /^(?:IM\s*机器人|IM\s*Bots?)$/i.test(button.textContent?.trim() ?? '')));
  link.click();
  await waitFor(() => link.getAttribute('aria-current') === 'true');
  const content = await waitFor(() => [...dialog.children].find(element =>
    [...element.classList].some(name => name.endsWith('_options')) && element.childElementCount));
  if (!dialog.parentElement || dialog.parentElement.parentElement !== document.body) throw new Error('Unexpected settings layout');
  for (const node of document.body.children) if (node !== dialog.parentElement) node.setAttribute('data-somnus-plugin-hidden', '');
  for (const node of dialog.parentElement.children) if (node !== dialog) node.setAttribute('data-somnus-plugin-hidden', '');
  for (const node of dialog.children) if (node !== content) node.setAttribute('data-somnus-plugin-hidden', '');
  dialog.parentElement.setAttribute('data-somnus-plugin-overlay', '');
  dialog.setAttribute('data-somnus-plugin-panel', '');
  content.setAttribute('data-somnus-plugin-content', '');
  const style = document.createElement('style');
  style.textContent = `
    [data-somnus-plugin-hidden] { display: none !important; }
    [data-somnus-plugin-overlay], [data-somnus-plugin-panel] { display: block !important; position: fixed !important;
      inset: 0 !important; width: 100% !important; height: 100% !important; max-width: none !important;
      max-height: none !important; margin: 0 !important; padding: 0 !important; border: none !important;
      border-radius: 0 !important; transform: none !important; }
    [data-somnus-plugin-content] { display: block !important; height: 100% !important; overflow: auto !important; }
  `;
  document.head.append(style);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length === 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

function registerDshPluginPage(options) {
  const { market } = options;
  registerDshView(options, {
    channelPrefix: 'somnus-dsh-plugin-page:', partitionPrefix: 'somnus-dsh-plugin-page-',
    installed: async (id, source) => {
      if (id !== IM_PACKAGE || source !== 'community') return false;
      const profile = await market.webProfile();
      return Boolean(profile?.bundles.includes(id) && await market.community.installed(profile, id));
    },
    async isolate(view) {
      await view.webContents.executeJavaScript('(' + isolateImSection.toString() + ')()');
    },
  });
}

function registerDshImView(options) {
  registerDshView(options, {
    channelPrefix: 'somnus-dsh-im:', partitionPrefix: 'somnus-dsh-im-',
    installed: async () => Boolean((await options.market.webProfile())?.bundles.includes(IM_PACKAGE)),
  });
}

function registerNativeDshView(options) {
  const { market, workflow } = options;
  registerDshView(options, {
    channelPrefix: 'somnus-native-dsh:', partitionPrefix: 'somnus-native-dsh-', reusable: true,
    async prepare(server, workspaceId, validate) {
      const result = { projectRegistered: false, companyModel: server.companyModel ?? null };
      if (workspaceId == null || !workflow) return result;
      let root;
      try {
        ({ root } = await workflow.target(workspaceId, DIFF_TOOL, { source: 'source_1' }));
      } catch {
        return result;
      }
      validate();
      try {
        const created = await market.account.request(server, 'workspace/create', { request: { path: root } });
        return { ...result, projectRegistered: Boolean(created?.workspace?.workspaceId) };
      } catch {
        return result;
      }
    },
  });
}

module.exports = { registerDshImView, registerNativeDshView, registerDshPluginPage, managedUrl, IM_PACKAGE };
