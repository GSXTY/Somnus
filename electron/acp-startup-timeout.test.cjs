const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { AcpStdio } = require('./acp-stdio.cjs');

for (const [method, label] of [
  ['initialize', /启动外部 Agent 超时/],
  ['session/new', /创建会话超时/],
  ['session/set_model', /切换模型超时/],
  ['session/set_config_option', /应用会话设置超时/],
  ['session/prompt', /等待外部 Agent 响应超时/],
]) {
  test(`ACP timeout identifies ${method} and clears its process and pending requests`, async t => {
    const connection = new AcpStdio(process.execPath,
      ['-e', 'process.stdin.resume();setInterval(()=>{},1000)'], path.dirname(__filename), () => {});
    t.after(() => connection.stop());
    const pending = connection.request(method, {}, 30);
    const sibling = connection.request('another/request', {}, null);
    await Promise.all([
      assert.rejects(pending, error => error.code === 'ACP_REQUEST_TIMEOUT' && label.test(error.message)),
      assert.rejects(sibling, error => error.code === 'ACP_REQUEST_TIMEOUT' && label.test(error.message)),
    ]);
    await connection.exited;
    assert.equal(connection.pending.size, 0);
    assert.ok(connection.failure);
    await assert.rejects(connection.request('initialize', {}, 30), label);
  });
}
