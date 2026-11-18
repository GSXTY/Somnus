const { randomUUID } = require('node:crypto');
const { lstat, open, realpath } = require('node:fs/promises');
const path = require('node:path');
const { trustWorkbench } = require('./project-folders.cjs');
const { panelBounds } = require('./workspace-web.cjs');
const { createDshPluginSettings } = require('./acp-dsh-plugin-settings.cjs');
const { managedUrl, IM_PACKAGE } = require('./acp-dsh-im-view.cjs');
const { IM_PANEL_HASH, waitForImPanel } = require('./acp-dsh-im-panel.cjs');
const { legacyPages, isolateLegacyPage } = require('./acp-dsh-legacy-pages.cjs');

const CHANNEL = 'somnus-plugin-pages:';
const ORIGIN = 'https://somnus-plugin.invalid';
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const PART = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i;
const TYPES = new Map(Object.entries({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }));
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};

function parts(relative) {
  const list = relative.split('/');
  return list.length <= 12 && list.every(part => PART.test(part) && !part.endsWith('.') && !RESERVED.test(part)) ? list : null;
}

async function packagePath(root, relative, directory = false) {
  const list = typeof relative === 'string' && parts(relative);
  if (!list) return null;
  try {
    let file = await realpath(root);
    for (const [index, name] of list.entries()) {
      file = path.join(file, name);
      const info = await lstat(file);
      if (info.isSymbolicLink() || (index === list.length - 1 && !directory ? !info.isFile() : !info.isDirectory())) return null;
    }
    return await realpath(file) === file ? file : null;
  } catch { return null; }
}

async function ownedPages(market, pluginId) {
  const profile = await market.webProfile();
  if (!profile) return [];
  const pages = [];
  for (const name of profile.bundles) {
    if (typeof name !== 'string' || name.startsWith('@deepseek-ai/')) continue;
    const installed = await market.community.installed(profile, name);
    const declared = installed?.dsh?.somnus?.pages;
    if (!Array.isArray(declared) && !installed?.dsh?.client) continue;
    const root = await market.community.packageRoot(profile, name);
    if (!root) continue;
    const seen = new Set();
    for (const item of (Array.isArray(declared) ? declared : []).slice(0, 8)) {
      if (!ID.test(item?.id ?? '') || item.id.startsWith('legacy-') || seen.has(item.id) || typeof item.title !== 'string' ||
          !item.title.trim() || item.title.length > 100 || /[\x00-\x1f\x7f]/.test(item.title)) continue;
      const directory = await packagePath(root, item.directory, true);
      if (!directory || !await packagePath(directory, 'index.html')) continue;
      pages.push({ id: name + '#' + item.id, pluginId: name, label: item.title.trim(),
        sidebar: item.sidebar === true, directory });
      seen.add(item.id);
    }
    if (seen.size) continue;
    for (const legacy of await legacyPages(market, installed, root, packagePath)) {
      const id = 'legacy-sidebar-' + legacy.key;
      if (seen.has(id)) continue;
      pages.push({ id: name + '#' + id, pluginId: name, label: legacy.label, sidebar: true, legacy });
      seen.add(id);
    }
  }
  const labels = page => [page.label, ...(page.legacy.aliases ?? [])]
    .map(label => label.trim().replace(/\s+/g, ' ').toLowerCase());
  return pages.filter(page => (!pluginId || page.pluginId === pluginId) && (!page.legacy || !pages.some(other =>
    other.pluginId !== page.pluginId && other.legacy &&
    (other.legacy.key === page.legacy.key || labels(other).some(label => labels(page).includes(label))))));
}

function publicPage({ directory, legacy, ...page }) { return page; }

async function servePage(request, page, settings, validate) {
  const target = URL.parse(request.url);
  if (target?.origin !== ORIGIN || target.username || target.password) return new Response(null, { status: 403 });
  if (target.pathname === '/__somnus/settings') {
    try {
      if (request.method === 'GET') return Response.json(await settings.read(page.pluginId, 'community', validate), { headers: HEADERS });
      if (request.method === 'POST' && request.headers.get('content-type') === 'application/json') {
        const text = await request.text();
        if (text.length <= 64_000) {
          const input = JSON.parse(text);
          return Response.json(await settings.save(page.pluginId, 'community', input.sectionId, input.revision,
            input.edits, validate), { headers: HEADERS });
        }
      }
    } catch {
      return Response.json({ error: '插件设置不可用或未能保存。' }, { status: 409, headers: HEADERS });
    }
    return new Response(null, { status: 405 });
  }
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const relative = target.pathname === '/' ? 'index.html' : target.pathname.slice(1);
  const mime = TYPES.get(path.extname(relative));
  const file = mime && await packagePath(page.directory, relative);
  if (!file) return new Response(null, { status: 404 });
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) return new Response(null, { status: 404 });
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return new Response(null, { status: 413 });
    return new Response(await handle.readFile(), { headers: { ...HEADERS, 'Content-Type': mime } });
  } finally { await handle.close(); }
}

function registerOwnedDshPages({ ipcMain, window, origin, WebContentsView, session, market }) {
  const settings = createDshPluginSettings(market);
  const registered = [];
  let view;
  let ready = false;
  let requestedBounds;
  let generation = 0;
  function close() {
    generation++;
    ready = false;
    requestedBounds = undefined;
    if (!view) return;
    const closed = view;
    view = undefined;
    if (!window.isDestroyed()) window.contentView.removeChildView(closed);
    if (!closed.webContents.isDestroyed()) closed.webContents.close();
  }
  function bounds(rect) {
    const size = panelBounds(rect, window);
    requestedBounds = size;
    if (!view || !ready) return;
    if (size.width && size.height) view.setBounds(size);
    view.setVisible(Boolean(size.width && size.height));
  }
  function handle(verb, fn) {
    const channel = CHANNEL + verb;
    registered.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      const validate = () => trustWorkbench(event, window, origin);
      validate();
      return fn(validate, ...args);
    });
  }
  handle('list', async (validate, pluginId) => {
    const pages = await ownedPages(market, pluginId);
    validate();
    return pages.map(publicPage);
  });
  handle('show', async (validate, id, rect) => {
    close();
    const request = generation;
    if (typeof id !== 'string' || id.length > 250 || !id.includes('#')) throw new Error('无效的插件页面。');
    const page = (await ownedPages(market, id.split('#')[0])).find(item => item.id === id);
    if (!page) throw new Error('此插件页面目前不可用。');
    if (request !== generation) return;
    validate();
    const server = page.legacy && await market.settings(validate);
    const native = server && managedUrl(await server.ready);
    const directIm = native && page.pluginId === IM_PACKAGE && server.imPanel;
    if (directIm) native.hash = IM_PANEL_HASH;
    if (request !== generation) return;
    validate();
    const browser = session.fromPartition('somnus-owned-plugin-' + randomUUID(), { cache: false });
    browser.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browser.setPermissionCheckHandler(() => false);
    browser.on('will-download', event => event.preventDefault());
    browser.webRequest.onBeforeRequest(({ url }, next) => {
      const target = URL.parse(url);
      const ws = native && target?.protocol === 'ws:' && target.host === native.host;
      next({ cancel: target?.origin !== (native?.origin ?? ORIGIN) && !ws &&
        !url.startsWith('data:image/') && !(native && url.startsWith('blob:' + native.origin + '/')) });
    });
    if (!native) browser.protocol.handle('https', incoming => servePage(incoming, page, settings, () => {
      if (request !== generation) throw new Error('此插件页面已关闭。');
      validate();
    }));
    const added = new WebContentsView({ webPreferences: { session: browser, sandbox: true, contextIsolation: true,
      nodeIntegration: false, devTools: false, webviewTag: false, disableDialogs: true,
      ...(native && page.pluginId === IM_PACKAGE ? { backgroundThrottling: false } : {}) } });
    view = added;
    const restrict = (event, legacyUrl) => {
      if (URL.parse(event.url ?? legacyUrl)?.origin !== (native?.origin ?? ORIGIN)) event.preventDefault();
    };
    added.webContents.on('will-frame-navigate', restrict);
    added.webContents.on('will-redirect', restrict);
    added.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    added.webContents.once('destroyed', () => {
      if (!native) browser.protocol.unhandle('https');
      void browser.clearStorageData().catch(() => {});
    });
    try {
      const initial = panelBounds(rect, window);
      requestedBounds = initial;
      // A hidden WebContentsView starts at a zero-size Chromium viewport. Prime
      // DSH while clipped outside the workbench, then reveal only isolated UI.
      added.setBounds({ x: 32768, y: 0, width: Math.max(initial.width, 800), height: Math.max(initial.height, 600) });
      window.contentView.addChildView(added);
      await added.webContents.loadURL(native?.href ?? ORIGIN + '/');
      if (native && request === generation) {
        if (directIm) await added.webContents.executeJavaScript('(' + waitForImPanel.toString() + ')()');
        else {
          const target = { ...page.legacy, im: page.pluginId === IM_PACKAGE };
          await added.webContents.executeJavaScript('(' + isolateLegacyPage.toString() + ')(' + JSON.stringify(target) + ')');
        }
        if (request === generation) validate();
      }
      if (request === generation) {
        ready = true;
        const final = requestedBounds;
        if (final.width && final.height) added.setBounds(final);
        added.setVisible(Boolean(final.width && final.height));
      }
    } catch {
      if (request !== generation) return;
      close();
      throw new Error(native ? 'DSH 未能加载这个插件页面，请确认插件已启用后重试。' : '无法打开插件页面。');
    }
  });
  handle('bounds', (_validate, rect) => bounds(rect));
  handle('close', close);
  window.webContents.on('did-start-navigation', (event, _legacyUrl, isInPlace, isMainFrame) => {
    if ((event.isMainFrame ?? isMainFrame) && !(event.isSameDocument ?? isInPlace)) close();
  });
  window.webContents.on('render-process-gone', close);
  window.once('closed', () => {
    close();
    for (const channel of registered) ipcMain.removeHandler(channel);
  });
}

module.exports = { registerOwnedDshPages, ownedPages, servePage };
