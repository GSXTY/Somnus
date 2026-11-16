const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createRelayClient, relayOrigin, resolveRelayConfig } = require('./acp-dot-relay-client.cjs');

test('the relay uses HTTPS, with an explicit loopback development exception', () => {
  assert.equal(relayOrigin('https://relay.example.com/'), 'https://relay.example.com');
  assert.equal(relayOrigin('https://secret@relay.example.com/'), null);
  assert.equal(relayOrigin('https://relay.example.com/mcp'), null);
  assert.equal(relayOrigin('http://relay.example.com', true), null);
  assert.equal(relayOrigin('http://127.0.0.1:8042'), null);
  assert.equal(relayOrigin('http://127.0.0.1:8042', true), 'http://127.0.0.1:8042');
});

test('install links must use the exact ChatGPT HTTPS origin', async t => {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-dot-'));
  t.after(() => fs.rm(profileDir, { recursive: true, force: true }));
  const env = { SOMNUS_DOT_RELAY_URL: 'https://relay.example.com' };
  assert.deepEqual(await resolveRelayConfig(profileDir, {
    ...env, SOMNUS_DOT_INSTALL_URL: 'https://chatgpt.com/apps/somnus',
  }), { origin: 'https://relay.example.com', installUrl: 'https://chatgpt.com/apps/somnus', localDev: false });
  for (const target of ['https://chatgpt.com.fake.test/app', 'http://chatgpt.com/app', 'https://user@chatgpt.com/app']) {
    assert.equal((await resolveRelayConfig(profileDir, { ...env, SOMNUS_DOT_INSTALL_URL: target })).installUrl, undefined);
  }
  assert.equal((await resolveRelayConfig(profileDir, {
    SOMNUS_DOT_RELAY_URL: 'http://127.0.0.1:8893', SOMNUS_DOT_RELAY_LOCAL_DEV: '1',
  })).localDev, true);
});

test('hosted pairing protects credentials and relinks tasks across desktop restart', async t => {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-dot-'));
  t.after(() => fs.rm(profileDir, { recursive: true, force: true }));
  const token = 'desktop-token-fixture';
  const code = 'ABCD-EFGH';
  const task = { id: 'task_synthetic', status: 'pending', prompt: 'synthetic prompt' };
  let paired = false;
  let paused = false;
  let failDisconnect = false;
  const calls = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value).reverse(),
    decryptString: buffer => buffer.reverse().toString(),
  };
  const fetchRequest = async (url, options) => {
    const endpoint = new URL(url).pathname;
    calls.push(endpoint);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, endpoint === '/api/pairs' ? undefined : `Bearer ${token}`);
    const status = () => ({ paired, ready: paired && !paused, paused });
    if (endpoint === '/api/pairs') {
      return Response.json({ desktop_token: token, pairing_code: code, expires_at: new Date(Date.now() + 60000).toISOString() });
    }
    if (endpoint === '/api/status') return Response.json(status());
    if (endpoint === '/api/enabled') {
      paused = !JSON.parse(options.body).enabled;
      return Response.json(status());
    }
    if (endpoint === '/api/tasks' && options.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), { prompt: 'synthetic prompt' });
      return Response.json({ task });
    }
    if (endpoint === '/api/tasks') return Response.json({ tasks: [task, { ...task, id: 'task_unlinked' }] });
    if (endpoint === '/api/pairs/current' && options.method === 'DELETE') {
      if (failDisconnect) return new Response(null, { status: 503 });
      return new Response(null, { status: 401 });
    }
    throw new Error('Unexpected relay operation');
  };
  const options = { profileDir, safeStorage, fetchRequest, origin: 'https://relay.example.com' };
  let client = createRelayClient(options);
  assert.equal((await client.getState()).endpoint, 'https://relay.example.com/mcp');
  assert.deepEqual(calls, []);
  assert.equal((await client.startPairing()).pairing_code, code);
  assert.equal((await client.getState()).pairing_code, code);
  paired = true;
  assert.equal((await client.getState()).pairing_code, undefined);
  assert.equal((await client.createTask('conversation-one', 'synthetic prompt')).task.id, task.id);
  const [record] = await fs.readdir(profileDir);
  const saved = await fs.readFile(path.join(profileDir, record), 'utf8');
  assert.ok(!saved.includes(token) && !saved.includes(code) && !saved.includes(task.prompt));

  client = createRelayClient(options);
  assert.equal((await client.getState()).ready, true);
  assert.deepEqual((await client.listTasks('conversation-one')).tasks.map(item => item.id), [task.id]);
  assert.deepEqual((await client.listTasks('conversation-two')).tasks, []);
  assert.equal((await client.setEnabled(false)).paused, true);
  await assert.rejects(client.createTask('conversation-one', task.prompt), /请先连接并开启/);
  assert.equal((await client.setEnabled(true)).ready, true);
  failDisconnect = true;
  await assert.rejects(client.disconnect(), /暂时无法连接/);
  assert.equal((await client.getState()).ready, true);
  failDisconnect = false;
  assert.equal((await client.disconnect()).enabled, false);
});

test('pairing refuses to create a remote pair if credential encryption is unavailable', async t => {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-dot-'));
  t.after(() => fs.rm(profileDir, { recursive: true, force: true }));
  const client = createRelayClient({ profileDir, origin: 'https://relay.example.com',
    safeStorage: { isEncryptionAvailable: () => false },
    fetchRequest: () => assert.fail('Must not create a remote pair without secure storage'),
  });
  await assert.rejects(client.startPairing(), /系统凭据存储暂不可用/);
});
