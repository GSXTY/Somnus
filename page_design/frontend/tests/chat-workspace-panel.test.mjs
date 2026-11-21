import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as widthPolicy from '../src/app/workspacePanelWidth.mjs';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/chat/ChatWorkspacePanel.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const descendants = node => Array.isArray(node) ? node.flatMap(descendants) :
  node && typeof node === 'object' ? [node, ...descendants(node.props.children)] : [];

function harness() {
  let index = 0;
  const hooks = [];
  const values = new Map();
  const container = { clientWidth: 1000 };
  let observer;
  const window = { vvmanProjects: {} };
  const exports = {};
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial) {
      const i = index++;
      return hooks[i] ??= { current: initial === null ? { parentElement: container } : initial };
    },
    useId: () => 'workspace',
    useEffect(effect) { const i = index++; if (!(i in hooks)) hooks[i] = effect(); },
  };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, antd: { Button: 'Button', Input: { Search: 'Search' } },
    './workspacePanelWidth.mjs': widthPolicy, './WorkspaceTerminal': { WorkspaceTerminal: 'WorkspaceTerminal' },
  };
  vm.runInNewContext(compiled, { exports, window, require: id => (modules[id] ?? (id.startsWith('.') ? Object.entries(modules).find(([key]) => key.startsWith('.') && key.split('/').at(-1) === id.split('/').at(-1))?.[1] : undefined)) ?? {},
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    ResizeObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
  });
  const props = { conversationId: 'chat', workspace: 'project', proposals: [], onClose() {} };
  return {
    render() { index = 0; return exports.ChatWorkspacePanel(props); },
    resize(available) { container.clientWidth = available; observer(); },
    savedWidth() { return values.get(widthPolicy.WORKSPACE_WIDTH_KEY); },
  };
}

test('workspace tabs mount only the selected view without a measured Ant tab strip', () => {
  const { render } = harness();
  const initial = descendants(render());
  assert(initial.some(node => node.props['aria-label'] === '新标签页'));
  assert(!initial.some(node => node.props['aria-label'] === '会话改动'));
  const changes = initial.find(node => node.props.role === 'tab' && node.props.children === '改动');
  changes.props.onClick();
  assert(descendants(render()).some(node => node.props['aria-label'] === '会话改动'));
  const files = initial.find(node => node.props.role === 'tab' && node.props.children === '文件');
  files.props.onClick();
  const next = descendants(render());
  assert(!next.some(node => node.props['aria-label'] === '会话改动'));
  assert(next.some(node => node.type?.name === 'WorkspaceFiles'));
  assert(!next.some(node => node.type === 'WorkspaceTerminal'));
});

test('terminal stays mounted while switching workspace tabs', () => {
  const { render } = harness();
  const initial = descendants(render());
  const tab = title => initial.find(node => node.props.role === 'tab' && node.props.children === title);
  tab('终端').props.onClick();
  assert.equal(descendants(render()).find(node => node.type === 'WorkspaceTerminal')?.props.visible, true);
  tab('文件').props.onClick();
  assert.equal(descendants(render()).find(node => node.type === 'WorkspaceTerminal')?.props.visible, false);
});

test('drag and keyboard resize clamp to the split width and persist only deliberate changes', () => {
  const panel = harness();
  const grip = () => descendants(panel.render()).find(node => node.props.role === 'separator').props;
  assert.equal(grip()['aria-valuenow'], 440);
  const event = { button: 0, pointerId: 1, clientX: 560, preventDefault() {},
    currentTarget: { setPointerCapture() {}, focus() {} } };
  grip().onPointerDown(event);
  grip().onPointerMove({ ...event, clientX: 320 });
  assert.equal(grip()['aria-valuenow'], 640);
  assert.equal(panel.savedWidth(), undefined);
  grip().onPointerUp({ ...event, type: 'pointerup', clientX: 320 });
  assert.equal(panel.savedWidth(), '640');
  panel.resize(500);
  assert.equal(grip()['aria-valuenow'], 260);
  panel.resize(1000);
  assert.equal(grip()['aria-valuenow'], 640);
  grip().onKeyDown({ key: 'Home', preventDefault() {} });
  assert.equal(grip()['aria-valuenow'], 280);
  assert.equal(panel.savedWidth(), '280');
});
