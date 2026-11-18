const { opendir, stat } = require('node:fs/promises');
const path = require('node:path');

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(['ppt-master', 'project-handoff']);
const MAX_ENTRIES = 512;

async function listDshSkills(managedHome) {
  const root = path.join(managedHome, 'skills');
  const directory = await opendir(root).catch(error => {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  });
  if (!directory) return [];
  const found = new Map();
  let count = 0;
  for await (const entry of directory) {
    if (++count > MAX_ENTRIES) break;
    const flatFile = entry.isFile() || (entry.isSymbolicLink() && entry.name.endsWith('.md'));
    if (flatFile && !entry.name.endsWith('.md')) continue;
    if (!flatFile && !entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const name = flatFile ? entry.name.slice(0, -3) : entry.name;
    if (name.length > 64 || !SKILL_NAME.test(name) || found.has(name) || RESERVED.has(name)) continue;
    const manifest = flatFile ? path.join(root, entry.name) : path.join(root, entry.name, 'SKILL.md');
    const file = await stat(manifest).catch(() => null);
    if (file?.isFile()) found.set(name, { name, source: 'managed' });
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
}

module.exports = { listDshSkills };
