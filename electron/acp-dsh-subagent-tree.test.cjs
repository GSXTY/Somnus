const assert = require('node:assert/strict');
const test = require('node:test');
const { NativeSubagentTree } = require('./acp-dsh-subagent-tree.cjs');

test('projects nested live tasks, ignores unchanged history, and notices reused children', async () => {
  const row = (id) => ({ id, label: id, mode: 'continuable' });
  const state = (asOfSeq, subagentCatalog, subagentTiming) =>
    ({ asOfSeq, values: { subagentCatalog, subagentTiming } });
  const projections = new Map([
    ['root', state(5, [row('previous'), row('reused')])],
    ['previous', state(2, [], { lastTurnCompleted: true })],
    ['reused', state(3, [], { lastTurnCompleted: true })],
  ]);
  const steps = [];
  const tree = new NativeSubagentTree(async (method, { sessionId }) => {
    assert.equal(method, 'projections');
    return projections.get(sessionId);
  }, 'root', ({ acpTool }) => steps.push(acpTool));
  await tree.capture();
  await tree.refresh();
  assert.deepEqual(steps, []);
  projections.set('reused', state(5, [row('leaf')], { lastTurnCompleted: true }));
  projections.set('leaf', state(1, [row('root')], { active: { since: 5 } }));
  await tree.refresh();
  assert.equal(tree.hasRunning(), true);
  assert.deepEqual(steps.map(({ title, status }) => [title, status]),
    [['reused', 'completed'], ['leaf', 'in_progress']]);
  assert.equal(steps[1].parent_id, steps[0].id);
  await tree.refresh();
  assert.equal(steps.length, 2);
  projections.set('leaf', state(2, [], { lastTurnCompleted: false, settledMs: 42 }));
  await tree.refresh();
  assert.equal(tree.hasRunning(), false);
  assert.equal(steps[2].id, steps[1].id);
  assert.equal(steps[2].status, 'failed');
  assert.equal(steps[2].duration_ms, 42);
});
