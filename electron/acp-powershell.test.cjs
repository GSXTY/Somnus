const assert = require('node:assert/strict');
const { access, mkdtemp, readFile, realpath, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { ProjectWorkflow, POWERSHELL_TOOL } = require('./acp-project-workflow.cjs');

const workspaceId = 'ws_001122aabbcc';
const rootKey = 'a'.repeat(64);
const win = { skip: process.platform !== 'win32' };
const payload = reply => JSON.parse(reply.content[0].text);

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'somnus-powershell-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workflow = new ProjectWorkflow({ profileDir: root });
  const target = { workspace_id: workspaceId, root_path: root, root_key: rootKey, source: 'source_1' };
  return { root, target, workflow };
}

test('PowerShell is offered only in full mode', async () => {
  const workflow = new ProjectWorkflow({ profileDir: os.tmpdir() });
  const tools = [{ name: POWERSHELL_TOOL }];
  for (const mode of ['read_only', 'workspace_write']) {
    const prepared = { permission_mode: mode, workspace_id: workspaceId };
    assert.deepEqual(await workflow.prepareTools(prepared, tools), []);
    await assert.rejects(workflow.tool({ project: { prepared } }, {}, { name: POWERSHELL_TOOL }, new AbortController().signal), /完全访问/);
  }
  assert.deepEqual(await workflow.prepareTools({ permission_mode: 'full' }, tools), tools);
});

test('full access executes PowerShell directly in the revalidated project and filters app env', win, async t => {
  const { root, target, workflow } = await fixture(t);
  const command = "Set-Content -LiteralPath confirmed.txt -Value 'synthetic'; Write-Output ((Get-Location).Path); Write-Output ('sensitive=' + $Env:SOMNUS_TEST_POWERSHELL_SECRET)";
  const file = path.join(root, 'confirmed.txt');
  let rootCalls = 0;
  const client = { async projectRoot(_turn, request) {
    rootCalls++;
    assert.deepEqual(request, { name: POWERSHELL_TOOL, source: 'source_1' });
    return target;
  } };
  const abort = new AbortController();
  const turn = { project: { prepared: { workspace_id: workspaceId, permission_mode: 'full' } },
    live: { requestDecision() { assert.fail('full-access PowerShell must not ask for a second approval'); } } };
  const request = { name: POWERSHELL_TOOL, arguments: { command, source: 'source_1' } };
  const old = process.env.SOMNUS_TEST_POWERSHELL_SECRET;
  process.env.SOMNUS_TEST_POWERSHELL_SECRET = 'must-not-inherit';
  t.after(() => {
    if (old === undefined) delete process.env.SOMNUS_TEST_POWERSHELL_SECRET;
    else process.env.SOMNUS_TEST_POWERSHELL_SECRET = old;
  });
  const output = payload(await workflow.tool(turn, client, request, abort.signal));
  assert.equal(output.status, 'passed');
  assert.equal(output.exitCode, 0);
  assert.match(output.output, /^sensitive=\r?$/m);
  assert.doesNotMatch(output.output, /must-not-inherit/);
  assert.ok(output.output.toLowerCase().includes(root.toLowerCase()));
  assert.equal(rootCalls, 2);
  assert.match(await readFile(file, 'utf8'), /synthetic/);
});

test('Windows revalidation, nonzero exit and output cap are enforced', win, async t => {
  const { root, workflow } = await fixture(t);
  const abort = new AbortController();
  let targets = 0;
  const changed = async () => ({ root, rootKey: (targets++ === 0 ? 'a' : 'b').repeat(64), source: 'source_1' });
  await assert.rejects(workflow.developmentTool(workspaceId, POWERSHELL_TOOL,
    { command: 'Set-Content -LiteralPath unexpected.txt -Value bad' }, changed, abort.signal), /项目或 PowerShell 已变更/);
  await assert.rejects(access(path.join(root, 'unexpected.txt')), { code: 'ENOENT' });
  const current = async () => ({ root, rootKey, source: 'source_1' });
  const result = payload(await workflow.developmentTool(workspaceId, POWERSHELL_TOOL,
    { command: "Write-Output ('x' * 80000); exit 7" }, current, abort.signal));
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 7);
  assert.equal(result.truncated, true);
  assert.equal(Buffer.byteLength(result.output), 64 * 1024);
});

test('a Shell budget applies to real command output and runtime', win, async t => {
  const { root, workflow } = await fixture(t);
  const current = async () => ({ root, rootKey, source: 'source_1' });
  const signal = new AbortController().signal;
  const settings = { timeoutSeconds: 1, outputKiB: 2 };
  const output = payload(await workflow.developmentTool(workspaceId, POWERSHELL_TOOL,
    { command: "Write-Output ('x' * 4096)" }, current, signal, undefined, settings));
  assert.equal(output.status, 'passed');
  assert.equal(output.truncated, true);
  assert.equal(Buffer.byteLength(output.output), 2 * 1024);
  const timeout = payload(await workflow.developmentTool(workspaceId, POWERSHELL_TOOL,
    { command: 'Start-Sleep -Seconds 15' }, current, signal, undefined, settings));
  assert.equal(timeout.status, 'timeout');
});

test('cancellation ends an active Windows PowerShell process and its children', win, async t => {
  const { root, workflow } = await fixture(t);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const pidFile = path.join(root, 'child.pid');
  const command = String.raw`$child = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 15"' -PassThru -WindowStyle Hidden
Set-Content -LiteralPath child.pid -Value $child.Id
$child.WaitForExit()
Set-Content -LiteralPath after.txt -Value bad`;
  const pending = workflow.runPowerShell({ command }, async () => ({ root, rootKey, source: 'source_1' }),
    abort.signal);
  let pid;
  for (let count = 0; count < 70 && !pid; count++) {
    pid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
    if (!pid) await delay(100);
  }
  assert.ok(pid, 'PowerShell child process started');
  abort.abort();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await assert.rejects(access(path.join(root, 'after.txt')), { code: 'ENOENT' });
});
