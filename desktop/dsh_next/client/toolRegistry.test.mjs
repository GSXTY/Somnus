/**
 * toolRegistry 单元测试（node:test，直接 import TypeScript 源码，Node 24 类型擦除）。
 *
 * 覆盖：注册/排序/注销幂等/重复 id 覆盖语义/非法条目忽略并 warn/订阅通知/
 * open 未注入 opener 的降级，以及 entries() 的拷贝语义。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRegistry, somnusToolRegistry } from './toolRegistry.ts';

const entry = (id, overrides = {}) => ({
  id,
  title: `工具 ${id}`,
  hint: `说明 ${id}`,
  panelKey: `panel-${id}`,
  ...overrides,
});

/** 捕获 console.warn：返回收集数组与还原函数。 */
function captureWarn() {
  const messages = [];
  const original = console.warn;
  console.warn = (...args) => { messages.push(args.map(String).join(' ')); };
  return { messages, restore: () => { console.warn = original; } };
}

test('register 登记条目并按 order、title 排序，entries() 返回拷贝', () => {
  const registry = createToolRegistry();
  registry.register(entry('sql', { order: 2 }));
  registry.register(entry('wave', { order: -1 }));
  registry.register(entry('deep', { order: 2, title: 'A 深度分析' }));

  const listed = registry.entries();
  assert.deepEqual(listed.map(item => item.id), ['wave', 'deep', 'sql']);
  // order 相同（2）时按 title 代码点升序：'A 深度分析' < '工具 sql'
  assert.deepEqual(registry.entries().map(item => item.id), ['wave', 'deep', 'sql']);

  // 拷贝语义：改返回值不影响注册表内部状态
  listed[0].title = '被外部改坏';
  listed.push(entry('ghost'));
  assert.equal(registry.entries()[0].title, '工具 wave');
  assert.deepEqual(registry.entries().map(item => item.id), ['wave', 'deep', 'sql']);
});

test('order 缺省为 0，非有限数字按 0 归一且不算非法条目', () => {
  const registry = createToolRegistry();
  registry.register(entry('none'));
  registry.register(entry('nan', { order: Number.NaN }));
  registry.register(entry('first', { order: -5 }));
  const listed = registry.entries();
  assert.deepEqual(listed.map(item => item.id), ['first', 'nan', 'none']);
  assert.equal(listed.find(item => item.id === 'none').order, 0);
  assert.equal(listed.find(item => item.id === 'nan').order, 0);
});

test('注销移除条目并通知订阅者，同一注销函数幂等', () => {
  const registry = createToolRegistry();
  let notified = 0;
  const unsubscribe = registry.subscribe(() => { notified += 1; });
  const dispose = registry.register(entry('sql'));
  assert.equal(notified, 1);
  assert.deepEqual(registry.entries().map(item => item.id), ['sql']);

  dispose();
  assert.equal(notified, 2);
  assert.deepEqual(registry.entries(), []);

  dispose();
  dispose();
  assert.equal(notified, 2, '重复注销不应再次通知');
  assert.deepEqual(registry.entries(), []);

  unsubscribe();
  registry.register(entry('wave'));
  assert.equal(notified, 2, '取消订阅后不再收到通知');
});

test('重复 id：后注册覆盖先前并 warn，旧注销函数变成 no-op', () => {
  const { messages, restore } = captureWarn();
  try {
    const registry = createToolRegistry();
    const disposeFirst = registry.register(entry('sql', { title: '旧 SQL' }));
    const disposeSecond = registry.register(entry('sql', { title: '新 SQL' }));
    assert.ok(messages.some(message => message.includes('sql') && message.includes('覆盖')));
    assert.deepEqual(registry.entries().map(item => item.title), ['新 SQL']);

    // 旧条目的注销函数不得误删后来者
    disposeFirst();
    assert.deepEqual(registry.entries().map(item => item.title), ['新 SQL']);

    disposeSecond();
    assert.deepEqual(registry.entries(), []);
  } finally {
    restore();
  }
});

test('非法条目被忽略并 warn，不抛异常也不污染注册表', () => {
  const { messages, restore } = captureWarn();
  try {
    const registry = createToolRegistry();
    registry.register(entry('ok'));

    const invalid = [
      null,
      undefined,
      'not-an-object',
      entry('no-title', { title: '' }),
      entry('blank-hint', { hint: '   ' }),
      entry('no-panel', { panelKey: '' }),
      entry('bad-prereq', { prereq: 'network' }),
      entry('bad-icon', { icon: 'rocket' }),
      { ...entry('no-id'), id: '' },
    ];
    for (const item of invalid) {
      assert.doesNotThrow(() => registry.register(item));
    }

    assert.deepEqual(registry.entries().map(item => item.id), ['ok']);
    assert.ok(messages.length >= invalid.length, `每个非法条目都应 warn，实际 ${messages.length} 条`);
    assert.ok(messages.every(message => message.startsWith('[somnusTools]')));
  } finally {
    restore();
  }
});

test('合法枚举值 prereq/icon 被保留，未提供的字段不出现在条目里', () => {
  const registry = createToolRegistry();
  registry.register(entry('sql', { prereq: 'database', icon: 'database' }));
  registry.register(entry('wave', { prereq: 'files' }));
  const [sql, wave] = registry.entries();
  assert.deepEqual(sql, { id: 'sql', title: '工具 sql', hint: '说明 sql', panelKey: 'panel-sql', prereq: 'database', icon: 'database', order: 0 });
  assert.equal('icon' in wave, false);
  assert.equal(wave.prereq, 'files');
});

test('open() 交给外壳注入的 opener；未注入时 warn 而不是抛错', () => {
  const { messages, restore } = captureWarn();
  try {
    const registry = createToolRegistry();
    assert.doesNotThrow(() => registry.open('plugin-sql'));
    assert.ok(messages.some(message => message.includes('尚未注入 open()')));

    const opened = [];
    registry.setOpener(panelKey => opened.push(panelKey));
    registry.open('plugin-sql');
    registry.open('plugin-wave');
    assert.deepEqual(opened, ['plugin-sql', 'plugin-wave']);

    // 空 panelKey 不进入 opener
    registry.open('');
    assert.deepEqual(opened, ['plugin-sql', 'plugin-wave']);
  } finally {
    restore();
  }
});

test('open() 不吞 opener 抛出的错误（由外壳用 try/catch 降级为 warn）', () => {
  const registry = createToolRegistry();
  registry.setOpener(() => { throw new Error('layout.selectPanel: main panel "x" is not registered'); });
  assert.throws(() => registry.open('x'), /is not registered/);
});

test('可重复取消订阅、非法监听器被忽略且不抛错', () => {
  const registry = createToolRegistry();
  assert.doesNotThrow(() => registry.subscribe(null)());
  const off = registry.subscribe(() => { throw new Error('listener boom'); });
  const { messages, restore } = captureWarn();
  try {
    // 监听器抛错只影响自己：注册仍然成功
    assert.doesNotThrow(() => registry.register(entry('sql')));
    assert.deepEqual(registry.entries().map(item => item.id), ['sql']);
  } finally {
    restore();
  }
  assert.ok(messages.some(message => message.includes('listener boom')));
  const quiet = registry.subscribe(() => {});
  quiet();
  assert.doesNotThrow(() => quiet());
  off();
});

test('每次 createToolRegistry() 都互不影响，外壳单例是 ToolRegistry 形状', () => {
  const first = createToolRegistry();
  const second = createToolRegistry();
  first.register(entry('sql'));
  assert.deepEqual(second.entries(), []);
  for (const method of ['register', 'entries', 'subscribe', 'open', 'setOpener']) {
    assert.equal(typeof somnusToolRegistry[method], 'function', method);
  }
});
