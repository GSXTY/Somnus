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
  let catalog = [ready, web];
  const results = () => ({ runtime, name: 'Fixture community market', sourceUrl: 'https://example.invalid', plugins: catalog });
  const bridge = {
    dshPluginMarket: async () => ({ runtime, plugins: [] }),
    dshCommunityMarket: async (search, refresh) => { calls.push([search, refresh]); return results(); },
    changeDshCommunityPlugin: async (id, action, search) => {
      calls.push([id, action, search]);
      catalog = catalog.map(item => item.id === id ? { ...item, present: true, installed: action === true } : item);
      return results();
    },
  };
  let hook = 0, revision = 0, changes = 0;
  const state = [], subscriptions = [];
  const react = {
    useState(initial) {
      const index = hook++;
      if (!(index in state)) state[index] = initial;
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
    return elements(exports.DshPluginMarket({ revision, onChanged: () => { changes += 1; } }));
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const findButton = label => render().find(node => node.type === 'Button' && node.props.children === label);

  render();
  await settle();
  const sourceButtons = render().filter(node => node.type === 'button' && node.props.className === 'plugin-market-card');
  assert.equal(sourceButtons.length, 2);
  sourceButtons[1].props.onClick();
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
  render().find(node => node.type === 'Popconfirm').props.onConfirm();
  await settle();
  assert.deepEqual(calls.at(-1), ['sample-agent', false, 'sample']);
  assert.equal(changes, 3, 'Each successful market mutation refreshes the installed inventory');
  revision += 1;
  render();
  await settle();
  assert.deepEqual(calls.at(-1), ['sample', true]);
});
