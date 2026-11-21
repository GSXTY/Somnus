
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { agentReadinessLabel } from '../src/configuration/agentReadiness.ts';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/configuration/ConfigurationCenter.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const codex = { id: 'codex', name: 'Codex', args: [] };
const oldDsh = { id: 'dsh', name: '已有 OpenMA', args: [] };

function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props.children)];
}

test('Agent catalog only offers account login; previously saved ACP adapters stay selectable', async () => {
  let hook = 0;
  const state = [], deps = [], auth = [];
  const react = {
    useState(initial) {
      const index = hook++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(current) { return state[hook++] ||= { current }; },
    useEffect(run, next) {
      const index = hook++;
      if (!deps[index] || next.some((value, i) => deps[index][i] !== value)) {
        deps[index] = next;
        run();
      }
    },
  };
  const names = new Proxy({}, { get: (_, name) => name === 'Input' ? { Search: 'Search', TextArea: 'TextArea', Password: 'Password' } : name });
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const keyMethods = [
    { id: 'api-key', name: 'API Key', kind: 'api-key' },
    { id: 'api-key:alias', name: '过时的 API Key', kind: 'browser' },
    { id: 'official', name: '供应商密钥', kind: 'browser', providerRoute: 'deepseek-official' },
  ];
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'antd' || name === '@ant-design/icons') return names;
      if (name.split('/').at(-1) === 'SomnusMark') return { SomnusMark: 'SomnusMark' };
      if (name.split('/').at(-1) === 'assistantApi') return { assistantStatus: async () => ({ configured: true }) };
      if (name.split('/').at(-1) === 'ManagedDshAccount') return { ManagedDshAccount: 'ManagedDshAccount' };
      if (name === './agentReadiness') return { agentReadinessLabel };
      return {};
    },
    window: {
      setInterval: () => 1, clearInterval() {},
      addEventListener() {}, removeEventListener() {},
      vvmanAcp: {
        list: async () => [codex, oldDsh], onUpdate: () => () => {}, connectManagedDsh: () => {},
        detectAdapter: () => assert.fail('the managed preset must not search for an external runtime'),
        dshPluginMarket: async () => ({ runtime: { installed: true } }),
        async probe(id) {
          return id === codex.id ? { provider: 'codex', loginMethods: [...keyMethods, { id: 'chatgpt', name: 'ChatGPT', kind: 'browser' }] } :
            { provider: 'deepseek-harness', loginMethods: [{ id: 'browser', name: 'OpenMA 配置凭据', kind: 'browser' }] };
        },
        async authenticate(...args) { auth.push(args); return { authentication: 'ready' }; },
      },
    },
    AbortController,
  });
  const tab = elements(exports.ConfigurationCenter({ view: 'config', onOpen() {} })).find(node => node.type === 'Tabs');
  assert.deepEqual(Array.from(tab.props.items, item => item.key), ['config']);
  const component = tab.props.items[0].children.type;
  const render = () => { hook = 0; return elements(component({ onOpen() {} })); };
  const findButton = (tree, name) => tree.find(node => node.type === 'Button' && node.props.children === name);
  const row = (tree, name) => tree.find(node => node.type === 'button' &&
    elements(node).some(child => child.type === 'strong' && child.props.children === name));
  const flush = () => new Promise(resolve => setImmediate(resolve));

  render();
  await flush();
  let tree = render();
  assert(!row(tree, 'DeepSeek Harness · OpenMA'));
  assert(row(tree, oldDsh.name));
  row(tree, 'DeepSeek 官方 Agent').props.onClick();
  tree = render();
  assert(tree.some(node => node.type === 'ManagedDshAccount'));
  assert(findButton(tree, '连接 Somnus 内置运行时'));
  assert(!findButton(tree, '检测本机安装'));
  assert(!findButton(tree, '手动接入'));
  assert(findButton(tree, '添加自定义 ACP'));
  assert(!findButton(tree, 'DSH 设置与 API Key'));

  row(tree, codex.name).props.onClick();
  findButton(render(), '刷新账号状态').props.onClick();
  await flush();
  tree = render();
  assert(!tree.some(node => node.type === 'Password'));
  for (const method of keyMethods) assert(!findButton(tree, method.name));
  findButton(tree, 'ChatGPT').props.onClick();
  await flush();
  assert.deepEqual(auth, [['codex', 'chatgpt']]);

  row(render(), oldDsh.name).props.onClick();
  findButton(render(), '刷新账号状态').props.onClick();
  await flush();
  tree = render();
  assert(!findButton(tree, 'OpenMA 配置凭据'));
  assert(tree.some(node => node.props['aria-label'] === '发送给 ACP Agent 的消息'));
});

