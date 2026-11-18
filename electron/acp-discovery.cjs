const { open, realpath, stat } = require('node:fs/promises');
const path = require('node:path');

const packages = {
  codex: [
    { name: 'Codex', packageName: '@agentclientprotocol/codex-acp', command: 'codex-acp', entry: 'dist/index.js', args: [] },
  ],
};
const codeBuddyPackage = {
  name: 'CodeBuddy Code', packageName: '@tencent-ai/codebuddy-code', command: 'codebuddy', entry: 'bin/codebuddy',
};

function localPath(value) {
  return typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value) && !/[\x00-\x1f]/.test(value);
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function localEntry(root, relative, isExpectedType) {
  if (!localPath(root)) return null;
  try {
    const directory = await realpath(root);
    const candidate = await realpath(path.join(directory, relative));
    if (localPath(directory) && within(directory, candidate) && isExpectedType(await stat(candidate))) return candidate;
  } catch {
    // An installation may be incomplete, inaccessible, or absent.
  }
  return null;
}

const localFile = (root, relative) => localEntry(root, relative, info => info.isFile());
const localDirectory = (root, relative) => localEntry(root, relative, info => info.isDirectory());

async function installedPackage(root, adapter) {
  const folder = path.join(root, 'node_modules', adapter.packageName);
  const manifest = await localFile(root, path.relative(root, path.join(folder, 'package.json')));
  if (!manifest) return null;
  try {
    const file = await open(manifest, 'r');
    let metadata;
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead === buffer.length) return null;
      metadata = JSON.parse(buffer.toString('utf8', 0, bytesRead));
    } finally {
      await file.close();
    }
    const entry = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[adapter.command];
    if (metadata.name !== adapter.packageName || typeof entry !== 'string' ||
        entry.replace(/^\.\//, '') !== adapter.entry) return null;
    const executableModule = await localFile(folder, adapter.entry);
    if (executableModule && within(path.dirname(manifest), executableModule)) return executableModule;
  } catch {
    // Ignore broken package metadata and look in the next known location.
  }
  return null;
}

async function detectManagedCodex(resourcesPath) {
  if (process.platform !== 'win32') return null;
  const root = await localDirectory(resourcesPath, 'agents/codex');
  if (!root) return null;
  const [adapter] = packages.codex;
  const [executable, script] = await Promise.all([localFile(root, 'node.exe'), installedPackage(root, adapter)]);
  if (!executable || !script) return null;
  return { name: adapter.name, executable, args: [script] };
}

async function detectManagedCodeBuddy(resourcesPath) {
  const root = await localDirectory(resourcesPath, 'agents/codebuddy');
  const nodeRoot = await localDirectory(resourcesPath, 'agents/codex');
  if (!root || !nodeRoot) return null;
  const [executable, script] = await Promise.all([
    localFile(nodeRoot, 'node.exe'), installedPackage(root, codeBuddyPackage),
  ]);
  return executable && script ? { name: codeBuddyPackage.name, executable, args: [script, '--acp'] } : null;
}

async function detectAdapter(provider, env = process.env, resourcesPath = process.resourcesPath) {
  if (process.platform !== 'win32') return null;
  if (provider === 'codebuddy') {
    const managed = await detectManagedCodeBuddy(resourcesPath);
    if (managed) return managed;
    const executable = await localFile(env.LOCALAPPDATA, 'codebuddy/bin/codebuddy.exe');
    return executable ? { name: 'CodeBuddy Code', executable, args: ['--acp'] } : null;
  }
  if (typeof provider !== 'string' || !Object.hasOwn(packages, provider)) return null;
  if (provider === 'codex') {
    const managed = await detectManagedCodex(resourcesPath);
    if (managed) return managed;
  }

  const nodeRoots = (await Promise.all([
    localDirectory(env.ProgramFiles, 'nodejs'),
    localDirectory(env['ProgramFiles(x86)'], 'nodejs'),
    localDirectory(env.LOCALAPPDATA, 'Programs/nodejs'),
  ])).filter(Boolean);
  let executable;
  for (const root of nodeRoots) {
    executable = await localFile(root, 'node.exe');
    if (executable) break;
  }
  if (!executable) return null;

  const userNpm = await localDirectory(env.APPDATA, 'npm');
  const npmRoots = [...new Set([userNpm, ...nodeRoots].filter(Boolean))];
  for (const adapter of packages[provider]) {
    for (const root of npmRoots) {
      const script = await installedPackage(root, adapter);
      if (script) return { name: adapter.name, executable, args: [script, ...adapter.args] };
    }
  }
  return null;
}

function matchesLaunch(profile, adapter) {
  return Boolean(adapter && typeof profile.executable === 'string' &&
    profile.executable.toLowerCase() === adapter.executable.toLowerCase() &&
    profile.args.length === adapter.args.length && profile.args.every((argument, index) => argument === adapter.args[index]));
}

module.exports = { detectAdapter, detectManagedCodex, detectManagedCodeBuddy, matchesLaunch };
