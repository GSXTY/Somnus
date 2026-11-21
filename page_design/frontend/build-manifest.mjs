import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(folder, prefix = '') {
 const rows = [];
 for (const name of (await readdir(folder)).sort()) {
  const relative = prefix + name, absolute = path.join(folder, name), info = await lstat(absolute);
  if (info.isSymbolicLink()) throw Error('Build inputs must not contain symbolic links: ' + relative);
  if (info.isDirectory()) rows.push(...await files(absolute, relative + '/'));
  else if (info.isFile()) rows.push(relative);
 }
 return rows;
}
/** @returns {import('vite').Plugin} */
export function frontendBuildManifest() {
 let root, output;
 return { name: 'somnus-verified-build-manifest', apply: 'build',
  configResolved(config) { root = config.root; output = path.resolve(root, config.build.outDir); },
  async closeBundle() {
   const sources = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'build-manifest.mjs'];
   for (const directory of ['src', 'public']) {
    const location = path.join(root, directory);
    const info = await lstat(location).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info) sources.push(...(await files(location)).map(name => directory + '/' + name));
   }
   const source_files = await Promise.all(sources.sort().map(async name => ({ path: name, sha256: hash(await readFile(path.join(root, name))) })));
   const source_fingerprint = hash(source_files.map(row => row.path + '\0' + row.sha256 + '\n').join(''));
   const assets = await Promise.all((await files(output)).filter(name => name !== 'build-manifest.json').map(async name => {
    const content = await readFile(path.join(output, name)); return { path: name, sha256: hash(content), size: content.length };
   }));
   await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify({ schema_version: 1, producer: 'somnus-frontend', source_fingerprint, source_files, assets, generated_at: new Date().toISOString() }, null, 2) + '\n');
  }
 };
}
