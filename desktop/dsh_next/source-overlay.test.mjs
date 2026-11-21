import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applySomnusBuiltOverlay, prepareSomnusSourceOverlay, sourceProfileBootFile, verifySomnusSourceEntry } from './source-overlay.mjs';
import { createSomnusChanges } from './stage-next.mjs';

const owner = resolve(fileURLToPath(new URL('../../', import.meta.url)));

async function workspace(t, configuration = "export default [{ entry: ['lib/types/main.js'], outDir: 'lib' }];\n") {
  const root = await mkdtemp(join(tmpdir(), 'somnus-source-overlay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'apps/desktop'), { recursive: true });
  await writeFile(join(root, 'apps/desktop/tsdown.config.ts'), configuration);
  return root;
}

test('source preparation selects Somnus entry while retaining upstream desktop implementation imports', async t => {
  const root = await workspace(t);
  const result = await prepareSomnusSourceOverlay(root);
  const main = await readFile(join(root, 'apps/desktop/somnus-source/main.mjs'), 'utf8');
  const desktop = await readFile(join(root, 'apps/desktop/somnus-source/standalone-main.mjs'), 'utf8');
  const helper = await readFile(join(root, 'apps/desktop/somnus-source/somnus-desktop.mjs'), 'utf8');
  assert.match(main, /import \{ DesktopHostProcess \} from '\.\.\/lib\/types\/host-process\.js'/);
  assert.match(main, /startSomnus\(/);
  verifySomnusSourceEntry(main);
  assert.doesNotMatch(main, /import .*\/main\.js/);
  assert.match(await readFile(join(root, 'apps/desktop/tsdown.config.ts'), 'utf8'), /entry: \{ main: 'somnus-source\/main\.mjs' \}/);
  assert.match(desktop, /SOMNUSNEXT_RESOURCES must be an absolute/);
  assert.match(helper, /if \(app\.isPackaged\) return process\.resourcesPath/);
  assert.equal(result.entry, 'somnus-source/main.mjs');
  assert.equal(result.commit, 'f2483c6d26104b3594cb0e22f56c0331b55dfffe');
  assert.ok(Object.keys(result.files).includes('somnus-source/standalone-main.mjs'));
  assert.deepEqual(await prepareSomnusSourceOverlay(root), result);
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'node_modules/dependency-sentinel'), 'keep installed dependencies');
  await writeFile(join(root, 'apps/desktop/tsdown.config.ts'), "export default [{ entry: ['lib/types/main.js'], outDir: 'lib' }];\n");
  assert.deepEqual(await prepareSomnusSourceOverlay(root), result);
  assert.equal(await readFile(join(root, 'node_modules/dependency-sentinel'), 'utf8'), 'keep installed dependencies');
  await writeFile(join(root, 'apps/desktop/somnus-source/main.mjs'), main + '// manual edit\n');
  await assert.rejects(prepareSomnusSourceOverlay(root), /was edited/);
});

test('preparation refuses the maintained checkout and an upstream compiler configuration it does not understand', async t => {
  await assert.rejects(prepareSomnusSourceOverlay(owner), /isolated build workspace/);
  const root = await workspace(t, 'export default []\n');
  await assert.rejects(prepareSomnusSourceOverlay(root), /upstream|上游/);
  await assert.rejects(readFile(join(root, 'somnus-source-overlay.json')), { code: 'ENOENT' });
});

test('source compiler chunk lookup accepts new hashes and rejects missing or ambiguous profile boot code', () => {
  const prefix = '/dsh/node_modules/@deepseek-ai/dsh/lib/';
  assert.equal(sourceProfileBootFile([prefix + 'profile-boot-NewCompilerHash.js']), prefix.slice(1) + 'profile-boot-NewCompilerHash.js');
  assert.throws(() => sourceProfileBootFile([]), /found 0/);
  assert.throws(() => sourceProfileBootFile([prefix + 'profile-boot-A.js', prefix + 'profile-boot-B.js']), /found 2/);
  assert.throws(() => sourceProfileBootFile(['/wrong/node_modules/profile-boot-A.js']), /found 0/);
});

test('entry verification refuses an upstream launcher and the previous binary overlay entry', () => {
  assert.throws(() => verifySomnusSourceEntry('import { app } from "electron"; app.whenReady();'), /not compiled with the Somnus source entry/);
  assert.throws(() => verifySomnusSourceEntry('startSomnus({ DesktopHostProcess });'), /not compiled with the Somnus source entry/);
});

test('source finalization rejects installed app targets before loading archive dependencies', async t => {
  const root = await workspace(t);
  const app = join(root, 'app');
  await mkdir(app);
  await assert.rejects(applySomnusBuiltOverlay(app, { sourceRoot: root, somnusRoot: root }), /must not replace the current app/);
});

test('repository-local build copies require explicit opt-in, the dedicated cache and an owner marker', async t => {
  const root = join(owner, '.source-build-cache', 'overlay-test-' + randomUUID());
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'apps/desktop'), { recursive: true });
  await writeFile(join(root, 'apps/desktop/tsdown.config.ts'), "export default [{ entry: ['lib/types/main.js'], outDir: 'lib' }];\n");
  await writeFile(join(root, '.somnus-build-workspace.json'), JSON.stringify({ schema: 1, projectRoot: owner, upstreamCommit: 'wrong' }));
  await assert.rejects(prepareSomnusSourceOverlay(root), /isolated build workspace/);
  await assert.rejects(prepareSomnusSourceOverlay(root, { allowLocalWorkspace: true }), /isolated build workspace/);
  const release = JSON.parse(await readFile(join(owner, 'desktop/dsh_next/next-release.json'), 'utf8'));
  await writeFile(join(root, '.somnus-build-workspace.json'), JSON.stringify({ schema: 1, projectRoot: owner, upstreamCommit: release.commit }));
  assert.equal((await prepareSomnusSourceOverlay(root, { allowLocalWorkspace: true })).commit, release.commit);
});

test('source finalization refuses output from a different build workspace', async t => {
  const root = await workspace(t);
  const another = await workspace(t);
  await assert.rejects(applySomnusBuiltOverlay(another, { sourceRoot: root }), /belong to this isolated source workspace/);
});

test('release and source transforms refuse unrecognized inputs before reading any runtime files', async () => {
  const files = [];
  const read = file => { files.push(file); return Buffer.from(JSON.stringify({ name: 'not-the-pinned-release', main: 'lib/main.js' })); };
  await assert.rejects(createSomnusChanges(read), /Expected the unmodified/);
  await assert.rejects(createSomnusChanges(read, { sourceBuild: { commit: 'different', entry: 'somnus-source/main.mjs' }, profileBootFile: 'dsh/node_modules/@deepseek-ai/dsh/lib/profile-boot-new.js' }), /source build does not carry/);
  assert.deepEqual(files, ['package.json', 'package.json']);
});
