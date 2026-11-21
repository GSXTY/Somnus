import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/configuration/Models.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const catalogExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/configuration/modelProviderCatalog.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: catalogExports });
const settle = () => new Promise(resolve => setImmediate(resolve));

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value?.props ? [value, ...nodes(value.props.children)] : [];
}

test('Windows Provider setup ignores the legacy default and saves explicit catalog and custom configurations', async () => {
  const company = { id: 'deepseek', name: '公司默认', model: 'deepseek-flash', base_url: 'https://api.deepseek.com',
    builtin: true, requires_api_key: true, configured: false, api_key_masked: '未配置' };
  const providers = [company];
  const saves = [];
  const tested = [];
  const exports = {};
  const state = [];
  let cursor = 0;
  let mounted = false;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useRef(initial) { const slot = cursor++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
        useState(initial) {
          const slot = cursor++;
          if (!(slot in state)) state[slot] = initial;
          return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
        },
        useEffect(effect) {
          if (!mounted) { mounted = true; effect(); }
        },
      };
      if (name === 'antd') return { Button: 'Button', Alert: 'Alert', Input: { Password: 'Password' }, Modal: 'Modal',
        Checkbox: 'Checkbox', Popconfirm: 'Popconfirm', Select: 'Select', Segmented: 'Segmented', Spin: 'Spin', Tag: 'Tag' };
      if (name === '@ant-design/icons') return { ApiOutlined: 'ApiOutlined', PlusOutlined: 'PlusOutlined', SearchOutlined: 'SearchOutlined' };
      if (name.split('/').at(-1) === 'assistantApi') return {
        listProviders: async () => ({ active: 'deepseek', providers }),
        saveCompanyProvider: async () => assert.fail('Windows setup must not change built-in credentials'),
        saveModel: async fields => {
          saves.push({ ...fields });
          const row = { ...fields, id: 'configured-' + saves.length, configured: true };
          providers.push(row);
          return row;
        },
        testModelConnection: async id => { tested.push(id); return { ok: true, message: '可用', elapsed_ms: 0 }; },
      };
      if (name.split('/').at(-1) === 'modelProviderCatalog') return catalogExports;
      if (name.split('/').at(-1) === 'errors.mjs') return { describeError: err => err.message };
      return {};
    },
    AbortController,
  });
  function view(windowsDesktop = true) {
    cursor = 0;
    return nodes(exports.Models({ windowsDesktop }));
  }
  const node = (type, condition = () => true) => view().find(item => item.type === type && condition(item.props));
  const button = label => node('Button', props => props.children === label);
  view();
  await settle();
  assert(!node('h2', props => props.children === 'DeepSeek'));
  assert(node('h2', props => props.children === '还没有配置供应商'));
  assert(!button('更换 API Key'));
  node('Button', props => props['aria-label'] === '添加供应商').props.onClick();
  const modal = () => node('Modal', props => props.open);
  const field = label => nodes(modal()).find(item => item.type === 'label' && item.props.children[0] === label)?.props.children[1];
  const type = (label, value) => field(label).props.onChange({ target: { value } });
  const mode = () => node('Segmented', props => props['aria-label'] === '供应商添加方式');
  assert.equal(mode().props.value, 'catalog');
  assert.equal(modal().props.okButtonProps.disabled, true);
  node('Select', props => props['aria-label'] === '供应商目录').props.onChange('moonshot-cn');
  assert.equal(field('接口地址').props.value, 'https://api.moonshot.cn/v1');
  assert.equal(field('接口地址').props.disabled, undefined);
  type('API Key', 'test-key');
  type('模型 ID', 'test-model');
  assert.equal(modal().props.okButtonProps.disabled, false);
  modal().props.onOk();
  await settle();
  assert.equal(saves[0].name, 'Moonshot AI（中国）');
  assert.equal(saves[0].base_url, 'https://api.moonshot.cn/v1');
  assert.equal(saves[0].model, 'test-model');
  assert(!button('设为默认'));
  button('测试连接').props.onClick();
  await settle();
  assert.deepEqual(tested, ['configured-1']);

  node('Button', props => props['aria-label'] === '添加供应商').props.onClick();
  mode().props.onChange('custom');
  assert.equal(field('接口地址').props.value, '');
  assert.equal(field('接口地址').props.disabled, undefined);
  type('供应商名称', '本机测试');
  type('接口地址', 'https://api.example.invalid/v1');
  type('模型 ID', 'local-test');
  modal().props.onOk();
  await settle();
  assert.equal(saves[1].name, '本机测试');
  assert.equal(saves[1].base_url, 'https://api.example.invalid/v1');
  assert.equal(saves[1].model, 'local-test');
  assert.equal(saves[1].api_key, undefined);
});
