/**
 * Build the workbench bundle in disposable storage, verify it against its
 * manifest, then publish it atomically. A failure never leaves a half-written
 * page_design/web behind: the live copy is only replaced after the candidate
 * has been verified, and the previous copy is restored if the swap fails.
 */
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath } from '../../../desktop/storage-paths.mjs';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const project = path.resolve(frontend, '../..');

const exists = async value => lstat(value).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

export async function verifyFrontend(output) {
  const manifest = JSON.parse(await readFile(path.join(output, 'build-manifest.json'), 'utf8'));
  if (manifest.producer !== 'somnus-frontend' || !Array.isArray(manifest.assets)) throw Error('Invalid frontend build manifest');
  const seen = new Set();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.path !== 'string' || !asset.path || seen.has(asset.path)
      || !Number.isSafeInteger(asset.size) || asset.size < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw Error('Invalid or duplicate frontend asset');
    }
    seen.add(asset.path);
  }
  // Every entry the desktop shell loads must be present; a missing embed.html
  // turns the sidebar panels blank without failing the build otherwise.
  for (const entry of ['index.html', 'embed.html']) {
    if (!manifest.assets.some(asset => asset.path === entry)) throw Error('Missing frontend entry: ' + entry);
  }
  for (const asset of manifest.assets) {
    const location = path.resolve(output, asset.path);
    const relative = path.relative(output, location);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Invalid build asset path');
    const bytes = await readFile(location);
    if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw Error('Frontend asset verification failed: ' + asset.path);
    }
  }
  return { assets: manifest.assets.length, bytes: manifest.assets.reduce((sum, asset) => sum + asset.size, 0) };
}

async function assertOrdinaryDirectory(location) {
  if (await exists(location)) {
    const info = await lstat(location);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Build output must be an ordinary directory: ' + location);
  }
}

export async function publishBuild({ output = path.resolve(frontend, '../web'),
  storage = cachePath(project, 'frontend', 'builds'), build, move = rename } = {}) {
  output = path.resolve(output);
  await assertOrdinaryDirectory(output);
  await mkdir(storage, { recursive: true });
  const scratch = await mkdtemp(path.join(storage, 'build-'));
  const staged = path.join(scratch, 'web');
  const candidate = output + '.pending-' + randomUUID();
  const backup = output + '.previous-' + randomUUID();
  let previous = false, candidateOwned = false, published = false, failure;
  try {
    const runBuild = build ?? (await import('vite')).build;
    await runBuild({ root: frontend, configFile: path.join(frontend, 'vite.config.ts'),
      build: { outDir: staged, emptyOutDir: true } });
    const verified = await verifyFrontend(staged);
    await mkdir(path.dirname(output), { recursive: true });
    // Keep the final rename on the destination volume, even when configured
    // build storage is on another disk. Copy failure leaves live assets intact.
    await mkdir(candidate); // Exclusive ownership before any recursive cleanup.
    candidateOwned = true;
    await cp(staged, candidate, { recursive: true, force: false });
    await verifyFrontend(candidate);
    await assertOrdinaryDirectory(output);
    if (await exists(output)) {
      await move(output, backup);
      previous = true;
    }
    try {
      await move(candidate, output);
      candidateOwned = false;
      published = true;
    } catch (error) {
      if (previous) {
        try { await move(backup, output); previous = false; }
        catch (restoreError) {
          throw new AggregateError([error, restoreError], 'Publish failed; previous resources retained at ' + backup);
        }
      }
      throw error;
    }
    if (previous) {
      try { await rm(backup, { recursive: true, force: true }); }
      catch (error) { throw new Error('New frontend published; previous resources retained at ' + backup, { cause: error }); }
      previous = false;
    }
    return { output, ...verified };
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors = [];
    for (const owned of [...(candidateOwned ? [candidate] : []), scratch]) {
      try { await rm(owned, { recursive: true, force: true }); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) failure = new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      (failure ? failure.message + '; ' : '') + (published ? 'New frontend published; ' : '') + 'temporary cleanup failed');
  }
  if (failure) throw failure;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await publishBuild();
  console.log(JSON.stringify({ ok: true, output: result.output, assets: result.assets, bytes: result.bytes }));
}
