const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, writeFile, rm, readFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const os = require('node:os');
const { projectToolHost, NATIVE_APPROVAL, TOKEN_VARIABLE, ENDPOINT_VARIABLE } = require('./acp-dsh-project-tools.cjs');
const { NativeDshChat } = require('./acp-native-dsh-chat.cjs');
const { approvalPreview } = require('./acp-native-approval.cjs');

test('native generic approvals bridge exact calls, redact credentials and preserve cancellation', async t => {
  const chat = new NativeDshChat({}, {}, {});
  const controller = new AbortController();
  const cid = 'a'.repeat(32), tid = 'b'.repeat(32), sid = 'somnus-' + cid + '-123456789abc';
  const updates = []; let choice = 'allow_once';
  const turn = { conversationId: cid, turnId: tid, agentId: 'somnus', submitted: true,
    signal: controller.signal, project: {}, questionSources: new Set(), steerSources: new Set(),
    interactionQueue: Promise.resolve(), onUpdate: update => {
      updates.push(update);
      if (update.acpPermission) queueMicrotask(() => choice === 'abort' ? controller.abort()
        : chat.respondPermission(cid, update.acpPermission.requestId, choice));
    } };
  chat.sessions.set(sid, turn); chat.running.set(cid, turn);
  const host = await projectToolHost((input, signal) => chat.projectTool(input, signal));
  t.after(host.dispose);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'somnus-approval-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'plugin.mjs'); await writeFile(file, host.plugin);
  const previous = Object.fromEntries([TOKEN_VARIABLE, ENDPOINT_VARIABLE].map(key => [key, process.env[key]]));
  Object.assign(process.env, host.env); t.after(() => { for (const [key,value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }});
  const handlers = new Map();
  const plugin = await import(pathToFileURL(file).href);
  plugin.apply({ on: (name, fn) => handlers.set(name, fn), commands: { register() {} }, tools: { register() {} } });
  const events = [{ type: 'user/message', data: { source: { kind: 'user', rpcId: tid } } },
    { type: 'tool/call', data: { callId: 'tool-1', name: 'browser.navigate', arguments: JSON.stringify({
      url: 'https://example.test', api_key: 'private-value', headers: { Authorization: 'Bearer private-token' } }) } }];
  const agent = { session: { id: sid, seq: 10, snapshotEvents: () => events } };
  const listener = handlers.get('approval/request');
  const request = { agent, toolName: 'browser.navigate', callId: 'tool-1', reason: 'Open synthetic page', signal: controller.signal };
  assert.equal(await listener(request, () => 'next'), 'allowed-once');
  const permission = updates.find(update => update.acpPermission).acpPermission;
  assert.equal(permission.kind, 'native_tool'); assert.equal(permission.details.toolName, 'browser.navigate');
  assert.ok(permission.details.argumentsPreview.includes('example.test'));
  assert.ok(!JSON.stringify(permission).includes('private-value'));
  assert.ok(!JSON.stringify(permission).includes('private-token'));
  assert.deepEqual(permission.options.map(item => item.id), ['allow_once','reject_once']);
  choice = 'reject_once'; assert.equal(await listener(request, () => 'next'), 'rejected');
  assert.equal(await listener({ ...request, callId: 'not-current' }, () => 'next'), 'rejected');
  assert.equal(await listener({ ...request, toolName: '<script>' }, () => 'next'), 'rejected');
  assert.equal(await listener({ ...request, agent: { session: { id: 'other', seq: 1, snapshotEvents: () => [] } } }, () => 'next'), 'next');
  choice = 'allow_once'; assert.equal(await listener({ ...request, signal: undefined }, () => 'next'), 'allowed-once');
  choice = 'abort'; assert.equal(await listener(request, () => 'next'), 'cancelled');
  assert.equal(turn.pendingPermission, undefined);
  assert.throws(() => chat.respondPermission(cid, permission.requestId, 'allow_once'), /已结束/);
});

test('approval preview is bounded and sensitive object fields are removed', () => {
  const preview = approvalPreview({ password:'hidden', token:'hidden', path:'a.txt', nested:{clientSecret:'hidden'}, binary:'data:image/png;base64,AAAA' });
  assert.ok(!preview.includes('hidden')); assert.ok(preview.includes('a.txt'));
  assert.ok(!preview.includes('AAAA')); assert.ok(approvalPreview('x'.repeat(10000)).length <= 6000);
});

test('four permission presets preserve review and add real workspace write without changing identity', async () => {
  const source = await readFile(path.join(__dirname, 'acp-native-dsh-chat.cjs'), 'utf8');
  assert.match(source, /\['workspace_write', 'read-only'\]/);
  assert.match(source, /\['workspace_direct', 'workspace-write'\]/);
  assert.match(source, /\['full', 'danger-full-access'\]/);
  assert.match(source, /你是 Somnus/);
  assert.match(source, /prepared\.permission_mode === 'full'/);
  assert.match(source, /完全访问不会改变公司数据网关的只读权限/);
  assert.match(source, /工作区外目标仍受原生权限检查/);
});
