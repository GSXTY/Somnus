import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/DshPluginMarket.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const runtime = { installed: true, version: '1.0.0' };
const ready = { id: 'sample-agent', name: 'Sample Agent', installed: false, present: false, available: true };
const web = { id: 'sample-web', name: 'Sample Web', installed: false, present: true, available: true, compatibility: 'dsh-web' };

function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props.children)];
}

test('DSH market searches the selected community market and keeps package installation separate from enabling', async () => {
  const calls = [];
  const directSources = [];
  const catalogQueries = [];
  let catalog = [ready, web];
  const results = () => ({ runtime, name: 'Fixture community market', sourceUrl: 'https://example.invalid', plugins: catalog,
    sources: [{ id: 'community', name: 'Default', url: 'https://example.invalid' },
      { id: 'team-source', name: 'Team', url: 'https://team.invalid/index.json' }],
  });
  const bridge = {
    dshPluginMarket: async () => ({ runtime, plugins: [] }),
    dshCommunityMarket: async (search, refresh, source, options) => {
      calls.push(source ? [search, refresh, source] : [search, refresh]);
      if (options) catalogQueries.push(options);
      const result = results();
      return { ...result, plugins: result.plugins.filter(item =>
        (!options?.includeIds || options.includeIds.includes(item.id)) && !options?.excludeIds?.includes(item.id)) };
    },
    changeDshCommunityPlugin: async (id, action, search) => {
      calls.push([id, action, search]);
      catalog = catalog.map(item => item.id === id ? { ...item, present: true, installed: action === true } : item);
      return results();
    },
    installDshCommunityPluginVersion: async (...args) => { calls.push(args); return results(); },
  };
  let hook = 0, revision = 0, changes = 0;
  const state = [], subscriptions = [];
  const react = {
    useState(initial) {
      const index = hook++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(current) {
      const index = hook++;
      return state[index] ||= { current };
    },
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
      return { describeError: error => error.message };
    },
    window: { vvmanAcp: bridge, setTimeout: callback => setTimeout(callback, 0), clearTimeout },
  });
  const render = () => {
    hook = 0;
    return elements(exports.DshPluginMarket({ revision, onInstallSource: source => directSources.push(source),
      onChanged: () => { changes += 1; } }));
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const findButton = label => render().find(node => node.type === 'Button' && node.props.children === label);

  render();
  await settle();
  const sourcePicker = render().find(node => node.type === 'Dropdown');
  assert.deepEqual(Array.from(sourcePicker.props.menu.selectedKeys), ['official']);
  sourcePicker.props.onOpenChange(true);
  assert.equal(render().find(node => node.type === 'Dropdown').props.open, true);
  sourcePicker.props.menu.onClick({ key: 'community' });
  assert.equal(render().find(node => node.type === 'Dropdown').props.open, false);
  render();
  await settle();
  render().find(node => node.type === 'Input').props.onChange({ target: { value: ' SaMpLe ' } });
  render();
  await settle();
  assert.deepEqual(calls, [['', false], ['sample', false]]);
  assert(!findButton('启用'), 'Web-only packages must not have a Somnus enable action');
  findButton('安装').props.onClick();
  await settle();
  assert.deepEqual(calls.at(-1), ['sample-agent', 'install', 'sample']);
  findButton('启用').props.onClick();
  await settle();
  assert.deepEqual(calls.at(-1), ['sample-agent', true, 'sample']);
  render().find(node => node.type === 'Popconfirm' && node.props.title === '停用此插件？').props.onConfirm();
  await settle();
  assert.deepEqual(calls.at(-1), ['sample-agent', false, 'sample']);
  assert.equal(changes, 3, 'Each successful market mutation refreshes the installed inventory');
  revision += 1;
  render();
  await settle();
  assert.deepEqual(calls.at(-1), ['sample', true]);
  catalog = [{ ...ready, present: true, installedVersion: '1.0.0', version: '1.1.0', versions: ['1.1.0', '1.0.0'] }];
  render().find(node => node.props['aria-label'] === '市场来源').props.onChange({ target: { value: 'team-source' } });
  render();
  await settle();
  assert.deepEqual(calls.at(-1), ['sample', false, 'team-source']);
  render().find(node => node.props.className === 'plugin-market-card-title' && node.props.children === ready.name).props.onClick();
  assert(render().some(node => node.props.id === 'market-detail-name' && node.props.children === ready.name));
  const version = render().find(node => node.type === 'Popconfirm' && node.props.title.includes('v1.1.0'));
  await version.props.onConfirm();
  assert.deepEqual(calls.at(-1), ['sample-agent', '1.1.0', 'team-source', 'sample']);
  render().find(node => node.props['aria-label'] === '返回市场目录').props.onClick();
  render().find(node => node.props['aria-label'] === '收藏 Sample Agent').props.onClick();
  findButton('收藏').props.onClick();
  render();
  await settle();
  assert.deepEqual(Array.from(catalogQueries.at(-1).includeIds), [ready.id]);
  assert(render().some(node => node.props['aria-label'] === '取消收藏 Sample Agent'));
  const hideMenu = render().find(node => node.type === 'Dropdown' && node.props.children?.props['aria-label'] === '更多操作 Sample Agent');
  hideMenu.props.menu.items.find(item => item.key === 'hidden').onClick();
  findButton('已隐藏').props.onClick();
  render();
  await settle();
  assert.deepEqual(Array.from(catalogQueries.at(-1).includeIds), [ready.id]);
  findButton('发现').props.onClick();
  render();
  await settle();
  assert.deepEqual(Array.from(catalogQueries.at(-1).excludeIds), [ready.id]);
  assert(!render().some(node => node.props.className === 'plugin-market-card-title'));
  findButton('任务').props.onClick();
  assert(render().some(node => node.type === 'Modal' && node.props.title === '市场任务' && node.props.open));
  catalog = [{ ...ready, id: 'rich:' + '9'.repeat(40), available: false, browseOnly: true,
    installReference: 'github:nexu-io/open-design#path:packages/dsh-runtime' }];
  revision += 1;
  render();
  await settle();
  findButton('安装').props.onClick();
  assert.deepEqual(directSources, ['github:nexu-io/open-design#path:packages/dsh-runtime']);
});
