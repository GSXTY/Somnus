
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/ManagedDshAccount.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props.children)];
}

function harness(bridge) {
  let hook = 0;
  let timerId = 0;
  let queue = [];
  const states = [], effects = [], timers = new Map();
  const react = {
    useState(initial) {
      const index = hook++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useEffect(run, dependencies) {
      const index = hook++;
      const prior = effects[index];
      if (!prior || dependencies.some((value, key) => value !== prior.dependencies[key])) queue.push(() => {
        prior?.cleanup?.();
        effects[index] = { dependencies, cleanup: run() };
      });
    },
  };
  const components = new Proxy({}, { get: (_, name) => name });
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'antd') return components;
      return { describeError: error => error.message };
    },
    window: {
      vvmanAcp: bridge,
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); },
    },
  });
  const render = () => {
    hook = 0;
    queue = [];
    const rendered = elements(exports.ManagedDshAccount({ connected: true, disabled: false }));
    queue.forEach(effect => effect());
    return rendered;
  };
  return {
    find(type, text) { return render().find(node => node.type === type && (!text || node.props.children === text)); },
    tick() { for (const [id, run] of timers) { timers.delete(id); run(); } },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('DSH login stays pending until official runtime confirms; refresh recovers a failed status lookup', async () => {
  let status = 'signed-out', failing = true;
  const account = harness({
    async managedDshAccountStatus() {
      if (failing) throw new Error('读取失败');
      return { state: status };
    },
    async signInManagedDshAccount() { status = 'pending'; return { state: status }; },
  });
  assert(!account.find('Button', '登录 DeepSeek'));
  await flush();
  assert.equal(account.find('Alert').props.message, '读取失败');
  failing = false;
  account.find('Button', '刷新账号状态').props.onClick();
  await flush();
  assert(account.find('Tag', '未登录'));
  account.find('Button', '登录 DeepSeek').props.onClick();
  await flush();
  assert(account.find('Tag', '等待浏览器授权'));
  assert(account.find('Button', '登录 DeepSeek').props.disabled);
  status = 'signed-in';
  account.tick();
  await flush();
  assert(account.find('Tag', '账号已登录'));
  assert(!account.find('Button', '登录 DeepSeek'));
  assert(account.find('p', '可在下方验证 ACP 会话。'));
});

test('unsupported DSH runtime cannot initiate an account login', async () => {
  const account = harness({
    async managedDshAccountStatus() { return { state: 'unavailable', message: '运行时不提供网页登录' }; },
    async signInManagedDshAccount() { throw new Error('should not be called'); },
  });
  account.find('Tag');
  await flush();
  assert(account.find('Tag', '此运行时暂未提供账号登录'));
  assert(account.find('p', '运行时不提供网页登录'));
  assert(!account.find('Button', '登录 DeepSeek'));
});
