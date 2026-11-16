
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

test('personal inventory shows installed plugins from both DSH markets, independently of market search and enablement', async () => {
  let installed = [badge, community, { ...badge, source: 'community' }];
  let dotSetup = { enabled: false, ready: false, paused: false, port: null, secret_path: null };
  const dotChanges = [];
  let reads = 0;
  const changes = [];
  const vvmanAcp = {
    async dshInstalledPlugins() { reads += 1; return { plugins: installed }; },
    async setDshInstalledPluginEnabled(id, source, enabled) {
      changes.push([id, source, enabled]);
      installed = installed.map(plugin => plugin.id === id ? { ...plugin, enabled } : plugin);
      return { plugins: installed };
    },
  };
  const state = [], subscriptions = [];
  let hook = 0;
  const react = {
    useState(initial) {
      const index = hook++;
      if (!(index in state)) state[index] = initial;
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
      if (name === './DotConnectionGuide') return { DotConnectionGuide: 'DotConnectionGuide' };
      if (name === './PluginDevelopment') return { PluginDevelopment: 'PluginDevelopment' };
      if (name === './errors.mjs') return { describeError: error => error.message };
      if (name === './assistantApi') return {
        dotTaskSetup: async () => dotSetup,
        setDotTaskEnabled: async enabled => {
          dotChanges.push(enabled);
          dotSetup = { ...dotSetup, ready: enabled, paused: !enabled };
          return dotSetup;
        },
        listInstalledPlugins: async () => [],
        listDefaultPlugins: async () => ({ plugins: [{ id: 'company', name: '公司默认' }] }),
        listSkills: async () => [],
      };
      return {};
    },
    window: { vvmanAcp },
    AbortController,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  const render = (windowsDesktop = false) => { hook = 0; return elements(exports.PluginConfiguration({ windowsDesktop })); };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const section = (nodes, id) => elements(nodes.find(node => node.props['aria-labelledby'] === id));
  const buttons = nodes => nodes.filter(node => node.props.className === 'plugin-row-link');

  render();
  await settle();
  let nodes = render();
  let personal = section(nodes, 'plugin-personal-title');
  assert.deepEqual(buttons(personal).map(row => elements(row).find(node => node.type === 'strong').props.children), ['Badge Skill', 'Example']);
  assert.deepEqual(personal.filter(node => node.type === 'Tag').map(node => node.props.children), ['已启用', '已停用']);
  assert.equal(buttons(section(nodes, 'plugin-defaults-title')).length, 1);
  personal.find(node => node.type === 'Input').props.onChange({ target: { value: 'community plugin' } });
  personal = section(render(), 'plugin-personal-title');
  assert.equal(buttons(personal).length, 1, 'Personal search also matches DSH description');
  buttons(personal)[0].props.onClick();
  nodes = render();
  const details = elements(nodes.find(node => node.type === 'Modal' && node.props.title === 'Example'));
  details.find(node => node.type === 'Button' && node.props.children === '启用').props.onClick();
  await settle();
  nodes = render();
  assert.deepEqual(changes, [['example', 'community', true]]);
  assert.equal(section(nodes, 'plugin-personal-title').find(node => node.type === 'Tag').props.children, '已启用');
  assert.equal(nodes.find(node => node.type === 'DshPluginMarket').props.revision, 1);

  installed = [...installed, { ...community, id: 'new-plugin', name: 'New plugin' }];
  nodes.find(node => node.type === 'DshPluginMarket').props.onChanged();
  render();
  await settle();
  nodes = render();
  personal = section(nodes, 'plugin-personal-title');
  personal.find(node => node.type === 'Input').props.onChange({ target: { value: '' } });
  assert.equal(buttons(section(render(), 'plugin-personal-title')).length, 3);
  assert.equal(reads, 3);

  assert(!render().some(node => node.props['aria-labelledby'] === 'plugin-recommendations-title'));
  const windows = render(true);
  windows.find(node => node.type === 'Button' && node.props.children === '插件开发').props.onClick();
  const development = render(true).find(node => node.type === 'PluginDevelopment');
  assert(development);
  development.props.onClose();
  const recommended = section(windows, 'plugin-recommendations-title');
  assert(recommended.some(node => node.type === 'strong' && node.props.children === 'Somnus × dot'));
  assert(!section(windows, 'plugin-personal-title').some(node => node.props.children === 'Somnus × dot'));
  recommended.find(node => node.type === 'Button' && node.props.children === '查看个人接入教程').props.onClick();
  const guide = () => render(true).find(node => node.type === 'DotConnectionGuide');
  assert(guide());
  dotSetup = { enabled: true, ready: false, paused: false, port: 4567, secret_path: 'sample-connection-test-key' };
  guide().props.onClose();
  assert.equal(guide(), undefined);
  await settle();
  personal = section(render(true), 'plugin-personal-title');
  assert.equal(buttons(personal).length, 4);
  const dotRow = () => elements(section(render(true), 'plugin-personal-title')
    .find(node => node.props.className === 'plugin-row' &&
      elements(node).some(child => child.type === 'strong' && child.props.children === 'Somnus × dot')));
  const dotDetail = () => elements(render(true).find(node => node.type === 'Modal' && node.props.title === 'Somnus × dot'));
  const openDotDetail = () => dotRow().find(node => node.props.className === 'plugin-row-link').props.onClick();
  assert(dotRow().some(node => node.type === 'Tag' && node.props.children === '待连接'));
  assert(!dotRow().some(node => node.type === 'Button'));
  openDotDetail();
  const reconnect = dotDetail().find(node => node.type === 'Button' && node.props.children === '重新连接');
  reconnect.props.onClick();
  assert(guide());
  dotSetup = { ...dotSetup, ready: true };
  guide().props.onClose();
  render(true);
  await settle();
  assert(dotRow().some(node => node.type === 'Tag' && node.props.children === '已连接'));
  openDotDetail();
  dotDetail().find(node => node.type === 'Button' && node.props.children === '停用').props.onClick();
  await settle();
  assert(dotRow().some(node => node.type === 'Tag' && node.props.children === '已停用'));
  dotDetail().find(node => node.type === 'Button' && node.props.children === '启用').props.onClick();
  await settle();
  assert.deepEqual(dotChanges, [false, true]);
  assert(dotRow().some(node => node.type === 'Tag' && node.props.children === '已连接'));
  assert.equal(dotSetup.port, 4567);
});
