const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { backendCommand, startBackend } = require('./backend.cjs');

const fixture = `
const fs = require('node:fs');
const http = require('node:http');
const behavior = process.argv[2];
const readyFile = process.argv[process.argv.indexOf('--ready-file') + 1];
const server = http.createServer((request, response) => {
  if (request.url !== '/api/health') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ app_id: 'vvfly-respiratory-viewer', framework: 'fastapi' }));
});
process.stdin.on('end', () => {
  console.log('EOF received');
  server.close();
});
process.stdin.resume();
server.listen(0, '127.0.0.1', () => {
  if (behavior === 'hang') return;
  fs.writeFileSync(readyFile + '.tmp', JSON.stringify({
    pid: behavior === 'bad-pid' ? process.pid + 1 : process.pid,
    port: server.address().port,
  }));
  fs.renameSync(readyFile + '.tmp', readyFile);
});
`;

async function localBackend(t, behavior, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'electron-shell-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'fixture.cjs');
  await fs.writeFile(script, fixture);
  const log = path.join(directory, 'backend.log');
  const backend = startBackend({
    executable: process.execPath,
    args: [script, behavior],
    cwd: directory,
  }, log, options);
  t.after(() => backend.stop());
  return { backend, log };
}

test('prefers the Somnus backend and can launch an existing legacy backend during upgrade', async t => {
  const resourcesPath = await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-backend-command-'));
  t.after(() => fs.rm(resourcesPath, { recursive: true, force: true }));
  const backendDir = path.join(resourcesPath, 'backend');
  await fs.mkdir(backendDir);
  const command = {
    packaged: true,
    resourcesPath,
    sourceRoot: path.resolve('source'),
  };
  for (const [platform, suffix] of [['win32', '.exe'], ['darwin', '']]) {
    const legacy = path.join(backendDir, 'RespiratoryViewer' + suffix);
    const current = path.join(backendDir, 'SomnusBackend' + suffix);
    await fs.writeFile(legacy, '');
    assert.equal(backendCommand({ ...command, platform }).executable, legacy);
    await fs.writeFile(current, '');
    assert.deepEqual(backendCommand({ ...command, platform }), {
      executable: current,
      args: [],
      cwd: backendDir,
    });
  }
  assert.deepEqual(backendCommand({
    ...command, packaged: false, env: { RESPIRATORY_VIEWER_PYTHON: 'my-python' },
  }), {
    executable: 'my-python', args: [path.join(command.sourceRoot, 'launcher.py')], cwd: command.sourceRoot,
  });
});

test('discovers the port from its own backend and shuts it down using EOF', async t => {
  const { backend, log } = await localBackend(t, 'ready');
  const origin = await backend.ready;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  await backend.stop();
  assert.match(await fs.readFile(log, 'utf8'), /EOF received/);
});

test('rejects a ready record from another PID', async t => {
  const { backend } = await localBackend(t, 'bad-pid');
  await assert.rejects(backend.ready, /无法验证/);
  await backend.stop();
});

test('times out if the backend never announces readiness', async t => {
  const { backend } = await localBackend(t, 'hang', { timeoutMs: 250 });
  await assert.rejects(backend.ready, /启动超时/);
  await backend.stop();
});
