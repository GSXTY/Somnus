import { randomUUID } from 'node:crypto';
import nodeFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const require = createRequire(import.meta.url);

/** Only migration needs physical-file semantics, including for nested *.asar files. */
export function harnessMigrationFs() {
  return process.versions.electron ? require('original-fs').promises : nodeFs;
}

async function harnessMigrationFilter(upstream, fs) {
  const skipped = new Set(['cache', 'dsh-runtimes']);
  // Treat the legacy `electron` directory as a download only when its layout identifies it.
  const cachedElectron = [join(upstream, 'electron', 'electron.exe'), join(upstream, 'electron', 'resources', 'default_app.asar')];
  const markers = await Promise.all(cachedElectron.map(file => fs.lstat(file).then(
    info => info.isFile(),
    error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; },
  )));
  if (markers.every(Boolean)) skipped.add('electron');
  return source => {
    const root = relative(upstream, source).split(sep, 1)[0];
    return !skipped.has(process.platform === 'win32' ? root.toLowerCase() : root);
  };
}

function linkTarget(path) {
  if (process.platform !== 'win32') return path;
  const windowsPath = path.replace(/^\\\\\?\\UNC\\/i, '\\\\');
  return windowsPath.replace(/^\\\\\?\\(?=[a-z]:\\)/i, '');
}

function deferLink(error) {
  return process.platform === 'win32' && ['EACCES', 'EPERM', 'ENOTSUP', 'ENOENT'].includes(error.code);
}

/** Copy ordinary files first, then recreate links without walking their target trees. */
export async function copyHarnessHome(upstream, staging, target, fs = harnessMigrationFs()) {
  const keep = await harnessMigrationFilter(upstream, fs);
  const links = [];
  await fs.cp(upstream, staging, {
    recursive: true,
    force: false,
    async filter(source, destination) {
      if (!keep(source)) return false;
      if (!(await fs.lstat(source)).isSymbolicLink()) return true;
      links.push({ source, destination });
      return false;
    },
  });
  const deferred = [];
  for (const { source, destination } of links) {
    const path = relative(upstream, source);
    const original = linkTarget(await fs.readlink(source));
    const absolute = resolve(dirname(source), original);
    const fromUpstream = relative(upstream, absolute);
    const internal = fromUpstream !== '..' && !fromUpstream.startsWith('..' + sep) && !isAbsolute(fromUpstream);
    const finalSource = join(target, path);
    const finalTarget = internal ? join(target, fromUpstream) : absolute;
    const windows = process.platform === 'win32';
    let knownMissing = false;
    const info = await fs.stat(source).catch(error => {
      knownMissing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
      if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code)) return undefined;
      throw error;
    });
    // pnpm can leave a project index entry after the referenced installation was removed.
    const [root, store, version, projects] = path.split(sep);
    if (knownMissing && root === 'pnpm' && store === 'store' && /^v\d+$/.test(version) && projects === 'projects') continue;
    const type = info?.isDirectory() ? (windows ? 'junction' : 'dir') : 'file';
    const value = type === 'junction' || isAbsolute(original) ? finalTarget : relative(dirname(finalSource), finalTarget);
    try {
      await fs.symlink(value, destination, type);
    } catch (error) {
      if (!deferLink(error)) throw error;
      deferred.push({ path, originalTarget: original, intendedTarget: finalTarget, type, reason: error.code });
    }
  }
  if (deferred.length === 0) return undefined;
  const name = `.somnus-migration-links-${randomUUID()}.json`;
  const report = { upstream, deferred };
  await fs.writeFile(join(staging, name), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { name, report };
}

/** Windows may need the published target to exist before creating its junction. */
export async function finishHarnessLinks(target, migration, fs = harnessMigrationFs()) {
  if (!migration) return undefined;
  const { name, report } = migration;
  if (!report.deferred.some(entry => entry.type === 'junction' && entry.reason === 'ENOENT')) return name;
  const file = join(target, name);
  const remaining = [];
  for (const entry of report.deferred) {
    if (entry.type !== 'junction' || entry.reason !== 'ENOENT') {
      remaining.push(entry);
      continue;
    }
    try {
      await fs.symlink(entry.intendedTarget, join(target, entry.path), 'junction');
    } catch (error) {
      if (!deferLink(error)) throw error;
      remaining.push({ ...entry, reason: error.code });
    }
  }
  if (remaining.length === 0) {
    await fs.unlink(file);
    return undefined;
  }
  const updated = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(updated, JSON.stringify({ ...report, deferred: remaining }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try { await fs.rename(updated, file); }
  finally { await fs.unlink(updated).catch(() => {}); }
  return name;
}
