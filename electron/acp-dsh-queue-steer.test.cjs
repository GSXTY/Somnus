const assert = require('node:assert/strict');
const { mkdtemp, rmdir, unlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createQueueSteering } = require('./acp-dsh-queue-steer.cjs');
const { queueStore } = require('./acp-dsh-recovery.cjs');

const cid = 'a'.repeat(32);
const tid = 'b'.repeat(32);
const steerId = 'c'.repeat(32);
const agentId = 'd'.repeat(32);
const scope = { agentId, permission: 'read_only', model: 'deepseek-flash' };
const storage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text),
  decryptString: bytes => bytes.toString() };
const items = ['first', 'second'].map((text, index) => ({ id: String(index).repeat(32),
  draft: { text, ...(index === 1 ? { composerBlocks: [{ id: 'quote', kind: 'quote', label: 'reply', offset: 0, text: 'source' }] } : {}) },
  route: { agent: { agentId, agentName: 'Somnus' }, nativeDsh: true, companyOptions: { model: scope.model } },
  permission: scope.permission }));
const input = { conversationId: cid, turnId: tid, queueIds: items.map(item => item.id) };

async function testProfile(run) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'somnus-steer-queue-'));
  try { await run(home); }
  finally {
    const folder = path.join(home, 'somnus-queues');
    await unlink(path.join(folder, cid + '.bin')).catch(() => {});
    await rmdir(folder).catch(() => {});
    await rmdir(home);
  }
}

test('whole queue steer submits one ordered message and handles repeat and stale writes', () => testProfile(async home => {
  const store = queueStore(home, storage);
  const calls = [];
  let receipt;
  const project = {
    async reserveSteer(id, turn, content) { calls.push([id, turn, content]); return { steer_id: steerId }; },
    async steerMessage(_id, id) { return id === steerId ? receipt : null; },
  };
  const chat = { steerScope: (id, turn) => id === cid && turn === tid ? scope : null, async steer(request, check) {
    check();
    assert.equal(request.steerId, steerId);
    receipt = { id: steerId, role: 'user', content: calls[0][2] };
    return { accepted: true, message: receipt };
  } };
  const controller = createQueueSteering(store, project, chat);
  await controller.save(cid, items);
  const results = await Promise.all([controller.steer(input, () => {}), controller.steer(input, () => {})]);
  assert.equal(calls.length, 1);
  assert.match(calls[0][2], /^first\n\nsecond/);
  assert.match(calls[0][2], /"kind":"quote","label":"reply","text":"source"/);
  assert.deepEqual(results.map(result => result.acceptedQueueIds), [input.queueIds, input.queueIds]);
  await controller.save(cid, items);
  assert.deepEqual(await controller.read(cid), []);
}));

test('whole queue preserves every draft when ineligible and resolves accepted history after lost acknowledgement', () => testProfile(async home => {
  let receipt;
  let reservations = 0;
  const project = { async reserveSteer() { reservations++; return { steer_id: steerId }; }, async steerMessage() { return receipt; } };
  const chat = { steerScope: () => scope, async steer() {
    receipt = { id: steerId, role: 'user', status: 'complete', content: 'accepted' };
    throw new Error('response interrupted');
  } };
  const restore = () => createQueueSteering(queueStore(home, storage), project, chat);
  const controller = restore();
  const document = { id: 'e'.repeat(32), name: 'retained.md', kind: 'text', chars: 10 };
  const ineligible = [items[0], { ...items[1], draft: { ...items[1].draft, docFile: document } }];
  await controller.save(cid, ineligible);
  await assert.rejects(controller.steer(input, () => {}), /附件/);
  assert.equal(reservations, 0);
  assert.deepEqual((await controller.read(cid))[1].draft.docFile, document);
  await controller.save(cid, [items[0], { ...items[1], permission: 'full' }]);
  await assert.rejects(controller.steer(input, () => {}), /权限/);
  assert.equal((await controller.read(cid))[1].permission, 'full');
  await controller.save(cid, [items[0], { ...items[1], route: { ...items[1].route, companyOptions: { model: 'deepseek-pro' } } }]);
  await assert.rejects(controller.steer(input, () => {}), /模型/);
  assert.equal(reservations, 0);
  await controller.save(cid, items);
  const stale = await controller.steer({ ...input, queueIds: input.queueIds.slice().reverse() }, () => {});
  assert.equal(stale.accepted, false);
  assert.equal(reservations, 0);
  await assert.rejects(controller.steer(input, () => {}), /response interrupted/);
  const restarted = restore();
  assert.deepEqual(await restarted.read(cid), []);
  assert.deepEqual((await restarted.steer(input, () => {})).messages, [receipt]);
  assert.equal(reservations, 1);
}));
