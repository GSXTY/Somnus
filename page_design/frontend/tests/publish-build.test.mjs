import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishBuild, verifyFrontend } from '../scripts/publish-build.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function writeBundle(folder, { embed = true, tamper = false } = {}) {
  await mkdir(join(folder, 'assets'), { recursive: true });
  const files = { 'index.html': '<html><body>app</body></html>', 'assets/app.js': 'console.log("x");' };
  if (embed) files['embed.html'] = '<html><body>embed</body></html>';
  for (const [name, text] of Object.entries(files)) await writeFile(join(folder, name), text);
  const assets = Object.entries(files).map(([path, text]) => ({
    path, sha256: digest(text), size: Buffer.byteLength(text),
  }));
  if (tamper) await writeFile(join(folder, 'assets/app.js'), 'tampered');
  await writeFile(join(folder, 'build-manifest.json'), JSON.stringify({ schema_version: 1, producer: 'somnus-frontend', assets }));
}

test('verification rejects a bundle without the embed entry and a tampered asset', async t => {
  const root = await mkdtemp(join(tmpdir(), 'somnus-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeBundle(join(root, 'no-embed'), { embed: false });
  await assert.rejects(verifyFrontend(join(root, 'no-embed')), /Missing frontend entry: embed.html/);
  await writeBundle(join(root, 'tampered'), { tamper: true });
  await assert.rejects(verifyFrontend(join(root, 'tampered')), /verification failed/);
});

test('publish only replaces live resources after the candidate is verified', async t => {
  const root = await mkdtemp(join(tmpdir(), 'somnus-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'web');
  const storage = join(root, 'storage');

  const result = await publishBuild({ output, storage,
    build: async ({ build }) => { await writeBundle(build.outDir); } });
  assert.equal(result.assets, 3);
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), '<html><body>app</body></html>');

  // A failing build must leave the previously published bundle untouched.
  await assert.rejects(publishBuild({ output, storage,
    build: async ({ build }) => { await writeBundle(build.outDir, { embed: false }); } }),
  /Missing frontend entry: embed.html/);
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), '<html><body>app</body></html>');
  assert.equal((await readFile(join(output, 'embed.html'), 'utf8')).includes('embed'), true);
});
