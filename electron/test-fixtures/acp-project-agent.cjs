const assert = require('node:assert/strict');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { createInterface } = require('node:readline');
const path = require('node:path');

const mode = process.argv[2];
const write = mode === 'write';
let turnId;
let mirror;
let mcp;
let prompts = 0;
const send = fields => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...fields }) + '\n');

async function mcpCall(method, params) {
  const headers = Object.fromEntries(mcp.headers.map(({ name, value }) => [name, value]));
  const response = await fetch(mcp.url, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, id: method, params }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params, result, error } = JSON.parse(line);
  if (method === 'initialize') {
    assert.deepEqual(params.clientCapabilities, { fs: { readTextFile: true, writeTextFile: write } });
    assert.equal(process.env.VV_MAN_TEST_NATIVE_TOKEN, undefined);
    send({ id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: write }, mcpCapabilities: { http: true } } } });
  } else if (method === 'session/new') {
    assert.equal(params.cwd, process.cwd());
    if (write) assert.deepEqual(params.mcpServers, []);
    else {
      assert.equal(params.mcpServers.length, 1);
      [mcp] = params.mcpServers;
      assert.equal(mcp.name, 'vv_man');
      assert.equal(mcp.type, 'http');
    }
    send({ id, result: { sessionId: 'safe-session' } });
  } else if (method === 'session/prompt') {
    turnId = id;
    assert.equal(params.sessionId, 'safe-session');
    prompts += 1;
    const [text, image] = params.prompt;
    assert.match(text.text, /backend user text/);
    assert.match(text.text, /skill instructions/);
    assert.doesNotMatch(text.text, /renderer injection/);
    if (prompts === 1) {
      const [history, current] = text.text.split('\n\n本轮请求及获授权上下文：\n');
      assert.ok(current.startsWith('backend user text'));
      const packet = JSON.parse(history.trimEnd().split('\n').at(-1));
      assert.deepEqual(packet, {
        ...(!write ? { summary: 'older same-agent summary\nSecond summary line' } : {}),
        recent: [{ role: 'user', content: 'prior same-agent text' }, { role: 'assistant', content: 'prior exact reply' }],
      });
      if (!write) assert.ok(history.indexOf('older same-agent summary') < history.indexOf('prior same-agent text'));
    } else {
      assert.doesNotMatch(text.text, /prior same-agent text|prior exact reply|older same-agent summary/);
    }
    assert.equal(text.type, 'text');
    mirror = text.text.match(/Somnus 项目临时视图：([^\n]+)/)[1];
    assert.equal(path.dirname(mirror).toLowerCase(), process.cwd().toLowerCase());
    assert.equal(readFileSync(path.join(mirror, 'source_1', 'direct.txt'), 'utf8'), 'snapshot');
    if (write) {
      assert.doesNotMatch(text.text, /search_project_files/);
      assert.deepEqual(image, { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' });
      writeFileSync(path.join(mirror, 'source_1', 'direct.txt'), 'local mirror edit');
    } else {
      assert.match(text.text, /search_project_files.*文件名.*文本内容.*超出项目临时视图/);
      assert.equal(existsSync(path.join(mirror, 'source_1', 'docs', 'outside-mirror.txt')), false);
      const { tools } = await mcpCall('tools/list', {});
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, 'search_project_files');
      assert.deepEqual(tools[0].inputSchema.required, ['query']);
      assert.deepEqual(tools[0].inputSchema.properties.mode.enum, ['name', 'content']);
      const result = await mcpCall('tools/call', { name: 'search_project_files',
        arguments: { query: 'needle', mode: 'content', source: 'source_1', path: 'docs' } });
      assert.equal(result.isError, false);
      assert.deepEqual(JSON.parse(result.content[0].text).matches, [
        { source: 'source_1', path: 'docs/outside-mirror.txt', line: 1, snippet: 'needle' },
      ]);
    }
    send({ method: 'session/update', params: { sessionId: 'safe-session', update: {
      sessionUpdate: 'tool_call', toolCallId: 'edit-tool', kind: 'edit', title: 'Editing file',
      status: 'pending', rawInput: { secret: 'do not forward' },
    } } });
    send({ method: 'session/update', params: { sessionId: 'safe-session', update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'edit-tool', status: 'completed',
    } } });
    send({ method: 'session/update', params: { sessionId: 'safe-session', update: {
      sessionUpdate: 'plan', entries: [{ content: 'Read context', status: 'completed', priority: 'high' }],
    } } });
    send({ id: 'outside', method: 'fs/read_text_file', params: { sessionId: 'safe-session', path: path.join(process.cwd(), 'other', 'secret.txt') } });
  } else if (id === 'outside') {
    assert.equal(error.code, -32001);
    send({ id: 'wrong-session', method: 'fs/read_text_file', params: { sessionId: 'different-session', path: path.join(mirror, 'source_1', 'direct.txt') } });
  } else if (id === 'wrong-session') {
    assert.equal(error.code, -32001);
    send({ id: 'read', method: 'fs/read_text_file', params: {
      sessionId: 'safe-session', path: path.join(mirror, 'source_1', 'delegated.txt'), line: 2, limit: 1,
    } });
  } else if (id === 'read') {
    assert.deepEqual(result, { content: 'second line' });
    send({ id: 'write', method: 'fs/write_text_file', params: {
      sessionId: 'safe-session', path: path.join(mirror, 'source_1', 'delegated.txt'), content: 'delegated edit',
    } });
  } else if (id === 'write') {
    assert.equal(error.code, -32001);
    assert.match(error.message, write ? /提交 Somnus 审批/ : /当前权限/);
    send({ method: 'session/update', params: { sessionId: 'safe-session', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'verified' },
    } } });
    send({ id: turnId, result: { stopReason: 'end_turn' } });
  }
});
