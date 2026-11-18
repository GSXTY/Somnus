import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/DocumentLibrary.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
  node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));
const personalDocumentsChangedEvent = 'somnus:personal-documents-changed';

function harness(bridge, picker, window = new EventTarget()) {
  let index = 0;
  const state = [];
  const exports = {};
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
    },
    useRef(current) { return state[index++] ??= { current }; },
    useEffect(effect, deps) {
      const slot = index++;
      const current = state[slot];
      if (current?.deps.every((value, key) => value === deps[key])) return;
      current?.cleanup?.();
      state[slot] = { deps, cleanup: effect() };
    },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    antd: Object.fromEntries(['Alert', 'Button', 'Empty', 'Input', 'Modal', 'Spin', 'Tag'].map(name => [name, name])),
    '@ant-design/icons': new Proxy({}, { get: (_, name) => String(name) }),
    './errors.mjs': { describeError: error => error.message },
    './documentLibraryBridge': { documentBridge: () => bridge, personalDocumentsChangedEvent },
  };
  vm.runInNewContext(compiled, { exports, window, require: name => imports[name] });
  const browsers = nodes(picker ? exports.DocumentPicker(picker) : exports.DocumentLibrary()).filter(node => typeof node.type === 'function');
  return scope => {
    const browser = browsers.find(node => node.props.scope === scope);
    return () => {
      index = 0;
      const results = nodes(browser.type(browser.props));
      return (type, match = () => true) => results.find(node => node.type === type && match(node.props));
    };
  };
}

const folder = { name: '参考资料', path: '参考资料', kind: 'folder' };
const file = { name: 'notes.md', path: '参考资料/notes.md', kind: 'file' };
const shared = { name: '模板.md', path: '模板.md', kind: 'file' };

test('library keeps Windows imports in the current private folder and opens shared documents', async () => {
  const calls = [];
  const bridge = {
    list: async (scope, path) => ({ folder: path, entries: scope === 'shared' ? [shared] : path ? [] : [folder] }),
    importFiles: async path => { calls.push(['import', path]); return { folder: path, entries: [file] }; },
    createFolder: async (path, name) => {
      calls.push(['create', path, name]);
      return { folder: path, entries: [file, { name, path: path + '/' + name, kind: 'folder' }] };
    },
    openFile: async (scope, path) => { calls.push(['open', scope, path]); },
  };
  const library = harness(bridge);
  const personal = library('private');
  personal();
  await settle();
  personal()('button').props.onClick();
  personal();
  await settle();
  personal()('Button', props => props.children === '导入文件').props.onClick();
  await settle();
  personal()('Button', props => props.children === '新建文件夹').props.onClick();
  personal()('Input').props.onChange({ target: { value: '子目录' } });
  await personal()('Modal').props.onOk();
  assert.deepEqual(calls, [['import', folder.path], ['create', folder.path, '子目录']]);

  const sharedView = harness(bridge)('shared');
  sharedView();
  await settle();
  assert.equal(sharedView()('Button', props => props.children === '导入文件'), undefined);
  assert.equal(sharedView()('Button', props => props.children === '新建文件夹'), undefined);
  sharedView()('button').props.onClick();
  await settle();
  assert.deepEqual(calls.at(-1), ['open', 'shared', shared.path]);
});

test('project folder picker uses only personal folders and requires a named folder', async () => {
  const calls = [];
  const picker = harness({
    list: async (scope, path) => { calls.push([scope, path]); return { folder: path, entries: path ? [file] : [folder] }; },
  }, { open: true, kind: 'folder', onClose() {}, onPick: (scope, selected) => calls.push([scope, selected.path]) })('private');
  picker();
  await settle();
  assert.equal(picker()('Button', props => props.children === '选择此文件夹'), undefined);
  picker()('button').props.onClick();
  picker();
  await settle();
  assert.equal(picker()('button'), undefined);
  picker()('Button', props => props.children === '选择此文件夹').props.onClick();
  assert.deepEqual(calls, [['private', ''], ['private', folder.path], ['private', folder.path]]);
});

test('personal document actions create inside the open folder and delete only after confirmation', async () => {
  const calls = [];
  const bridge = {
    list: async (scope, path) => ({ folder: path, entries: scope === 'shared' ? [shared] : path ? [] : [folder] }),
    createFile: async (path, name, content) => {
      calls.push(['create', path, name, content]);
      return { folder: path, entries: [file] };
    },
    deleteEntry: async path => {
      calls.push(['delete', path]);
      return { folder: folder.path, entries: [] };
    },
  };
  const personal = harness(bridge)('private');
  personal();
  await settle();
  personal()('button').props.onClick();
  personal();
  await settle();
  personal()('Button', props => props.children === '新建文件').props.onClick();
  personal()('Input').props.onChange({ target: { value: file.name } });
  await personal()('Modal').props.onOk();
  const remove = () => personal()('Button', props => props['aria-label'] === '移到回收站 ' + file.name);
  remove().props.onClick();
  personal()('Modal').props.onCancel();
  assert.deepEqual(calls, [['create', folder.path, file.name, '']]);
  remove().props.onClick();
  await personal()('Modal').props.onOk();
  assert.deepEqual(calls.at(-1), ['delete', file.path]);
  assert.equal(remove(), undefined);

  const sharedView = harness(bridge)('shared');
  sharedView();
  await settle();
  assert.equal(sharedView()('Button', props => props.children === '新建文件'), undefined);
  assert.equal(sharedView()('Button', props => props.danger), undefined);
});

test('an approved write refreshes private document views without reloading shared documents', async () => {
  const events = new EventTarget();
  const calls = [];
  let freshEntries = [];
  const bridge = {
    list: async (scope, path) => {
      calls.push(scope);
      return { folder: path, entries: scope === 'private' ? freshEntries : [shared] };
    },
  };
  const personal = harness(bridge, undefined, events)('private');
  const sharedView = harness(bridge, undefined, events)('shared');
  personal();
  sharedView();
  await settle();
  assert.equal(personal()('button'), undefined);
  freshEntries = [file];
  events.dispatchEvent(new Event(personalDocumentsChangedEvent));
  personal();
  sharedView();
  await settle();
  assert.equal(personal()('button').props.children[1].props.children, file.name);
  assert.deepEqual(calls, ['private', 'shared', 'private']);
});
