import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertExternalWorkspace, inspectBackend, pnpmCommand, prepareWorkspace } from './source-build.mjs';

test('a build workspace must not overwrite either source tree', () => {
  const product = join(tmpdir(), 'somnus-source-fixture');
  const upstream = join(product, 'vendor/dsh-next');
  for (const destination of [product, join(product, 'scratch'), upstream, join(upstream, 'scratch')]) {
    assert.throws(() => assertExternalWorkspace(destination, product, upstream), /outside/);
  }
  assert.doesNotThrow(() => assertExternalWorkspace(join(tmpdir(), 'somnus-build-fixture'), product, upstream));
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
  const unowned = join(directory, 'unowned');
  await mkdir(unowned);
  await writeFile(join(unowned, 'personal.txt'), 'leave alone');
  await assert.rejects(prepareWorkspace(source, unowned, { commit }), /unowned/);
  assert.equal(await readFile(join(unowned, 'personal.txt'), 'utf8'), 'leave alone');
});
