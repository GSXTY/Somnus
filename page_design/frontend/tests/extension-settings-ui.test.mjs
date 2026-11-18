import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const settle = () => new Promise(resolve => setImmediate(resolve));

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value?.props ? [value, ...nodes(value.props.children), ...nodes(value.props.actions)] : [];
}

function mount(component, options) {
  const input = readFileSync(new URL('../src/' + component + '.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(input, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } });
  const slots = [];
  const effects = [];
  let index = 0;
  let mounted = false;
  const react = {
    useState(initial) {
      const position = index++;
      if (!(position in slots)) slots[position] = initial;
      return [slots[position], next => { slots[position] = typeof next === 'function' ? next(slots[position]) : next; }];
    },
    useRef(current) { const position = index++; return slots[position] ??= { current }; },
    useEffect(effect) { if (!mounted) effects.push(effect); },
  };
  const jsx = (type, props) => ({ type, props });
  const names = new Proxy({}, { get: (_, name) => name });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, AbortController, Error, window: options.window ?? {}, fetch: options.fetch,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === './assistantApi') return options.api;
      return names;
    },
  });
  function render() { index = 0; return nodes(exports[component]()); }
  render();
  mounted = true;
  effects.forEach(run => run());
  return render;
}

test('MCP details lock both built-ins and keep the same editable connection actions for personal servers', async () => {
  const calls = [];
  const personal = { id: 'docs', name: 'Docs', transport: 'stdio', enabled: false, status: 'disabled', tools: [] };
  const builtins = ['database', 'text-to-sql'].map(id => ({
    id, name: id, transport: 'http', enabled: true, status: 'unavailable', builtin: true, runtime_managed: true, tools: [],
  }));
  const render = mount('McpServers', { fetch: async (path, request) => {
    calls.push([path, request.method]);
    const result = path === '/api/mcp/servers' ? { servers: [...builtins, personal] }
      : { server: { ...personal, enabled: true, status: 'idle' } };
    return { ok: true, json: async () => result };
  }, window: { vvmanAcp: { dshMcpConnections: async () => ({ connections: [{
    id: 'agent-desktop', name: 'agent-desktop', transport: 'stdio', enabled: true, status: 'configured',
    builtin: true, runtime_managed: true,
  }] }) } } });
  const row = name => render().find(node => node.type === 'ExtensionItem' && node.props.title === name);
  await settle();
  const defaultSection = render().find(node => node.props['aria-label'] === '默认 MCP');
  assert.deepEqual(nodes(defaultSection).filter(node => node.type === 'ExtensionItem').map(node => node.props.title),
    ['数据库', 'Text to SQL', 'agent-desktop']);
  assert.equal(row('agent-desktop').props.actions, undefined);
  row('agent-desktop').props.onOpen();
  assert(!render().some(node => node.type === 'Button' && ['配置', '移除', '测试连接'].includes(node.props.children)));
  render().find(node => node.type === 'ExtensionHeading').props.onBack();
  for (const name of ['数据库', 'Text to SQL']) {
    assert.equal(row(name).props.actions, undefined);
    row(name).props.onOpen();
    assert.equal(render().find(node => node.type === 'ExtensionHeading').props.title, name);
    assert(!render().some(node => node.type === 'Button' && ['配置', '移除', '测试连接'].includes(node.props.children)));
    render().find(node => node.type === 'ExtensionHeading').props.onBack();
  }
  assert.deepEqual(calls, [['/api/mcp/servers', 'GET']]);
  row('Docs').props.actions.props.onChange(true);
  await settle();
  assert.deepEqual(calls[1], ['/api/mcp/servers/docs', 'PUT']);
  row('Docs').props.onOpen();
  assert(render().some(node => node.type === 'Button' && node.props.children === '测试连接'));
});

test('Skills expose local directory entries as read-only and retain the imported skill switch in detail', async () => {
  const changes = [];
  const skill = { id: 'review', name: 'Review', description: 'Check work', enabled: false, reference_count: 1 };
  const render = mount('PersonalSkills', {
    window: { vvmanAcp: { dshSkills: async () => [{ name: 'Native skill', source: 'user' }] } },
    api: { listSkills: async () => [skill], setSkillEnabled: async (id, enabled) => {
      changes.push([id, enabled]);
      return { ...skill, enabled };
    } },
  });
  const row = name => render().find(node => node.type === 'ExtensionItem' && node.props.title === name);
  const header = () => render().find(node => node.type === 'ExtensionHeading');
  await settle();
  row('Native skill').props.onOpen();
  assert(!render().some(node => node.type === 'Switch'));
  header().props.onBack();
  row('Review').props.onOpen();
  render().find(node => node.type === 'Switch').props.onChange(true);
  await settle();
  assert.deepEqual(changes, [['review', true]]);
  assert.equal(render().find(node => node.type === 'Switch').props.checked, true);
});
