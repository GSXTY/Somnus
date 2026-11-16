import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/DotConnectionGuide.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function find(node, type, match) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.map(child => find(child, type, match)).find(Boolean);
  return node.type === type && match(node.props) ? node : find(node.props.children, type, match);
}

test('Dot connection guide prepares local settings, builds HTTPS endpoint, and waits for verified readiness', async () => {
  const secretPath = 'sample-connection-test-key';
  const setup = { enabled: false, ready: false, paused: false, port: 4567, secret_path: secretPath };
  const hooks = [], effects = [], timers = new Map(), copies = [], requests = [];
  let cursor = 0, timerId = 0;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = initial;
      return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value; }];
    },
    useRef(initial) {
      const slot = cursor++;
      return hooks[slot] ??= { current: initial };
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      if (hooks[slot]?.deps.every((value, index) => value === deps[index])) return;
      const previous = hooks[slot];
      hooks[slot] = { deps };
      effects.push(() => { previous?.cleanup?.(); hooks[slot].cleanup = effect(); });
    },
  };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    antd: Object.fromEntries(['Alert', 'Button', 'Input', 'Modal', 'Popconfirm', 'Spin'].map(name => [name, name])),
    './assistantApi': { async dotTaskSetup(signal, prepare = false) {
      requests.push({ signal, prepare });
      if (prepare) {
        if (setup.mode === 'hosted') Object.assign(setup, { pairing_code: 'sample-key', expires_at: Date.now() + 60_000 });
        else Object.assign(setup, { enabled: true, port: 4567, secret_path: secretPath });
      }
      return { ...setup };
    } },
    './errors.mjs': { describeError: error => error.message },
  };
  vm.runInNewContext(compiled, {
    exports, AbortController, URL, require: name => imports[name],
    navigator: { clipboard: { async writeText(text) { copies.push(text); } } },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function render() { cursor = 0; return exports.DotConnectionGuide({ onClose() {} }); }
  function get(type, match = () => true) { return find(render(), type, match); }
  function commit() { render(); effects.splice(0).forEach(effect => effect()); }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  commit();
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].prepare, false);
  get('Button', props => props.children === '准备本机连接').props.onClick();
  await settle();
  commit();
  await settle();
  assert(requests.some(request => request.prepare));
  assert.equal(get('code', props => props.className === 'plugin-connection-target').props.children,
    'http://127.0.0.1:4567/mcp/' + secretPath);
  assert.equal(get('Alert').props.message, '等待 dot 确认订阅');
  assert(get('details'));
  assert.equal(get('a', props => props.href === 'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels').props.target, '_blank');
  get('Button', props => props.children === '复制命令').props.onClick();
  get('Button', props => props.children === '复制订阅指令').props.onClick();
  get('Button', props => props.children === '复制测试文字').props.onClick();
  await settle();
  assert.equal(copies.shift(), 'cloudflared tunnel --url http://127.0.0.1:4567');
  assert.match(copies.shift(), /task\.created.*read_task.*submit_result/);
  assert.match(copies.shift(), /SOMNUS-DOT-OK/);

  const address = () => get('Input', props => props.id === 'dot-external-address');
  address().props.onChange({ target: { value: 'http://example.com' } });
  assert.equal(get('Button', props => props.children === '复制地址'), undefined);
  address().props.onChange({ target: { value: 'https://example.com/' } });
  get('Button', props => props.children === '复制地址').props.onClick();
  await settle();
  assert.deepEqual(copies, ['https://example.com/mcp/' + secretPath]);

  setup.ready = true;
  async function poll() {
    const [timer, callback] = timers.entries().next().value;
    timers.delete(timer);
    callback();
    await settle();
  }
  await poll();
  assert.equal(get('Alert').props.type, 'success');

  Object.assign(setup, {
    mode: 'hosted', enabled: true, ready: false, paired: false,
    port: null, secret_path: null, local_dev: false, endpoint: 'https://relay.example.com/mcp',
  });
  await poll();
  assert.equal(address(), undefined, 'Hosted relay uses the provisioned HTTPS endpoint');
  assert.equal(get('Input', props => props['aria-label'] === 'Somnus 插件地址'), undefined);
  assert(get('Alert', props => props.message === 'ChatGPT 插件尚未发布'));
  assert.equal(get('Button', props => props.children === '获取配对码'), undefined);
  setup.local_dev = true;
  await poll();
  get('Button', props => props.children === '获取配对码').props.onClick();
  await settle();
  assert.equal(get('Input', props => props['aria-label'] === 'dot 配对码').props.value, 'sample-key');
  assert(get('Alert', props => props.message === '等待个人配对'));
  setup.install_url = 'https://chatgpt.com/example-install';
  await poll();
  assert.equal(get('a').props.href, setup.install_url);
  Object.assign(setup, { paired: true, ready: true });
  await poll();
  assert.equal(get('Input', props => props['aria-label'] === 'dot 配对码'), undefined);
  assert.equal(get('Alert').props.type, 'success');
  hooks.forEach(hook => hook?.cleanup?.());
  assert.equal(timers.size, 0);
});
