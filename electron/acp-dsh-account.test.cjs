const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DshAccount, accountState } = require('./acp-dsh-account.cjs');

test('DSH account login redeems only the local cookie and opens the trusted official authorization page', async () => {
  const origin = 'http://127.0.0.1:8608';
  const cookie = 'dsh-auth-test=v1.example.signature';
  const browser = 'https://platform.deepseek.com/dsh/authorize?request=opaque';
  const server = { ready: Promise.resolve(origin + '/?token=local-fixture') };
  let legitimate = true;
  let redemptions = 0;
  const account = new DshAccount(async (target, request) => {
    const url = new URL(target);
    assert.equal(url.origin, origin);
    if (request.redirect === 'manual') {
      redemptions++;
      return new Response(null, { status: 303, headers: { 'set-cookie': cookie + '; Path=/; HttpOnly' } });
    }
    assert.equal(request.headers.cookie, cookie);
    assert.equal(request.redirect, 'error');
    const { rpcId, method, payload } = JSON.parse(request.body);
    assert.equal(url.pathname, '/api/' + method);
    if (method === 'account/startSignIn') {
      assert.equal(payload.args.callbackOrigin, origin);
      assert.equal(payload.args.loginSource, 'desktop');
    }
    const value = { status: 'signed-out', attempt: { phase: 'waiting-browser',
      authorizeUrl: legitimate ? browser : 'https://platform.deepseek.com.example.test/dsh/authorize' } };
    return Response.json({ rpcId, result: { ok: true, value } });
  });
  const opened = [];
  let validated = 0;
  const start = () => account.signIn(server, '1.0.0', () => validated++, url => opened.push(url));
  assert.deepEqual(await start(), { state: 'pending' });
  assert.deepEqual(opened, [browser]);
  assert.equal(validated, 2);
  legitimate = false;
  await assert.rejects(start(), /登录地址无效/);
  assert.deepEqual(opened, [browser]);
  assert.equal(redemptions, 1);
});

test('renderer-facing account status exposes neither the launch URL nor the account payload', () => {
  assert.deepEqual(accountState({ status: 'credential-stored', token: 'private', links: { url: 'private' } }),
    { state: 'signed-in' });
  assert.deepEqual(accountState({ status: 'signed-out', attempt: { phase: 'waiting-browser', authorizeUrl: 'private' } }),
    { state: 'pending' });
  assert.equal(accountState({ status: 'signed-out', attempt: { phase: 'expired' } }).state, 'failed');
});
