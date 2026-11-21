const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { AcpAgents } = require('./acp-agents.cjs');

test('same group chat uses distinct ACP processes and scopes updates, approval and cancellation to one turn', {
  skip: process.platform !== 'win32', timeout: 15_000,
}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'somnus-group-host-'));
  const fixture = path.join(directory, 'group-agent.cjs');
  const source = await readFile(path.join(__dirname, 'test-fixtures', 'acp-test-agent.cjs'), 'utf8');
  await writeFile(fixture, source.replace("if (text === 'cancel me') break;", "if (text.startsWith('cancel me')) break;"));
  const payloads = new Map();
  const client = { prepare: async turn => ({ text: payloads.get(turn.turnId), images: [] }) };
  const agents = new AcpAgents(path.join(directory, 'agents.json'), '1.0', directory, undefined, client);
  const connections = [];
  t.after(async () => {
    agents.close();
    await Promise.all(connections.map(connection => connection.exited));
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const codex = await agents.save({ name: 'Fixture Codex', executable: process.execPath, args: [fixture] });
  const dsh = await agents.save({ name: 'Fixture DSH', executable: process.execPath, args: [fixture] });
  const cid = 'shared-group-conversation';
  const updates = [];
  const start = (agent, turnId, text, groupMember = true) => {
    payloads.set(turnId, text);
    const result = agents.promptConversation({ conversationId: cid, agentId: agent.id, turnId, text, groupMember },
      event => updates.push(event));
    result.catch(() => {});
    return result;
  };
  const first = start(codex, 'codex-turn', 'cancel me');
  const second = start(dsh, 'dsh-turn', 'cancel me');
  await assert.rejects(start(codex, 'duplicate', 'duplicate'), /已有冲突/);
  await assert.rejects(start(dsh, 'legacy', 'legacy', false), /已有冲突/);
  const get = id => agents.findConversationTurn(cid, id);
  for (let attempt = 0; attempt < 200 && (!get('dsh-turn')?.promptActive || !get('codex-turn')?.promptActive); attempt++) {
    await delay(15);
  }
  const codexTurn = get('codex-turn');
  const dshTurn = get('dsh-turn');
  assert.ok(codexTurn?.promptActive && dshTurn?.promptActive);
  assert.notEqual(codexTurn.current.cwd, dshTurn.current.cwd);
  connections.push(codexTurn.current.connection, dshTurn.current.connection);
  const permission = dshTurn.live.request({ title: 'check', kind: 'edit', options: [{ id: 'allow', name: 'Allow', kind: 'allow_once' }] });
  const requestId = updates.findLast(event => event.acpPermission)?.acpPermission.requestId;
  assert.ok(requestId);
  assert.throws(() => agents.respondPermission(cid, requestId, 'allow', 'codex-turn'), /已结束/);
  agents.cancelConversation(cid, 'codex-turn');
  assert.equal((await first).stopReason, 'cancelled');
  assert.equal(get('dsh-turn'), dshTurn);
  assert.equal(dshTurn.cancelled, false);
  agents.respondPermission(cid, requestId, 'allow', 'dsh-turn');
  assert.equal(await permission, 'allow');
  agents.cancelConversation(cid, 'dsh-turn');
  assert.equal((await second).stopReason, 'cancelled');
  assert.ok(updates.some(event => event.turnId === 'codex-turn'));
  assert.ok(updates.some(event => event.turnId === 'dsh-turn'));
  assert.ok(updates.every(event => event.conversationId === cid &&
    event.agentId === (event.turnId === 'codex-turn' ? codex.id : dsh.id)));
  assert.equal(agents.conversations.size, 0);
  const fresh = await start(dsh, 'fresh-turn', 'fresh');
  assert.equal(fresh.stopReason, 'end_turn');
  assert.match(fresh.text, /fresh/);
  assert.match(fresh.text, /\(1\)$/);
});
