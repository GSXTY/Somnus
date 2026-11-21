const { readdir, lstat, realpath, mkdir, copyFile, readFile } = require('node:fs/promises');
const path = require('node:path');
async function hostFiles(root) {
  const base = await realpath(root), rows = [];
  async function collect(folder, prefix) {
    for (const name of (await readdir(folder)).sort()) {
      const file = path.join(folder, name), info = await lstat(file), relative = prefix + name;
      if (info.isSymbolicLink()) throw new Error('Host resources must not contain symbolic links: ' + relative);
      if (info.isDirectory() && !prefix && name === 'runtime') await collect(file, 'runtime/');
      else if (info.isDirectory() && prefix.startsWith('runtime/')) await collect(file, relative + '/');
      else if (info.isFile() && /\.(?:cjs|mjs)$/.test(name) && !/\.test\.(?:cjs|mjs)$/.test(name) && name !== 'acp-dot-relay-client.cjs' ||
               info.isFile() && prefix === 'runtime/' && name === 'required-host-files.json') rows.push(relative);
    }
  }
  await collect(base, '');
  const required = JSON.parse(await readFile(path.join(base, 'runtime', 'required-host-files.json'), 'utf8'));
  if (required.schema_version !== 1 || !Array.isArray(required.files)) throw new Error('Invalid required Host resource manifest.');
  for (const file of required.files) if (typeof file !== 'string' || !rows.includes(file)) throw new Error('Missing required Host resource: ' + file);
  return rows;
}
async function copyHostFiles(root, target) {
  const files = await hostFiles(root);
  for (const file of files) { const destination = path.join(target, file); await mkdir(path.dirname(destination), { recursive: true }); await copyFile(path.join(root, file), destination); }
  return files;
}
module.exports = { hostFiles, copyHostFiles };
