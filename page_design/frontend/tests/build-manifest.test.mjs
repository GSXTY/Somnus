import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { frontendBuildManifest } from '../build-manifest.mjs';

test('the Vite build manifest includes both final entries and the source of the embedded page', async t => {
  const root = await mkdtemp(join(tmpdir(), 'somnus-frontend-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'dist');
  await mkdir(join(output, 'assets'), { recursive: true });
  await mkdir(join(root, 'scripts'));
  const sources = ['build-manifest.mjs', 'index.html', 'package.json', 'pnpm-lock.yaml',
    'scripts/make-embed.mjs', 'tsconfig.json', 'vite.config.ts'];
  for (const name of sources) await writeFile(join(root, name), name);
  const index = '<html><head><script src="/workbench-assets/assets/app.js"></script></head><body></body></html>';
  const script = 'console.log("fixture");';
  await writeFile(join(output, 'index.html'), index);
  await writeFile(join(output, 'assets', 'app.js'), script);

  const plugin = frontendBuildManifest();
  plugin.configResolved({ root, build: { outDir: 'dist' } });
  await plugin.writeBundle();

  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), index);
  const embed = await readFile(join(output, 'embed.html'), 'utf8');
  assert.match(embed, /dataset\.somnusEmbed = '1'/);
  assert.match(embed, /\/workbench-assets\/assets\/app\.js/);
  const manifest = JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.source_files.map(file => file.path), sources);
  assert.deepEqual(manifest.assets, [['assets/app.js', script], ['embed.html', embed], ['index.html', index]].map(([path, text]) => ({
    path, sha256: createHash('sha256').update(text).digest('hex'), size: Buffer.byteLength(text),
  })));
});
