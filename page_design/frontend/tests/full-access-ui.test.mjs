import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
  node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(file, name, props, api = {}) {
  const state = [], exports = {};
  let cursor = 0;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => { state[slot] = value; }];
    },
    useRef(current) { return state[cursor++] ??= { current }; },
  };
  const jsx = (type, input) => ({ type, props: input });
  const antd = { Alert: 'Alert', Button: 'Button', Dropdown: 'Dropdown', Modal: 'Modal', Space: 'Space',
    message: { useMessage: () => [{ error() {} }, null] } };
  const imports = {
    react, antd, './assistantApi': api, '@ant-design/icons': { LockOutlined: 'Lock' },
    'react/jsx-runtime': { jsx, jsxs: jsx },
  };
  const content = readFileSync(new URL('../src/' + file + '.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: id => imports[id] });
  return (type, match = () => true) => {
    cursor = 0;
    return nodes(exports[name](props)).find(node => node.type === type && match(node.props));
  };
}

test('full access requires separate confirmation before the per-conversation permission is saved', async () => {
  const calls = [];
  const props = { conversationId: 'specific-chat', allowFullAccess: true, permission: 'read_only',
    onChange: mode => calls.push(['changed', mode]), onBusyChange() {} };
  const view = harness('PermissionSwitch', 'PermissionSwitch', props, {
    async saveConversationPermission(...args) { calls.push(args); return 'full'; },
  });
  view('Dropdown').props.menu.onClick({ key: 'full' });
  assert(view('Modal').props.open);
  assert.deepEqual(calls, []);
  view('Modal').props.onCancel();
  assert.equal(view('Modal').props.open, false);
  view('Dropdown').props.menu.onClick({ key: 'full' });
  view('Modal').props.onOk();
  await settle();
  assert.deepEqual(calls, [['specific-chat', 'full'], ['changed', 'full']]);
  assert.equal(view('Modal').props.open, false);
  const web = harness('PermissionSwitch', 'PermissionSwitch', { ...props, allowFullAccess: false });
  assert(!web('Dropdown').props.menu.items.some(item => item.key === 'full'));
});

test('PowerShell approval shows exact command, working directory and timeout before continuing', async () => {
  const calls = [];
  const command = 'Get-Location\nWrite-Output "smoke"';
  const props = { request: {
    requestId: 'job', kind: 'powershell', title: '运行 PowerShell',
    details: { kind: 'powershell', command, cwd: 'C:\\Work', timeoutSeconds: 12 },
    options: [{ id: 'allow_once', kind: 'allow_once', name: '继续' }],
  }, onRespond: async id => { calls.push(id); } };
  const view = harness('ExecutionDetails', 'ActionApproval', props);
  assert.equal(view('pre').props.children, command);
  assert.equal(view('code').props.children, 'C:\\Work');
  assert(view('dd', value => value.children.includes?.(12)));
  assert.deepEqual(calls, []);
  view('Button', value => value.children === '继续').props.onClick();
  await settle();
  assert.deepEqual(calls, ['allow_once']);
});
