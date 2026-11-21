const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path'); const { EventEmitter } = require('node:events');
const { RuntimeRegistry } = require('./registry.cjs');
const CID = 'a'.repeat(32), AGENT = '11111111-1111-4111-8111-111111111111';
test('the real IPC lifecycle survives renderer replacement, revalidates host ownership and settles without renderer', async () => {
  const handlers = new Map(), finished = []; let resets = 0, workflowResets = 0, native;
  const window = new EventEmitter(); window.webContents = new EventEmitter(); window.isDestroyed = () => false;
  const frame = { url: 'http://127.0.0.1:8999/', detached: false, send() {} }; window.webContents.mainFrame = frame;
  class ACP { reset() { resets++; } close() {} }
  class Workflow { reset() { workflowResets++; } }
  class Market { initializeDefaultIm() {} closeSettings() {} }
  class Native {
    constructor() { native = this; this.turns = new Map(); }
    async prompt(input, validate, emit) {
      validate(); const row = { validate, emit }; this.turns.set(input.turnId, row);
      const result = await new Promise(resolve => { row.resolve = resolve; });
      validate(); emit({ ...input, text: 'SYNTHETIC-RESULT' }); this.turns.delete(input.turnId);
      return result;
    }
    cancel(cid) { for (const row of this.turns.values()) row.resolve({ text: '', stopReason: 'cancelled' }); }
  }
  const client = { runtimeTaskState: async () => ({ epoch: 'epoch', accepted: true, finish_receipt: 'f'.repeat(64), task: { status: 'running' } }), finishRuntimeTask: async (route, body) => { finished.push(body); return {}; } };
  const fallback = new Proxy({}, { get: () => () => Promise.resolve({}) });
  const dependencies = {
    './runtime/appearance.cjs': require('./appearance.cjs'),
    './runtime/diagnostics.cjs': require('./diagnostics.cjs'), './acp-runtime-policy.cjs': require('../acp-runtime-policy.cjs'), './acp-ui-preferences.cjs': require('../acp-ui-preferences.cjs'),
    './acp-agents.cjs': { AcpAgents: ACP }, './acp-native-dsh-chat.cjs': { NativeDshChat: Native },
    './acp-project.cjs': { createProjectClient: () => client }, './acp-project-workflow.cjs': { ProjectWorkflow: Workflow },
    './acp-dsh-market.cjs': { DshPluginMarket: Market }, './runtime/registry.cjs': { RuntimeRegistry },
    './project-folders.cjs': { trustWorkbench: event => { if (event.senderFrame !== window.webContents.mainFrame || event.senderFrame.detached) throw Error('untrusted renderer'); } },
    electron: { nativeTheme: Object.assign(new EventEmitter(),{shouldUseDarkColors:false}), safeStorage: { isEncryptionAvailable: () => false } },
  };
  const file = path.join(__dirname, '..', 'acp-ipc.cjs'), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, require: id => dependencies[id] || (id.startsWith('node:') ? require(id) : fallback), process, console, URL, AbortSignal, Buffer, setTimeout, clearTimeout }, { filename: file });
  module.exports.registerAcpAgents({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, window, origin: 'http://127.0.0.1:8999', token: 'f'.repeat(64), profileDir: __dirname, version: 'test' });
  const event = { senderFrame: frame }, input = { agentId: AGENT, conversationId: CID, turnId: 'b'.repeat(32) };
  const call = handlers.get('vvman-acp:native-dsh-prompt')(event, input);
  await new Promise(resolve => setImmediate(resolve));
  frame.detached = true; window.webContents.mainFrame = { ...frame, detached: false };
  window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  window.webContents.emit('render-process-gone', { reason: 'crashed' });
  native.turns.get(input.turnId).resolve({ text: 'SYNTHETIC-RESULT', stopReason: 'end_turn' });
  assert.equal((await call).text, 'SYNTHETIC-RESULT');
  assert.equal(finished[0].content, 'SYNTHETIC-RESULT'); assert.equal(finished[0].status, 'complete');
  assert.equal(resets, 0); assert.equal(workflowResets, 0);
  assert.throws(() => handlers.get('vvman-acp:native-dsh-prompt')(event, { ...input, turnId: 'c'.repeat(32) }), /untrusted/);
  window.emit('closed');
});
