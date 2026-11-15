
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
      if (name === './errors.mjs') return { describeError: error => error.message };
      if (name === './assistantApi') return {
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
  const render = () => { hook = 0; return elements(exports.PluginConfiguration({})); };
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
});

