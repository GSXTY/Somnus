const { spawn } = require('node:child_process');
const { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat } = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');

const GITHUB_REPO = /^([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})$/i;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MANIFEST = 'SKILL.md';
const MAX_FILES = 20000;
const MAX_MANIFEST = 256 * 1024;
const MAX_TREE = 8 * 1024 * 1024;
const MAX_SKILL_BYTES = 512 * 1024 * 1024;

function sourceFor(reference) {
  if (reference === 'ppt-master') reference = 'hugohe3/ppt-master';
  let slug = reference;
  if (typeof reference === 'string' && reference.startsWith('https://')) {
    const url = URL.parse(reference);
    if (url?.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) {
      throw new Error('请提供 GitHub Skill 仓库的地址。');
    }
    slug = url.pathname.slice(1).replace(/\/$/, '');
  }
  if (typeof slug !== 'string') throw new Error('请提供 Skill 的 GitHub 仓库地址。');
  const match = GITHUB_REPO.exec(slug.replace(/\.git$/i, ''));
  if (!match || /^\.+$/.test(match[2])) throw new Error('请提供 Skill 的 GitHub 仓库地址（owner/repo）。');
  return { slug: `${match[1]}/${match[2]}`, repo: match[2].toLowerCase() };
}

async function info(file) {
  return lstat(file).catch(error => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
}

async function safeDirectory(directory) {
  const item = await info(directory);
  if (!item?.isDirectory() || item.isSymbolicLink()) throw new Error('Skill 目录不可用。');
}

async function removeTreeBelow(parent, directory) {
  if (!await info(directory)) return;
  await safeDirectory(directory);
  const target = await realpath(directory);
  const relative = path.relative(await realpath(parent), target);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) {
    throw new Error('Skill 临时安装目录无效。');
  }
  await rm(target, { recursive: true, force: true });
}

async function gitProgram() {
  for (const base of [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (typeof base !== 'string' || !/^[a-z]:\\/i.test(base)) continue;
    const candidate = path.join(base, 'Git', 'cmd', 'git.exe');
    if ((await info(candidate))?.isFile() && (await realpath(candidate)).toLowerCase() === candidate.toLowerCase()) {
      return candidate;
    }
  }
  throw new Error('安装 GitHub Skill 需要本机的 Git for Windows。');
}

function gitEnvironment() {
  const useful = /^(?:path|systemroot|windir|temp|tmp|userprofile|localappdata|programfiles|programw6432|https?_proxy|no_proxy)$/i;
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => useful.test(key))),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: 'NUL',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function runGit(executable, cwd, args, signal, input) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(executable, [
      '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'credential.helper=',
      '-c', 'http.followRedirects=false', '-c', 'core.longpaths=true', ...args,
    ], { cwd, env: gitEnvironment(), windowsHide: true,
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'ignore'] });
    const stop = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => child.kill());
      killer.once('close', code => { if (code !== 0) child.kill(); });
    };
    signal.addEventListener('abort', stop, { once: true });
    if (input) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    const chunks = [];
    let bytes = 0;
    let capped = false;
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_TREE) {
        if (!capped) stop();
        capped = true;
      } else chunks.push(chunk);
    });
    child.once('error', reject);
    child.once('close', code => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(new Error('GitHub Skill 安装已取消或超时。'));
      else if (code !== 0 || capped) reject(new Error('无法下载或读取 GitHub Skill 仓库。'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function selectSkill(tree, repo) {
  const entries = tree.split('\0').filter(Boolean).map(line => {
    const entry = /^(\d+) \w+ ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);
    if (!entry) throw new Error('GitHub Skill 的目录结构不可读取。');
    return { mode: entry[1], oid: entry[2], file: entry[3] };
  });
  const candidates = entries.filter(({ mode, file }) => /^100(?:644|755)$/.test(mode) &&
    (file === MANIFEST || /^(?:\.dsh\/|\.agents\/)?skills\/[a-z0-9-]+\/SKILL\.md$/.test(file)));
  const chosen = candidates.find(({ file }) => file !== MANIFEST && path.posix.basename(path.posix.dirname(file)) === repo) ??
    (candidates.length === 1 ? candidates[0] : null);
  if (!chosen) throw new Error(candidates.length ? '仓库包含多个 Skill，请提供对应的单 Skill 仓库。' : '仓库没有可识别的 SKILL.md。');
  const folder = path.posix.dirname(chosen.file);
  const name = folder === '.' ? undefined : path.posix.basename(folder);
  const files = entries.filter(({ file }) => folder === '.' || file.startsWith(folder + '/'));
  if (files.length > MAX_FILES || files.some(({ mode, file }) => !/^100(?:644|755)$/.test(mode) ||
      file.split('/').some(part => /[\\:\x00-\x1f<>?"*|]/.test(part) || /[ .]$/.test(part) ||
        /^(?:\.{1,2}|\.git|(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?)$/i.test(part)))) {
    throw new Error('Skill 包含太多文件、链接或不受支持的路径。');
  }
  const names = new Set(files.map(({ file }) => file.toLowerCase()));
  if (names.size !== files.length) throw new Error('Skill 包含 Windows 无法区分的文件名。');
  return { folder, name, files };
}

async function verifyManifest(file, expected) {
  const item = await stat(file).catch(() => null);
  if (!item?.isFile() || item.size > MAX_MANIFEST) throw new Error('未找到可读取的 Skill 清单。');
  const text = await readFile(file, 'utf8');
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  const name = /^[ \t]*name[ \t]*:[ \t]*(['"]?)([a-z0-9-]+)\1[ \t]*\r?$/m.exec(frontmatter ?? '')?.[2];
  if (!name || name.length > 64 || !SKILL_NAME.test(name) || (expected && name !== expected) ||
      !/^[ \t]*description[ \t]*:[ \t]*\S/m.test(frontmatter ?? '')) {
    throw new Error('Skill 清单需要与目录一致的名称和非空描述。');
  }
  return name;
}

async function existingManifest(root, name) {
  for (const manifest of [path.join(root, name, MANIFEST), path.join(root, name + '.md')]) {
    if (!await info(manifest)) continue;
    await verifyManifest(manifest, name);
    return true;
  }
  return false;
}

async function installWorkspaceSkill({ market, reference: name, workspaceRoot, validateSender, onProgress }) {
  if (typeof name !== 'string' || name.length > 64 || !SKILL_NAME.test(name)) throw new Error('请输入工作区 Skill 的准确名称。');
  const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  const checked = async file => {
    const item = await lstat(file);
    if (item.isSymbolicLink() || !samePath(file, await realpath(file))) throw new Error('不能从链接移入 Skill。');
    return item;
  };
  const root = await realpath(workspaceRoot);
  let source;
  for (const folder of ['.dsh', '.agents']) {
    let candidate = root;
    try {
      for (const part of [folder, 'skills', name]) {
        candidate = path.join(candidate, part);
        if (!(await checked(candidate)).isDirectory()) throw new Error('工作区 Skill 目录无效。');
      }
      const manifest = await checked(path.join(candidate, MANIFEST));
      if (!manifest.isFile() || manifest.nlink !== 1) throw new Error('工作区 Skill 清单无效。');
      await verifyManifest(path.join(candidate, MANIFEST), name);
      source = candidate;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!source) throw new Error('当前工作区找不到此 Skill。');
  await mkdir(market.home, { recursive: true });
  await safeDirectory(market.home);
  const home = await realpath(market.home);
  const skills = path.join(home, 'skills');
  await mkdir(skills, { recursive: true });
  if (!(await checked(skills)).isDirectory()) throw new Error('用户 Skill 目录不可用。');
  const target = path.join(skills, name);
  const result = { name, profile: 'skills', settings: 'skills', verified: true };
  if (await existingManifest(skills, name)) return { ...result, alreadyInstalled: true };
  onProgress('installing');
  const stage = await mkdtemp(path.join(home, '.somnus-skill-'));
  const destination = path.join(stage, name);
  let files = 0;
  let bytes = 0;
  const copy = async (from, to) => {
    validateSender();
    const item = await checked(from);
    if (++files > MAX_FILES) throw new Error('工作区 Skill 文件或目录过多。');
    if (item.isDirectory()) {
      await mkdir(to);
      const entries = await readdir(from);
      for (const part of entries) {
        if (/[\\:\x00-\x1f<>?"*|]|[ .]$/.test(part) ||
            /^(?:\.{1,2}|\.git|(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?)$/i.test(part)) {
          throw new Error('工作区 Skill 中存在不支持的路径。');
        }
        await copy(path.join(from, part), path.join(to, part));
      }
      return;
    }
    bytes += item.size;
    if (!item.isFile() || item.nlink !== 1 || bytes > MAX_SKILL_BYTES) throw new Error('工作区 Skill 含链接、特殊文件或超出大小限制。');
    const sourceHandle = await open(from, 'r');
    const unchanged = checked => checked.isFile() && checked.nlink === 1 && item.dev === checked.dev &&
      item.ino === checked.ino && item.size === checked.size && item.mtimeMs === checked.mtimeMs;
    try {
      if (!unchanged(await sourceHandle.stat())) throw new Error('工作区 Skill 文件已变更，请重试。');
      if (item.size === 0) {
        const empty = await open(to, 'wx');
        await empty.close();
      } else {
        await pipeline(sourceHandle.createReadStream({ autoClose: false, end: item.size - 1 }),
          createWriteStream(to, { flags: 'wx' }));
      }
      if (!unchanged(await sourceHandle.stat()) || !unchanged(await checked(from))) {
        throw new Error('复制期间工作区 Skill 文件发生变更，请重试。');
      }
    } finally {
      await sourceHandle.close();
    }
  };
  try {
    await copy(source, destination);
    onProgress('verifying');
    await verifyManifest(path.join(destination, MANIFEST), name);
    validateSender();
    await checked(skills);
    if (await info(target)) throw new Error('用户 Skill 路径已存在。');
    await rename(destination, target);
    return { ...result, alreadyInstalled: false, message: '已复制到用户 Skill 目录，工作区内的文件仍保留。' };
  } finally {
    await removeTreeBelow(home, stage).catch(() => {});
  }
}

async function installChatSkill({ market, reference, validateSender = () => {},
  signal, onProgress = () => {}, git = runGit, findGit = gitProgram }) {
  const { slug, repo } = sourceFor(reference);
  validateSender();
  const scope = market.home;
  await mkdir(scope, { recursive: true });
  await safeDirectory(scope);
  const skills = path.join(scope, 'skills');
  await mkdir(skills).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await safeDirectory(skills);
  const deadline = AbortSignal.timeout(120_000);
  const cancel = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const result = (name, alreadyInstalled) => ({
    name, profile: 'skills', verified: true, settings: 'skills', alreadyInstalled,
    ...(alreadyInstalled ? { verificationScope: 'existing-local-manifest' } : { source: `https://github.com/${slug}` }),
  });
  if (repo.length <= 64 && SKILL_NAME.test(repo)) {
    if (await existingManifest(skills, repo)) return result(repo, true);
  }
  onProgress('installing');
  const executable = await findGit();
  const stage = await mkdtemp(path.join(scope, '.somnus-skill-'));
  const destination = path.join(stage, 'checkout');
  try {
    await git(executable, stage, ['clone', '--depth=1', '--filter=blob:none', '--no-checkout',
      '--no-tags', '--', `https://github.com/${slug}.git`, destination], cancel);
    const tree = await git(executable, destination, ['ls-tree', '-rz', 'HEAD'], cancel);
    const { folder, name: directoryName, files } = selectSkill(tree, repo);
    const objects = [...new Set(files.map(({ oid }) => oid))];
    await git(executable, destination, ['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--no-tags',
      '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', '--stdin', 'origin'],
    cancel, objects.join('\n') + '\n');
    await git(executable, destination, ['checkout', 'HEAD', '--', folder], cancel);
    onProgress('verifying');
    let size = 0;
    for (const { file } of files) {
      const item = await info(path.join(destination, ...file.split('/')));
      if (!item?.isFile() || item.isSymbolicLink()) throw new Error('Skill 文件未完整下载。');
      size += item.size;
      if (size > MAX_SKILL_BYTES) throw new Error('Skill 文件超过 512 MiB。');
    }
    const source = folder === '.' ? path.join(stage, 'skill') : path.join(destination, ...folder.split('/'));
    if (folder === '.') {
      await removeTreeBelow(stage, path.join(destination, '.git'));
      await rename(destination, source);
    }
    const name = await verifyManifest(path.join(source, MANIFEST), directoryName);
    if (await existingManifest(skills, name)) return result(name, true);
    const target = path.join(skills, name);
    cancel.throwIfAborted();
    validateSender();
    await safeDirectory(skills);
    if (await info(target)) throw new Error('该 Skill 路径已存在，请先检查现有文件。');
    await rename(source, target);
    await verifyManifest(path.join(target, MANIFEST), name);
    return result(name, false);
  } finally {
    await removeTreeBelow(scope, stage).catch(() => {});
  }
}

module.exports = { installChatSkill, installWorkspaceSkill };
