import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/Models.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value?.props ? [value, ...nodes(value.props.children)] : [];
}

test('company default accepts only a DeepSeek API key and tests the fixed model endpoint', async () => {
  const company = { id: 'deepseek', name: '公司默认', model: 'deepseek-flash', base_url: 'https://api.deepseek.com',
    builtin: true, requires_api_key: true, configured: false, api_key_masked: '未配置' };
  let current = company;
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
        Checkbox: 'Checkbox', Popconfirm: 'Popconfirm', Select: 'Select', Spin: 'Spin', Tag: 'Tag' };
      if (name === '@ant-design/icons') return { ApiOutlined: 'ApiOutlined', PlusOutlined: 'PlusOutlined', SearchOutlined: 'SearchOutlined' };
      if (name === './assistantApi') return {
        listProviders: async () => ({ active: 'deepseek', providers: [current] }),
        saveCompanyProvider: async apiKey => {
          saves.push(apiKey);
          current = { ...company, configured: true, api_key_masked: '••••' };
        },
        removeCompanyProviderKey: async () => { current = company; },
        testModelConnection: async id => { tested.push([id, current.base_url]); return { ok: true, message: '可用', elapsed_ms: 0 }; },
      };
      if (name === './errors.mjs') return { describeError: err => err.message };
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
  assert(!view(false).find(item => item.props.children === '填写 API Key'));
  assert(view().some(item => item.props['aria-label'] === '添加供应商'));
  assert(node('h2', props => props.children === 'DeepSeek'));
  assert(!view().some(item => item.props.children === '公司默认'));
  assert.equal(button('测试连接').props.disabled, true);
  button('填写 API Key').props.onClick();
  const modal = () => node('Modal');
  const field = label => nodes(modal()).find(item => item.type === 'label' && item.props.children[0] === label)?.props.children[1];
  assert.equal(field('接口地址'), undefined);
  assert.equal(field('模型 ID'), undefined);
  assert.equal(field('API Key').props.value, '');
  assert.equal(modal().props.okButtonProps.disabled, true);
  field('API Key').props.onChange({ target: { value: ' sk-sample-key ' } });
  modal().props.onOk();
  await settle();
  assert.deepEqual(saves, ['sk-sample-key']);
  button('测试连接').props.onClick();
  await settle();
  assert.deepEqual(tested, [['deepseek', 'https://api.deepseek.com']]);
  button('更换 API Key').props.onClick();
  assert.equal(field('API Key').props.value, '');
  assert.equal(modal().props.okButtonProps.disabled, true);
  modal().props.onCancel();
  await node('Popconfirm', props => props.title === '移除 DeepSeek API Key？').props.onConfirm();
  assert(button('填写 API Key'));
  assert(!button('移除 API Key'));
});
