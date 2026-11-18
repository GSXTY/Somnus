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
import { addonInstallIntent } from '../src/chatAddonInstall.ts';

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
function harness({ list = [first, next], vision = false, modelConfigured = true, windowsDesktop = false, remove = async () => ({ deleted: true }), send, bridge, externalApi, projectBridge, workspaceLists, documentLibrary, fetchFile, historyFor = id => [message(id)], clipboard, addonInstaller, nativeDshBridge, desktopBridge, workspaceLinks = false } = {}) {
  let cursor = 0, workspace = 'default', visible = true; const state = [], effects = [], effectDeps = [], storage = new Map([['ya70-assistant-last-conversation', 'target']]);
  const eventListeners = new Map();
  const documentListeners = new Map();
  class MockNode {}
  const calls = { removed: [], renamed: [], images: [], sent: [], sentModelIds: [], cancelled: [], addonSettings: [], opened: 0 };
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
    assistantStatus: async () => ({ configured: modelConfigured, connection_status: 'unverified', model: 'mock-only', database_connected: false, capabilities: { chat: true, vision }, message: '测试' }),
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
    sendMessage: async (id, content, signal, onEvent, images, _data, _files, _dataMeta, _skills, modelId) => {
      calls.sent.push({ id, content, images });
      calls.sentModelIds.push(modelId);
      if (send) await send(onEvent, images, id, signal);
    },
  };
  const images = { isLocalImage, prepareImages: async (files, existing) => { calls.images.push(...files); return prepareImages(files, existing, async file => ({ name: file.name, data_url: 'data:image/png;base64,AA==', mime: file.type, size: file.size, width: 1, height: 1 })); } };
  const antd = Object.fromEntries(['Alert', 'Button', 'Collapse', 'Dropdown', 'Modal', 'Select', 'Skeleton', 'Space', 'Spin', 'Tag'].map(name => [name, name])); antd.Input = Object.assign(function Input() {}, { TextArea: 'TextArea' });
  const exports = {};
  const context = { exports, require: name => name === 'react' ? react : name === 'react-dom' ? { createPortal: value => value } : name === './DocumentLibrary' ? { DocumentPicker: 'DocumentPicker' } : name === './documentLibraryBridge' ? { documentBridge: () => documentLibrary, readDocumentFile: (...args) => documentLibrary.readFile(...args) } : name === './DshRecommendationCards' ? { DshRecommendationCards: 'DshRecommendationCards' } : name === './ExecutionDetails' ? { ExecutionDetails: 'ExecutionDetails', ActionApproval: 'ActionApproval', AgentQuestions: 'AgentQuestions' } : name === './DelegationReview' ? { DelegationReview: 'DelegationReview', DelegationOutcome: 'DelegationOutcome' } : name === './SomnusMark' ? { SomnusMark: 'SomnusMark' } : name === './assistantAcp' ? { mainChatBridge: () => bridge } : name === './ChatTaskControls' ? { ChatTaskControls: 'ChatTaskControls' } : name === './ComposerCommands' ? { ComposerCommands: 'ComposerCommands', composerCommandListId: 'composer-commands', composerCommandRowId: index => 'command-' + index } : name === './ComposerEditor' ? { ComposerEditor: 'ComposerEditor' } : name === './ComposerTeamwork' ? { ComposerTeamwork: 'ComposerTeamwork' } : name === './ComposerExtensions' ? { ComposerExtensions: 'ComposerExtensions' } : name === './ModelSwitch' ? { ModelSwitch: 'ModelSwitch' } : name === './SkillPicker' ? {} : name === './PluginPicker' ? { PluginPicker: 'PluginPicker', PluginChips: 'PluginChips' } : name === './PermissionSwitch' ? { PermissionSwitch: 'PermissionSwitch' } : name === './ConversationTrace' ? { ConversationTrajectory: 'ConversationTrajectory' } : name === './ConversationSessionChrome' ? { ConversationReplyRating: 'ConversationReplyRating', ConversationTurnRail: 'ConversationTurnRail' } : name === './ChatWorkspacePanel' ? { ChatWorkspacePanel: 'ChatWorkspacePanel' } : name === './ChatProjectContext' ? { ChatProjectContext: 'ChatProjectContext' } : name === './ProjectTools' ? { ProjectTools: 'ProjectTools', ChatWorktree: 'ChatWorktree' } : name === './FileProposalReview' ? { FileProposalReview: 'FileProposalReview', FileChangeCards: 'FileChangeCards', useFileProposals: () => ({ items: [] }), associateFileProposals: () => ({ byReply: new Map(), legacy: [] }) } : name === './RecentSessions' ? { RecentSessions: 'RecentSessions' } : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : name === 'antd' ? antd : name === '@ant-design/icons' ? new Proxy({}, { get: (_, key) => String(key) }) : name === './chatAddonInstall' ? { addonInstallIntent } : name === './assistantApi' ? api : name === './taskAttention' ? { linkedConversation: () => undefined, reportConversationFinished: () => {}, watchAnalysisTask: () => {} } : name === './MarkdownView' ? { Markdown: props => ({ type: 'Markdown', props }) } : name === './format.mjs' ? format : name === './errors.mjs' ? errors : name === './assistantImages.mjs' ? images : (() => { throw Error(name); })(), localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, window: { vvmanProjects: projectBridge, somnusAddonInstaller: addonInstaller, somnusNativeDshChat: nativeDshBridge, somnusDesktop: desktopBridge, somnusWorkspaceWeb: workspaceLinks ? {} : undefined, addEventListener(type, callback) { eventListeners.set(type, callback); }, removeEventListener(type) { eventListeners.delete(type); } }, AbortController, performance, Date, Error, atob, File, crypto, fetch: fetchFile, console };
  context.navigator = { clipboard };
  context.Node = MockNode;
  context.document = {
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    removeEventListener(type) { documentListeners.delete(type); },
  };
  vm.runInNewContext(source, context);
  const render = () => { cursor = 0; const tree = exports.AIAssistant({ visible, workspace, windowsDesktop, workspaceLinks, sidebar: {}, attentionTarget: {}, onLockedChange() {}, onModelConfig: bridge ? () => {} : undefined, onOpenAddonSettings(settings, name) { calls.addonSettings.push([settings, name]); }, onOpenChat() { calls.opened++; } }); return tree; };
  function flushEffects() { for (const effect of effects.splice(0)) effect(); }
  render(); flushEffects();
  return { flushEffects, activateSearch() { eventListeners.get('workbench:search-conversations')?.(); }, dispatchDocument(type, target = new MockNode()) { documentListeners.get(type)?.({ target }); }, node: () => new MockNode(), render, calls, storage, setWorkspace(id) { workspace = id; render(); flushEffects(); }, setVisible(value) { visible = value; render(); flushEffects(); }, find: (type, predicate = () => true) => nodes(render()).find(value => value.type === type && predicate(value.props)), all: () => nodes(render()) };
}
const button = (h, text) => h.find('Button', props => props.children === text || props['aria-label'] === text);
const textarea = h => {
  const editor = h.find('ComposerEditor');
  return { ...editor, props: { ...editor.props, 'aria-activedescendant': editor.props.activeDescendant,
    onChange: event => editor.props.onChange(event.target.value, editor.props.references) } };
};
function pressEnter(h) {
  textarea(h).props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {} });
}
const containsText = (h, text) => h.all().some(value => value.props?.children === text || (Array.isArray(value.props?.children) && value.props.children.includes(text)));
const chatMenu = h => h.find('Dropdown', props => props.children?.props?.className === 'assistant-chat-title-button').props.menu;

test('session tabs show the current conversation trajectory and retain unsent input when returning', async () => {
  const history = [message('question-one'), { ...message('answer-one'), role: 'assistant' }, message('question-two')];
  const h = harness({ historyFor: () => history });
  await flush();
  textarea(h).props.onChange({ target: { value: 'Unsent draft' } });
  const tab = id => h.find('button', props => props.role === 'tab' && props.id === id);
  const transcript = () => h.find('div', props => props.id === 'assistant-panel-chat');
  assert.equal(tab('assistant-tab-chat').props['aria-selected'], true);
  assert.deepEqual(h.all().filter(node => node.type === 'article' && node.props['data-turn-anchor'])
    .map(node => node.props['data-turn-anchor']), history.filter(item => item.role === 'user').map(item => item.id));
  tab('assistant-tab-trajectory').props.onClick();
  assert.equal(tab('assistant-tab-trajectory').props['aria-selected'], true);
  assert.equal(transcript().props.hidden, true);
  assert.equal(h.find('ConversationTrajectory').props.conversationId, first.id);
  assert.deepEqual(h.find('ConversationTrajectory').props.messages, history);
  h.find('ConversationTrajectory').props.onReadChat();
  assert.equal(transcript().props.hidden, false);
  assert.equal(textarea(h).props.value, 'Unsent draft');
  assert.equal(h.calls.sent.length, 0);
});
async function confirmDeletion(h) { chatMenu(h).onClick({ key: 'delete' }); h.find('Modal', props => props.title === '删除会话').props.onOk(); await flush(); }

test('an explicit addon request persists in chat and opens the reported settings without a model', async () => {
  const request = '帮我安装一下 dsh im';
  const reply = { ...message('install'), role: 'assistant', status: 'streaming', content: '' };
  let listener;
  let installation;
  let saved;
  const h = harness({
    modelConfigured: false,
    addonInstaller: {
      onProgress(callback) { listener = callback; return () => { listener = undefined; }; },
      async install(input) {
        installation = input;
        listener('installing');
        listener('verifying');
        return { name: '@xmanrui/dsh-im', profile: 'web', verified: true, alreadyInstalled: false, settings: 'dsh-im' };
      },
    },
    externalApi: {
      async beginExternalTurn(id, { content }) {
        assert.equal(id, first.id);
        assert.equal(content, request);
        return { conversation: first, turn_id: reply.id, user_message: { ...message('request'), content }, assistant_message: reply };
      },
      async finishExternalTurn(id, turn, result) {
        assert.equal(id, first.id);
        assert.equal(turn, reply.id);
        saved = JSON.parse(JSON.stringify(result));
        return { conversation: first, message: { ...reply, content: result.content, status: result.status } };
      },
    },
  });
  await flush();
  textarea(h).props.onChange({ target: { value: request } });
  assert.equal(button(h, '发送').props.disabled, false);
  pressEnter(h);
  await flush();
  assert.equal(installation.reference, '@xmanrui/dsh-im');
  assert.equal(saved.status, 'complete');
  assert.match(saved.content, /已安装到桌面配置/);
  assert.deepEqual(saved.execution.steps.map(step => step.status), ['completed', 'completed', 'completed']);
  assert.deepEqual(h.calls.addonSettings, [['dsh-im', '@xmanrui/dsh-im']]);
  assert.equal(h.calls.sent.length, 0);
});

test('completed reply actions copy the answer and open a branch at that reply', async () => {
  const reply = { ...message('answer'), role: 'assistant', content: '**回答内容**' };
  const branch = { ...first, id: 'branch', title: '新分支', updated_at: 5 };
  const calls = [];
  const h = harness({
    historyFor: () => [reply],
    clipboard: { async writeText(text) { calls.push(['copy', text]); } },
    externalApi: {
      async branchConversation(id, replyId) { calls.push(['branch', id, replyId]); return branch; },
      async conversation(id) { return { conversation: id === branch.id ? branch : first, messages: [reply] }; },
    },
  });
  await flush();
  button(h, '复制回答').props.onClick();
  await flush();
  assert.ok(containsText(h, '已复制'));
  button(h, '从此处新建分支').props.onClick();
  await flush();
  assert.deepEqual(calls, [['copy', reply.content], ['branch', first.id, reply.id]]);
  assert.equal(h.storage.get('ya70-assistant-last-conversation'), branch.id);
});

test('personal document attachment uses the existing upload and rejects a shared selection', async () => {
  const reads = [];
  const uploads = [];
  const h = harness({
    documentLibrary: { async readFile(...args) {
      reads.push(args);
      return { name: 'note.txt', size: 4, mimeType: 'text/plain', dataBase64: 'bm90ZQ==' };
    } },
    async fetchFile(url, request) {
      uploads.push([url, request.method, request.headers['X-Filename'], await request.body.text()]);
      return { ok: true, json: async () => ({ file: { id: 'note', name: 'note.txt', chars: 4 } }) };
    },
  });
  await flush();
  h.find('Dropdown', props => props.children?.props['aria-label'] === '添加文件').props.menu.onClick({ key: 'library' });
  const picker = h.find('DocumentPicker');
  assert.equal(picker.props.open, true);
  const entry = { kind: 'file', name: 'note.txt', path: 'project/note.txt' };
  picker.props.onPick('shared', entry);
  assert.deepEqual(reads, []);
  picker.props.onPick('private', entry);
  await flush();
  assert.deepEqual(reads, [['private', 'project/note.txt']]);
  assert.deepEqual(uploads, [['/api/assistant/files', 'POST', 'note.txt', 'note']]);
  assert.equal(textarea(h).props.references[0].kind, 'file');
});

test('chat retains historical text and uses the normal Agent composer without starting removed tasks', async () => {
  const historical = 'Historical task text';
  const h = harness({ windowsDesktop: true, historyFor: () => [{ ...message('past'), content: historical }],
    externalApi: {
      dotTaskStatus() { assert.fail('chat must not query removed task status'); },
      listDotTasks() { assert.fail('chat must not query removed task records'); },
      createDotTask() { assert.fail('chat must not send a removed task'); },
    },
  });
  await flush();
  assert(containsText(h, historical));
  assert(!h.all().some(node => node.type === 'Dropdown' &&
    node.props.menu?.items.some(item => item?.key === 'dot')));
  textarea(h).props.onChange({ target: { value: 'Current message' } });
  pressEnter(h);
  await flush();
  assert.deepEqual(h.calls.sent.map(item => item.content), ['Current message']);
});

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
  assert(!chatMenu(empty).items.some(item => item.key === 'delete')); assert(empty.all().some(value => value.props?.children === '新会话'));
  const failed = harness({ remove: async () => { throw Error('会话正在生成，请稍后重试'); } }); await flush();
  textarea(failed).props.onChange({ target: { value: '失败后保留的草稿' } }); await confirmDeletion(failed);
  assert.equal(failed.storage.get('ya70-assistant-last-conversation'), 'target');
  assert.equal(textarea(failed).props.value, '失败后保留的草稿');
  assert(containsText(failed, '原有内容-target'));
  assert(failed.find('Alert', props => props.message === '会话正在生成，请稍后重试'));
});

test('pending deletion disables switching, drafting and conflicting mutations', async () => {
  let reject; const h = harness({ remove: () => new Promise((_, fail) => { reject = fail; }) }); await flush();
  chatMenu(h).onClick({ key: 'delete' }); h.find('Modal', props => props.title === '删除会话').props.onOk();
  assert.equal(button(h, '新建会话').props.disabled, true); assert.equal(chatMenu(h).items.find(item => item.key === 'rename').disabled, true); assert.equal(textarea(h).props.disabled, true);
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

test('a follow-up draft remains editable during generation and survives a failed reply', async () => {
  const reply = { id: 'follow-up-answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  let fail;
  const h = harness({ send: async onEvent => {
    onEvent({ type: 'start', data: { user_message: message('first-request'), assistant_message: reply } });
    await new Promise(resolve => { fail = resolve; });
    onEvent({ type: 'error', data: { message: '上游暂时不可用', assistant_message: { ...reply, status: 'error' } } });
  } });
  await flush();
  textarea(h).props.onChange({ target: { value: '当前请求' } });
  button(h, '发送').props.onClick();
  await flush();
  assert.equal(textarea(h).props.disabled, false);
  assert.equal(textarea(h).props.value, '');
  textarea(h).props.onChange({ target: { value: '下一条消息' } });
  assert.equal(h.calls.sent.length, 1);
  h.find('RecentSessions').props.onOpen('next');
  await flush();
  h.find('RecentSessions').props.onOpen(first.id);
  await flush();
  assert.equal(textarea(h).props.value, '下一条消息');
  fail();
  await flush();
  assert.equal(textarea(h).props.value, '下一条消息');
  assert.equal(button(h, '发送').props.disabled, false);
});

test('busy queued messages start in order with their selected models and leave the latest draft alone', async () => {
  const finish = [];
  const h = harness({ bridge: {}, send: async onEvent => {
    await new Promise(resolve => { finish.push(() => {
      onEvent({ type: 'done', data: {} });
      resolve();
    }); });
  } });
  await flush();
  const enter = content => {
    textarea(h).props.onChange({ target: { value: content } });
    pressEnter(h);
  };
  enter('当前任务');
  await flush();
  h.find('ModelSwitch').props.onChange('model-two');
  enter('第二条');
  h.find('ModelSwitch').props.onChange('model-three');
  enter('第三条');
  enter('待移除');
  const remove = h.all().filter(node => node.props?.['aria-label'] === '移除此排队消息');
  remove[2].props.onClick();
  textarea(h).props.onChange({ target: { value: '保留这条草稿' } });
  assert.deepEqual(h.calls.sent.map(item => item.content), ['当前任务']);
  finish[0]();
  await flush();
  assert.deepEqual(h.calls.sent.map(item => item.content), ['当前任务', '第二条']);
  finish[1]();
  await flush();
  assert.deepEqual(h.calls.sent.map(item => item.content), ['当前任务', '第二条', '第三条']);
  assert.deepEqual(h.calls.sentModelIds, [undefined, 'model-two', 'model-three']);
  finish[2]();
  await flush();
  assert.equal(textarea(h).props.value, '保留这条草稿');
});

test('composer uses the running turn stop control, queues follow-ups, and recalls the last item into an empty draft', async () => {
  let finish;
  const h = harness({ send: async onEvent => {
    await new Promise(resolve => { finish = resolve; });
    onEvent({ type: 'done', data: {} });
  } });
  await flush();
  textarea(h).props.onChange({ target: { value: '运行中的请求' } });
  pressEnter(h);
  await flush();
  assert(button(h, '停止生成'));
  assert(!button(h, '排队'));
  textarea(h).props.onChange({ target: { value: '待取回' } });
  assert(button(h, '停止生成').props.className.includes('assistant-secondary-stop'));
  button(h, '排队').props.onClick();
  assert.equal(textarea(h).props.value, '');
  assert(button(h, '将排队消息带回输入框'));
  let prevented = false;
  textarea(h).props.onKeyDown({ key: 'ArrowUp', nativeEvent: {}, preventDefault() { prevented = true; } });
  assert(prevented);
  assert.equal(textarea(h).props.value, '待取回');
  assert(!button(h, '将排队消息带回输入框'));
  assert.equal(h.calls.sent.length, 1);
  const escape = () => textarea(h).props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
  escape();
  assert.deepEqual(h.calls.cancelled, []);
  escape();
  await flush();
  assert.deepEqual(h.calls.cancelled, [first.id]);
  finish();
  await flush();
});

test('composer guards IME and held Enter, and Tab accepts a slash command', async () => {
  const h = harness();
  await flush();
  const key = (key, props = {}) => textarea(h).props.onKeyDown({ key, nativeEvent: {}, preventDefault() {}, ...props });
  textarea(h).props.onChange({ target: { value: '输入草稿' } });
  key('Enter', { nativeEvent: { keyCode: 229 } });
  key('Enter', { nativeEvent: { isComposing: true } });
  key('Enter', { repeat: true });
  key('Enter', { shiftKey: true });
  await flush();
  assert.deepEqual(h.calls.sent, []);
  assert.equal(textarea(h).props.value, '输入草稿');
  textarea(h).props.onChange({ target: { value: '/new' } });
  key('Tab');
  await flush();
  assert.notEqual(textarea(h).props.value, '/new');
  assert.deepEqual(h.calls.sent, []);
});

test('composer accepts a local file drop and opens private document references with @', async () => {
  const file = new File([new Uint8Array([1])], 'dropped.png', { type: 'image/png' });
  const h = harness({ vision: true, documentLibrary: {} });
  await flush();
  const card = () => h.find('div', props => Object.hasOwn(props, 'data-composer-card'));
  const dataTransfer = { types: ['Files'], items: [
    { kind: 'file', getAsFile: () => file },
    { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => assert.fail('directory should be skipped') },
  ] };
  card().props.onDragOver({ dataTransfer, preventDefault() {} });
  assert.equal(dataTransfer.dropEffect, 'copy');
  assert.equal(card().props['data-dragging'], true);
  card().props.onDrop({ dataTransfer, preventDefault() {} });
  await flush();
  assert.deepEqual(h.calls.images, [file]);
  assert.equal(card().props['data-dragging'], undefined);
  textarea(h).props.onChange({ target: { value: '查看 @' } });
  assert(h.find('div', props => props['aria-label'] === '引用文件或会话'));
  pressEnter(h);
  assert.equal(h.find('DocumentPicker').props.open, true);
  assert.equal(textarea(h).props.value, '查看 @');
  h.find('DocumentPicker').props.onClose();
  assert.equal(h.find('DocumentPicker').props.open, false);
  assert.deepEqual(h.calls.sent, []);
});

test('Ctrl+Enter sends reserved native guidance into the running turn', async () => {
  const agentId = 'fbbce833-544a-42a1-8579-cba2a817383e';
  const reply = { id: 'native-turn', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const received = [];
  let complete;
  const h = harness({
    bridge: { companyRuntime: async () => ({ agentId }) },
    nativeDshBridge: { onUpdate: () => () => {}, async promptConversation() {
      await new Promise(resolve => { complete = resolve; });
      return { text: '完成', stopReason: 'end_turn' };
    }, async steer(payload) {
      received.push(payload);
      return { accepted: true, message: { ...message('steer'), content: '修改方向' } };
    } },
    externalApi: {
      async beginExternalTurn() {
        return { turn_id: reply.id, user_message: message('start'), assistant_message: reply, conversation: first };
      },
      async reserveExternalSteer(id, turnId, content) {
        received.push([id, turnId, content]);
        return { steer_id: 'steer-id' };
      },
      async finishExternalTurn(_id, _turn, result) {
        return { message: { ...reply, content: result.content, status: result.status }, conversation: first };
      },
    },
  });
  await flush();
  textarea(h).props.onChange({ target: { value: '当前任务' } });
  pressEnter(h);
  await flush();
  textarea(h).props.onChange({ target: { value: '修改方向' } });
  textarea(h).props.onKeyDown({ key: 'Enter', ctrlKey: true, nativeEvent: {}, preventDefault() {} });
  await flush();
  assert.deepEqual(received[0], [first.id, reply.id, '修改方向']);
  assert.deepEqual({ ...received[1] }, { conversationId: first.id, turnId: reply.id, steerId: 'steer-id' });
  assert.equal(textarea(h).props.value, '');
  complete();
  await flush();
});

test('an empty composer sends the exact durable queue as one native guidance batch', async () => {
  const reply = { id: 'batch-turn', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const persisted = [];
  const batches = [];
  let complete;
  const h = harness({
    bridge: { companyRuntime: async () => ({ agentId: 'fbbce833-544a-42a1-8579-cba2a817383e' }) },
    nativeDshBridge: { onUpdate: () => () => {}, async promptConversation() {
      await new Promise(resolve => { complete = resolve; });
      return { text: '完成', stopReason: 'end_turn' };
    }, async saveQueue(id, items) { persisted.push([id, items]); }, async steerQueue(payload) {
      batches.push(payload);
      return { accepted: true, messages: [], acceptedQueueIds: payload.queueIds };
    } },
    externalApi: {
      async beginExternalTurn() { return { turn_id: reply.id, user_message: message('start'), assistant_message: reply, conversation: first }; },
      async finishExternalTurn(_id, _turn, result) { return { message: { ...reply, content: result.content, status: result.status }, conversation: first }; },
    },
  });
  await flush();
  for (const content of ['当前任务', '排队一', '排队二']) {
    textarea(h).props.onChange({ target: { value: content } });
    pressEnter(h);
    await flush();
  }
  assert(button(h, '追加全部排队消息'));
  const ids = Array.from(persisted.at(-1)[1], item => item.id);
  assert.equal(ids.length, 2);
  textarea(h).props.onKeyDown({ key: 'Enter', ctrlKey: true, nativeEvent: {}, preventDefault() {} });
  await flush();
  assert.deepEqual({ ...batches[0], queueIds: Array.from(batches[0].queueIds) }, { conversationId: first.id, turnId: reply.id, queueIds: ids });
  assert.equal(persisted.at(-1)[1].length, 0);
  assert(!button(h, '追加全部排队消息'));
  complete();
  await flush();
});

test('a selected conversation reference stays inline and sends only bounded textual messages', async () => {
  const saved = [];
  const h = harness({ nativeDshBridge: { async saveDraft(_id, draft) { saved.push(draft); } },
    historyFor: id => [message(id), { id: 'pending', role: 'assistant', content: 'incomplete private detail', status: 'streaming' }],
  });
  await flush();
  textarea(h).props.onChange({ target: { value: '对照 @其他' } });
  pressEnter(h);
  await flush();
  const editor = textarea(h);
  assert.equal(editor.props.value, '对照 ');
  assert.equal(editor.props.references[0].kind, 'conversation');
  assert.equal(editor.props.references[0].label, next.title);
  assert(!editor.props.references[0].text.includes('incomplete private detail'));
  assert(saved.some(draft => draft?.composerBlocks?.length === 1));
  button(h, '发送').props.onClick();
  await flush();
  assert.match(h.calls.sent[0].content, /原有内容-next/);
  assert.doesNotMatch(h.calls.sent[0].content, /incomplete private detail/);
});

test('recovered queue stays paused and skips a server-confirmed duplicate before continuing in order', async () => {
  const durable = [
    { id: '1'.repeat(32), draft: { text: '已提交' }, route: { nativeDsh: false, modelId: 'old-model' }, permission: 'read_only' },
    { id: '2'.repeat(32), draft: { text: '下一条' }, route: { nativeDsh: false, modelId: 'next-model' }, permission: 'read_only' },
  ];
  const writes = [];
  let sent = 0;
  const h = harness({
    nativeDshBridge: {
      async getQueue(id) { return id === first.id ? durable : []; },
      async saveQueue(id, items) { writes.push([id, items.map(item => item.id)]); },
    },
    send: async onEvent => {
      if (++sent === 1) throw Object.assign(new Error('已提交'), { code: 'queue_already_submitted' });
      onEvent({ type: 'done', data: {} });
    },
  });
  await flush();
  h.render();
  h.flushEffects();
  await flush();
  assert.equal(h.calls.sent.length, 0);
  assert(containsText(h, '已恢复，等待你继续发送。'));
  button(h, '继续发送').props.onClick();
  await flush();
  assert.deepEqual(h.calls.sent.map(item => item.content), ['已提交', '下一条']);
  assert.deepEqual(h.calls.sentModelIds, ['old-model', 'next-model']);
  assert.deepEqual(Array.from(writes.at(-1)[1]), []);
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
      onUpdate({ agentId: 'agent', conversationId: first.id, text: '', acpStage: 'thinking' });
      assert.equal(h.find('ExecutionDetails').props.stage, 'thinking');
      onUpdate({ agentId: 'agent', conversationId: first.id, text: '',
        acpTool: { id: 'acp-report', title: 'mcp__vv_man__run_report', kind: 'other', status: 'in_progress' } });
      emit({ callId: 'call-1', traceId: 'acp-report', name: 'run_report', status: 'running' });
      emit({ callId: 'call-2', name: 'run_report', status: 'running' });
      emit({ callId: 'call-1', traceId: 'acp-report', name: 'run_report', status: 'complete' });
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
  assert.equal(execution.steps.map(step => step.title + ':' + step.status).join(','), 'run_report:completed,run_report:failed,legacy:completed');
  assert.equal(execution.steps[0].id, 'acp-report');
  assert.equal(h.find('ExecutionDetails').props.execution.steps[1].failure_reason, '本次 MCP 调用已拒绝');
  assert.equal(h.find('ExecutionDetails').props.replyStatus, 'complete');
  assert(!h.find('div', props => props.className === 'assistant-tool-note'));
  assert(h.find('button', props => props.className === 'assistant-token-usage').props['aria-label'].includes('输入 1,234 · 输出 0'));
  assert(h.find('button', props => props.className === 'assistant-token-usage').props['aria-label'].includes('部分回复的用量未完整返回'));
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

test('composer sums saved usage once, correctly weighting only reported cache usage', async () => {
  const reply = { role: 'assistant', content: 'Test reply', status: 'complete', created_at: 1 };
  const h = harness({ historyFor: () => [
    { ...reply, id: 'legacy', reply_meta: { model: 'legacy' } },
    { ...reply, id: 'usage', reply_meta: { model: 'counted', usage: { input_tokens: 0, output_tokens: 42 } } },
    { ...reply, id: 'used-a', reply_meta: { model: 'agent-a', usage: { input_tokens: 120, output_tokens: 5, cached_input_tokens: 20 } } },
    { ...reply, id: 'used-b', reply_meta: { model: 'agent-b', usage: { input_tokens: 80, output_tokens: 5, cached_input_tokens: 60 } } },
    { ...reply, id: 'no-cache', reply_meta: { model: 'agent-b', usage: { input_tokens: 50, output_tokens: 0 } } },
    { ...reply, id: 'missing', reply_meta: { model: 'unreported', usage_unavailable: true } },
  ] });
  await flush();
  const meters = h.all().filter(node => node.props.className === 'assistant-token-usage');
  assert.equal(meters.length, 1);
  assert(meters[0].props['aria-label'].includes('共 302 tokens'));
  assert(meters[0].props['aria-label'].includes('输入 250 · 输出 52'));
  assert(meters[0].props['aria-label'].includes('缓存命中 40%'));
  assert(meters[0].props['aria-label'].includes('部分回复的用量未完整返回'));
  assert(!containsText(h, '用量未返回'));
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
  const reply = h.find('article', props => props.className === 'assistant-message assistant');
  assert(nodes(reply).some(node => node.type === 'ActionApproval' && node.props.request.requestId === 'test_job'),
    'approval appears inside the running reply');
  await approval.props.onRespond('allow_once');
  await flush();
  assert.deepEqual(events[2], ['respond', 'target', 'test_job', true]);
  assert(!h.find('ActionApproval'));
});

test('blank chat permissions are reserved before sending and changes while working apply to the next turn', async () => {
  const permissionCalls = [];
  let finishFirst;
  let sendCount = 0;
  const bridge = { list: async () => [], onUpdate: () => () => {} };
  const h = harness({ list: [], bridge, windowsDesktop: true, externalApi: {
    async createConversation(workspace, mode) {
      permissionCalls.push(['create', workspace, mode]);
      return { ...first, permission_mode: mode };
    },
    async saveConversationPermission(id, mode) {
      permissionCalls.push(['update', id, mode]);
      return mode;
    },
  }, send: async () => {
    if (++sendCount === 1) await new Promise(resolve => { finishFirst = resolve; });
  } });
  await flush();
  const permission = () => h.find('PermissionSwitch').props;
  assert.equal(permission().conversationId, undefined);
  assert.equal(permission().disabled, false);
  assert.equal(h.find('ModelSwitch').props.disabled, false);
  permission().onChange('workspace_write');
  textarea(h).props.onChange({ target: { value: '第一条' } });
  pressEnter(h);
  await flush();
  assert.deepEqual(permissionCalls, [['create', 'default', 'workspace_write']]);
  assert.equal(permission().defer, true);
  assert.equal(permission().disabled, false);
  permission().onChange('read_only');
  assert.equal(permission().permission, 'read_only');
  assert.equal(permissionCalls.length, 1);
  finishFirst();
  await flush();
  textarea(h).props.onChange({ target: { value: '第二条' } });
  pressEnter(h);
  await flush();
  assert.deepEqual(permissionCalls[1], ['update', first.id, 'read_only']);
  assert.equal(h.calls.sent.length, 2);
});

test('preselected Teamwork applies only to the newly materialized chat before its first native prompt', async () => {
  const agentId = 'fbbce833-544a-42a1-8579-cba2a817383e';
  const calls = [];
  const reply = { id: 'teamwork-turn', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const h = harness({
    list: [], windowsDesktop: true,
    desktopBridge: { teamwork: async () => ({ available: true, enabled: false }), async setTeamwork(id, enabled) {
      calls.push(['set', id, enabled]);
      return { available: true, enabled };
    } },
    bridge: { companyRuntime: async () => ({ agentId }), onUpdate: () => () => {} },
    nativeDshBridge: {
      onUpdate: () => () => {},
      async promptConversation({ conversationId }) {
        calls.push(['prompt', conversationId]);
        return { text: '完成', stopReason: 'end_turn' };
      },
    },
    externalApi: {
      async createConversation() { calls.push(['create']); return first; },
      async beginExternalTurn(id) {
        calls.push(['reserve', id]);
        return { turn_id: reply.id, user_message: message('question'), assistant_message: reply, conversation: first };
      },
      async finishExternalTurn() { return { message: { ...reply, status: 'complete' }, conversation: first }; },
    },
  });
  await flush();
  const additional = h.find('Dropdown', props => props.menu?.items.some(item => item?.key === 'settings:extensions'));
  additional.props.menu.onClick({ key: 'settings:extensions' });
  assert.equal(h.find('ComposerExtensions').props.open, true);
  const teamwork = () => h.find('ComposerTeamwork').props;
  assert.equal(teamwork().conversationId, undefined);
  teamwork().onDraftChange(true);
  assert.equal(teamwork().draftEnabled, true);
  assert.deepEqual(calls, []);
  textarea(h).props.onChange({ target: { value: '开始协作' } });
  pressEnter(h);
  await flush();
  assert.deepEqual(calls, [['create'], ['set', first.id, true], ['reserve', first.id], ['prompt', first.id]]);
  assert.equal(teamwork().conversationId, first.id);
  assert.equal(teamwork().draftEnabled, false);
});

test('slash menu routes keyboard selections to UI actions without sending a chat message', async () => {
  const h = harness({ list: [], projectBridge: {}, bridge: {} });
  await flush();
  textarea(h).props.onChange({ target: { value: '/per' } });
  const menu = () => h.find('ComposerCommands');
  assert.equal(menu().props.commands[0].name, 'permission');
  assert.equal(textarea(h).props['aria-activedescendant'], 'command-0');
  pressEnter(h);
  assert.equal(h.find('PermissionSwitch').props.openRequest, 1);
  assert.equal(menu(), undefined);
  assert.deepEqual(h.calls.sent, []);
  textarea(h).props.onChange({ target: { value: '/' } });
  textarea(h).props.onKeyDown({ key: 'ArrowDown', nativeEvent: {}, preventDefault() {} });
  assert.equal(menu().props.selected, 1);
  textarea(h).props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
  assert.equal(menu(), undefined);
  assert.equal(textarea(h).props.value, '/');
});

test('slash menu dismisses outside the composer and does not overlap extensions', async () => {
  const h = harness({ list: [], projectBridge: {}, bridge: {} });
  await flush();
  const menu = () => h.find('ComposerCommands');
  const extensions = () => h.find('ComposerExtensions').props;
  const edit = value => {
    textarea(h).props.onChange({ target: { value } });
    h.render();
    h.flushEffects();
  };
  edit('/');
  const insideMenu = h.node();
  menu().props.menuRef.current = { contains: target => target === insideMenu };
  h.dispatchDocument('pointerdown', insideMenu);
  assert.ok(menu());
  textarea(h).props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: true } });
  assert.ok(menu());

  h.dispatchDocument('pointerdown');
  assert.equal(menu(), undefined);
  assert.equal(textarea(h).props.value, '/');
  edit('/f');
  extensions().onOpenChange(true);
  assert.equal(extensions().open, true);
  assert.equal(menu(), undefined);
  extensions().onOpenChange(false);
  assert.equal(menu(), undefined);
  extensions().onOpenChange(true);
  edit('/fi');
  assert.equal(extensions().open, false);
  assert.equal(menu().props.commands[0].name, 'file');
  h.dispatchDocument('focusin');
  assert.equal(menu(), undefined);
  assert.equal(textarea(h).props.value, '/fi');
});

test('a discovered DSH command runs through the scoped command API and saves its response', async () => {
  const agentId = 'fbbce833-544a-42a1-8579-cba2a817383e';
  const reply = { id: 'command-reply', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const calls = [];
  let saved;
  const h = harness({
    bridge: { companyRuntime: async () => ({ agentId }) },
    nativeDshBridge: {
      onUpdate: () => () => {},
      listCommands: async () => ({ commands: [{ name: 'compact', description: '压缩上下文', executable: true }] }),
      async executeCommand(input) { calls.push(input); return { ok: true, text: '上下文已压缩' }; },
      promptConversation() { assert.fail('a slash command must not submit a model prompt'); },
    },
    externalApi: {
      async beginExternalTurn(_id, input) {
        assert.equal(input.content, '/compact');
        return { turn_id: reply.id, user_message: message('command'), assistant_message: reply, conversation: first };
      },
      async finishExternalTurn(_id, _turn, result) {
        saved = result;
        return { message: { ...reply, content: result.content, status: result.status }, conversation: first };
      },
    },
  });
  await flush();
  textarea(h).props.onChange({ target: { value: '/compact' } });
  h.render();
  h.flushEffects();
  await flush();
  assert.equal(h.find('ComposerCommands').props.commands[0].native, true);
  pressEnter(h);
  await flush();
  assert.equal(calls[0].line, '/compact');
  assert.equal(calls[0].turnId, reply.id);
  assert.equal(calls[0].conversationId, first.id);
  assert.equal(saved.content, '上下文已压缩');
  assert.equal(saved.status, 'complete');
});

test('plan and goal actions live directly in the plus menu without adding toolbar buttons', async () => {
  const h = harness({
    bridge: { companyRuntime: async () => ({ agentId: 'fbbce833-544a-42a1-8579-cba2a817383e' }) },
    nativeDshBridge: { taskState: async () => ({}), executeCommand() {} },
  });
  await flush();
  const addition = h.find('Dropdown', props => props.children?.props.title === '添加文件或运行命令');
  assert(!h.find('Button', props => props.className === 'assistant-plan-mode'));
  assert(!addition.props.menu.items.some(item => item?.key === 'commands'));
  assert.equal(addition.props.menu.items.find(item => item?.key === 'plan').label, '计划模式');
  assert.equal(addition.props.menu.items.find(item => item?.key === 'goal').label, '设定目标');
  addition.props.menu.onClick({ key: 'goal' });
  assert.equal(h.find('ChatTaskControls').props.goalRequest, 1);
  textarea(h).props.onChange({ target: { value: '/go' } });
  assert.equal(h.find('ComposerCommands').props.commands[0].name, 'goal');
});

test('workspace opens for the current chat without modifying or dispatching the draft', async () => {
  const h = harness({ projectBridge: {} });
  await flush();
  assert(!h.find('ChatWorkspacePanel'));
  button(h, '工作区').props.onClick();
  const panel = h.find('ChatWorkspacePanel');
  assert.equal(panel.props.conversationId, first.id);
  textarea(h).props.onChange({ target: { value: '保留当前草稿' } });
  assert.equal(panel.props.onOpenTerminal, undefined);
  assert.equal(textarea(h).props.value, '保留当前草稿');
  assert.deepEqual(h.calls.sent, []);
  panel.props.onClose();
  assert(!h.find('ChatWorkspacePanel'));
});

test('the workspace link preference routes a reply link into the same conversation Web panel', async () => {
  const h = harness({ workspaceLinks: true, historyFor: () => [
    { ...message('link'), role: 'assistant', content: '[帮助](https://example.com/)' },
  ] });
  await flush();
  const markdown = h.all().find(node => node.props?.onOpenExternalLink);
  assert(markdown);
  markdown.props.onOpenExternalLink('https://example.com/');
  const panel = h.find('ChatWorkspacePanel');
  assert.equal(panel.props.webRequest.url, 'https://example.com/');
  assert.equal(panel.props.conversationId, first.id);
  assert.deepEqual(h.calls.sent, []);
});

test('worktree management starts from the conversation title menu and retains the draft', async () => {
  const h = harness({ projectBridge: { createWorktree: async () => {} } });
  h.setWorkspace('ws_123456789abc');
  await flush();
  textarea(h).props.onChange({ target: { value: '当前草稿' } });
  assert(!h.find('ChatWorktree'));
  const titleMenu = h.find('Dropdown', props => props.menu?.items.some(item => item?.key === 'worktree'));
  assert.equal(titleMenu.props.menu.items.find(item => item.key === 'worktree').label, '创建会话工作树');
  titleMenu.props.menu.onClick({ key: 'worktree' });
  assert.equal(h.find('ChatWorktree').props.conversationId, first.id);
  h.find('ChatWorktree').props.onOpenChange(false);
  assert(!h.find('ChatWorktree'));
  assert.equal(textarea(h).props.value, '当前草稿');
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
    nativeDshBridge: bridge,
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
  await send('默认 Agent');
  assert.equal(reserved[0].agent_id, companyId);
  assert.equal(reserved[0].agent_name, '默认 Agent');
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

test('company chat uses native DSH for text, attachments, and approvals', async () => {
  const agentId = 'fbbce833-544a-42a1-8579-cba2a817383e';
  const reply = { id: 'native-answer', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const requested = [];
  const acp = [];
  const decisions = [];
  const reserved = [];
  let listener, saved, completePrompt;
  const h = harness({
    vision: true,
    bridge: {
      companyRuntime: async () => ({ agentId }),
      onUpdate() { return () => {}; },
      async promptConversation(request) {
        acp.push(request);
        return { text: 'ACP 回答', stopReason: 'end_turn' };
      },
    },
    nativeDshBridge: {
      onUpdate(callback) { listener = callback; return () => { listener = undefined; }; },
      async respondPermission(...decision) { decisions.push(decision); completePrompt(); },
      async promptConversation(input) {
        requested.push(input);
        if (requested.length === 3) {
          listener({ conversationId: first.id, text: '', acpTool: {
            id: 'task-a', title: '检查项目', kind: 'subagent', status: 'in_progress',
          } });
          listener({ conversationId: first.id, text: '', acpTool: {
            id: 'task-a-command', parent_id: 'task-a', title: '检查工作目录', kind: 'execute', status: 'in_progress',
          } });
          listener({ conversationId: first.id, text: '', acpPermission: { requestId: 'native-write-confirmation', title: '确认更改文件',
            kind: 'edit', options: [{ id: 'approve', name: '允许', kind: 'allow_once' }] } });
          await new Promise(resolve => { completePrompt = resolve; });
          listener({ conversationId: first.id, text: '', acpTool: {
            id: 'task-a-command', title: '检查工作目录', kind: 'execute', status: 'completed',
          } });
        }
        listener({ conversationId: first.id, text: '原生回答', acpStage: 'responding' });
        return { text: '原生回答', modelName: 'native-model', stopReason: 'end_turn' };
      },
    },
    externalApi: {
      async beginExternalTurn(_id, input) {
        reserved.push(input);
        return { turn_id: reply.id, user_message: message('question'), assistant_message: reply, conversation: first };
      },
      async finishExternalTurn(_id, _turn, result) {
        saved = result;
        return { message: { ...reply, status: result.status, content: result.content }, conversation: first };
      },
    },
  });
  await flush();
  assert.equal(containsText(h, 'DSH 原生'), false);
  textarea(h).props.onChange({ target: { value: '测试原生 DSH' } });
  pressEnter(h);
  await flush();
  assert.equal(requested[0].text, undefined);
  assert.equal(requested[0].turnId, reply.id);
  assert.equal(requested[0].agentId, agentId);
  assert.equal(saved.content, '原生回答');
  assert.equal(saved.status, 'complete');
  assert.equal(acp.length, 0);
  textarea(h).props.onPaste({ clipboardData: { items: [{ kind: 'file', type: 'image/png',
    getAsFile: () => new File(['image'], 'preview.png', { type: 'image/png' }) }] }, preventDefault() {} });
  await flush();
  pressEnter(h);
  await flush();
  assert.equal(requested.length, 2);
  assert.equal(reserved[1].attachments[0].name, 'preview.png');
  assert.equal(saved.content, '原生回答');
  h.find('PermissionSwitch').props.onChange('workspace_write');
  textarea(h).props.onChange({ target: { value: '需确认后再修改' } });
  pressEnter(h);
  await flush();
  assert.equal(acp.length, 0);
  assert.equal(requested.length, 3);
  assert.equal(h.find('ExecutionDetails').props.execution.steps[1].parent_id, 'task-a');
  await h.find('ActionApproval').props.onRespond('approve');
  await flush();
  assert.deepEqual(decisions, [[first.id, 'native-write-confirmation', 'approve']]);
  assert.equal(saved.execution.approvals[0].status, 'approved');
  assert.equal(saved.execution.steps[1].parent_id, 'task-a');
  assert.equal(saved.execution.steps[1].status, 'completed');
});

test('company model and advertised reasoning effort reach the reserved native turn', async () => {
  const agentId = 'fbbce833-544a-42a1-8579-cba2a817383e';
  const configurations = [];
  const reply = { id: 'company-reply', role: 'assistant', content: '', status: 'streaming', created_at: 1 };
  const h = harness({
    bridge: { companyRuntime: async () => ({ agentId }) },
    nativeDshBridge: {
      onUpdate: () => () => {},
      promptConversation: async () => ({ text: '已回复', stopReason: 'end_turn' }),
    },
    externalApi: {
      listProviders: async () => ({ company_models: [
        { model: 'mock-only', vision: false, reasoning_efforts: ['low'] },
        { model: 'deepseek-v4-pro', vision: true, reasoning_efforts: ['none', 'high', 'max'] },
      ] }),
      async beginExternalTurn(_id, input) {
        configurations.push(input);
        return { turn_id: reply.id, user_message: message('requested'), assistant_message: reply, conversation: first };
      },
      async finishExternalTurn(_id, _turn, result) {
        return { message: { ...reply, status: result.status, content: result.content }, conversation: first };
      },
    },
  });
  await flush();
  const picker = () => h.find('ModelSwitch').props;
  picker().onCompanyModel('deepseek-v4-pro');
  picker().agentReasoning.onChange('max');
  textarea(h).props.onChange({ target: { value: '分析' } });
  pressEnter(h);
  await flush();
  assert.equal(configurations[0].company_model, 'deepseek-v4-pro');
  assert.equal(configurations[0].reasoning_effort, 'max');
});

test('a timed-out question retains its draft and reserves a native late-answer turn without replacing the composer', async () => {
  const agentId = 'fbbce833-544a-42a1-8579-cba2a817383e';
  const nativeCalls = [];
  const reservations = [];
  let listener, finishInitial;
  const questions = [{ id: 'mode', question: '使用哪种格式？' }];
  const h = harness({
    bridge: { companyRuntime: async () => ({ agentId }), onUpdate: () => () => {} },
    nativeDshBridge: {
      onUpdate(callback) { listener = callback; return () => {}; },
      respondQuestion() { assert.fail('a late answer uses a separately reserved native turn'); },
      holdQuestion: async () => {},
      async promptConversation(input) {
        nativeCalls.push(input);
        if (nativeCalls.length === 1) {
          listener({ conversationId: first.id, text: '', dshQuestion: { requestId: 'native-question', questions, expiresAt: Date.now() + 1000, phase: 'open' } });
          await new Promise(resolve => { finishInitial = resolve; });
        }
        return { text: '已回复', stopReason: 'end_turn' };
      },
    },
    externalApi: {
      async beginExternalTurn(_id, input) {
        reservations.push(input);
        const reply = { id: 'q-reply-' + reservations.length, role: 'assistant', content: '', status: 'streaming', created_at: 1 };
        return { turn_id: reply.id, user_message: { ...message('u-' + reservations.length), role: 'user' }, assistant_message: reply, conversation: first };
      },
      async finishExternalTurn(_id, turnId, result) {
        return { message: { id: turnId, role: 'assistant', content: result.content, status: result.status, created_at: 1 }, conversation: first };
      },
    },
  });
  await flush();
  textarea(h).props.onChange({ target: { value: '请整理文件' } });
  pressEnter(h);
  await flush();
  const answers = [{ id: 'mode', selected: [], custom: 'Markdown' }];
  h.find('AgentQuestions').props.onDraftChange(answers);
  assert.equal(h.find('ModelSwitch').props.disabled, false);
  assert.equal(button(h, '添加文件').props.disabled, false);
  h.setVisible(false);
  const reminder = h.find('Dropdown', props => props.children?.props.title === '查看待处理的会话提醒');
  assert.match(reminder.props.menu.items[0].label, /^等待回答/);
  reminder.props.menu.onClick({ key: first.id });
  assert.equal(h.calls.opened, 1);
  h.setVisible(true);
  listener({ conversationId: first.id, text: '', dshQuestion: { requestId: 'native-question', questions, phase: 'continued' } });
  finishInitial();
  await flush();
  assert.deepEqual(h.find('AgentQuestions').props.initialAnswers, answers);
  textarea(h).props.onChange({ target: { value: '另一条草稿' } });
  await h.find('AgentQuestions').props.onRespond(answers);
  await flush();
  assert.equal(nativeCalls[1].questionReply.requestId, 'native-question');
  assert.deepEqual(nativeCalls[1].questionReply.answers, answers);
  assert.match(reservations[1].content, /补充回答任务问题.*Markdown/s);
  assert.equal(textarea(h).props.value, '另一条草稿');
  assert.equal(h.find('AgentQuestions'), undefined);
});

test('reopened conversation restores text and the draft for the same native question', async () => {
  const answer = [{ id: 'format', selected: [], custom: '草稿回答' }];
  const image = { name: '恢复.png', data_url: 'data:image/png;base64,AA==', mime: 'image/png', size: 1, width: 1, height: 1 };
  const writes = [];
  const h = harness({ nativeDshBridge: {
    async getDraft() { return { text: '保留的消息', questionId: 'reopened', answers: answer, attachments: [image] }; },
    async recoverQuestions() { return [{ requestId: 'reopened', phase: 'continued', questions: [{ id: 'format', question: '格式？' }] }]; },
    async saveDraft(id, draft) { writes.push([id, draft]); },
  } });
  await flush();
  h.render();
  h.flushEffects();
  await flush();
  assert.equal(textarea(h).props.value, '保留的消息');
  assert.equal(h.find('img', props => props.alt === image.name).props.src, image.data_url);
  assert.deepEqual(h.find('AgentQuestions').props.initialAnswers, answer);
  textarea(h).props.onChange({ target: { value: '追加文本' } });
  assert.equal(writes[0][0], first.id);
  assert.equal(writes[0][1].text, '追加文本');
  assert.equal(writes[0][1].questionId, 'reopened');
  assert.deepEqual(writes[0][1].attachments, [image]);
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
  assert(h.find('button', props => props.className === 'assistant-token-usage').props['aria-label'].includes('缓存命中 50%'));
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
  textarea(h).props.onChange({ target: { value: '请委派任务' } });
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
