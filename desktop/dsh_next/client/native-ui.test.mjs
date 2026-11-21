import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { buildInstalledClientOverlay, compileWorkbench } from './overlay.mjs';
import { buildBrandingOverlay } from '../overlay.mjs';
import { installEmbeddedConfigurationBridge } from '../../../page_design/frontend/src/configuration/embeddedConfigurationBridge.mjs';

const archive = readFileSync(new URL('../upstream/app.asar', import.meta.url));
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
function read(file) {
  let entry = header;
  for (const segment of file.split('/')) entry = entry.files[segment];
  const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
  return archive.subarray(offset, offset + entry.size);
}
const branding = JSON.parse(readFileSync(new URL('../branding.json', import.meta.url)));
const asset = file => readFileSync(new URL('../../../' + file, import.meta.url));
const overlay = await buildInstalledClientOverlay(read, branding, asset, 'dsh/node_modules');
const compiled = await compileWorkbench();
const moduleFile = name => `dsh/node_modules/@deepseek-ai/dsh-client-ui-${name}/lib/client.js`;

function renderHarness(states = [], hostWindow = {}) {
  let index = 0;
  const writes = [];
  const effects = [];
  const react = { lazy: factory => factory, Suspense: 'Suspense', useEffect: effect => effects.push(effect), useRef: value => ({ current: value }), useState: initial => {
    const at = index++;
    return [at in states ? states[at] : typeof initial === 'function' ? initial() : initial, value => writes.push([at, value])];
  } };
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' };
  const module = { exports: {} };
  vm.runInNewContext(compiled.code, { module, exports: module.exports,
    require: id => id === 'react' ? react : id === 'react/jsx-runtime' ? jsx : id === '@deepseek-ai/dsh-client-ui-primitives' ? { Button: 'NativeButton', Modal: 'NativeModal' } : {},
    window: { matchMedia: () => ({ matches: false }), ...hostWindow }, self: {}, URL, console, Error });
  return { ui: module.exports, writes, effects };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children, tree.props?.footer].flat(20).flatMap(nodes)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (typeof tree === 'string') return tree;
  if (!tree || typeof tree !== 'object') return '';
  return text(tree.props?.children);
}

test('native entry customization keeps the upstream component', () => {
  assert.deepEqual(overlay.get(moduleFile('entry-customization')), read(moduleFile('entry-customization')));
  assert.ok(!compiled.code.includes('ConfiguredModelPicker'));
  assert.ok(!compiled.code.includes('"somnus-config"'));
  assert.ok(!compiled.code.includes('AGENT_CATALOG'));
});

function modelPickerHarness(current) {
  let cursor = 0;
  const slots = [];
  const react = {
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useState(initial) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = initial;
      return [slots[at], next => { slots[at] = next; }];
    },
    useRef(initial) {
      const at = cursor++;
      return slots[at] ??= { current: initial };
    },
    useMemo: run => run(),
    useEffect() {}, useLayoutEffect() {}, useId: () => 'fake-picker',
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const source = overlay.get(moduleFile('model-selection')).toString();
  const start = source.indexOf('function externalProvider(');
  const end = source.indexOf('const zh=', start);
  const NativePicker = vm.runInNewContext(source.slice(start, end) + '\nModelSelect;', {
    react, react_jsx_runtime: { jsx, jsxs: jsx, Fragment: 'fragment' },
    react_dom: { createPortal: node => node }, document: { body: {} },
    clsx: (...args) => args.filter(Boolean).join(' '), orderModelProviders: value => value,
    ModelSelect_module_css_default: new Proxy({}, { get: (_value, key) => key }),
    _deepseek_ai_dsh_client_ui_primitives: new Proxy({
      rankByName: (models, query) => models.filter(model => model.name.toLowerCase().includes(query.toLowerCase())),
    }, { get: (value, key) => value[key] ?? 'Native-' + key }),
    queueMicrotask,
  });
  const key = 'same-model';
  const group = (id, name, modelNames = [key]) => ({ id, name, models: modelNames.map(value => ({ id: value, name: value })) });
  const groups = [group('user-openai', 'Codex'), group('deepseek-custom', 'DeepSeek', ['deepseek-flash']),
    group('somnus-codex', 'Codex', [key, ...['1', '2', '3', '4'].map(value => 'codex-' + value)]),
    group('somnus-acp-custom', 'Other', [key])];
  const selections = [];
  function render() {
    cursor = 0;
    return nodes(NativePicker({ available: true, locked: false,
      directory: { getSnapshot: () => ({ current, groups, failures: [], error: null, pending: null, status: 'ready' }) },
      t: value => value, load() {}, select: choice => { selections.push(choice); return Promise.resolve(); },
      renderSlot: (_name, _props, options) => options?.fallback,
    }));
  }
  render().find(node => node.props['aria-haspopup'] === 'menu').props.onClick();
  render().find(node => node.props.role === 'menuitem' && text(node).startsWith('menu.model')).props.onClick();
  return { render, selections };
}

test('picker splits same-name API and ACP routes and selects by provider plus model', () => {
  const { render, selections } = modelPickerHarness({ provider: 'somnus-codex', model: 'same-model' });
  const tabs = () => render().filter(node => node.props.role === 'tab');
  const options = () => render().filter(node => node.props.role === 'menuitemradio');
  assert.deepEqual(tabs().map(tab => String(tab.props.title)), ['Somnus API', 'Codex · ACP', 'Other · ACP']);
  assert.equal(tabs()[1].props['aria-selected'], true);
  assert.equal(options()[0].props['aria-checked'], true);
  assert.equal(options().length, 5);
  render().find(node => node.props.role === 'searchbox').props.onChange({ target: { value: 'codex-4' } });
  assert.deepEqual(options().map(text), ['codex-4']);
  tabs()[0].props.onClick({ currentTarget: { focus() {} } });
  assert.deepEqual(options().map(text), ['same-model', 'deepseek-flash']);
  assert.equal(options()[0].props['aria-checked'], false);
  options()[0].props.onClick();
  assert.deepEqual(selections.map(choice => [choice.provider, choice.model]), [['user-openai', 'same-model']]);
});

test('picker tab navigation selects and focuses the next source without choosing a model', () => {
  const { render, selections } = modelPickerHarness({ provider: 'user-openai', model: 'same-model' });
  const tabs = () => render().filter(node => node.props.role === 'tab');
  const focused = [];
  function arrow(key, tab) {
    let prevented = false;
    tab.props.onKeyDown({ key, nativeEvent: { isComposing: false }, preventDefault: () => { prevented = true; },
      currentTarget: { parentElement: { querySelectorAll: () => tabs().map(node => ({ focus: () => focused.push(node.props.title) })) } },
    });
    assert.equal(prevented, true);
  }
  assert.equal(tabs()[0].props['aria-selected'], true);
  arrow('ArrowRight', tabs()[0]);
  assert.equal(tabs()[1].props['aria-selected'], true);
  arrow('End', tabs()[1]);
  assert.equal(tabs()[2].props['aria-selected'], true);
  assert.deepEqual(focused, ['Codex · ACP', 'Other · ACP']);
  assert.deepEqual(selections, []);
});

test('native theme applies the Somnus palette to both schemes and embeds follow the active scheme', () => {
  const source = overlay.get(moduleFile('theme')).toString();
  const registration = /ctx\.effect\(\(\)=>theme\.overrideTokens\('somnus',[^\n]+?,'Somnus palette'\);/.exec(source)[0];
  let palette;
  const dispose = () => {};
  vm.runInNewContext(registration, {
    ctx: { effect: effect => assert.equal(effect(), dispose) },
    theme: { overrideTokens: (name, tokens) => {
      assert.equal(name, 'somnus');
      palette = JSON.parse(JSON.stringify(tokens));
      return dispose;
    } },
  });
  assert.deepEqual(palette, branding.themeTokens);
  const themeStyles = read(moduleFile('theme')).toString();
  for (const [name, { light, dark }] of Object.entries(palette)) {
    assert.ok(themeStyles.includes(name + ':'), name);
    assert.match(light, /^#[\da-f]{6}$/i, name);
    assert.match(dark, /^#[\da-f]{6}$/i, name);
  }
  for (const token of ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill']) assert.ok(palette[token]);
  assert.equal(palette['--dsw-alias-button-info-fill'].light, palette['--dsw-alias-button-primary-fill'].light);
  assert.match(overlay.get(moduleFile('conversation')).toString(),
    /background:var\(--dsw-alias-button-info-fill\);width:34px;height:34px;color:var\(--dsw-alias-label-primary-foreground\)/);
  assert.ok(compiled.style.includes('color-scheme: dark'));
  assert.ok(compiled.style.includes('.somnus-frame-dashboard'));
});

test('alternate source branding preserves native client palette and module composition', () => {
  const nativeClient = read(moduleFile('theme'));
  const nativePackage = read('package.json');
  const sources = new Map([
    ['desktop/src/main.ts', Buffer.from("app.setName('DSH NEXT')\nconst options = { show: false, title: 'DSH NEXT', }")],
    ['desktop/src/client/index.ts', nativeClient], ['desktop/package.json', nativePackage],
  ]);
  const changes = buildBrandingOverlay('desktop', branding, file => sources.get(file), asset);
  assert.deepEqual(changes.get('desktop/src/client/index.ts'), nativeClient);
  assert.deepEqual(changes.get('desktop/package.json'), nativePackage);
  assert.ok(changes.get('desktop/src/main.ts').toString().includes('Somnus'));
});

test('the sidebar settings button opens its dialog directly and retains the keyboard shortcut and reconnect control', () => {
  const account = overlay.get(moduleFile('settings-account')).toString();
  assert.ok(!account.includes('name:`settings.launcher`'));
  assert.ok(!account.includes('function AccountMenu('));
  assert.ok(!account.includes('id:`account`,order:-10'));
  assert.ok(!account.includes('id:`desktop-onboarding`,locale:'));
  assert.ok(!account.includes('name:`settings.models.sign-in`,locale:'));

  const source = overlay.get(moduleFile('settings-general')).toString();
  const start = source.indexOf('function SettingsRoot(');
  const end = source.indexOf('var DesktopChannelSource=', start);
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const root = vm.runInNewContext('(' + source.slice(start, end) + ')', {
    react: { useRef: value => ({ current: value }), useEffect() {}, useLayoutEffect() {},
      useCallback: fn => fn, useState: value => [value, () => {}] },
    react_jsx_runtime: jsx, SettingsRoot_module_css_default: new Proxy({}, { get: (_, key) => key }), clsx: (...args) => args.filter(Boolean),
    _deepseek_ai_dsh_client_ui_primitives: new Proxy({}, { get: (_, key) => 'Native-' + key }),
  });
  const calls = [];
  for (const wide of [true, false]) {
    const rendered = root({ wide, reconnect: () => calls.push('reconnect'),
      useConnectionState: selector => selector('disconnected'), useSections: () => [], useOnboardingSteps: () => [],
      useSessions: selector => selector({ byId: {}, phase: 'ready' }),
      useShortcuts: selector => selector([{ id: 'settings.open', keys: ['Ctrl', ','], aria: 'Control+Comma' }]),
      useStore: selector => selector({ open: false }),
      actions: { open: () => calls.push('open') },
      renderSlot: (slot, _props, options) => options?.fallback ?? slot,
      t: value => value === 'trigger' ? '设置' : value,
    });
    const button = nodes(rendered).find(node => node.type === 'button');
    assert.equal(button.props['aria-label'], '设置');
    assert.equal(button.props['aria-keyshortcuts'], 'Control+Comma');
    assert.equal(button.props['aria-haspopup'], 'dialog');
    assert.equal(button.props.children, 'settings.trigger');
    button.props.onClick();
    const connection = nodes(rendered).find(node => node.type === 'Native-ConnectionIndicator');
    assert.equal(connection.props.state, wide ? 'disconnected' : undefined);
    connection.props.onReconnect();
  }
  assert.deepEqual(calls, ['open', 'reconnect', 'open', 'reconnect']);
});

test('desktop update UI is never registered and does not read an update carrier', () => {
  const source = overlay.get(moduleFile('settings-general')).toString();
  const apply = source.slice(source.indexOf('function apply(ctx)'));
  assert.ok(!apply.includes('new DesktopUpdateSource('));
  assert.ok(!apply.includes('new DesktopChannelSource('));
  assert.ok(!apply.includes('id:`desktop-update-channel`'));
  assert.ok(!apply.includes('id:`desktop-channel-toast`'));
  assert.ok(!apply.includes('sidebar.toggle.badge'));
  assert.ok(apply.includes('id:`current-version`'));
});

test('native user Provider forms and edit/delete controls are preserved while builtin rows and onboarding are hidden', () => {
  const file = moduleFile('settings-models');
  const source = overlay.get(file).toString();
  const original = read(file).toString();
  for (const name of ['ProviderEditor', 'CustomProviderCard', 'EditorFooter']) {
    const body = value => { const start = value.indexOf(`function ${name}(`); const end = value.indexOf('function ', start + 15); return value.slice(start, end); };
    assert.equal(body(source), body(original), name);
  }
  assert.ok(source.includes('id:`models`'));
  assert.ok(!source.includes('id:`deepseek-official`,children:{"settings.models.sign-in"'));
  const expression = /const state=(\{\.\.\.snapshot,rows:[\s\S]*?\});const\[hasReadySnapshot/.exec(source)[1];
  const snapshot = { rows: [
    { entry: { provider: 'deepseek-account' } }, { entry: { provider: 'deepseek-official' } },
    { entry: { provider: 'somnus-import-fixture', displayName: 'DeepSeek' }, configured: true },
    { entry: { provider: 'custom-deepseek', displayName: 'My DeepSeek' }, configured: true },
  ] };
  const filtered = vm.runInNewContext('(' + expression + ')', { snapshot, t: value => value });
  assert.deepEqual(Array.from(filtered.rows, row => row.entry.provider), ['somnus-import-fixture', 'custom-deepseek']);
});

test('settings navigation reuses the native shell instance and preserves original close behavior', () => {
  const file = moduleFile('settings-general');
  const source = overlay.get(file).toString();
  const added = 'const disposeSomnusSettings=ctx.reflect.provide(`somnusSettings`,{open:section=>{if(section===void 0)shellInstance.actions.open();else shellInstance.actions.openSection(section)}});';
  assert.ok(source.includes(added));
  assert.ok(source.includes('disposeSomnusSettings();disposeCommand();disposeSlot()'));
  const panel = value => value.slice(value.indexOf('function SettingsPanel('), value.indexOf('function SettingsRoot('));
  assert.equal(panel(source), panel(read(file).toString()));
  const calls = [];
  let navigation;
  const scope = { ctx: { reflect: { provide: (_name, value) => { navigation = value; return () => {}; } } },
    shellInstance: { actions: { open: () => calls.push('same-shell'), openSection: id => calls.push(id) } } };
  vm.runInNewContext(added, scope);
  navigation.open('models'); navigation.open('somnus-external-agents'); navigation.open();
  assert.deepEqual(calls, ['models', 'somnus-external-agents', 'same-shell']);
});

test('any native supplier uses Somnus identity while explicitly selected ACP Agents retain their identity', () => {
  const { ui } = renderHarness();
  const model = { id: 'actual-model', name: 'Actual model' };
  for (const provider of [{ id: 'openai-custom', name: 'OpenAI' }, { id: 'deepseek-account', name: 'DeepSeek account' },
    { id: 'somnus-import-fixture', name: 'DeepSeek' }, { id: 'codex-named-native-provider', name: 'Codex supplier' }]) {
    const rendered = ui.NativeModelIdentity({ provider, model, placement: 'trigger' });
    assert.equal(text(rendered), 'Somnus / Actual model');
    const icon = nodes(rendered).find(node => node.type === 'img');
    assert.deepEqual(Buffer.from(icon.props.src.split(',')[1], 'base64'), asset('electron/brand/somnus.png'));
    assert.equal(text(ui.NativeModelIdentity({ provider, model, placement: 'option' })), 'Actual model');
  }
  for (const provider of [{ id: 'somnus-codex', name: 'Codex' }, { id: 'somnus-codebuddy', name: 'CodeBuddy Code' },
    { id: 'somnus-acp-verified', name: 'External Agent' }]) {
    const rendered = ui.NativeModelIdentity({ provider, model, placement: 'trigger' });
    assert.equal(text(rendered), provider.name + ' / Actual model');
    assert.equal(nodes(rendered).filter(node => node.type === 'img').length, 0);
  }
});

test('embedded Agent settings target the actual DSH parent port and relay Codex commands across distinct loopback origins', { timeout: 1000 }, async () => {
  const parentOrigin = 'http://127.0.0.1:9222';
  const backendOrigin = 'http://127.0.0.1:8111';
  const parentListeners = new Map();
  const childListeners = new Map();
  const calls = [];
  const host = {
    location: { origin: parentOrigin },
    addEventListener: (name, handler) => parentListeners.set(name, handler),
    removeEventListener: name => parentListeners.delete(name),
    somnusApi: { origin: async () => backendOrigin, configuration: async (method, args) => {
      calls.push([method, args]); return { agent: { id: 'fixture-codex' }, info: { authentication: 'required' } };
    } },
  };
  const { ui, effects } = renderHarness([backendOrigin, ''], host);
  const rendered = ui.NativeAgentSettings({ configuration: async () => [], styles: {} });
  const iframe = nodes(rendered).find(node => node.type === 'iframe');
  const url = new URL(iframe.props.src);
  assert.equal(url.origin, backendOrigin);
  assert.equal(url.searchParams.get('somnus_parent_origin'), parentOrigin);
  assert.equal(url.hash, '#config');
  const child = {
    parent: host, location: { href: iframe.props.src },
    addEventListener: (name, handler) => childListeners.set(name, handler),
    setTimeout: () => 1, clearTimeout() {},
    postMessage: (data, targetOrigin) => {
      if (targetOrigin === backendOrigin) childListeners.get('message')?.({ source: host, origin: parentOrigin, data });
    },
  };
  host.postMessage = (data, targetOrigin) => {
    if (targetOrigin === parentOrigin) void parentListeners.get('message')?.({ source: child, origin: backendOrigin, data });
  };
  iframe.props.ref.current = { contentWindow: child };
  const dispose = effects[1]();
  installEmbeddedConfigurationBridge(child);
  // In-memory dispatcher only: this test never invokes a real OAuth flow.
  const result = await child.vvmanAcp.connectCodex();
  assert.deepEqual(calls, [['connectCodex', []]]);
  assert.equal(result.agent.id, 'fixture-codex');
  assert.equal(result.info.authentication, 'required');
  dispose();
});
