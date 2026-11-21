import { componentSourceUrl } from './source-paths.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
  node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(file, name, context, api, props) {
  let index = 0;
  const hooks = [];
  const exports = {};
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in hooks)) hooks[slot] = initial;
      return [hooks[slot], value => { hooks[slot] = value; }];
    },
    useMemo(compute) { return compute(); },
    useEffect(effect, deps) {
      const slot = index++;
      const previous = hooks[slot];
      if (previous && deps.every((value, key) => value === previous.deps[key])) return;
      previous?.cleanup?.();
      hooks[slot] = { deps, cleanup: effect() };
    },
  };
  const jsx = (type, input) => ({ type, props: input });
  const modules = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, './assistantApi': api,
    antd: Object.fromEntries(['Alert', 'Button', 'Modal', 'Segmented', 'Space'].map(value => [value, value])),
    './fileProposalDiff': { unifiedFileDiff: () => [] },
    './documentLibraryBridge': { personalDocumentsChangedEvent: 'somnus:personal-documents-changed' },
  };
  const compiled = ts.transpileModule(readFileSync(componentSourceUrl(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, window: context, AbortController, Event, require: id => (modules[id] ?? (id.startsWith('.') ? Object.entries(modules).find(([key]) => key.startsWith('.') && key.split('/').at(-1) === id.split('/').at(-1))?.[1] : undefined)) });
  return (nextProps = props) => { index = 0; return exports[name](nextProps); };
}

test('current chat displays the authorized worktree root in place of registered project roots', async () => {
  const context = new EventTarget();
  context.vvmanProjects = { worktreeLocation: async () => 'C:/test/actual-worktree' };
  const conversation = { id: 'chat', permission_mode: 'workspace_write', worktree: { commit: 'example' } };
  const props = { workspace: 'project-id', conversation, visible: true };
  const render = harness('ChatProjectContext', 'ChatProjectContext', context, {
    workspaces: async () => [{ id: 'project-id', name: '当前测试项目', source_folders: ['C:/test/project'] }],
  }, props);
  render();
  await settle();
  let output = nodes(render());
  for (const expected of ['当前测试项目', 'C:/test/actual-worktree', '修改前确认']) {
    assert(output.some(node => node.props.children === expected));
  }
  assert(!output.some(node => node.props.children === 'C:/test/project'));
  output = nodes(render({ ...props, conversation: { ...conversation, worktree: null } }));
  assert(output.some(node => node.props.children === 'C:/test/project'));
});

test('approval keeps saved proposal visible and opens by conversation and proposal IDs', async () => {
  const context = new EventTarget();
  const calls = [];
  context.vvmanProjects = { async openApprovedFile(...args) { calls.push(['open', ...args]); } };
  context.addEventListener('somnus:personal-documents-changed', () => calls.push(['refresh']));
  const preview = { id: 'proposal', status: 'pending', operation: 'create', path: 'docs/note.md',
    source_folder: 'C:\\test\\actual-worktree', old_content: '', new_content: '' };
  const render = harness('FileProposalReview', 'FileProposalReview', context, {
    async decideFileProposal(...args) { calls.push(args); return { ...preview, status: 'applied' }; },
  }, { conversationId: 'chat', preview, onClose() { calls.push(['close']); }, onDecision() {} });
  const action = text => nodes(render().props.footer).find(node => node.props.children === text);
  assert.equal(render().props.title, '审阅新建文件');
  action('批准并创建').props.onClick();
  await settle();
  const saved = render();
  assert.equal(saved.props.title, '文件已保存');
  assert(nodes(saved).some(node => node.type === 'code' && node.props.children === 'C:\\test\\actual-worktree\\docs\\note.md'));
  action('打开文件').props.onClick();
  await settle();
  assert.deepEqual(calls, [['chat', 'proposal', 'approve'], ['refresh'], ['open', 'chat', 'proposal']]);
});
