const assert = require('node:assert/strict');
const test = require('node:test');
const { listCommandRows, exactCommand, taskState } = require('./acp-dsh-commands.cjs');

test('catalog admits known text commands and exact verified plugin owners only', () => {
  const byName = Object.fromEntries(listCommandRows([
    { name: 'feedback', definitionId: '@deepseek-ai/dsh-command-feedback', description: 'Feedback' },
    { name: 'permission', definitionId: '@fixture/safe/permission', description: 'Change permissions' },
    { name: 'ping', definitionId: '@fixture/safe:ping', description: 'Inspect local state', input: { hint: '<query>' } },
    { name: 'impostor', definitionId: '@fixture/safe-next:ping', description: 'Not installed' },
    { name: 'unknown', description: 'Missing an owner identity' },
    { name: 'goal', definitionId: '@fixture/safe:goal', description: 'Conflicting command' },
  ], ['@fixture/safe']).map(row => [row.name, row]));
  assert.equal(byName.feedback.executable, true);
  assert.equal(byName.permission.executable, false);
  assert.equal(byName.ping.executable, true);
  assert.equal(byName.ping.hint, '<query>');
  assert.equal(byName.impostor.executable, false);
  assert.equal(byName.unknown.executable, false);
  assert.equal(byName.goal.executable, false);
});

test('native goal and plan projections retain public state only', () => {
  const state = taskState({ plan: { active: true, pending: false, debug: 'internal' },
    goal: { goal: { id: 'internal', objective: 'Finish report', phase: 'paused', maxGoalRounds: 10 }, roundsStarted: 2 } });
  assert.deepEqual(state, { plan: { active: true, pending: false },
    goal: { objective: 'Finish report', phase: 'paused', maxGoalRounds: 10, roundsStarted: 2 } });
});

test('a direct command parses exactly one human composer line', () => {
  assert.equal(exactCommand('/fixture-ping 测试'), 'fixture-ping');
  assert.throws(() => exactCommand('/fixture-ping\n/permission full'), /一条/);
  assert.throws(() => exactCommand('https://example.com/feedback'), /一条/);
});
