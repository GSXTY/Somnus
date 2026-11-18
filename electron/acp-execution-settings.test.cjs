const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createExecutionSettings, DEFAULT_EXECUTION_SETTINGS } = require('./acp-execution-settings.cjs');
const { SessionMcp } = require('./acp-mcp.cjs');

const settings = {
  loop: { maxCalls: 2, maxConcurrent: 1 },
  shell: { timeoutSeconds: 1, outputKiB: 2 },
};

test('execution settings persist per profile and reject invalid budgets without overwriting', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'somnus-execution-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createExecutionSettings(dir);
  assert.deepEqual(store.get(), DEFAULT_EXECUTION_SETTINGS);
  assert.deepEqual(store.set(settings), settings);
  assert.deepEqual(createExecutionSettings(dir).get(), settings);
  assert.throws(() => store.set({ ...settings, loop: { ...settings.loop, maxCalls: 49 } }), /超出允许范围/);
  assert.throws(() => store.set({ ...settings, shell: { ...settings.shell, timeoutSeconds: 151 } }), /超出允许范围/);
  assert.deepEqual(store.get(), settings);
  await writeFile(path.join(dir, 'agent-execution-settings.json'), '{');
  assert.deepEqual(store.get(), DEFAULT_EXECUTION_SETTINGS);
});

test('MCP bridge enforces per-turn count and concurrency from the snapshot', async () => {
  const makeTurn = () => ({ executionSettings: settings, signal: new AbortController().signal, onUpdate() {} });
  let turn = makeTurn();
  const first = Promise.withResolvers();
  const name = 'example';
  const result = { content: [{ type: 'text', text: 'ok' }] };
  const bridge = new SessionMcp([{ name }], () => turn, (_turn, call) =>
    call.arguments.id === 1 ? first.promise : result);
  try {
    const invoke = id => bridge.call({ id, params: { name, arguments: { id } } });
    const pending = invoke(1);
    assert.match((await invoke(2)).content[0].text, /并发上限/);
    first.resolve(result);
    assert.equal((await pending).isError, false);
    assert.equal((await invoke(3)).isError, false);
    assert.match((await invoke(4)).content[0].text, /2 次/);
    turn = makeTurn();
    assert.equal((await invoke(5)).isError, false);
  } finally {
    bridge.close();
  }
});
