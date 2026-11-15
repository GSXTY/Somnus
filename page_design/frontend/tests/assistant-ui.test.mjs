// Run the real component's event handlers with deterministic hooks and mock services.
// This exercises state transitions without a browser or external model request.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareImages, isLocalImage } from '../src/assistantImages.mjs';
import * as format from '../src/format.mjs';
import * as errors from '../src/errors.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/AIAssistant.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const first = { id: 'target', title: '专属测试会话', created_at: 1, updated_at: 3, message_count: 1 };
const next = { id: 'next', title: '其他最近会话', created_at: 1, updated_at: 2, message_count: 1 };
const message = id => ({ id: id + '-message', role: 'user', content: '原有内容-' + id, status: 'complete', created_at: 1 });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function harness({ list = [first, next], vision = false, remove = async () => ({ deleted: true }), send, bridge, externalApi, projectBridge, workspaceLists, historyFor = id => [message(id)] } = {}) {
  let cursor = 0, workspace = 'default', visible = true; const state = [], effects = [], effectDeps = [], storage = new Map([['ya70-assistant-last-conversation', 'target']]);
  const eventListeners = new Map();
  const calls = { removed: [], renamed: [], images: [], sent: [], cancelled: [], opened: 0 };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect(effect, deps) {
      const index = cursor++;
      const old = effectDeps[index];
      if (!old || !deps || deps.some((value, key) => !Object.is(value, old[key]))) {
        effectDeps[index] = deps || [];
        effects.push(effect);
      }
    },
  };
  const api = {
    assistantStatus: async () => ({ configured: true, connection_status: 'unverified', model: 'mock-only', database_connected: false, capabilities: { chat: true, vision }, message: '测试' }),
    conversations: async (_signal, id) => workspaceLists?.[id] || list,
  workspaces: async () => [{ id: 'default', name: '默认空间', conversation_count: list.length }],
  createWorkspace: async name => ({ id: 'ws_test', name, conversation_count: 0 }),
    conversation: async id => ({ conversation: (workspaceLists ? Object.values(workspaceLists).flat() : list).find(value => value.id === id), messages: historyFor(id) }),
    createConversation: async () => ({ ...first, id: 'new-chat', title: '新会话', updated_at: 4, message_count: 0 }),
    renameConversation: async (id, title) => {
      calls.renamed.push({ id, title });
      return { ...list.find(item => item.id === id), title };
    },
    deleteConversation: async id => { calls.removed.push(id); return remove(id); }, cancelConversation: async id => { calls.cancelled.push(id); return { cancelled: true }; },
    ...externalApi,
    sendMessage: async (id, content, signal, onEvent, images) => { calls.sent.push({ id, content, images }); if (send) await send(onEvent, images, id, signal); },
  };
  const images = { isLocalImage, prepareImages: async (files, existing) => { calls.images.push(...files); return prepareImages(files, existing, async file => ({ name: file.name, data_url: 'data:image/png;base64,AA==', mime: file.type, size: file.size, width: 1, height: 1 })); } };
  const antd = Object.fromEntries(['Alert', 'Button', 'Collapse', 'Modal', 'Select', 'Skeleton', 'Space', 'Spin', 'Tag'].map(name => [name, name])); antd.Input = Object.assign(function Input() {}, { TextArea: 'TextArea' });
  const exports = {};
  const context = { exports, require: name => name === 'react' ? react : name === 'react-dom' ? { createPortal: value => value } : name === './DshRecommendationCards' ? { DshRecommendationCards: 'DshRecommendationCards' } : name === './ExecutionDetails' ? { ExecutionDetails: 'ExecutionDetails', ActionApproval: 'ActionApproval' } : name === './DelegationReview' ? { DelegationReview: 'DelegationReview', DelegationOutcome: 'DelegationOutcome' } : name === './SomnusMark' ? { SomnusMark: 'SomnusMark' } : name === './assistantAcp' ? { mainChatBridge: () => bridge } : name === './ModelSwitch' ? { ModelSwitch: 'ModelSwitch' } : name === './SkillPicker' ? {} : name === './PluginPicker' ? { PluginPicker: 'PluginPicker', PluginChips: 'PluginChips' } : name === './PermissionSwitch' ? { PermissionSwitch: 'PermissionSwitch' } : name === './ProjectTools' ? { ProjectTools: 'ProjectTools', ChatWorktree: 'ChatWorktree' } : name === './FileProposalReview' ? { FileProposalReview: 'FileProposalReview', FileChangeCards: 'FileChangeCards', useFileProposals: () => ({ items: [] }), associateFileProposals: () => ({ byReply: new Map(), legacy: [] }) } : name === './RecentSessions' ? { RecentSessions: 'RecentSessions' } : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : name === 'antd' ? antd : name === '@ant-design/icons' ? new Proxy({}, { get: (_, key) => String(key) }) : name === './assistantApi' ? api : name === './MarkdownView' ? { Markdown: props => ({ type: 'Markdown', props }) } : name === './format.mjs' ? format : name === './errors.mjs' ? errors : name === './assistantImages.mjs' ? images : (() => { throw Error(name); })(), localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, window: { vvmanProjects: projectBridge, addEventListener(type, callback) { eventListeners.set(type, callback); }, removeEventListener(type) { eventListeners.delete(type); } }, AbortController, performance, Date, Error, console };
  vm.runInNewContext(source, context);
  const render = () => { cursor = 0; const tree = exports.AIAssistant({ visible, workspace, sidebar: {}, onLockedChange() {}, onModelConfig: bridge ? () => {} : undefined, onOpenChat() { calls.opened++; } }); return tree; };
  function flushEffects() { for (const effect of effects.splice(0)) effect(); }
  render(); flushEffects();
  return { activateSearch() { eventListeners.get('workbench:search-conversations')?.(); }, render, calls, storage, setWorkspace(id) { workspace = id; render(); flushEffects(); }, setVisible(value) { visible = value; render(); flushEffects(); }, find: (type, predicate = () => true) => nodes(render()).find(value => value.type === type && predicate(value.props)), all: () => nodes(render()) };
}
const button = (h, text) => h.find('Button', props => props.children === text || props['aria-label'] === text);
const textarea = h => h.find('TextArea');
const containsText = (h, text) => h.all().some(value => value.props?.children === text || (Array.isArray(value.props?.children) && value.props.children.includes(text)));
async function confirmDeletion(h) { button(h, '删除').props.onClick(); h.find('Modal', props => props.title === '删除会话').props.onOk(); await flush(); }

test('delete-current success selects the remaining recent conversation and clears the draft', async () => {
  const h = harness(); await flush();
  textarea(h).props.onChange({ target: { value: '未发送草稿' } });
  await confirmDeletion(h);
  assert.deepEqual(h.calls.removed, ['target']);
  assert.equal(h.storage.get('ya70-assistant-last-conversation'), 'next');
  assert.equal(textarea(h).props.value, '');
  assert(h.all().some(value => value.props?.children === '其他最近会话'));
  assert(!containsText(h, '原有内容-target'));
});

test('deleting the last conversation clears selection and last-key; failed deletion preserves content and draft', async () => {
  const empty = harness({ list: [first] }); await flush(); await confirmDeletion(empty);
  assert.equal(empty.storage.has('ya70-assistant-last-conversation'), false);
  assert(!button(empty, '删除')); assert(empty.all().some(value => value.props?.children === '新会话'));
  const failed = harness({ remove: async () => { throw Error('会话正在生成，请稍后重试'); } }); await flush();
  textarea(failed).props.onChange({ target: { value: '失败后保留的草稿' } }); await confirmDeletion(failed);
  assert.equal(failed.storage.get('ya70-assistant-last-conversation'), 'target');
  assert.equal(textarea(failed).props.value, '失败后保留的草稿');
  assert(containsText(failed, '原有内容-target'));
  assert(failed.find('Alert', props => props.message === '会话正在生成，请稍后重试'));
});

test('pending deletion disables switching, drafting and conflicting mutations', async () => {
  let reject; const h = harness({ remove: () => new Promise((_, fail) => { reject = fail; }) }); await flush();
  button(h, '删除').props.onClick(); h.find('Modal', props => props.title === '删除会话').props.onOk();
  assert.equal(button(h, '新建会话').props.disabled, true); assert.equal(button(h, '重命名').props.disabled, true); assert.equal(textarea(h).props.disabled, true);
  assert(h.all().filter(value => value.type === 'button' && value.props?.className?.includes('assistant-history-item')).every(value => value.props.disabled));
  reject(Error('失败')); await flush();
});

test('the real paste handler imports clipboard image Files, previews and removes them, and blocks vision-disabled send', async () => {
  const h = harness(); await flush(); let prevented = false;
  textarea(h).props.onChange({ target: { value: '有文字也不能静默丢图' } });
  assert.equal(button(h, '发送').props.disabled, false);
  const file = new File([new Uint8Array([1, 2])], 'clipboard-blue.png', { type: 'image/png' });
  textarea(h).props.onPaste({ preventDefault() { prevented = true; }, clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } }); await flush();
  assert.equal(prevented, true); assert.equal(h.calls.images[0], file);
  assert(h.find('img', props => props.alt === 'clipboard-blue.png'));
  assert.equal(button(h, '发送').props.disabled, true); assert.equal(h.calls.sent.length, 0);
  h.find('button', props => props['aria-label'] === '移除图片 clipboard-blue.png').props.onClick();
  assert(!h.find('img', props => props.alt === 'clipboard-blue.png')); assert.equal(button(h, '发送').props.disabled, false);
});

test('vision-enabled pure-image send is allowed; failed stream restores the image draft', async () => {
  const h = harness({ vision: true, send: async (onEvent, images) => { onEvent({ type: 'start', data: { user_message: { ...message('picture'), content: '', attachments: images }, assistant_message: { id: 'answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 } } }); onEvent({ type: 'error', data: { message: '模拟上游失败', assistant_message: { id: 'answer', role: 'assistant', content: '', status: 'error', created_at: 1 } } }); } }); await flush();
  const file = new File([new Uint8Array([1])], 'test.png', { type: 'image/png' });
  textarea(h).props.onPaste({ preventDefault() {}, clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } }); await flush();
  assert.equal(button(h, '发送').props.disabled, false); button(h, '发送').props.onClick(); await flush();
  assert.equal(h.calls.sent[0].content, ''); assert.equal(h.calls.sent[0].images[0].name, 'test.png');
  assert(h.find('div', props => props.className === 'assistant-image-drafts'));
  assert(h.find('Alert', props => props.message === '模拟上游失败'));
});


test('new conversation is immediately selected in the same sidebar list', async () => {
  const h = harness(); await flush();
  button(h, '新建会话').props.onClick(); await flush();
  const sidebar = h.find('RecentSessions').props;
  assert.equal(sidebar.activeId, 'new-chat');
  assert.equal(sidebar.items[0].id, 'new-chat');
  assert.equal(h.storage.get('ya70-assistant-last-conversation'), 'new-chat');
});

test('sidebar rename and confirmed removal of an inactive chat preserve the current draft', async () => {
  const h = harness(); await flush();
  textarea(h).props.onChange({ target: { value: '当前草稿' } });
  h.find('RecentSessions').props.onRename(next);
  h.all().find(node => node.props?.['aria-label'] === '会话名称').props.onChange({ target: { value: '新的名称' } });
  h.find('Modal', props => props.title === '重命名会话').props.onOk(); await flush();
  assert.deepEqual(h.calls.renamed, [{ id: 'next', title: '新的名称' }]);
  assert.equal(h.find('RecentSessions').props.items.find(item => item.id === 'next').title, '新的名称');
  h.find('RecentSessions').props.onDelete(next);
  assert.deepEqual(h.calls.removed, []);
  h.find('Modal', props => props.title === '删除会话').props.onCancel();
  assert.deepEqual(h.calls.removed, []);
  h.find('RecentSessions').props.onDelete(next);
  h.find('Modal', props => props.title === '删除会话').props.onOk(); await flush();
  assert.deepEqual(h.calls.removed, ['next']);
  assert.equal(h.find('RecentSessions').props.items.length, 1);
  assert.equal(h.find('RecentSessions').props.activeId, 'target');
  assert.equal(textarea(h).props.value, '当前草稿');
});

test('MCP unavailable approval stays on its reply and displays one desktop instruction', async () => {
  const reason = '此 MCP 工具需要在本机桌面版确认。请打开 Somnus.exe 后重新发送。';
  const reply = { id: 'answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const notice = { tool_name: 'run_report', reason };
  const h = harness({ send: async onEvent => {
    onEvent({ type: 'start', data: { user_message: message('request'), assistant_message: reply } });
    onEvent({ type: 'mcp_approval_blocked', data: notice });
    assert(h.find('Alert', props => props.message === reason && props.description === 'run_report'));
    onEvent({ type: 'done', data: { assistant_message: { ...reply, status: 'complete', reply_meta: { mcp_approval_blocked: notice } } } });
  } });
  await flush();
  textarea(h).props.onChange({ target: { value: '生成报告' } });
  button(h, '发送').props.onClick();
  await flush();
  assert.equal(h.all().filter(node => node.type === 'Alert' && node.props.message === reason).length, 1);
});

test('parallel same-name ACP tool calls resolve independent entries and legacy progress still pairs', async () => {
  const reply = { id: 'answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  let onUpdate;
  let execution;
  const bridge = {
    onUpdate(listener) { onUpdate = listener; return () => {}; },
    async promptConversation() {
      const emit = toolProgress => onUpdate({ agentId: 'agent', conversationId: first.id, text: '', toolProgress });
      emit({ callId: 'call-1', name: 'run_report', status: 'running' });
      emit({ callId: 'call-2', name: 'run_report', status: 'running' });
      emit({ callId: 'call-1', name: 'run_report', status: 'complete' });
      emit({ callId: 'call-2', name: 'run_report', status: 'error', message: '本次 MCP 调用已拒绝' });
      assert(h.find('div', props => props.className === 'assistant-tool-note' && props.children.includes('本次 MCP 调用已拒绝')));
      emit({ name: 'legacy', status: 'running' });
      emit({ name: 'legacy', status: 'complete' });
      return { text: 'finished', stopReason: 'end_turn', usage: { input_tokens: 1234, output_tokens: 0, partial: true } };
    },
  };
  const h = harness({
    bridge,
    externalApi: {
      beginExternalTurn: async () => ({ turn_id: 'turn', user_message: message('request'), assistant_message: reply, conversation: first }),
      finishExternalTurn: async (_id, _turn, result) => {
        execution = result.execution;
        assert.deepEqual(result.usage, { input_tokens: 1234, output_tokens: 0, partial: true });
        return { message: { ...reply, content: result.content, status: 'complete', reply_meta: { execution, usage: result.usage } }, conversation: first };
      },
    },
  });
  await flush();
  h.find('ModelSwitch').props.onExternal({ agentId: 'agent', agentName: 'Test Agent' });
  textarea(h).props.onChange({ target: { value: '生成报告' } });
  button(h, '发送').props.onClick();
  await flush();
  assert.equal(execution.steps.map(step => step.title + ':' + step.status).join(','), 'run_report:completed,run_report · 本次 MCP 调用已拒绝:failed,legacy:completed');
  assert.equal(h.find('ExecutionDetails').props.execution.steps[1].title, 'run_report · 本次 MCP 调用已拒绝');
  assert(!h.find('div', props => props.className === 'assistant-tool-note'));
  assert(h.find('span', props => Array.isArray(props.children) && props.children.join('') === '输入 1,234 · 输出 0 tokens · 用量不完整'));
});

test('concurrent built-in and ACP turns survive view and project switches and stop only the selected chat', async () => {
  const pending = new Map();
  let nativeUpdate;
  let finishExternal;
  const cancelledNative = [];
  const reply = id => ({ id: id + '-reply', role: 'assistant', content: '', status: 'streaming', created_at: 1 });
  const bridge = {
    onUpdate(listener) { nativeUpdate = listener; return () => {}; },
    promptConversation() { return new Promise(resolve => { finishExternal = resolve; }); },
    async cancelConversation(id) { cancelledNative.push(id); finishExternal({ text: 'native partial', stopReason: 'cancelled' }); },
  };
  const h = harness({
    bridge, workspaceLists: { default: [first], other: [next] },
    send: (onEvent, _images, id, signal) => new Promise(resolve => {
      onEvent({ type: 'start', data: { user_message: message(id + '-request'), assistant_message: reply(id) } });
      pending.set(id, onEvent);
      signal.addEventListener('abort', resolve, { once: true });
    }),
    externalApi: {
      beginExternalTurn: async id => ({ turn_id: 'turn', user_message: message(id + '-request'), assistant_message: reply(id), conversation: next }),
      finishExternalTurn: async (id, _turn, result) => ({ message: { ...reply(id), ...result }, conversation: next }),
    },
  });
  await flush();
  const submit = value => {
    textarea(h).props.onChange({ target: { value } });
    button(h, '发送').props.onClick();
  };
  const delta = (id, text) => pending.get(id)({ type: 'delta', data: { text } });
  submit('built-in request');
  await flush();
  h.setVisible(false);
  h.setWorkspace('other');
  h.setVisible(true);
  await flush();
  h.find('ModelSwitch').props.onExternal({ agentId: 'agent', agentName: 'Test Agent' });
  submit('native request');
  await flush();
  delta(first.id, 'background reply A');
  nativeUpdate({ agentId: 'agent', conversationId: next.id, text: 'native partial' });
  assert(h.all().some(node => node.props?.text === 'native partial'));
  assert(h.find('RecentSessions').props.runningIds.has(next.id));
  button(h, '停止生成').props.onClick();
  await flush();
  assert.deepEqual(cancelledNative, [next.id]);
  assert.deepEqual(h.calls.cancelled, []);
  h.setWorkspace('default');
  await flush();
  assert(h.all().some(node => node.props?.text === 'background reply A'));
  assert(button(h, '停止生成'));
  delta(first.id, ' continues');
  assert(h.all().some(node => node.props?.text === 'background reply A continues'));
  button(h, '停止生成').props.onClick();
  await flush();
  assert.deepEqual(h.calls.cancelled, [first.id]);
  assert.deepEqual(cancelledNative, [next.id]);
});

test('saved reply metadata displays reported counts and the new missing usage marker only', async () => {
  const reply = { role: 'assistant', content: 'Test reply', status: 'complete', created_at: 1 };
  const h = harness({ historyFor: () => [
    { ...reply, id: 'legacy', reply_meta: { model: 'legacy' } },
    { ...reply, id: 'usage', reply_meta: { model: 'counted', usage: { input_tokens: 0, output_tokens: 42 } } },
    { ...reply, id: 'missing', reply_meta: { model: 'unreported', usage_unavailable: true } },
  ] });
  await flush();
  assert(h.find('span', props => Array.isArray(props.children) && props.children.join('') === '输入 0 · 输出 42 tokens'));
  assert.equal(h.all().filter(node => node.type === 'span' && node.props.children === '用量未返回').length, 1);
  assert(!containsText(h, '用量不完整'));
});

test('native project tests wait for explicit approval and dispatch only the identified job', async () => {
  let finish;
  const events = [];
  const details = { executable: 'C:/python.exe', args: ['-m', 'pytest'], cwd: 'D:/repo', presetName: 'Tests' };
  const h = harness({
    projectBridge: {
      prepareDevelopment: async (conversation, job) => {
        events.push(['prepare', conversation, job]);
        return job === 'git_job' ? { kind: 'complete' } : { kind: 'approval', details };
      },
      respondDevelopment: async (conversation, job, approved) => {
        events.push(['respond', conversation, job, approved]);
        finish();
        return { kind: 'complete' };
      },
      cancelDevelopment: async () => {},
    },
    send: async onEvent => {
      const reply = { id: 'answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
      onEvent({ type: 'start', data: { user_message: message('request'), assistant_message: reply } });
      onEvent({ type: 'project_development', data: { id: 'git_job' } });
      onEvent({ type: 'project_development', data: { id: 'test_job' } });
      onEvent({ type: 'project_development', data: { id: 'test_job' } });
      await new Promise(resolve => { finish = resolve; });
      onEvent({ type: 'done', data: { assistant_message: { ...reply, status: 'complete' } } });
    },
  });
  await flush();
  textarea(h).props.onChange({ target: { value: '运行测试' } });
  button(h, '发送').props.onClick();
  await flush();
  assert.deepEqual(events, [['prepare', 'target', 'git_job'], ['prepare', 'target', 'test_job']]);
  const approval = h.find('ActionApproval');
  assert.deepEqual(approval.props.request.details, details);
  assert.equal(approval.props.request.requestId, 'test_job');
  await approval.props.onRespond('allow_once');
  await flush();
  assert.deepEqual(events[2], ['respond', 'target', 'test_job', true]);
  assert(!h.find('ActionApproval'));
});

test('only complete ACP turns persist and display DSH recommendation cards', async () => {
  const reply = { id: 'dsh-answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const recommendations = [{ id: 'proposal-1', kind: 'page', title: '本机图表', description: '生成图表页面' }];
  for (const stopReason of ['end_turn', 'cancelled']) {
    let persisted;
    const bridge = {
      onUpdate() { return () => {}; },
      async promptConversation() { return { text: '已回复', stopReason, recommendations }; },
    };
    const h = harness({
      bridge,
      externalApi: {
        beginExternalTurn: async () => ({ turn_id: 'turn', user_message: message('request'), assistant_message: reply, conversation: first }),
        finishExternalTurn: async (_id, _turn, result) => {
          persisted = result.recommendations;
          return { message: { ...reply, content: result.content, status: result.status, reply_meta: { recommendations: persisted } }, conversation: first };
        },
      },
    });
    await flush();
    h.find('ModelSwitch').props.onExternal({ agentId: 'agent', agentName: 'DeepSeek Harness 官方 ACP' });
    textarea(h).props.onChange({ target: { value: '看看能否制作仪表盘' } });
    button(h, '发送').props.onClick();
    await flush();
    const expected = stopReason === 'end_turn' ? recommendations : undefined;
    assert.equal(persisted, expected);
    assert.equal(h.find('DshRecommendationCards').props.cards, expected);
  }
});

test('company default uses the managed runtime without changing the selected provider; personal and local routes stay separate', async () => {
  const companyId = 'fbbce833-544a-42a1-8579-cba2a817383e';
  const reply = { id: 'company-answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const reserved = [];
  const requested = [];
  const bridge = {
    companyRuntime: async modelId => modelId === undefined || modelId === 'deepseek' ? { agentId: companyId } : null,
    onUpdate() { return () => {}; },
    async promptConversation(input) {
      requested.push(input);
      return { text: '已回复', stopReason: 'end_turn' };
    },
  };
  const h = harness({
    bridge,
    externalApi: {
      beginExternalTurn: async (_id, input) => {
        reserved.push(input);
        return { turn_id: 'turn', user_message: message('request'), assistant_message: reply, conversation: first };
      },
      finishExternalTurn: async (_id, _turn, result) => ({ message: { ...reply, content: result.content, status: result.status }, conversation: first }),
    },
  });
  async function send(content) {
    textarea(h).props.onChange({ target: { value: content } });
    button(h, '发送').props.onClick();
    await flush();
  }
  await flush();
  await send('公司默认');
  assert.equal(reserved[0].agent_id, companyId);
  assert.equal(reserved[0].agent_name, '公司默认');
  assert.equal(reserved[0].model, 'mock-only');
  assert.equal(requested[0].agentId, companyId);
  assert.equal(requested[0].modelId, undefined);
  assert.equal(h.find('ModelSwitch').props.external, undefined);

  h.find('ModelSwitch').props.onExternal({ agentId: 'local-agent', agentName: '个人 Agent', modelId: 'local-pro' });
  await send('本地 Agent');
  assert.equal(requested[1].agentId, 'local-agent');
  assert.equal(requested[1].modelId, 'local-pro');

  h.find('ModelSwitch').props.onExternal();
  h.find('ModelSwitch').props.onChange('m_personal');
  h.setVisible(true);
  await flush();
  await send('个人供应商');
  assert.equal(reserved.length, 2);
  assert.equal(h.calls.sent[0].content, '个人供应商');
});

test('composer forwards the real ACP reasoning value and retains actual context and cache metrics', async () => {
  const options = [{ id: '', name: 'Provider default' }, { id: 'high', name: 'High' }];
  const context = { used_tokens: 115000, max_tokens: 475000 };
  const usage = { input_tokens: 200, output_tokens: 20, cached_input_tokens: 100 };
  const reply = { id: 'agent-answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const discovery = [];
  let persisted, requested;
  const bridge = {
    async discoverModels(id, modelId) {
      discovery.push([id, modelId]);
      return { agentId: id, modelId, models: [], reasoning: { modelId, value: 'high', options } };
    },
    onUpdate() { return () => {}; },
    async promptConversation(input) {
      requested = input;
      return { text: '已回复', modelName: '测试模型', contextUsage: context, usage };
    },
  };
  const h = harness({
    bridge,
    externalApi: {
      beginExternalTurn: async () => ({ turn_id: 'turn', user_message: message('request'), assistant_message: reply, conversation: first }),
      finishExternalTurn: async (_id, _turn, result) => {
        persisted = result;
        return { message: { ...reply, content: result.content, status: result.status,
          reply_meta: { provider_id: 'agent', model: result.model, context: result.context, usage: result.usage } }, conversation: first };
      },
    },
  });
  await flush();
  h.find('ModelSwitch').props.onExternal({ agentId: 'agent', agentName: '测试 Agent', modelId: 'model', modelName: '测试模型' });
  h.setVisible(true);
  await flush();
  assert.deepEqual(discovery, [['agent', 'model']]);
  assert.equal(h.find('ModelSwitch').props.agentReasoning.settings.options, options);
  h.find('ModelSwitch').props.agentReasoning.onChange('');
  textarea(h).props.onChange({ target: { value: '测试请求' } });
  button(h, '发送').props.onClick();
  await flush();
  assert.equal(requested.reasoningEffort, '', 'DSH provider default is a deliberate empty value');
  assert.equal(persisted.context, context);
  assert.equal(persisted.usage, usage);
  assert(containsText(h, ' · 缓存命中 50%'));
  const meter = h.all().find(node => typeof node.type === 'function' && node.type.name === 'ContextMeter');
  assert.equal(meter.props.context, context);
  const ring = nodes(meter.type(meter.props)).find(node => node.props.className === 'assistant-context-meter');
  assert(ring.props['aria-label'].includes('已用 24.2% · 剩余 75.8%，115,000 / 475,000 tokens'));
});

test('workspace sidebar search filters the current project and opens the selected chat', async () => {
  const h = harness();
  await flush();
  h.activateSearch();
  const search = () => h.all().find(node => node.props['aria-label'] === '按标题搜索会话');
  const resultList = () => nodes(h.find('Modal', props => props.title === '搜索会话'))
    .find(node => node.type === 'RecentSessions');
  assert.equal(resultList().props.items.length, 2);
  search().props.onChange({ target: { value: '其他' } });
  assert.equal(resultList().props.items.length, 1);
  assert.equal(resultList().props.items[0].id, 'next');
  resultList().props.onOpen('next');
  await flush();
  assert.equal(h.storage.get('ya70-assistant-last-conversation'), 'next');
  assert.equal(h.find('Modal', props => props.title === '搜索会话').props.open, false);
});
test('built-in delegation waits for approval, forwards the selected agent and shows the returned result', async () => {
  const requests = [], answers = [];
  const agents = [{ id: 'codex', name: 'Codex' }, { id: 'dsh', name: 'DSH' }];
  const agentBridge = {
    listDelegationAgents: async () => agents,
    runDelegation: async input => { requests.push(input); return { text: '复核结果', agentName: 'DSH' }; },
  };
  const pending = { id: 'approval', task: '复核统计', context: '样本数据', agent_id: 'codex', agent_name: 'Codex' };
  let complete;
  let push;
  const assistant = { id: 'assistant', role: 'assistant', content: '', status: 'streaming', created_at: 2, reply_meta: {} };
  const h = harness({
    bridge: agentBridge,
    send: async onEvent => {
      push = onEvent;
      onEvent({ type: 'start', data: { user_message: message('fresh'), assistant_message: assistant } });
      onEvent({ type: 'delegation_request', data: pending });
      await new Promise(resolve => { complete = resolve; });
    },
    externalApi: { respondToDelegation: async (...args) => { answers.push(args); } },
  });
  await flush();
  h.find('TextArea').props.onChange({ target: { value: '请委派任务' } });
  button(h, '发送').props.onClick();
  await flush();
  const approval = h.find('DelegationReview').props;
  assert.equal(approval.request.context, pending.context);
  assert.equal(requests.length, 0);
  approval.onRespond('dsh');
  approval.onRespond('dsh');
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].agentId, 'dsh');
  assert.equal(requests[0].task, pending.task);
  assert.equal(answers[0][0], 'target');
  assert.equal(answers[0][1], 'approval');
  assert.equal(answers[0][2].result, '复核结果');
  push({ type: 'delegation_resolved', data: { id: 'approval', agent_name: 'DSH', status: 'complete', result: '复核结果' } });
  assert.equal(h.find('DelegationReview'), undefined);
  assert.equal(h.find('DelegationOutcome').props.result.result, '复核结果');
  push({ type: 'done', data: { message: { ...assistant, status: 'complete', content: '总结', reply_meta: { delegation: { agent_name: 'DSH', status: 'complete', result: '复核结果' } } } } });
  complete();
  await flush();
  assert.equal(h.find('DelegationOutcome').props.result.agent_name, 'DSH');
});
