import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { activeTaskStates, imageArtifact, safeArtifactUrl, taskLabels } from '../src/deepAnalysisApi.mjs';
import * as format from '../src/format.mjs';
import * as errors from '../src/errors.mjs';
const require = createRequire(new URL('../package.json', import.meta.url)), ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/DeepAnalysis.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
function harness({ failUpload = false, failCreate = false, connection, statusError, ready = false, getTask } = {}) {
  let cursor = 0, mounted = false; const state = [], effects = [], calls = { uploaded: [], created: [] }, store = new Map();
  const react = { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; }, useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; }, useEffect(effect) { cursor++; if (!mounted) effects.push(effect); } };
  const api = { activeTaskStates, taskLabels, imageArtifact, safeArtifactUrl,
    deepStatus: async () => { if (statusError) throw Error(statusError); return { configured: ready, execution_ready: ready, docker_available: ready, image_ready: ready, execution_reason: ready ? '' : 'Docker尚未就绪' }; },
    uploadAnalysisFile: async file => { calls.uploaded.push(file); if (failUpload) throw Error('CSV解析失败'); return { id: 'local-file', name: file.name, size: file.size, row_count: 560, columns: ['synthetic', 'userid'], sha256: 'hash' }; },
    createAnalysisTask: async (file, question) => { calls.created.push({ file, question }); if (failCreate) throw Error('请求失败'); return { id: 'blocked-task', file_id: file, question, status: 'blocked', updated_at: 1, error: 'Docker尚未就绪', answer: '', steps: [], artifacts: [] }; },
    getAnalysisTask: getTask || (async () => { throw Error('missing'); }), cancelAnalysisTask: async () => { throw Error('unexpected'); },
  };
  const antd = Object.fromEntries(['Alert', 'Button', 'Card', 'Collapse', 'Empty', 'Space', 'Spin', 'Tag'].map(name => [name, name])); antd.Empty = Object.assign('Empty', { PRESENTED_IMAGE_SIMPLE: 'simple' }); antd.Input = { TextArea: 'TextArea' };
  const events = new Map();
  const browser = {
    setTimeout, clearTimeout, location: { hash: '' },
    addEventListener: (type, listener) => events.set(type, listener),
    removeEventListener: type => events.delete(type),
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : name === 'antd' ? antd : name === '@ant-design/icons' ? new Proxy({}, { get: (_, key) => key }) : name === './deepAnalysisApi.mjs' ? api : name === './taskAttention' ? { watchAnalysisTask: () => {} } : name === './MarkdownView' ? { Markdown: 'Markdown' } : name === './format.mjs' ? format : name === './errors.mjs' ? errors : name.endsWith('.css') ? {} : (() => { throw Error(name); })(), AbortController, window: browser, localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }, Date, Error, console });
  const render = () => { cursor = 0; const result = exports.DeepAnalysis({ dataConnection: connection }); mounted = true; return result; }; render(); effects.forEach(effect => effect());
  return {
    calls, store, render,
    openTaskLink(id) { browser.location.hash = '#deep-analysis?task=' + id; events.get('hashchange')?.(); },
    find: (type, check = () => true) => nodes(render()).find(node => node.type === type && check(node.props)),
    all: () => nodes(render()),
  };
}
const createButton = h => h.find('Button', props => props.children === '创建试用任务（检查条件）');
async function upload(h) { h.find('input').props.onChange({ target: { files: [{ name: 'synthetic.csv', size: 100 }], value: 'value' } }); await flush(); }

test('a task link reopens the correct result on an already mounted analysis page', async () => {
  const first = 'a'.repeat(32), second = 'b'.repeat(32);
  const requests = [];
  const h = harness({ getTask: async id => {
    requests.push(id);
    return { id, status: 'complete', question: id, updated_at: 1, answer: 'Saved result ' + id };
  } });
  h.openTaskLink(first);
  await flush();
  assert.equal(h.find('Markdown').props.text, 'Saved result ' + first);
  h.openTaskLink(second);
  await flush();
  assert.equal(h.find('Markdown').props.text, 'Saved result ' + second);
  assert.deepEqual(requests, [first, second]);
});

test('real page allows a readiness-check task with local CSV, then displays blocked without a fabricated answer', async () => {
  const h = harness(); await flush(); assert.equal(createButton(h).props.disabled, true);
  await upload(h); assert.equal(createButton(h).props.disabled, true);
  h.find('TextArea').props.onChange({ target: { value: '分析一下' } });
  assert.equal(createButton(h).props.disabled, false);
  createButton(h).props.onClick(); await flush();
  assert.equal(h.calls.created.length, 1); assert.equal(h.calls.created[0].file, 'local-file');
  assert.equal(h.store.get('ya70-deep-analysis-last-task'), 'blocked-task');
  assert(h.all().some(node => node.type === 'Tag' && node.props.children === '条件未就绪'));
  assert(h.all().some(node => node.type === 'Alert' && node.props.message === 'Docker尚未就绪'));
  assert(!h.all().some(node => node.type === 'Markdown'));
  await upload(h); assert(!h.all().some(node => node.type === 'Tag' && node.props.children === '条件未就绪'));
  assert.equal(h.store.has('ya70-deep-analysis-last-task'), false); // New data must not inherit the prior file's result.
});

test('real page preserves selected file and question on task failure and never sends an empty question', async () => {
  const h = harness({ failCreate: true }); await flush(); await upload(h);
  const text = '只分析合成数据'; h.find('TextArea').props.onChange({ target: { value: text } });
  createButton(h).props.onClick(); await flush();
  assert.equal(h.find('TextArea').props.value, text);
  assert(h.all().some(node => node.props?.children?.includes?.('synthetic.csv')));
  assert(h.find('Alert', props => props.message === '请求失败'));
  h.find('TextArea').props.onChange({ target: { value: ' ' } }); assert.equal(createButton(h).props.disabled, true);
});

test('remote file selection stays blocked on denied permission and shows the upload destination when ready', async () => {
  const connection = { mode: 'remote', url: 'https://analysis.example.test' };
  const denied = harness({ connection, statusError: '当前访问令牌未获准使用远程深度分析。' });
  await flush();
  assert.equal(denied.find('Button', props => props.children === '选择并上传 CSV / Excel').props.disabled, true);
  assert(denied.find('Alert', props => props.message === '当前访问令牌未获准使用远程深度分析。'));
  await upload(denied);
  assert.equal(denied.calls.uploaded.length, 0);

  const allowed = harness({ connection, ready: true });
  await flush();
  const notice = allowed.find('Alert', props => props.message === '所选文件会上传到远程分析主机');
  assert(JSON.stringify(notice.props.description).includes(connection.url));
  assert.equal(allowed.find('Button', props => props.children === '选择并上传 CSV / Excel').props.disabled, false);
  await upload(allowed);
  assert.equal(allowed.calls.uploaded.length, 1);
});
