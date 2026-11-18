const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { ownedPages, servePage } = require('./acp-dsh-plugin-pages.cjs');
const { isolateLegacyPage } = require('./acp-dsh-legacy-pages.cjs');
const { createImPanelOverlay, IM_PANEL_HASH, supportsImPanel } = require('./acp-dsh-im-panel.cjs');

test('dedicated IM client registers a scoped root using its shared render service', async t => {
  const overlay = await createImPanelOverlay();
  t.after(overlay.dispose);
  const directory = path.dirname(overlay.file);
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.ok(manifest.dsh.client.inject.includes('@xmanrui/dsh-im'));
  assert.ok(supportsImPanel('5.10.0'));
  assert.equal(supportsImPanel('5.9.1'), false);

  let panel;
  const location = { hash: '' };
  const window = { __ModuleLoader__: { load({ factory }) {
    panel = factory(name => {
      assert.equal(name, 'react');
      return { createElement: (tag, props, child) => ({ tag, props, child }) };
    });
  } } };
  vm.runInNewContext(await readFile(path.join(directory, 'client.js'), 'utf8'), { window, location });
  let root;
  const child = { imPanel: true };
  const injected = {
    dshImClient: { version: 1, render: () => child },
    slots: { register({ name, priority }, render) { assert.equal(name, 'root'); assert.ok(priority < 0); root = render; } },
    effect: callback => callback(),
  };
  const context = { inject: (dependencies, bind) => {
    assert.deepEqual([...dependencies], ['dshImClient']);
    bind(injected);
  } };
  panel.apply(context);
  assert.equal(root, undefined);

  location.hash = IM_PANEL_HASH;
  panel.apply(context);
  const result = root();
  assert.equal(result.tag, 'main');
  assert.equal(result.props['data-somnus-im-panel'], '');
  assert.equal(result.child, child);
});

test('IM sidebar can open the native Settings section from the account menu without a shortcut', async () => {
  const account = { open: false, getAttribute: () => String(account.open),
    click() { account.open = true; } };
  let settingsOpened = false;
  let imSelected = false;
  const menuItem = { textContent: 'SettingsCtrl+,', getAttribute: () => null,
    querySelectorAll: () => [{ textContent: 'Settings' }],
    click() { settingsOpened = true; } };
  const im = { textContent: 'IM机器人', getAttribute: () => String(imSelected),
    click() { imSelected = true; } };
  const element = properties => ({ children: [], classList: [], attributes: new Set(),
    setAttribute(name) { this.attributes.add(name); }, ...properties });
  const home = element();
  const body = element();
  const portal = element({ parentElement: body });
  const panel = element({ parentElement: portal, querySelectorAll: () => [im] });
  const nav = element();
  const content = element({ parentElement: panel, classList: ['dsh_options'], isConnected: true });
  Object.defineProperty(content, 'childElementCount', { get: () => Number(imSelected) });
  body.children = [home, portal];
  portal.children = [panel];
  panel.children = [nav, content];
  let style;
  const document = {
    body,
    querySelector(selector) {
      if (selector === '[data-shortcut-modal="settings"]') return settingsOpened ? panel : null;
      return selector.includes('[data-signed-out]') ? account : null;
    },
    querySelectorAll(selector) {
      return selector === '[role="menu"] [role="menuitem"]' && account.open ? [menuItem] : [];
    },
    addEventListener() {},
    createElement: () => ({}),
    head: { append(node) { style = node; } },
  };
  await vm.runInNewContext('(' + isolateLegacyPage.toString() + ')({im:true,label:"IM机器人"})',
    { document, setTimeout(callback) { callback(); } });
  assert.equal(settingsOpened, true);
  assert.equal(imSelected, true);
  assert.ok(style.textContent.includes('overflow:auto'));
  assert.ok(home.attributes.has('data-somnus-legacy-hidden'));
  assert.ok(nav.attributes.has('data-somnus-legacy-hidden'));
  assert.ok(content.attributes.has('data-somnus-legacy-content'));
});

test('declared active package pages can read local assets and only their own settings', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'somnus-plugin-page-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'panel'));
  await writeFile(path.join(root, 'panel', 'index.html'), '<h1>Fixture plugin</h1>');
  await writeFile(path.join(root, 'secret.html'), 'Must not leak');
  const id = '@example/verified';
  const manifest = { dsh: { somnus: { pages: [
    { id: 'home', title: 'Fixture Plugin', directory: 'panel', sidebar: true },
    { id: 'home', title: 'Duplicate', directory: 'panel' },
    { id: 'unsafe', title: 'Outside', directory: '../panel' },
  ] } } };
  const market = {
    webProfile: async () => ({ bundles: [id] }),
    community: { installed: async () => manifest, packageRoot: async () => root },
  };
  const pages = await ownedPages(market);
  assert.deepEqual(pages.map(({ id, pluginId, label, sidebar }) => ({ id, pluginId, label, sidebar })),
    [{ id: id + '#home', pluginId: id, label: 'Fixture Plugin', sidebar: true }]);
  const scope = [];
  const settings = { read: async (...args) => { scope.push(args.slice(0, 2)); return { sections: [] }; } };
  const request = (relative, init) => servePage(new Request('https://somnus-plugin.invalid' + relative, init),
    pages[0], settings, () => {});
  assert.equal(await (await request('/')).text(), '<h1>Fixture plugin</h1>');
  assert.equal((await request('/../secret.html')).status, 404);
  assert.equal((await request('/%2e%2e%2fsecret.html')).status, 404);
  assert.deepEqual(await (await request('/__somnus/settings?pluginId=another')).json(), { sections: [] });
  assert.deepEqual(scope, [[id, 'community']]);
  assert.equal((await request('/__somnus/settings', { method: 'PUT' })).status, 405);
});
