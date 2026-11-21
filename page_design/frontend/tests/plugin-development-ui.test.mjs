import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/plugins/PluginDevelopment.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
  node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));

test('plugin development separates checks, local trial install and exportable review candidates', async () => {
  const state = [], effects = [], calls = [], exports = {};
  let cursor = 0;
  const template = { name: '', version: '1.0.0', skill_ids: [] };
  const draft = { name: '测试插件', version: '1.1.0', skill_ids: ['skill-1'] };
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
    },
    useRef(initial) { return state[cursor++] ??= { current: initial }; },
    useEffect(effect) { const slot = cursor++; if (!state[slot]) { state[slot] = true; effects.push(effect); } },
  };
  const jsx = (type, props) => ({ type, props });
  const antd = { Alert: 'Alert', Button: 'Button', Input: { TextArea: 'Editor' }, Modal: 'Modal', Tag: 'Tag' };
  const api = {
    pluginDevelopmentTemplate: async () => template,
    listPluginCandidates: async () => [],
    isPortablePluginPackage: value => Boolean(value?.format),
    async preflightPortablePlugin(value) {
      calls.push('check-package');
      return { ok: true, manifest: value.manifest, checks: [] };
    },
    async importPortablePlugin(value) {
      calls.push('install-package');
      return { ...value.manifest, id: 'portable', enabled: false };
    },
    async preflightPlugin(manifest) {
      calls.push('check');
      return manifest.name ? { ok: true, manifest, checks: [{ id: 'version', status: 'pass', message: '版本正确' }] } :
        { ok: false, checks: [{ id: 'manifest', status: 'fail', message: '请填写名称' }] };
    },
    async importPlugin(manifest) { calls.push('install'); return { ...manifest, id: 'personal', enabled: false }; },
    async createPluginCandidate(manifest) {
      calls.push('candidate');
      return { id: 'review', manifest, sha256: 'review-hash', report: { ok: true, checks: [] } };
    },
  };
  const imports = { react, antd, './assistantApi': api, './errors.mjs': { describeError: error => error.message }, 'react/jsx-runtime': { jsx, jsxs: jsx } };
  vm.runInNewContext(compiled, { exports, window: {}, AbortController, require: name => (imports[name] ?? (name.startsWith('.') ? Object.entries(imports).find(([key]) => key.startsWith('.') && key.split('/').at(-1) === name.split('/').at(-1))?.[1] : undefined)) });
  const render = () => {
    cursor = 0;
    return nodes(exports.PluginDevelopment({ owner: true, skills: [], mcp: [], onClose() {}, onInstalled: plugin => calls.push(plugin.id) }));
  };
  const button = text => render().find(node => node.type === 'Button' && node.props.children === text);
  const editor = () => render().find(node => node.type === 'Editor');
  render();
  effects.splice(0).forEach(effect => effect());
  await settle();
  assert.deepEqual(JSON.parse(editor().props.value), template);
  assert.equal(button('试装到个人插件').props.disabled, true);
  button('检查插件').props.onClick();
  await settle();
  const checks = render().find(node => node.type?.name === 'Checks');
  assert.equal(checks.props.report.checks[0].message, '请填写名称');
  assert.deepEqual(calls, ['check']);
  editor().props.onChange({ target: { value: JSON.stringify(draft) } });
  button('检查插件').props.onClick();
  await settle();
  button('试装到个人插件').props.onClick();
  await settle();
  button('生成默认插件候选').props.onClick();
  await settle();
  assert.deepEqual(calls, ['check', 'check', 'install', 'personal', 'candidate']);
  assert(button('导出审阅文件'));
  assert(render().some(node => node.type === 'code' && node.props.children === 'review-hash'));
  editor().props.onChange({ target: { value: '{}' } });
  assert.equal(button('生成默认插件候选').props.disabled, true);
  editor().props.onChange({ target: { value: JSON.stringify({ format: 'somnus.plugin.v1', manifest: draft }) } });
  button('检查插件').props.onClick();
  await settle();
  assert.equal(button('生成默认插件候选').props.disabled, true);
  button('试装到个人插件').props.onClick();
  await settle();
  assert.deepEqual(calls.slice(-3), ['check-package', 'install-package', 'portable']);
});
