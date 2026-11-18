const { createHash } = require('node:crypto');
const { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } = require('node:fs/promises');
const path = require('node:path');

const PACKAGE = '@local/agent-desktop-mcp';

async function plainPath(root, parts, file = true) {
  let current = await realpath(root);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index === parts.length - 1 && file ? !info.isFile() : !info.isDirectory())) {
      throw new Error('默认桌面 MCP 的路径不是普通本机文件。');
    }
  }
  return current;
}

async function desktopExecutable(profileDir, resourcesPath) {
  try {
    const modules = await plainPath(profileDir, ['dsh-home', 'mcp', 'agent-desktop', 'node_modules'], false);
    const alias = path.join(modules, 'agent-desktop', 'bin', 'agent-desktop-win32-x64.exe');
    const canonical = await realpath(alias);
    const relative = path.relative(modules, canonical);
    if (/^\.pnpm[\\/]agent-desktop@\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?[\\/]node_modules[\\/]agent-desktop[\\/]bin[\\/]agent-desktop-win32-x64\.exe$/i.test(relative)) {
      const checked = await plainPath(modules, relative.split(path.sep));
      if (checked.toLowerCase() === canonical.toLowerCase()) return alias;
    } else {
      const checked = await plainPath(modules, ['agent-desktop', 'bin', 'agent-desktop-win32-x64.exe']);
      if (checked.toLowerCase() === canonical.toLowerCase()) return alias;
    }
  } catch { /* only the exact owned package layout may resolve through pnpm */ }
  const candidates = [[resourcesPath, ['agents', 'agent-desktop', 'agent-desktop.exe']]];
  for (const [root, parts] of candidates) {
    try { return await plainPath(root, parts); } catch { /* inspect the next app-owned component */ }
  }
  return null;
}

async function scanWrapper(root) {
  const entries = [];
  let bytes = 0;
  async function walk(folder, relative = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      const file = path.join(folder, entry.name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('桌面 MCP 包含不支持的链接。');
      if (stat.isDirectory()) await walk(file, name);
      else {
        bytes += stat.size;
        if (bytes > 2 * 1024 * 1024 || entries.length >= 100) throw new Error('桌面 MCP 包装目录超过预期大小。');
        entries.push([name, createHash('sha256').update(await readFile(file)).digest('hex')]);
      }
    }
  }
  await walk(root);
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

async function initializeDesktopMcpDefault(profileDir, resourcesPath) {
  const executable = await desktopExecutable(profileDir, resourcesPath);
  const destination = path.join(profileDir, 'dsh-home', 'mcp', 'default', 'agent-desktop-mcp');
  let sourcePath;
  try { sourcePath = await plainPath(profileDir, ['documents', 'test1', 'agent-desktop-mcp'], false); }
  catch { return { executable, migrated: false }; }
  const metadata = JSON.parse(await readFile(await plainPath(sourcePath, ['package.json']), 'utf8'));
  if (metadata.name !== PACKAGE || metadata.private !== true || metadata.dsh?.bundle?.patch !== './cordis.patch.yml') {
    return { executable, migrated: false };
  }
  const patch = await readFile(await plainPath(sourcePath, ['cordis.patch.yml']), 'utf8');
  const yamlFile = path.join(profileDir, 'dsh-runtime', '0.2.2-rc.1', 'node_modules', 'yaml');
  const { createRequire } = require('node:module');
  const yaml = createRequire(path.join(profileDir, 'dsh-runtime', '0.2.2-rc.1', 'package.json'))(yamlFile);
  const parsed = yaml.parse(patch);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !Array.isArray(parsed[0]?.insert) || parsed[0].insert.length !== 1 ||
      parsed[0].insert[0]?.name !== '@deepseek-ai/dsh-mcp-client' ||
      parsed[0].insert[0]?.config?.serverName !== 'agent-desktop') throw new Error('桌面 MCP 包装配置无法识别。');
  const files = await scanWrapper(sourcePath);
  const parents = ['dsh-home', 'mcp', 'default'];
  let base = await realpath(profileDir);
  for (const part of parents) {
    base = path.join(base, part);
    await mkdir(base).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(base);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('默认 MCP 目录无效。');
  }
  const targetInfo = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (targetInfo) {
    return { executable, migrated: false, message: '默认桌面 MCP 目录已存在，原包装目录已保留。' };
  }
  const lockFile = path.join(base, '.agent-desktop-migration.lock');
  let lock;
  try {
    lock = await open(lockFile, 'wx');
    await lock.writeFile(String(process.pid));
    if (await lstat(destination).catch(() => null)) return { executable, migrated: false };
    if (JSON.stringify(files) !== JSON.stringify(await scanWrapper(sourcePath))) throw new Error('桌面 MCP 包装目录已变化。');
    // These paths are fixed descendants of the same Somnus profile. A rename
    // preserves all wrapper bytes and never follows the original project root.
    await rename(sourcePath, destination);
    return { executable, migrated: true, directory: destination };
  } catch (error) {
    if (error.code === 'EEXIST') return { executable, migrated: false };
    throw error;
  } finally {
    await lock?.close();
    if (lock) await unlink(lockFile).catch(() => {});
  }
}

function defaultDesktopConnection(config, executable) {
  if (!executable || config?.serverName !== 'agent-desktop' || config.transport !== 'stdio' ||
      typeof config.command !== 'string' || !Array.isArray(config.args) || config.args.length !== 1 || config.args[0] !== 'mcp') return false;
  return path.resolve(config.command).toLowerCase() === path.resolve(executable).toLowerCase();
}

module.exports = { defaultDesktopConnection, desktopExecutable, initializeDesktopMcpDefault };
