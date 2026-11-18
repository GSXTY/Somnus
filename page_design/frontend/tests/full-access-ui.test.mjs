import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
  node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(file, name, props, api = {}, projectBridge) {
  const state = [], exports = {};
  let cursor = 0;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
    },
    useRef(current) { return state[cursor++] ??= { current }; },
    useEffect() {},
  };
  const jsx = (type, input) => typeof type === 'function' ? type(input) : ({ type, props: input });
  const antd = { Alert: 'Alert', Button: 'Button', Dropdown: 'Dropdown', Input: 'Input', Modal: 'Modal', Space: 'Space', Tag: 'Tag',
    message: { useMessage: () => [{ error() {} }, null] } };
  const imports = {
    react, antd, './assistantApi': api, '@ant-design/icons': new Proxy({}, { get: (_icons, name) => name }),
    './fileProposalDiff': { lineCounts: () => ({ added: 1, removed: 0 }) },
    './documentLibraryBridge': {}, './errors.mjs': { describeError: error => error.message },
    'react/jsx-runtime': { jsx, jsxs: jsx },
  };
  const content = readFileSync(new URL('../src/' + file + '.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, window: { vvmanProjects: projectBridge }, require: id => imports[id] });
  return (type, match = () => true) => {
    cursor = 0;
    return nodes(exports[name](props)).find(node => node.type === type && match(node.props));
  };
}

test('an applied file card locates the saved file without opening its diff', async () => {
  const opened = [], revealed = [];
  const item = { id: 'proposal-1', path: 'file.txt', status: 'applied', created_at: 1 };
  const props = { conversationId: 'chat-1', items: [item], onPreview: proposal => { opened.push(proposal.id); } };
  const bridge = { async revealProposal(...ids) { revealed.push(ids); } };
  const view = harness('FileProposalReview', 'FileChangeCards', props, {}, bridge);
  const reveal = () => view('Button', item => item['aria-label'] === '在文件资源管理器中定位');
  assert.equal(reveal().props.title, '在文件资源管理器中定位');
  reveal().props.onClick();
  await settle();
  assert.deepEqual(revealed, [['chat-1', 'proposal-1']]);
  assert.deepEqual(opened, []);
  view('button', props => props.className === 'assistant-file-diff').props.onClick();
  assert.deepEqual(opened, ['proposal-1']);
  props.items = [{ ...item, status: 'pending' }];
  assert.equal(reveal(), undefined);
});

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

test('new conversation permissions can be selected before creation and full access still requires confirmation', async () => {
  const changes = [];
  const props = { allowFullAccess: true, permission: 'read_only', onChange: mode => changes.push(mode), onBusyChange() {} };
  const view = harness('PermissionSwitch', 'PermissionSwitch', props, {
    saveConversationPermission() { assert.fail('a draft permission must not write to an existing conversation'); },
  });
  assert.equal(view('Dropdown').props.disabled, false);
  view('Dropdown').props.menu.onClick({ key: 'workspace_write' });
  assert.deepEqual(changes, ['workspace_write']);
  view('Dropdown').props.menu.onClick({ key: 'full' });
  assert.equal(view('Modal').props.title, '为新会话启用完全访问？');
  assert.deepEqual(changes, ['workspace_write']);
  view('Modal').props.onOk();
  await settle();
  assert.deepEqual(changes, ['workspace_write', 'full']);
});

test('execution shows live progress and folds completed history with separate tool outcomes', () => {
  const steps = [
    { id: 'call_one', title: 'mcp__vv_man__query_database', kind: 'other', status: 'completed', duration_ms: 275 },
    { id: 'local-call-call-1', title: 'query_database', kind: 'tool', status: 'completed', duration_ms: 250 },
    { id: 'call_two', title: 'mcp__vv_man__query_database', kind: 'other', status: 'failed', duration_ms: 15 },
    { id: 'local-call-call-2', title: 'query_database', kind: 'tool', status: 'failed', duration_ms: 3 },
    { id: 'modern', title: 'read_file', kind: 'tool', status: 'failed', failure_reason: '文件不存在' },
  ];
  const props = { execution: { steps, plan: [] }, replyStatus: 'complete', elapsedMs: 63000, startedAt: Date.now() - 3200 };
  const view = harness('ExecutionDetails', 'ExecutionDetails', props);
  const text = node => Array.isArray(node) ? node.map(text).join('') :
    typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';
  assert.equal(view('details').props.open, undefined);
  assert.match(text(view('summary')), /回复完成.*1 分 3 秒.*3 项操作/);
  assert.doesNotMatch(text(view('summary')), /成功|失败/);
  const counts = view('details').props.children.find(node => node?.props.className === 'assistant-execution-counts');
  assert.match(text(counts), /成功 1.*失败 2/);
  assert.match(text(view('ol')), /未记录具体原因.*文件不存在/);
  assert(view('details', props => props.className === 'assistant-execution-operation'));
  assert.doesNotMatch(text(view('ol')), /mcp__vv_man__/);
  assert.equal(steps.length, 5);
  props.replyStatus = 'streaming';
  props.stage = 'thinking';
  assert.equal(view('details').props.open, undefined);
  assert.match(text(view('summary')), /正在思考.*3 秒/);
  assert.match(text(view('ol')), /query_database/);
  assert(!view('div', value => value.className === 'assistant-execution-counts'));
  props.replyStatus = 'error';
  assert.equal(view('details').props.open, undefined);
  assert.match(text(view('summary')), /回复失败/);
  props.replyStatus = 'streaming';
  steps.push({ id: 'running', title: '检查项目目录', kind: 'execute', status: 'in_progress' });
  assert.match(text(view('summary')), /正在执行 · 检查项目目录/);
  assert(view('span', props => props.className === 'assistant-execution-kind' && props.children === '命令'));
});

test('live stage is visible before the first tool call', () => {
  const props = { replyStatus: 'streaming', stage: 'connecting' };
  const view = harness('ExecutionDetails', 'ExecutionDetails', props);
  assert.equal(view('span', props => props.className === 'assistant-execution-heading-main').props.children[0], '连接 Agent');
  props.replyStatus = 'complete';
  assert.equal(view('details'), undefined);
});

test('historic execution keeps ambiguous adjacent operations separate', () => {
  const steps = [
    { id: 'call_one', title: 'mcp__vv_man__query_database', kind: 'other', status: 'failed', duration_ms: 15 },
    { id: 'local-call-call-1', title: 'query_database', kind: 'tool', status: 'completed', duration_ms: 3 },
    { id: 'call_two', title: 'mcp__vv_man__query_database', kind: 'other', status: 'failed', duration_ms: 350 },
    { id: 'local-call-call-2', title: 'query_database · 查询失败', kind: 'tool', status: 'failed', duration_ms: 5 },
  ];
  const view = harness('ExecutionDetails', 'ExecutionDetails', { execution: { steps, plan: [] }, replyStatus: 'complete' });
  assert.equal(nodes(view('ol')).filter(item => item.type === 'li').length, 4);
  assert(view('small', props => props.className === 'assistant-execution-reason' && props.children === '查询失败'));
});

test('live activity nests Subagent tools across multiple levels even when events arrive out of order', () => {
  const steps = [
    { id: 'read', parent_id: 'inner', title: '读取项目', kind: 'read', status: 'in_progress' },
    { id: 'outer', title: '检查项目', kind: 'subagent', status: 'in_progress' },
    { id: 'inner', parent_id: 'outer', title: '检查源码', kind: 'subagent', status: 'in_progress' },
    { id: 'cycle', parent_id: 'cycle', title: '独立操作', kind: 'read', status: 'completed' },
  ];
  const view = harness('ExecutionDetails', 'ExecutionDetails', { execution: { steps, plan: [] }, replyStatus: 'streaming' });
  const root = view('ol');
  assert.equal(root.props.children.length, 2);
  const outer = root.props.children[0];
  const inner = outer.props.children[1].props.children[0];
  const read = inner.props.children[1].props.children[0];
  assert.equal(nodes(outer.props.children[0]).find(node => node.type === 'summary').props.title, '检查项目');
  assert.equal(nodes(inner.props.children[0]).find(node => node.type === 'summary').props.title, '检查源码');
  assert.equal(nodes(read).find(node => node.type === 'summary').props.title, '读取项目');
});

test('PowerShell approval shows exact command, working directory, timeout and scope before continuing', async () => {
  const calls = [];
  const command = 'Get-Location\nWrite-Output "smoke"';
  const props = { request: {
    requestId: 'job', kind: 'powershell', title: '运行 PowerShell',
    details: { kind: 'powershell', command, cwd: 'C:\\Work', timeoutSeconds: 12, sandboxMode: 'workspace-write' },
    options: [{ id: 'allow_once', kind: 'allow_once', name: '继续' }],
  }, onRespond: async id => { calls.push(id); } };
  const view = harness('ExecutionDetails', 'ActionApproval', props);
  assert.equal(view('pre').props.children, command);
  assert.equal(view('code').props.children, 'C:\\Work');
  assert(view('dd', value => value.children.includes?.(12)));
  assert(view('dd', value => value.children === '仅工作区内可写'));
  assert.deepEqual(calls, []);
  view('Button', value => value.children === '继续').props.onClick();
  await settle();
  assert.deepEqual(calls, ['allow_once']);
});

test('native Agent questions accept choices or a typed reply, and skip without submitting a chat message', async () => {
  const calls = [];
  const view = harness('ExecutionDetails', 'AgentQuestions', {
    request: { requestId: 'clarify', questions: [
      { id: 'format', question: '选择格式', options: [{ label: 'PDF' }] },
      { id: 'notes', question: '补充说明', multiSelect: true, options: [{ label: '目录' }] },
    ] },
    onRespond: async value => { calls.push(JSON.parse(JSON.stringify(value))); },
  });
  const submit = () => view('Button', props => props.children === '提交回答');
  assert.equal(submit().props.disabled, true);
  view('input', props => props.type === 'radio').props.onChange({ target: { checked: true } });
  view('Input', props => props['aria-label'] === '选择格式').props.onChange({ target: { value: ' Markdown ' } });
  view('input', props => props.type === 'checkbox').props.onChange({ target: { checked: true } });
  submit().props.onClick();
  await settle();
  assert.deepEqual(calls, [[{ id: 'format', selected: [], custom: 'Markdown' }, { id: 'notes', selected: ['目录'] }]]);
  view('Button', props => props.children === '跳过').props.onClick();
  await settle();
  assert.equal(calls[1], null);
});

test('a native plan review approves only the exact action provided by the runtime', async () => {
  const calls = [];
  const view = harness('ExecutionDetails', 'AgentQuestions', {
    request: { requestId: 'plan-review', questions: [
      { id: 'decision', question: '评审本次计划', options: [{ label: 'Apply plan' }],
        intent: { kind: 'plan-review', approve: 'Apply plan' } },
    ] },
    onRespond: async value => { calls.push(JSON.parse(JSON.stringify(value))); },
  });
  assert.equal(view('section').props['aria-label'], '审阅执行计划');
  assert.deepEqual(calls, []);
  view('Button', props => props.children === '批准计划').props.onClick();
  await settle();
  assert.deepEqual(calls, [[{ id: 'decision', selected: ['Apply plan'] }]]);
});
