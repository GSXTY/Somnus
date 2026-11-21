import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/configuration/AppUpdateSettings.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

const create = (type, props) => ({ type, props });
const settle = () => new Promise(resolve => setImmediate(resolve));
function find(node, type) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  return node.type === type ? node : find(node.props.children, type);
}
function harness(bridge) {
  const state = [], effects = [], exports = {};
  let index = 0;
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => { state[slot] = value; }];
    },
    useRef(initial) {
      const slot = index++;
      return state[slot] ??= { current: initial };
    },
    useEffect(effect) { if (!effects.length) effects.push(effect); },
  };
  const imports = {
    react,
    'react/jsx-runtime': { jsx: create, jsxs: create },
    antd: { Alert: 'Alert', Button: 'Button', Progress: 'Progress' },
    './errors.mjs': { describeError: (error, fallback) => error.message || fallback },
  };
  vm.runInNewContext(compiled, { exports, window: { somnusUpdater: bridge }, require: name => (imports[name] ?? (name.startsWith('.') ? Object.entries(imports).find(([key]) => key.startsWith('.') && key.split('/').at(-1) === name.split('/').at(-1))?.[1] : undefined)) });
  function render() { index = 0; return exports.AppUpdateSettings(); }
  render();
  const cleanup = effects[0]?.();
  return { render, cleanup, find: type => find(render(), type) };
}

test('About updates read status, wait for each user action, and show download progress', async () => {
  const actions = [];
  let publish;
  const currentVersion = '1.0.0';
  const bridge = {
    getState: async () => ({ phase: 'idle', currentVersion }),
    subscribe(callback) { publish = callback; return () => { actions.push('unsubscribe'); }; },
    async check() { actions.push('check'); return { phase: 'available', currentVersion, version: '1.1.0' }; },
    async download() {
      actions.push('download');
      publish({ phase: 'downloading', currentVersion, version: '1.1.0', percent: 44.4 });
      return { phase: 'downloaded', currentVersion, version: '1.1.0' };
    },
    async install() { actions.push('install'); return { phase: 'downloaded', currentVersion, version: '1.1.0' }; },
  };
  const view = harness(bridge);
  await settle();
  assert.deepEqual(actions, []);
  assert.equal(view.find('Button').props.children, '检查更新');
  view.find('Button').props.onClick();
  await settle();
  assert.equal(view.find('Button').props.children, '下载更新');
  assert.deepEqual(actions, ['check']);
  view.find('Button').props.onClick();
  assert.equal(view.find('Progress').props.percent, 44);
  publish({ phase: 'downloaded', currentVersion, version: '1.1.0' });
  await settle();
  assert.equal(view.find('Button').props.children, '重启并更新');
  assert.deepEqual(actions, ['check', 'download']);
  view.find('Button').props.onClick();
  await settle();
  view.cleanup();
  assert.deepEqual(actions, ['check', 'download', 'install', 'unsubscribe']);
  assert.equal(harness(undefined).render(), null);
  const unconfigured = harness({ ...bridge, getState: async () => ({ phase: 'unconfigured', currentVersion }) });
  await settle();
  assert.equal(unconfigured.find('Button').props.children, '检查更新');
  assert.equal(unconfigured.find('Button').props.disabled, true);
});

test('A channel with no Windows release allows another manual check', async () => {
  const currentVersion = '1.0.0';
  const noRelease = { phase: 'no-release', currentVersion };
  let checks = 0;
  const view = harness({
    getState: async () => ({ phase: 'idle', currentVersion }),
    subscribe: () => () => {},
    async check() { checks++; return noRelease; },
    async download() { assert.fail('No release to download'); },
    async install() { assert.fail('No release to install'); },
  });
  await settle();
  view.find('Button').props.onClick();
  await settle();
  assert.equal(view.find('p').props.children, '尚未发布 Windows 安装包。');
  assert.equal(view.find('Button').props.children, '检查更新');
  assert.equal(view.find('Button').props.disabled, false);
  view.find('Button').props.onClick();
  await settle();
  assert.equal(checks, 2);
  view.cleanup();
});
