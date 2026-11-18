
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/PluginConfiguration.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props.children)];
}

const badge = {
  id: 'badge-skill', name: 'Badge Skill', source: 'official',
  description: 'Adds a badge.', version: '1.0', enabled: true, available: true,
};
const community = {
  id: 'example', name: 'Example', source: 'community',
  description: 'Community plugin', version: '2.0', enabled: false, available: true,
};
const handoff = { id: 'handoff', builtin: true, name: 'Project Handoff', version: '1.0', description: '项目交接',
  skill_ids: ['handoff-skill'], mcp_ids: [], missing_skills: [], missing_mcp: [], inactive_skills: [], inactive_mcp: [] };

test('personal inventory shows installed plugins from both DSH markets, independently of market search and enablement', async () => {
  const im = { id: '@xmanrui/dsh-im', source: 'community', name: 'IM 机器人', description: 'IM',
    version: '1.0', enabled: true, available: true, managedDefault: true };
  let installed = [badge, community, { ...badge, source: 'community' }, im];
  let defaultIm = { status: 'ready' };
  let reads = 0;
  const changes = [];
  const uninstalls = [];
  const removed = [];
  let imported = [];
  let confirmUninstall = false;
  const vvmanAcp = {
    async dshPluginMarket() { return { plugins: [] }; },
    async dshCommunityMarket() { return { plugins: [] }; },
    async setDshCommunityMarketSources() {},
    async dshInstalledPlugins() { reads += 1; return { plugins: installed, defaultIm }; },
    async dshPluginSettings() { return { writable: true, sections: [] }; },
    async setDshInstalledPluginEnabled(id, source, enabled) {
      changes.push([id, source, enabled]);
      installed = installed.map(plugin => plugin.id === id ? { ...plugin, enabled } : plugin);
      return { plugins: installed };
    },
    async uninstallDshPlugin(id, source) {
      uninstalls.push([id, source]);
      if (confirmUninstall) installed = installed.filter(plugin => plugin.id !== id || plugin.source !== source);
      return { plugins: installed };
    },
  };
  const state = [], subscriptions = [];
  let hook = 0;
  const react = {
    useState(initial) {
      const index = hook++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(current) { return state[hook++] ||= { current }; },
    useEffect(callback, deps) {
      const index = hook++;
      const previous = subscriptions[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.();
        subscriptions[index] = { deps, cleanup: callback() };
      }
    },
  };
  const names = new Proxy({}, { get: (_, name) => typeof name === 'string' ? name : undefined });
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'antd' || name === '@ant-design/icons') return names;
      if (name === './DshPluginMarket') return { DshPluginMarket: 'DshPluginMarket' };
      if (name === './OarPluginSettings') return { OarPluginSettings: 'OarPluginSettings' };
      if (name === './DshPluginPage') return { DSH_IM_PLUGIN: im.id };
      if (name === './PluginDevelopment') return { PluginDevelopment: 'PluginDevelopment' };
      if (name === './errors.mjs') return { describeError: error => error.message };
      if (name === './assistantApi') return {
        listInstalledPlugins: async () => imported,
        removePlugin: async id => { removed.push(id); imported = imported.filter(item => item.id !== id); },
        listDefaultPlugins: async () => ({ plugins: [handoff] }),
        listSkills: async () => [],
      };
      return {};
    },
    window: { vvmanAcp },
    AbortController,
    fetch: async path => ({ ok: true, json: async () => path === '/api/plugins' ?
      { plugins: [{ key: 'respiratory', name: '默认', tools: 5 }] } : {} }),
  });
  const render = (windowsDesktop = false, options = {}) => { hook = 0; return elements(exports.PluginConfiguration({ windowsDesktop, ...options })); };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const section = (nodes, id) => elements(nodes.find(node => node.props['aria-labelledby'] === id));
  const buttons = nodes => nodes.filter(node => node.props.className === 'plugin-row-link');
  const inventoryAction = (name, windowsDesktop = false, options = {}) => section(render(windowsDesktop, options), 'plugin-personal-title')
    .find(node => node.type === 'Button' && node.props['aria-label'] === '卸载 ' + name);
  const market = () => render().find(node => node.type === 'DshPluginMarket');
  const action = (label, windowsDesktop = false) => render(windowsDesktop).find(node => node.type === 'Button' && node.props.children === label);
  const control = label => render().find(node => node.props['aria-label'] === label);

  render();
  await settle();
  let nodes = render();
  assert(!nodes.some(node => node.props.role === 'tablist'), 'The first screen is a plugin overview');
  assert.equal(market().props.browse, false);
  assert.deepEqual(nodes.filter(node => node.type === 'input' && node.props.type === 'radio').map(node => node.props.checked), [false, false]);
  assert.equal(control('启用插件市场').props.checked, false);
  control('启用插件市场').props.onChange(true);
  assert.deepEqual(render().filter(node => node.type === 'input' && node.props.type === 'radio').map(node => node.props.checked), [true, false]);
  assert.equal(action('插件市场').props['aria-pressed'], false);
  assert.equal(control('启用 Computer Use（Next）'), undefined);
  assert.equal(control('启用远程控制'), undefined);
  assert.equal(render(true, { active: true }).find(node => node.type === 'OarPluginSettings').props.active, true);
  action('来源配置').props.onClick();
  assert.equal(market().props.sourcesOpen, true);
  market().props.onSourcesClose();
  render().filter(node => node.type === 'input' && node.props.type === 'radio')[1].props.onChange();
  control('启用插件市场').props.onChange(false);
  assert.equal(control('启用插件市场').props.checked, false);
  control('启用插件市场').props.onChange(true);
  let personal = section(nodes, 'plugin-personal-title');
  assert.deepEqual(buttons(personal).map(row => elements(row).find(node => node.type === 'strong').props.children), ['Badge Skill', 'Example']);
  assert.deepEqual(personal.filter(node => node.type === 'Tag').map(node => node.props.children), ['已启用', '已停用']);
  assert.equal(inventoryAction('Badge Skill').props.size, 'small');
  assert.equal(inventoryAction('Example').props.size, 'small');
  const defaults = section(nodes, 'plugin-defaults-title');
  const group = buttons(defaults)[0];
  assert.equal(buttons(defaults).length, 1);
  assert.equal(group.props['aria-expanded'], false);
  assert(!defaults.some(node => node.props.children === 'Project Handoff'));
  group.props.onClick();
  const expanded = section(render(), 'plugin-defaults-title');
  assert.equal(buttons(expanded).length, 3);
  assert(!expanded.some(node => node.type === 'Tag' && node.props.children === '内置'));
  assert(!expanded.some(node => node.props.children === 'Project Handoff'));
  assert(!personal.some(node => node.props.children === im.name));
  const imRow = buttons(expanded).find(row => elements(row).some(node => node.props.children === im.name));
  assert(imRow);
  imRow.props.onClick();
  let openedIm = 0;
  const imDetails = section(render(true, { onOpenIm: () => { openedIm += 1; } }), 'plugin-defaults-title');
  assert(imDetails.some(node => node.props.children === '已启用'));
  assert(!imDetails.some(node => node.type === 'Switch' || node.props.children === '卸载'));
  imDetails.find(node => node.type === 'Button' && node.props.children === '配置机器人').props.onClick();
  assert.equal(openedIm, 1);
  personal.find(node => node.type === 'Input').props.onChange({ target: { value: 'community plugin' } });
  personal = section(render(), 'plugin-personal-title');
  assert.equal(buttons(personal).length, 1, 'Personal search also matches DSH description');
  buttons(personal)[0].props.onClick();
  nodes = render();
  const detail = (nodes, id) => nodes.find(node => node.props.id === 'plugin-detail-' + id && !node.props.hidden);
  const details = elements(detail(nodes, 'dsh:example'));
  assert.equal(details[0].props.className, 'plugin-detail-page');
  details.find(node => node.type === 'Switch' && node.props['aria-label'] === '启用 Example').props.onChange();
  await settle();
  nodes = render();
  assert.deepEqual(changes, [['example', 'community', true]]);
  assert.equal(section(nodes, 'plugin-personal-title').find(node => node.type === 'Tag').props.children, '已启用');
  action('添加插件').props.onClick();
  assert.equal(market().props.browse, true);
  assert.equal(market().props.marketRequest.market, 'dsh-market');
  assert.equal(market().props.revision, 1);

  installed = [...installed, { ...community, id: 'new-plugin', name: 'New plugin' }];
  render().find(node => node.type === 'DshPluginMarket').props.onChanged();
  render();
  await settle();
  render(false, { overviewRequest: 1 });
  assert.equal(market().props.browse, false);
  nodes = render();
  personal = section(nodes, 'plugin-personal-title');
  personal.find(node => node.type === 'Input').props.onChange({ target: { value: '' } });
  assert.equal(buttons(section(render(), 'plugin-personal-title')).length, 3);
  assert.equal(reads, 3);

  assert(!render().some(node => node.props['aria-labelledby'] === 'plugin-recommendations-title'));
  const windows = render(true);
  windows.find(node => node.type === 'Dropdown' && node.props.menu.items.some(item => item.key === 'develop')).props.menu.onClick({ key: 'develop' });
  const development = render(true).find(node => node.type === 'PluginDevelopment');
  assert(development);
  development.props.onClose();
  assert(!windows.some(node => node.props['aria-labelledby'] === 'plugin-recommendations-title'));
  assert(!section(windows, 'plugin-personal-title').some(node => node.props.children === 'Somnus × dot'));
  const target = { active: true, installedPluginRequest: { id: 'new-plugin', sequence: 1 } };
  render(true, target);
  await settle();
  render(true, target);
  const opened = detail(render(true, target), 'dsh:new-plugin');
  assert(opened);
  assert.equal(elements(opened).find(node => node.type?.name === 'DshSettings').props.plugin.id, 'new-plugin');
  const uninstall = () => elements(detail(render(true, target), 'dsh:new-plugin')).find(node => node.type === 'Button' && node.props.children === '卸载');
  uninstall().props.onClick();
  await settle();
  assert(uninstall(), 'canceling native uninstall preserves the detail');
  confirmUninstall = true;
  uninstall().props.onClick();
  await settle();
  assert.deepEqual(uninstalls, [['new-plugin', 'community'], ['new-plugin', 'community']]);
  assert.equal(uninstall(), undefined);
  assert(!section(render(true, target), 'plugin-personal-title').some(node => node.props.children === 'New plugin'));
  imported = [{ ...handoff, id: 'local-personal', name: 'Local personal bundle', builtin: false, enabled: true }];
  render(true).find(node => node.type === 'Button' && node.props['aria-label'] === '刷新插件').props.onClick();
  render(true);
  await settle();
  assert.equal(inventoryAction('Local personal bundle', true).props.size, 'small');
  buttons(section(render(true), 'plugin-personal-title')).find(row => elements(row).some(node => node.props.children === 'Local personal bundle')).props.onClick();
  const localRemoval = elements(detail(render(true), 'personal:local-personal')).find(node => node.type === 'Popconfirm' && node.props.title === '卸载此插件？');
  await localRemoval.props.onConfirm();
  assert.deepEqual(removed, ['local-personal']);
  assert.equal(detail(render(true), 'personal:local-personal'), undefined);

  installed = installed.filter(plugin => plugin.id !== badge.id || plugin.source === 'official');
  confirmUninstall = false;
  inventoryAction('Badge Skill', true).props.onClick();
  await settle();
  assert(inventoryAction('Badge Skill', true), 'canceling official uninstall preserves the inventory row');
  buttons(section(render(true), 'plugin-personal-title')).find(row => elements(row).some(node => node.props.children === badge.name)).props.onClick();
  const officialDetailAction = elements(detail(render(true), 'dsh:' + badge.id))
    .find(node => node.type === 'Button' && node.props['aria-label'] === '卸载 Badge Skill');
  assert(officialDetailAction);
  confirmUninstall = true;
  officialDetailAction.props.onClick();
  await settle();
  assert.deepEqual(uninstalls.slice(-2), [['badge-skill', 'official'], ['badge-skill', 'official']]);
  assert.equal(inventoryAction('Badge Skill', true), undefined);
  assert.equal(detail(render(true), 'dsh:' + badge.id), undefined);

  defaultIm = { status: 'failed', message: '无法准备默认 IM 插件' };
  const imRequest = { active: true, installedPluginRequest: { id: im.id, sequence: 2 } };
  render(true, imRequest);
  await settle();
  render(true, imRequest);
  const failedDefault = section(render(true, imRequest), 'plugin-defaults-title');
  assert(failedDefault.some(node => node.props.children === '准备失败'));
  assert(failedDefault.some(node => node.type === 'Alert' && node.props.message === defaultIm.message));
  assert(!failedDefault.some(node => node.type === 'Switch' || node.props.children === '卸载'));
  assert(!failedDefault.some(node => node.type === 'Button' && node.props.children === '启用'));

  installed = installed.map(plugin => plugin.id === im.id ? { ...plugin, enabled: false, managedDefault: false } : plugin);
  defaultIm = { status: 'ready' };
  const legacyRequest = { ...imRequest, installedPluginRequest: { id: im.id, sequence: 3 } };
  render(true, legacyRequest);
  await settle();
  const disabledDefault = section(render(true, legacyRequest), 'plugin-defaults-title');
  assert(disabledDefault.some(node => node.props.children === '已停用'));
  disabledDefault.find(node => node.type === 'Button' && node.props.children === '启用').props.onClick();
  await settle();
  const enabledDefault = section(render(true, legacyRequest), 'plugin-defaults-title');
  assert.deepEqual(changes.at(-1), [im.id, 'community', true]);
  assert(enabledDefault.some(node => node.props.children === '已启用'));
  assert(!enabledDefault.some(node => node.type === 'Switch' || ['启用', '停用', '卸载'].includes(node.props.children)));
});
