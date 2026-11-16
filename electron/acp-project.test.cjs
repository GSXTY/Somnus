const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AcpAgents } = require('./acp-agents.cjs');
const { AcpProjectTurn, createProjectClient, projectFileTools } = require('./acp-project.cjs');
const { SessionMcp, toolCatalog } = require('./acp-mcp.cjs');

test('ACP uses reserved project context for read-only search and staged write proposals', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vvman-acp-project-test-'));
  const pending = [];
  const actualFiles = { 'direct.txt': 'snapshot', 'delegated.txt': 'first line\nsecond line' };
  const digest = 'a'.repeat(64);
  const nonce = 'private-test-proof';
  const searchTool = {
    name: 'search_project_files', description: 'Read-only project search',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', minLength: 1, maxLength: 200 },
      mode: { type: 'string', enum: ['name', 'content'], default: 'name' },
      source: { type: 'string' }, path: { type: 'string' },
    } },
  };
  let agentId;
  let readOnlyId;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers['x-data-agent-native'], nonce);
      assert.equal(req.method, 'POST');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      assert.ok([agentId, readOnlyId].includes(data.agent_id));
      const write = data.agent_id === agentId;
      const turn = write ? 'turn-main' : 'read-only-turn';
      assert.ok(req.url.startsWith('/api/assistant/conversations/conversation/external-turns/' + turn + '/'));
      let reply;
      if (req.url.endsWith('/prepare')) {
        assert.deepEqual(Object.keys(data), ['agent_id']);
        reply = { text: 'backend user text\n\nskill instructions', permission_mode: write ? 'workspace_write' : 'read_only',
          history: [{ role: 'user', content: 'prior same-agent text' },
            { role: 'assistant', content: 'prior exact reply' }],
          ...(!write ? { history_summary: 'older same-agent summary\nSecond summary line' } : {}),
          images: write || unsupported ? [{ mimeType: 'image/png', data: 'aW1hZ2U=' }] : [],
          tools: write ? [] : [searchTool],
          ...(write ? { workspace_id: 'ws_aabbccddeeff', project_sources: [{ source: 'source_1' }] } : {}),
          project: { available: true, supports_create: write, sources: [{ source: 'source_1', name: 'synthetic' }],
            files: Object.keys(actualFiles).map(file => ({ source: 'source_1', path: file })) } };
      } else if (req.url.endsWith('/tool')) {
        assert.equal(write, false);
        assert.deepEqual(data, { agent_id: readOnlyId, name: searchTool.name,
          arguments: { query: 'needle', mode: 'content', source: 'source_1', path: 'docs' } });
        reply = { content: [{ type: 'text', text: JSON.stringify({
          mode: 'content', matches: [{ source: 'source_1', path: 'docs/outside-mirror.txt', line: 1, snippet: 'needle' }],
          truncated: false,
        }) }], isError: false };
      } else {
        assert.equal(req.url.split('/').at(-1), 'project-file');
        assert.equal(data.source, 'source_1');
        if (data.action === 'propose_create') {
          assert.ok(write);
          assert.deepEqual(data, { agent_id: agentId, action: 'propose_create', source: 'source_1', path: 'new.txt', content: 'new proposal' });
          pending.push({ id: 'create_new', path: data.path, new_content: data.content, operation: 'create' });
          reply = { proposal: pending.at(-1) };
        } else if (data.action === 'propose') {
          assert.ok(Object.hasOwn(actualFiles, data.path));
          assert.ok(write);
          assert.equal(data.expected_sha256, digest);
          pending.push({ id: 'edit_' + data.path, path: data.path, new_content: data.content });
          reply = { proposal: pending.at(-1) };
        } else {
          assert.ok(Object.hasOwn(actualFiles, data.path));
          assert.equal(data.action, 'read');
          if (data.line) assert.deepEqual([data.line, data.limit], [2, 1]);
          reply = { content: data.line ? 'second line' : actualFiles[data.path], sha256: digest };
        }
      }
      res.setHeader('Content-Type', 'application/json').end(JSON.stringify(reply));
    } catch (error) {
      res.statusCode = 500;
      res.end();
      serverFailure = error;
    }
  });
  let unsupported = false;
  let serverFailure;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const local = createProjectClient('http://127.0.0.1:' + server.address().port, nonce);
  const agents = new AcpAgents(path.join(root, 'external-acp-agents.json'), 'test', undefined, undefined, local);
  t.after(async () => {
    agents.close();
    server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const fixture = path.join(__dirname, 'test-fixtures', 'acp-project-agent.cjs');
  const add = mode => agents.save({ name: mode, executable: process.execPath, args: [fixture, mode] });
  agentId = (await add('write')).id;
  readOnlyId = (await add('read')).id;
  await assert.rejects(async () => agents.promptConversation({ agentId, conversationId: 'conversation', text: 'unchecked' }, () => {}),
    /先建立授权/);
  const updates = [];
  const send = (id, turnId) => agents.promptConversation({
    agentId: id, conversationId: 'conversation', turnId, text: 'renderer injection',
  }, event => updates.push(event));
  const result = await send(agentId, 'turn-main');
  assert.equal(result.text, 'verified');
  assert.deepEqual(updates.flatMap(item => item.acpTool ? [item.acpTool] : []), [
    { id: 'edit-tool', kind: 'edit', title: 'Editing file', status: 'pending' },
    { id: 'edit-tool', kind: 'edit', title: 'Editing file', status: 'completed' },
  ]);
  assert.deepEqual(updates.find(item => item.acpPlan).acpPlan.entries, [
    { content: 'Read context', priority: 'high', status: 'completed' },
  ]);
  assert.deepEqual(result.projectProposals, [
    { id: 'create_new', path: 'new.txt', new_content: 'new proposal', operation: 'create' },
    { id: 'edit_delegated.txt', path: 'delegated.txt', new_content: 'delegated edit' },
    { id: 'edit_direct.txt', path: 'direct.txt', new_content: 'local mirror edit' },
  ]);
  assert.deepEqual(actualFiles, { 'direct.txt': 'snapshot', 'delegated.txt': 'first line\nsecond line' });
  assert.equal((await send(readOnlyId, 'read-only-turn')).projectProposals, undefined);
  assert.equal((await send(readOnlyId, 'read-only-turn')).text, 'verified');
  assert.deepEqual(updates.flatMap(item => item.toolProgress ? [item.toolProgress] : []), [
    'propose_project_file_create', searchTool.name, searchTool.name,
  ].flatMap(name => ['running', 'complete'].map(status => ({ name, callId: 'call-1', status }))));
  assert.ok(updates.every(item => !item.acpPermission));
  assert.equal(pending.length, 3);
  unsupported = true;
  await assert.rejects(send(readOnlyId, 'read-only-turn'), /不支持图片/);
  assert.equal(serverFailure, undefined);
});

test('project MCP read and proposal reuse native route and return the pending item without writing', async t => {
  const abort = new AbortController();
  const nativeCalls = [];
  const digest = 'a'.repeat(64);
  const currentContent = 'original\n';
  const proposal = { id: 'edit_one', path: 'README.md', old_content: currentContent, new_content: 'new\n', status: 'pending' };
  const creation = { id: 'create_one', path: 'docs/new.md', old_content: '', new_content: 'draft\n', status: 'pending', operation: 'create' };
  const turn = { conversationId: 'conversation', turnId: 'turn-one', agentId: 'agent', signal: abort.signal, onUpdate() {} };
  const prepared = { workspace_id: 'ws_aabbccddeeff', project: { available: true, supports_create: true },
    project_sources: [{ source: 'source_1' }], permission_mode: 'workspace_write' };
  const client = { async file(owner, params, signal) {
    assert.equal(owner, turn);
    assert.equal(signal.aborted, false);
    nativeCalls.push(params);
    if (params.action === 'read') return { sha256: digest, content: currentContent };
    if (params.action === 'propose_create') return { proposal: creation };
    assert.equal(params.expected_sha256, digest);
    return { proposal };
  } };
  const project = new AcpProjectTurn(client, turn, prepared);
  const tools = toolCatalog(projectFileTools(prepared));
  assert.deepEqual(projectFileTools({ ...prepared, permission_mode: 'read_only' }).map(tool => tool.name), ['read_project_file']);
  assert.deepEqual(projectFileTools({ ...prepared, project: { available: false } }), []);
  assert.deepEqual(projectFileTools({ ...prepared, project: { available: true } }).map(tool => tool.name),
    ['read_project_file', 'propose_project_file_edit']);
  const mcp = new SessionMcp(tools, () => turn, (_turn, params, signal) => project.mcpFile(params.name, params.arguments, signal));
  await mcp.listen();
  t.after(() => { abort.abort(); mcp.close(); });
  const { url, headers } = mcp.descriptor(true);
  let sequence = 0;
  const invoke = async (method, params) => {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: headers[0].value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
    return (await response.json()).result;
  };
  assert.deepEqual((await invoke('tools/list', {})).tools, tools);
  const file = { source: 'source_1', path: 'README.md' };
  const read = await invoke('tools/call', { name: 'read_project_file', arguments: file });
  assert.deepEqual(JSON.parse(read.content[0].text), { ...file, content: currentContent, sha256: digest });
  for (const args of [{ ...file, path: '../README.md' }, { ...file, source: 'source_9' }]) {
    assert.equal((await invoke('tools/call', { name: 'read_project_file', arguments: args })).isError, true);
  }
  const edit = { ...file, expected_sha256: digest, new_content: 'new\n' };
  const pending = await invoke('tools/call', { name: 'propose_project_file_edit', arguments: edit });
  assert.deepEqual(JSON.parse(pending.content[0].text), { ...file, proposal_id: proposal.id, status: 'pending' });
  assert.deepEqual(project.proposals, [proposal]);
  assert.equal((await invoke('tools/call', { name: 'propose_project_file_edit', arguments: edit })).isError, true);
  const target = { source: 'source_1', path: 'docs/new.md' };
  const createArgs = { ...target, new_content: 'draft\n' };
  for (const args of [{ ...createArgs, path: '../../new.md' }, { ...createArgs, expected_sha256: digest }]) {
    assert.equal((await invoke('tools/call', { name: 'propose_project_file_create', arguments: args })).isError, true);
  }
  const result = await invoke('tools/call', { name: 'propose_project_file_create', arguments: createArgs });
  assert.deepEqual(JSON.parse(result.content[0].text),
    { ...target, proposal_id: creation.id, status: 'pending', operation: 'create' });
  assert.deepEqual(project.proposals, [proposal, creation]);
  assert.equal((await invoke('tools/call', { name: 'propose_project_file_create', arguments: createArgs })).isError, true);
  assert.deepEqual(nativeCalls, [
    { ...file, action: 'read' }, { ...file, action: 'propose', content: 'new\n', expected_sha256: digest },
    { ...target, action: 'propose_create', content: 'draft\n' },
  ]);
});
