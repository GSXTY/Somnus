import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { assertExternalWorkspace, assertWindowsRuntimePath, defaultWorkspace, inspectBackend, pnpmCommand, prepareWorkspace, runOwnedProcess, sourceTerminalSmokeScript } from './source-build.mjs';

test('a build workspace must not overwrite either source tree', () => {
  const product = join(tmpdir(), 'somnus-source-fixture');
  const upstream = join(product, 'vendor/dsh-next');
  for (const destination of [product, join(product, 'scratch'), upstream, join(upstream, 'scratch')]) {
    assert.throws(() => assertExternalWorkspace(destination, product, upstream), /outside/);
  }
  assert.doesNotThrow(() => assertExternalWorkspace(join(tmpdir(), 'somnus-build-fixture'), product, upstream));
});

test('the default source workspace leaves headroom for Windows runtime DLL imports', () => {
  const commit = 'f2483c6d26104b3594cb0e22f56c0331b55dfffe';
  const storage = 'D:/a/_temp/s';
  const workspace = defaultWorkspace(storage, commit);
  assert.equal(workspace, join(storage, 's', commit.slice(0, 12)));
  const measured = assertWindowsRuntimePath(workspace, 'win32');
  assert.ok(measured.length <= measured.safetyBudget);
  assert.throws(() => defaultWorkspace(storage, 'not-a-commit'), /full pinned commit/);
  // This is the exact layout that failed its packaged Python lxml import in CI.
  assert.throws(() => assertWindowsRuntimePath('D:/a/_temp/somnus-source-validation/cache/dsh-source/f2483c6d2610', 'win32'), /shorter external directory/);
  assert.equal(assertWindowsRuntimePath('a'.repeat(300), 'linux'), undefined);
});

test('terminal smoke releases the ConPTY worker on natural exit and fails closed on timeout', () => {
  function fixture() {
    const state = { killed: 0, disposed: 0, cleared: 0, messages: [], process: { argv: ['fixture.exe', 'fixture'], env: {} } };
    const pty = {
      kill() { state.killed++; },
      onData(callback) { state.data = callback; return { dispose() { state.disposed++; } }; },
      onExit(callback) { state.exit = callback; return { dispose() { state.disposed++; } }; },
    };
    state.process.exit = code => { state.exited = code; };
    vm.runInNewContext(sourceTerminalSmokeScript(), {
      require: name => name === 'node:path' ? { join } : { spawn: () => pty },
      process: state.process,
      setTimeout: callback => { state.deadline = callback; return 'owned timer'; },
      clearTimeout: token => { assert.equal(token, 'owned timer'); state.cleared++; },
      console: { log: value => state.messages.push(value), error: value => state.messages.push(value) },
    });
    return state;
  }
  const natural = fixture();
  natural.data('somnus-source-pty');
  natural.exit({ exitCode: 0 });
  assert.equal(natural.killed, 1);
  assert.equal(natural.disposed, 2);
  assert.equal(natural.cleared, 1);
  assert.ok(natural.messages.includes('Somnus source terminal smoke passed'));
  const timeout = fixture();
  timeout.deadline();
  assert.equal(timeout.killed, 1);
  assert.equal(timeout.disposed, 2);
  assert.equal(timeout.process.exitCode, 1);
  assert.equal(timeout.exited, 1);
  assert.ok(timeout.messages.includes('Source terminal smoke timed out'));
});

test('the independent smoke deadline terminates its owned child instead of leaving it running', async () => {
  let childPid;
  await assert.rejects(runOwnedProcess([process.execPath, '-e', 'setInterval(() => {}, 1000)'], process.cwd(), process.env,
    { timeoutMs: 500 }), error => {
    assert.match(error.message, /exit deadline/);
    childPid = error.childPid;
    return true;
  });
  assert.ok(Number.isInteger(childPid));
  assert.throws(() => process.kill(childPid, 0), error => error.code === 'ESRCH');
});

test('an explicit pnpm JavaScript entry runs with Node and a missing entry fails visibly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnus-pnpm-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'tool'));
  const entry = join(directory, 'tool/pnpm.mjs');
  await writeFile(entry, 'console.log("11.28.5");\n');
  assert.deepEqual(pnpmCommand(entry), [process.execPath, entry]);
  assert.throws(() => pnpmCommand(join(directory, 'missing.mjs')), /Install pnpm/);
});

test('the backend must have a matching source-build receipt and cannot come from the existing app', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnus-backend-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const backend = join(directory, 'frozen');
  await mkdir(backend);
  await writeFile(join(backend, 'SomnusBackend.exe'), 'fixture');
  await assert.rejects(inspectBackend(backend, '0.3.0-test'), /ENOENT/);
  const record = join(backend, 'somnus-backend-build.json');
  await writeFile(record, JSON.stringify({ schemaVersion: 1, producer: 'SomnusNext PyInstaller', sourceVersion: 'wrong' }));
  await assert.rejects(inspectBackend(backend, '0.3.0-test'), /does not match/);
  await writeFile(record, JSON.stringify({ schemaVersion: 1, producer: 'SomnusNext PyInstaller', sourceVersion: '0.3.0-test' }));
  assert.equal(await inspectBackend(backend, '0.3.0-test'), await realpath(backend));
  assert.equal(await inspectBackend(backend, '0.3.0-test', directory), await realpath(backend));
  const existing = join(directory, 'app/resources/backend');
  await mkdir(existing, { recursive: true });
  await assert.rejects(inspectBackend(existing, '0.3.0-test', directory), /Existing app/);
});

test('pnpm/action-setup Windows shims resolve to the pinned package entry without a shell', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnus-pnpm-action-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'node_modules/.bin');
  const entry = join(directory, 'node_modules/pnpm/bin/pnpm.mjs');
  await mkdir(bin, { recursive: true });
  await mkdir(join(directory, 'node_modules/pnpm/bin'), { recursive: true });
  await writeFile(entry, 'console.log("11.28.5");\n');
  await writeFile(join(bin, 'pnpm.cmd'), '@echo off\n');
  await writeFile(join(bin, 'pnpm'), '#!/bin/sh\n');
  assert.deepEqual(pnpmCommand(join(bin, 'pnpm.cmd')), [process.execPath, entry]);
  if (process.platform === 'win32') {
    const previous = process.env.PATH;
    process.env.PATH = bin;
    try { assert.deepEqual(pnpmCommand(), [process.execPath, entry]); }
    finally { process.env.PATH = previous; }
  }
});

test('a repeated source snapshot restores tracked input while preserving installed dependencies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'somnus-snapshot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const workspace = join(directory, 'build');
  await mkdir(source);
  const execute = (args, input) => {
    const result = spawnSync('git', ['-C', source, ...args], { input, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Source test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Source test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  execute(['init']);
  await writeFile(join(source, 'owned.txt'), 'tracked input\n');
  const blob = execute(['hash-object', '-w', '--stdin'], 'tracked input\n');
  const tree = execute(['mktree'], `100644 blob ${blob}\towned.txt\n`);
  const commit = execute(['commit-tree', tree], 'source fixture\n');
  execute(['update-ref', 'HEAD', commit]);
  execute(['read-tree', 'HEAD']);
  await prepareWorkspace(source, workspace, { commit });
  await mkdir(join(workspace, 'node_modules'));
  await writeFile(join(workspace, 'node_modules/installed.txt'), 'keep dependencies');
  await writeFile(join(workspace, 'owned.txt'), 'previous generated overlay');
  await prepareWorkspace(source, workspace, { commit });
  assert.equal(await readFile(join(workspace, 'owned.txt'), 'utf8'), 'tracked input\n');
  assert.equal(await readFile(join(workspace, 'node_modules/installed.txt'), 'utf8'), 'keep dependencies');
  assert.equal(execute(['status', '--porcelain', '--untracked-files=no']), '');
  const report = join(workspace, 'somnus-source-build.json');
  await writeFile(report, JSON.stringify({ ok: true, applicationReady: true }));
  await rm(join(workspace, 'owned.txt'));
  await mkdir(join(workspace, 'owned.txt'));
  await assert.rejects(prepareWorkspace(source, workspace, { commit }));
  const failed = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(failed.ok, false);
  assert.equal(failed.applicationReady, false);
  assert.equal(failed.stage, 'preparing');
  const unowned = join(directory, 'unowned');
  await mkdir(unowned);
  await writeFile(join(unowned, 'personal.txt'), 'leave alone');
  await writeFile(join(unowned, 'somnus-source-build.json'), 'unowned report');
  await assert.rejects(prepareWorkspace(source, unowned, { commit }), /unowned/);
  assert.equal(await readFile(join(unowned, 'personal.txt'), 'utf8'), 'leave alone');
  assert.equal(await readFile(join(unowned, 'somnus-source-build.json'), 'utf8'), 'unowned report');
});

for (const representation of ['text checkout', 'directory-like Git link entry', 'real directory symlink']) {
  test(`source links are exported as Git text without traversal: ${representation}`, async t => {
    if (representation === 'real directory symlink' && process.platform === 'win32' && !process.env.GITHUB_ACTIONS) {
      t.skip('This local Windows sandbox does not permit creating symlinks; the CI runner covers real links');
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'somnus-link-source-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, 'source');
    const workspace = join(directory, 'build');
    const external = join(directory, 'outside');
    await mkdir(source);
    await mkdir(external);
    await writeFile(join(external, 'personal.txt'), 'external data must not be copied');
    const execute = (args, input) => {
      const result = spawnSync('git', ['-C', source, ...args], { input, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, GIT_AUTHOR_NAME: 'Source test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
          GIT_COMMITTER_NAME: 'Source test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    execute(['init']);
    const target = '../outside';
    const link = join(source, 'skills-link');
    if (representation === 'text checkout') await writeFile(link, target);
    else if (representation === 'directory-like Git link entry') await mkdir(link);
    else {
      try { await symlink(target, link, 'dir'); }
      catch (error) {
        if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
        t.skip('This host does not permit a real directory symlink');
        return;
      }
    }
    const blob = execute(['hash-object', '-w', '--stdin'], target);
    const tree = execute(['mktree'], `120000 blob ${blob}\tskills-link\n`);
    const commit = execute(['commit-tree', tree], 'link source fixture\n');
    execute(['update-ref', 'HEAD', commit]);
    execute(['read-tree', 'HEAD']);
    execute(['config', 'core.symlinks', representation === 'real directory symlink' ? 'true' : 'false']);
    await prepareWorkspace(source, workspace, { commit });
    const exported = join(workspace, 'skills-link');
    assert.equal(await readFile(exported, 'utf8'), target);
    assert.equal((await lstat(exported)).isFile(), true);
    assert.equal((await lstat(exported)).isSymbolicLink(), false);
    const configured = spawnSync('git', ['-C', workspace, 'config', '--get', 'core.symlinks'], { encoding: 'utf8' });
    assert.equal(configured.stdout.trim(), 'false');
    assert.equal(await readFile(join(external, 'personal.txt'), 'utf8'), 'external data must not be copied');
  });
}
