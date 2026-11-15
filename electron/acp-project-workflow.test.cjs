const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { EventEmitter, once } = require('node:events');
const { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProjectWorkflow } = require('./acp-project-workflow.cjs');
const { AcpLive } = require('./acp-live.cjs');
const { SessionMcp, MAX_CALLS } = require('./acp-mcp.cjs');

test('project tools bind to selected roots, request fresh confirmation and run actual test and Git processes', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'vvman-workflow-test-'));
  const root = await realpath(scratch);
  const key = 'a'.repeat(64);
  const workspaceId = 'ws_aabbccddeeff';
  const fixture = path.join(root, 'runner.cjs');
  const marker = path.join(root, 'confirmed.txt');
  const auth = 'native-fixture-secret';
  let source = 'source_1';
  let approved = true;
  const jobs = new Map();
  const conversationId = '1'.repeat(32);
  const dialogs = [];
  const seen = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const prefix = '/api/assistant/conversations/' + conversationId + '/development-jobs/';
    if (request.url.startsWith(prefix) && request.headers['x-data-agent-native'] === auth) {
      const [id, action] = request.url.slice(prefix.length).split('/');
      const job = jobs.get(id);
      if (job && ['claim', 'target', 'complete'].includes(action)) {
        if (action === 'complete') job.result = args.result;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(action === 'claim' ?
          { name: job.name, workspace_id: workspaceId, arguments: job.args } :
          { workspace_id: workspaceId, root_path: root, root_key: key, source }));
        return;
      }
    }
    seen.push(args);
    const allowed = request.headers['x-data-agent-native'] === auth &&
      request.url === '/api/assistant/workspaces/' + workspaceId + '/development-target' &&
      ['run_project_tests', 'project_git_diff'].includes(args.name) && (args.source === source || args.root_key === key);
    response.writeHead(allowed ? 200 : 409, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ root_path: root, root_key: key, workspace_id: workspaceId, source }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const handlers = new Map();
  const window = new EventEmitter();
  const frame = { url: origin + '/' };
  window.webContents = { mainFrame: frame };
  window.isDestroyed = () => false;
  const event = { sender: window.webContents, senderFrame: frame };
  const workflow = new ProjectWorkflow({ origin, token: auth, window, profileDir: root,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: { async showMessageBox(_window, options) { dialogs.push(options); return { response: Number(approved) }; } },
  });
  t.after(async () => {
    workflow.reset();
    server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const handle = (action, ...args) => handlers.get('vvman-projects:' + action)(event, ...args);
  await writeFile(fixture, `
    const assert = require('node:assert/strict');
    const { writeFileSync } = require('node:fs');
    const path = require('node:path');
    assert.equal(process.env.VVMAN_TEST_SECRET, undefined);
    assert.equal(process.env.PATH.split(path.delimiter)[0].toLowerCase(), path.dirname(process.execPath).toLowerCase());
    assert.equal(process.argv[2], 'single argument & echo not-a-shell');
    writeFileSync('confirmed.txt', 'marked');
    console.log('Test suite visible');
  `);
  const runner = await handle('save-test-runner', workspaceId, {
    name: 'Local fixture', executable: process.execPath, args: [fixture, 'single argument & echo not-a-shell'], source,
  });
  assert.match(dialogs[0].detail, /当前 Windows 用户权限/);
  assert.match(dialogs[0].detail, /single argument & echo not-a-shell/);
  assert.ok(dialogs[0].detail.includes(root));
  assert.deepEqual(await handle('list-test-runners', workspaceId), [runner]);
  const prepared = { workspace_id: workspaceId, project_sources: [{ source, root_key: key }] };
  const [tool] = await workflow.prepareTools(prepared, [{ name: 'run_project_tests', requires_confirmation: true }]);
  assert.deepEqual(tool.inputSchema.properties.preset_id.oneOf, [{ const: runner.id, title: runner.name }]);
  assert.equal(tool.requires_confirmation, undefined);

  source = 'source_2';
  approved = false;
  const cancelled = await handle('run-tests', workspaceId, runner.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.reason, 'rejected');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  approved = 420;
  assert.equal((await handle('run-tests', workspaceId, runner.id)).reason, 'dialog_closed');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  approved = true;
  const previous = process.env.VVMAN_TEST_SECRET;
  process.env.VVMAN_TEST_SECRET = auth;
  try {
    const result = await handle('run-tests', workspaceId, runner.id);
    assert.equal(result.status, 'passed');
    assert.equal(result.exitCode, 0);
    assert.equal(result.cwd, root);
    assert.match(result.output, /Test suite visible/);
    assert.equal(await readFile(marker, 'utf8'), 'marked');
  } finally {
    if (previous === undefined) delete process.env.VVMAN_TEST_SECRET;
    else process.env.VVMAN_TEST_SECRET = previous;
  }
  assert.equal(dialogs.length, 4);
  assert.equal(seen.filter(item => item.root_key === key).length, 4);
  const abort = new AbortController();
  const updates = [];
  let nextApproval = Promise.withResolvers();
  const turn = { project: { prepared }, agentId: 'fixture-agent', conversationId: 'fixture-chat',
    signal: abort.signal, onUpdate(event) {
      updates.push(event);
      if (event.acpPermission) nextApproval.resolve(event.acpPermission);
    } };
  turn.live = new AcpLive(turn, MAX_CALLS);
  t.after(() => abort.abort());
  let resolverCalls = 0;
  const client = { async projectRoot(_turn, request) {
    assert.deepEqual(request, { name: 'run_project_tests', root_key: key });
    resolverCalls += 1;
    return { workspace_id: workspaceId, root_path: root, root_key: key, source };
  } };
  const signal = abort.signal;
  await assert.rejects(workflow.tool(turn, client, { name: 'run_project_tests',
    arguments: { preset_id: runner.id, executable: process.execPath } }, signal), /只接受/);
  const mcp = new SessionMcp([tool], () => turn, (owner, request, requestSignal) =>
    workflow.tool(owner, client, request, requestSignal));
  await mcp.listen();
  t.after(() => mcp.close());
  const { url, headers: authHeaders } = mcp.descriptor(true);
  const invoke = (id, requestSignal) => fetch(url, { method: 'POST', signal: requestSignal,
    headers: { Authorization: authHeaders[0].value, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'run_project_tests', arguments: { preset_id: runner.id } } }),
  }).then(async reply => (await reply.json()).result);
  await rm(marker);
  const rejection = invoke('reject');
  const approval = await nextApproval.promise;
  assert.equal(approval.kind, 'test');
  assert.deepEqual(approval.details, { executable: runner.executable, args: runner.args, cwd: root, presetName: runner.name });
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  turn.live.respond(approval.requestId, 'reject_once');
  assert.equal(JSON.parse((await rejection).content[0].text).reason, 'rejected');
  assert.match(updates.at(-1).toolProgress.message, /测试未运行/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });

  nextApproval = Promise.withResolvers();
  const disconnected = new AbortController();
  const abandoned = invoke('disconnect', disconnected.signal);
  const stale = await nextApproval.promise;
  const closedRequest = Promise.withResolvers();
  const nativeUpdate = turn.onUpdate;
  turn.onUpdate = event => {
    nativeUpdate(event);
    if (event.acpPermissionClosed?.requestId === stale.requestId) closedRequest.resolve();
  };
  disconnected.abort();
  await assert.rejects(abandoned, { name: 'AbortError' });
  await closedRequest.promise;
  assert.throws(() => turn.live.respond(stale.requestId, 'allow_once'), /已结束/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });

  nextApproval = Promise.withResolvers();
  const accepted = invoke('allow');
  const request = await nextApproval.promise;
  turn.live.respond(request.requestId, 'allow_once');
  assert.equal(JSON.parse((await accepted).content[0].text).status, 'passed');
  assert.equal(await readFile(marker, 'utf8'), 'marked');
  assert.throws(() => turn.live.respond(request.requestId, 'allow_once'), /已结束/);
  nextApproval = Promise.withResolvers();
  const rerun = invoke('run-again');
  const next = await nextApproval.promise;
  assert.notEqual(next.requestId, request.requestId);
  turn.live.respond(next.requestId, 'reject_once');
  assert.equal(JSON.parse((await rerun).content[0].text).reason, 'rejected');
  assert.equal(dialogs.length, 4);
  assert.equal(resolverCalls, 5);

  const git = path.join(process.env.ProgramW6432 || process.env.ProgramFiles, 'Git', 'cmd', 'git.exe');
  const gitCall = (...args) => execFileSync(git, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8' });
  gitCall('init');
  const tracked = path.join(root, 'track.txt');
  const literal = path.join(root, 'literal[1].txt');
  const decoy = path.join(root, 'literal1.txt');
  await writeFile(tracked, 'original\n');
  await writeFile(literal, 'original literal\n');
  await writeFile(decoy, 'original decoy\n');
  await writeFile(path.join(root, '.gitattributes'), 'attributes.txt text eol=crlf\nraw.txt -text\n');
  for (const file of ['system.txt', 'attributes.txt', 'raw.txt']) await writeFile(path.join(root, file), 'alpha\nbeta\n');
  await mkdir(path.join(root, 'deleted-folder'));
  await writeFile(path.join(root, 'deleted-folder', 'child.txt'), 'outside filter\n');
  gitCall('--literal-pathspecs', 'add', '--', 'track.txt', 'literal[1].txt', 'literal1.txt', 'deleted-folder/child.txt',
    '.gitattributes', 'system.txt', 'attributes.txt', 'raw.txt');
  gitCall('-c', 'user.name=VV MAN fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  await writeFile(tracked, 'staged\n');
  gitCall('add', 'track.txt');
  await writeFile(tracked, 'unstaged\n');
  await writeFile(literal, 'staged literal\n');
  gitCall('--literal-pathspecs', 'add', '--', 'literal[1].txt');
  await writeFile(literal, 'unstaged literal\n');
  await writeFile(decoy, 'private decoy content\n');
  await writeFile(path.join(root, 'new[1].txt'), 'new literal\n');
  await writeFile(path.join(root, 'new1.txt'), 'new decoy\n');
  gitCall('rm', '-r', 'deleted-folder');
  const before = await readFile(path.join(root, '.git', 'index'));
  const changes = await handle('git-diff', workspaceId, source);
  assert.match(changes.staged, /\+staged/);
  assert.match(changes.unstaged, /\+unstaged/);
  assert.ok(changes.untracked.includes('confirmed.txt'));
  assert.equal(changes.truncated, false);
  assert.deepEqual(await readFile(path.join(root, '.git', 'index')), before);
  assert.equal(await readFile(tracked, 'utf8'), 'unstaged\n');
  await mkdir(path.join(root, 'nested'));
  await assert.rejects(handle('git-diff', workspaceId, '../nested'), /项目来源/);

  const gitTool = { name: 'project_git_diff', description: 'Git diff', inputSchema: { type: 'object', properties: {
    source: { type: 'string' },
  } } };
  await workflow.prepareTools(prepared, [gitTool]);
  assert.deepEqual(Object.keys(gitTool.inputSchema.properties), ['source', 'path']);
  turn.toolCalls = 0;
  const gitMcp = new SessionMcp([gitTool], () => turn, (owner, request, requestSignal) => workflow.tool(owner, {
    async projectRoot(_turn, settings) {
      assert.deepEqual(settings, { name: gitTool.name, source });
      return { workspace_id: workspaceId, root_path: root, root_key: key, source };
    },
  }, request, requestSignal));
  await gitMcp.listen();
  t.after(() => gitMcp.close());
  const descriptor = gitMcp.descriptor(true);
  const filtered = async file => {
    const response = await fetch(descriptor.url, { method: 'POST',
      headers: { Authorization: descriptor.headers[0].value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'git-' + file, method: 'tools/call',
        params: { name: gitTool.name, arguments: { source, path: file } } }),
    });
    return (await response.json()).result;
  };
  const selected = JSON.parse((await filtered('literal[1].txt')).content[0].text);
  assert.match(selected.staged, /\+staged literal/);
  assert.match(selected.unstaged, /\+unstaged literal/);
  assert.doesNotMatch(JSON.stringify(selected), /decoy|track\.txt|deleted-folder/);
  assert.deepEqual(JSON.parse((await filtered('new[1].txt')).content[0].text).untracked, ['new[1].txt']);
  for (const invalid of ['../track.txt', 'nested', 'deleted-folder', 'track.txt|whoami', ':(glob)track.txt', '.git/config']) {
    assert.equal((await filtered(invalid)).isError, true, invalid);
  }

  turn.toolCalls = 0;
  const isolatedDiff = async file => {
    const response = await filtered(file);
    assert.equal(response.isError, false);
    return JSON.parse(response.content[0].text).unstaged;
  };
  const nativeDiff = file => gitCall('diff', '--no-color', '--no-ext-diff', '--no-textconv', '--', file);
  await writeFile(path.join(root, 'system.txt'), 'alpha\r\nbeta\r\n');
  // Compare with the trusted Git for Windows distribution setting.
  assert.equal(await isolatedDiff('system.txt'), nativeDiff('system.txt'));
  gitCall('config', '--local', 'core.autocrlf', 'false');
  assert.match(await isolatedDiff('system.txt'), /\+alpha\r\n/);
  assert.equal(await isolatedDiff('system.txt'), nativeDiff('system.txt'));
  await writeFile(path.join(root, 'attributes.txt'), 'alpha\r\nbeta\r\n');
  assert.equal(await isolatedDiff('attributes.txt'), '');
  await writeFile(path.join(root, 'attributes.txt'), 'alpha\r\nBETTER\r\n');
  assert.match(await isolatedDiff('attributes.txt'), /\+BETTER\n/);
  assert.equal(await isolatedDiff('attributes.txt'), nativeDiff('attributes.txt'));
  gitCall('config', '--local', 'core.autocrlf', 'true');
  assert.equal(await isolatedDiff('system.txt'), '');
  await writeFile(path.join(root, 'raw.txt'), 'alpha\r\nbeta\r\n');
  assert.match(await isolatedDiff('raw.txt'), /\+alpha\r\n/);
  assert.equal(await isolatedDiff('raw.txt'), nativeDiff('raw.txt'));
  gitCall('config', '--local', 'core.autocrlf', 'input');
  assert.equal(await isolatedDiff('system.txt'), '');

  // Untrusted filter names remain inert even when attributes request one.
  await writeFile(path.join(root, '.gitattributes'), 'system.txt text filter=unsafe\n');
  gitCall('config', '--local', 'filter.unsafe.clean', 'echo filtered-out');
  gitCall('config', '--local', 'filter.unsafe.required', 'true');
  assert.equal(await isolatedDiff('system.txt'), '');
  const include = path.join(root, 'included.gitconfig');
  await writeFile(include, '[core]\n autocrlf = false\n');
  await writeFile(path.join(root, '.gitattributes'), '');
  gitCall('config', '--local', 'include.path', include);
  assert.match(nativeDiff('system.txt'), /\+alpha\r\n/);
  assert.equal(await isolatedDiff('system.txt'), '');

  const createJob = (name, args) => {
    const id = String(jobs.size + 2).repeat(32);
    const state = { name, args };
    jobs.set(id, state);
    return { id, state };
  };
  const listJob = createJob('list_project_test_runners', {});
  assert.deepEqual(await handle('prepare-development', conversationId, listJob.id), { kind: 'complete' });
  assert.deepEqual(JSON.parse(listJob.state.result.content[0].text), { runners: [{ id: runner.id, name: runner.name, source }] });
  const gitJob = createJob('project_git_diff', { source, path: 'literal[1].txt' });
  assert.deepEqual(await handle('prepare-development', conversationId, gitJob.id), { kind: 'complete' });
  assert.match(JSON.parse(gitJob.state.result.content[0].text).unstaged, /\+unstaged literal/);
  const deniedJob = createJob('run_project_tests', { preset_id: runner.id });
  await rm(marker);
  const preview = await handle('prepare-development', conversationId, deniedJob.id);
  assert.deepEqual(preview, { kind: 'approval', details: { executable: runner.executable, args: runner.args, cwd: root,
    presetName: runner.name } });
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await handle('respond-development', conversationId, deniedJob.id, false);
  assert.equal(JSON.parse(deniedJob.state.result.content[0].text).reason, 'rejected');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  const runJob = createJob('run_project_tests', { preset_id: runner.id });
  await handle('prepare-development', conversationId, runJob.id);
  await assert.rejects(handle('respond-development', '9'.repeat(32), runJob.id, true), /已结束/);
  assert.deepEqual(await handle('respond-development', conversationId, runJob.id, true), { kind: 'complete' });
  assert.equal(JSON.parse(runJob.state.result.content[0].text).status, 'passed');
  assert.equal(await readFile(marker, 'utf8'), 'marked');
  await assert.rejects(handle('respond-development', conversationId, runJob.id, true), /已结束/);
  const cancelJob = createJob('run_project_tests', { preset_id: runner.id });
  await handle('prepare-development', conversationId, cancelJob.id);
  handle('cancel-development', conversationId, cancelJob.id);
  await assert.rejects(handle('respond-development', conversationId, cancelJob.id, true), /已结束/);
  assert.equal(cancelJob.state.result, undefined);
});

test('worktree creation checks out the confirmed commit and binds only the selected chat', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vvman-chat-worktree-test-')));
  const base = path.join(scratch, 'original');
  const worktrees = path.join(scratch, 'project-worktrees');
  const workspaceId = 'ws_aabbccddeeff';
  const conversationId = '1'.repeat(32);
  const siblingId = '2'.repeat(32);
  const baseKey = 'a'.repeat(64);
  const worktreeKey = 'b'.repeat(64);
  const auth = 'worktree-fixture-native';
  let accept = false;
  let binding;
  let lastDialog;
  const opened = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers['x-data-agent-native'], auth);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const url = request.url;
    const original = { workspace_id: workspaceId, source: 'source_1', root_path: base, root_key: baseKey };
    let out;
    if (url.endsWith('/worktree-target') && !binding) {
      assert.deepEqual(args, { source: 'source_1' });
      out = { ...original, worktrees_path: worktrees };
    } else if (url.endsWith('/' + conversationId + '/worktree')) {
      assert.equal(args.base_root_key, baseKey);
      assert.equal(args.source, 'source_1');
      assert.equal(path.dirname(args.root_path), worktrees);
      assert.match(args.branch, new RegExp('^vvman/' + conversationId + '-[a-f0-9]{16}$'));
      binding = args;
      out = { worktree: { source: args.source, branch: args.branch, commit: args.commit, label: 'worktree', created_at: 1 } };
    } else if (url.endsWith('/' + conversationId + '/worktree-location') && binding) {
      out = { root_path: binding.root_path };
    } else if (url.endsWith('/' + conversationId + '/development-target') && binding) {
      if (args.name === 'run_project_tests') assert.equal(args.root_key, baseKey);
      out = { ...original, root_path: binding.root_path, root_key: worktreeKey, base_root_key: baseKey, base_root_path: base };
    } else if (url.endsWith('/' + siblingId + '/development-target') || url.endsWith('/' + workspaceId + '/development-target')) {
      out = original;
    }
    response.writeHead(out ? 200 : 409, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(out || {}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const handlers = new Map();
  const frame = { url: origin + '/' };
  const window = { webContents: { mainFrame: frame }, isDestroyed: () => false };
  const event = { sender: window.webContents, senderFrame: frame };
  const workflow = new ProjectWorkflow({ origin, token: auth, window, profileDir: scratch,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    shell: { async openPath(directory) { opened.push(directory); return ''; } },
    dialog: { async showMessageBox(_window, options) { lastDialog = options; return { response: Number(accept) }; } },
  });
  t.after(async () => {
    workflow.reset();
    server.close();
    const safePrefix = (await realpath(os.tmpdir())).toLowerCase() + path.sep;
    assert.ok(scratch.toLowerCase().startsWith(safePrefix) && path.basename(scratch).startsWith('vvman-chat-worktree-test-'));
    await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
  });
  const handle = (action, ...args) => handlers.get('vvman-projects:' + action)(event, ...args);
  await mkdir(base);
  const git = path.join(process.env.ProgramW6432 || process.env.ProgramFiles, 'Git', 'cmd', 'git.exe');
  const gitCall = (directory, ...args) => execFileSync(git, args, { cwd: directory, windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  gitCall(base, 'init');
  gitCall(base, 'config', 'core.autocrlf', 'false');
  await writeFile(path.join(base, 'README.md'), 'committed\n');
  await writeFile(path.join(base, 'verify.cjs'), "console.log(require('node:fs').readFileSync('README.md', 'utf8').trim());\n");
  await writeFile(path.join(base, '.gitattributes'), 'README.md filter=untrusted\n');
  gitCall(base, 'add', 'README.md', 'verify.cjs', '.gitattributes');
  gitCall(base, '-c', 'user.name=VV MAN fixture', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'first');
  gitCall(base, 'config', 'filter.untrusted.smudge', 'echo unwanted replacement');
  gitCall(base, 'config', 'filter.untrusted.required', 'true');
  const hookMarker = path.join(base, 'unexpected-hook.txt');
  await writeFile(path.join(base, '.git', 'hooks', 'post-checkout'),
    '#!/bin/sh\nprintf ran > "' + hookMarker.replaceAll('\\', '/') + '"\n');
  const commit = gitCall(base, 'rev-parse', 'HEAD');
  await writeFile(path.join(base, 'README.md'), 'original uncommitted\n');
  const beforeIndex = await readFile(path.join(base, '.git', 'index'));
  assert.equal(await handle('create-worktree', conversationId, 'source_1'), null);
  assert.equal(lastDialog.title, '创建聊天工作树');
  assert.match(lastDialog.detail, new RegExp(commit));
  await assert.rejects(readFile(path.join(worktrees, 'missing')), { code: 'ENOENT' });
  accept = true;
  const created = await handle('create-worktree', conversationId, 'source_1');
  assert.equal(created.worktree.commit, commit);
  const checkout = binding.root_path;
  assert.equal(await readFile(path.join(checkout, 'README.md'), 'utf8'), 'committed\n');
  await assert.rejects(readFile(hookMarker), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(base, '.git', 'index')), beforeIndex);
  assert.equal(await readFile(path.join(base, 'README.md'), 'utf8'), 'original uncommitted\n');
  const markerPath = path.join(checkout, '.git');
  const nativeMarker = (await readFile(markerPath, 'utf8')).trim();
  const expectedMetadata = path.join(base, '.git', 'worktrees', path.basename(checkout));
  assert.equal(path.resolve(nativeMarker.slice('gitdir: '.length)).toLowerCase(), expectedMetadata.toLowerCase());
  const clean = await handle('git-diff', workspaceId, undefined, conversationId);
  assert.deepEqual(clean, { staged: '', unstaged: '', untracked: [], truncated: false });
  await writeFile(path.join(checkout, 'README.md'), 'changed only in worktree\n');
  const diff = await handle('git-diff', workspaceId, undefined, conversationId);
  assert.match(diff.unstaged, /\+changed only in worktree/);
  const sibling = await handle('git-diff', workspaceId, undefined, siblingId);
  assert.match(sibling.unstaged, /\+original uncommitted/);
  const runner = await handle('save-test-runner', workspaceId, {
    name: 'Fixture', source: 'source_1', executable: process.execPath, args: ['verify.cjs'],
  });
  const report = await handle('run-tests', workspaceId, runner.id, conversationId);
  assert.equal(report.status, 'passed');
  assert.equal(report.cwd, checkout);
  assert.equal(report.output.trim(), 'changed only in worktree');
  await handle('open-worktree', conversationId);
  assert.deepEqual(opened, [checkout]);
  await rename(markerPath, path.join(checkout, '.git.original'));
  for (const forged of [
    path.join(base, '.git'),
    'Z:\\unrelated-worktrees\\' + path.basename(checkout),
    '\\\\unreachable.invalid\\worktrees\\' + path.basename(checkout),
    path.join(base, '.git', 'worktrees', '0'.repeat(32) + '-abcdef0123456789'),
  ]) {
    await writeFile(markerPath, 'gitdir: ' + forged + '\n');
    await assert.rejects(handle('git-diff', workspaceId, undefined, conversationId), /Git 目录已变更/);
  }
});
