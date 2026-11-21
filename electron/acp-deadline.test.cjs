const assert = require('node:assert/strict');
const test = require('node:test');
const { AcpDeadline } = require('./acp-deadline.cjs');

test('ACP deadline moves on progress but never passes its absolute bound', () => {
  let now = 0;
  const events = [];
  const deadline = new AcpDeadline(reason => events.push(reason), { idleMs: 20, hardMs: 55, clock: () => now });
  for (const at of [15, 30, 45]) {
    now = at;
    deadline.progress();
    assert.deepEqual(events, []);
  }
  now = 55;
  deadline.progress();
  assert.deepEqual(events, ['hard']);
  deadline.progress();
  assert.deepEqual(events, ['hard']);
});

test('ACP approval pauses idle warning with bounded grace and never cancels for silence', () => {
  let now = 0;
  const events = [];
  const deadline = new AcpDeadline(reason => events.push(reason), {
    idleMs: 20, hardMs: 100, approvalBudgetMs: 15, clock: () => now, onIdle: value => events.push(value.code),
  });
  now = 17;
  assert.equal(deadline.beginApproval(10), 10);
  now = 25;
  deadline.endApproval();
  assert.equal(deadline.remaining, 3);
  assert.equal(deadline.approvalBudget, 7);
  assert.equal(deadline.beginApproval(10), 10);
  now = 34;
  deadline.endApproval();
  assert.equal(deadline.remaining, 1);
  assert.equal(deadline.approvalBudget, 0);
  now = 35;
  deadline.schedule();
  assert.deepEqual(events, ['idle']);
  assert.equal(deadline.closed, false);
  deadline.close();
});

test('closing a prompt clears both ordinary and permission deadlines', () => {
  let now = 0;
  const events = [];
  const deadline = new AcpDeadline(reason => events.push(reason), { idleMs: 20, hardMs: 60, clock: () => now });
  now = 17;
  assert.equal(deadline.beginApproval(100), 43);
  deadline.close();
  now = 61;
  deadline.schedule();
  assert.deepEqual(events, []);
});


test('default unlimited ACP survives the former twelve minute cap and warns once until activity', () => {
  let now=0; const stops=[],warnings=[];
  const deadline=new AcpDeadline(reason=>stops.push(reason),{clock:()=>now,onIdle:value=>warnings.push(value.code)});
  now=13*60_000;deadline.schedule();
  assert.equal(deadline.hardAt,Infinity);assert.equal(deadline.closed,false);
  assert.deepEqual(stops,[]);assert.deepEqual(warnings,['idle']);
  now+=60_000;deadline.schedule();assert.deepEqual(warnings,['idle']);
  deadline.progress();now+=120_001;deadline.schedule();assert.deepEqual(warnings,['idle','idle']);
  deadline.close();
});
