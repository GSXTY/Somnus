const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { NativeDshChat } = require('./acp-native-dsh-chat.cjs');
const { AGENT_ID } = require('./acp-company.cjs');
const { catalog, pendingMode, beginMode } = require('./acp-dsh-agent-modes.cjs');

test('mode catalog uses runtime identities and exposes bounded unavailable diagnostics', () => {
  const rows = catalog({ presets: [{ id: 'cordis', broken: { message: 'secret-key stack' } }, { id: 'standard', isDefault: true }] });
  assert.equal(rows[0].name, 'Creator mode'); assert.equal(rows[0].available, false);
  assert(!JSON.stringify(rows).includes('secret-key')); assert.equal(rows[1].isDefault, true);
});

test('mode save rollback and durable confirmation guard survive restarts and repeated recovery failures', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'somnus-modes-')); t.after(() => rm(home, { recursive: true, force: true }));
  const cid = 'a'.repeat(32); let effective = 'standard', stored = null, failSave = false, failRollback = false;
  const market = { home, settings: async () => ({}), releaseChatSettings() {} };
  const client = { agentMode: async (_id, value) => {
    if (value !== undefined) { if (failSave) throw new Error('save failed'); stored = value; }
    return { agent_mode: stored, locked: false };
  }, prepare: async () => ({ agent_mode: stored }) };
  function instance() {
    const chat = new NativeDshChat(market, client, {});
    chat.scope = async () => ({ root: home, rootKey: 'fixture' });
    chat.rpc = async (_server, method, args) => {
      if (method === 'agentPresets/list') return { presets: ['standard', 'ptc', 'minimal', 'cordis'].map(id => ({ id, isDefault: id === 'standard' })) };
      if (method === 'session/projections') return { values: { agentPreset: effective } };
      if (method === 'session/events') return { records: [] };
      if (method === 'session/state') return {};
      if (method === 'agentPresets/select') { if (failRollback && args.agentPreset === 'standard') throw new Error('rollback failed'); effective = args.agentPreset; return effective; }
      throw new Error(method);
    };
    return chat;
  }
  let chat = instance();
  let snapshot = await chat.selectAgentMode({ conversationId: cid, modeId: 'ptc' }, () => {});
  assert.equal(stored, 'ptc'); assert.equal(snapshot.effectiveId, 'ptc'); assert.equal(await pendingMode(home, cid), false);
  stored = null; effective = 'standard'; failSave = true;
  await assert.rejects(chat.selectAgentMode({ conversationId: cid, modeId: 'minimal' }, () => {}), /save failed/);
  assert.equal(effective, 'standard'); assert.equal(await pendingMode(home, cid), false);
  failRollback = true;
  await assert.rejects(chat.selectAgentMode({ conversationId: cid, modeId: 'minimal' }, () => {}), /未能恢复/);
  assert.equal(effective, 'minimal'); assert.equal(await pendingMode(home, cid), true);
  chat = instance(); snapshot = await chat.listAgentModes({ conversationId: cid }, () => {});
  assert.equal(snapshot.needsConfirmation, true); assert.equal(snapshot.requestedId, null); assert.equal(snapshot.effectiveId, 'minimal');
  await assert.rejects(chat.prompt({ agentId: AGENT_ID, conversationId: cid, turnId: 'b'.repeat(32) }, () => {}, () => {}), /未完成确认/);
  await assert.rejects(chat.selectAgentMode({ conversationId: cid, modeId: 'minimal' }, () => {}), /save failed/);
  assert.equal(await pendingMode(home, cid), true);
  failSave = false; failRollback = false;
  snapshot = await chat.selectAgentMode({ conversationId: cid, modeId: 'minimal' }, () => {});
  assert.equal(snapshot.requestedId, 'minimal'); assert.equal(await pendingMode(home, cid), false);
  await beginMode(home, cid, 'ptc', 'minimal');
  await assert.rejects(chat.executeCommand({ agentId: AGENT_ID, conversationId: cid, turnId: 'b'.repeat(32), line: '/plan' }, () => {}), /未完成确认/);
});
