/** Build Somnus from the pinned DSH source checkout in an owned external workspace. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { storageRoot } from '../storage-paths.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const markerName = '.somnus-source-workspace.json';
const owner = 'SomnusNext source build';
let currentReport;
const windowsRuntimePathBudget = 230;
const windowsRuntimeDll = 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked/resources/runtime/primary-runtime/dependencies/python/Lib/site-packages/lxml/_elementpath.cp313-win_amd64.pyd';

function gitBytes(source, args) {
  const result = spawnSync('git', ['-C', source, ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString('utf8').trim()}`);
  return result.stdout;
}

function git(source, args) { return gitBytes(source, args).toString('utf8').trimEnd(); }

/** Reject build workspaces inside either the product source or its source dependency. */
export function assertExternalWorkspace(workspace, ...sources) {
  for (const source of sources) {
    const rel = relative(resolve(source), resolve(workspace));
    if (rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) {
      throw new Error('The source build workspace must be outside the source checkout');
    }
  }
}

/** Keep the source root short enough for native libraries in the assembled Windows payload. */
export function defaultWorkspace(storage, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('The source workspace requires a full pinned commit');
  return join(storage, 's', commit.slice(0, 12));
}

/** Reserve headroom for the Windows DLL loader before downloading or compiling dependencies. */
export function assertWindowsRuntimePath(workspace, platform = process.platform) {
  if (platform !== 'win32') return undefined;
  const candidate = join(workspace, windowsRuntimeDll);
  if (candidate.length > windowsRuntimePathBudget) {
    throw new Error(`The assembled Windows runtime DLL path would be ${candidate.length} characters, exceeding the ${windowsRuntimePathBudget}-character source-staging safety budget. Use --workspace with a shorter external directory. Candidate: ${candidate}`);
  }
  return { candidate, length: candidate.length, safetyBudget: windowsRuntimePathBudget };
}

/** Read the exact source identity and refuse changes to the pristine dependency. */
export async function inspectSource(source, lock) {
  if (resolve(git(source, ['rev-parse', '--show-toplevel'])) !== resolve(source)) throw new Error('Unexpected DSH source Git root');
  if (git(source, ['rev-parse', 'HEAD']) !== lock.commit) throw new Error('DSH source commit differs from source-lock.json');
  if (git(source, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('DSH dependency has local changes');
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (pkg.name !== lock.packageName || pkg.packageManager !== lock.packageManager) throw new Error('DSH package identity differs from source lock');
  if (createHash('sha256').update(await readFile(join(source, 'pnpm-lock.yaml'))).digest('hex') !== lock.lockfileSha256) throw new Error('DSH lockfile checksum mismatch');
  const license = await readFile(join(source, 'LICENSE'), 'utf8');
  if (!license.startsWith('MIT License') || !license.includes('Copyright (c) 2026 DeepSeek')) throw new Error('DSH MIT license is missing');
  return { commit: lock.commit, packageManager: pkg.packageManager, version: pkg.version };
}

/** Preserve generated dependencies while restoring only tracked source files into our workspace. */
export async function prepareWorkspace(source, workspace, lock, { localWorkspace = false } = {}) {
  validateWorkspace(workspace, source, localWorkspace);
  await mkdir(workspace, { recursive: true });
  const marker = join(workspace, markerName);
  if (existsSync(marker)) {
    const record = JSON.parse(await readFile(marker, 'utf8'));
    if (record.owner !== owner || record.commit !== lock.commit) throw new Error('Existing source workspace has a different owner or commit');
  } else if ((await readdir(workspace)).length) throw new Error('Refusing to overwrite a nonempty, unowned source workspace');
  // An interrupted second preparation must never leave an earlier successful
  // report describing the workspace it is about to change.
  await writeFile(join(workspace, 'somnus-source-build.json'), JSON.stringify({
    ok: false, stage: 'preparing', commit: lock.commit, workspace,
    applicationReady: false, uiAccepted: false, originalAsarRequired: false, installerCreated: false,
  }, null, 2));
  await writeFile(marker, JSON.stringify({ schemaVersion: 1, owner, commit: lock.commit, source }, null, 2));
  await writeFile(join(workspace, '.somnus-build-workspace.json'), JSON.stringify({
    schema: 1, projectRoot: await realpath(root), upstreamCommit: lock.commit,
  }, null, 2));
  const files = git(source, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean);
  for (const entry of files) {
    const matched = /^(100644|100755|120000) ([a-f0-9]{40}) 0\t(.+)$/s.exec(entry);
    if (!matched) throw new Error('Unsupported or unmerged tracked source entry');
    const [, mode, object, name] = matched;
    const destination = resolve(workspace, name);
    const rel = relative(workspace, destination);
    if (rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Invalid tracked source path');
    await mkdir(dirname(destination), { recursive: true });
    // Export Git link text rather than following a worktree directory symlink.
    // This matches a standard Windows core.symlinks=false checkout and never
    // traverses a link into a user's external directory.
    if (mode === '120000') await writeFile(destination, gitBytes(source, ['cat-file', 'blob', object]));
    else await copyFile(join(source, name), destination);
  }
  // The official build records a real source commit. Object storage is read through
  // an alternate; no hook, ref, index or configuration in the dependency is changed.
  git(workspace, ['init']);
  const sourceGit = git(source, ['rev-parse', '--absolute-git-dir']);
  await mkdir(join(workspace, '.git/objects/info'), { recursive: true });
  await writeFile(join(workspace, '.git/objects/info/alternates'), join(sourceGit, 'objects').replaceAll('\\', '/') + '\n');
  if (existsSync(join(sourceGit, 'shallow'))) await copyFile(join(sourceGit, 'shallow'), join(workspace, '.git/shallow'));
  git(workspace, ['config', 'core.autocrlf', 'false']);
  git(workspace, ['config', 'core.longpaths', 'true']);
  git(workspace, ['config', 'core.symlinks', 'false']);
  git(workspace, ['update-ref', 'refs/heads/somnus-source', lock.commit]);
  git(workspace, ['symbolic-ref', 'HEAD', 'refs/heads/somnus-source']);
  git(workspace, ['read-tree', 'HEAD']);
  return { workspace, files: files.length };
}

function validateWorkspace(workspace, source, localWorkspace) {
  if (!localWorkspace) return assertExternalWorkspace(workspace, root, source);
  const allowed = join(root, '.source-build-cache');
  const rel = relative(allowed, resolve(workspace));
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('--local-workspace only permits a child of the dedicated .source-build-cache directory');
  }
  assertExternalWorkspace(workspace, source);
}

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const path = join(directory, name + suffix);
      if (existsSync(path)) return path;
    }
  }
}

/** Resolve pnpm without requiring an existing Somnus installation. */
export function pnpmCommand(entry) {
  const path = entry ? resolve(entry) : findOnPath('pnpm');
  if (!path || !existsSync(path)) throw new Error('Install pnpm 11.28.5 on PATH or pass --pnpm-entry <pnpm.mjs>');
  if (/\.(?:mjs|cjs|js)$/iu.test(path)) return [process.execPath, path];
  if (/\.cmd$/iu.test(path)) {
    for (const candidate of ['../pnpm/bin/pnpm.mjs', '../pnpm/bin/pnpm.cjs',
      'node_modules/pnpm/bin/pnpm.mjs', 'node_modules/pnpm/bin/pnpm.cjs', 'node_modules/corepack/dist/pnpm.js']) {
      const module = join(dirname(path), candidate);
      if (existsSync(module)) return [process.execPath, module];
    }
    throw new Error('Cannot resolve this pnpm shim; pass --pnpm-entry pointing to its JavaScript entry');
  }
  return [path];
}

/** Accept only a source-frozen backend, never the existing app's resources. */
export async function inspectBackend(directory, expectedVersion, productRoot = root) {
  const backend = await realpath(directory);
  // Windows TEMP may name RUNNER~1 while realpath returns runneradmin.
  // Canonicalize the existing owner even when a fresh source clone has no app/.
  const product = await realpath(productRoot);
  let app = join(product, 'app');
  try { app = await realpath(app); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const rel = relative(app, backend);
  if (rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) {
    throw new Error('Existing app resources are not an allowed source-built backend');
  }
  if (!(await stat(join(backend, 'SomnusBackend.exe'))).isFile()) throw new Error('Source-frozen SomnusBackend.exe is missing');
  const receipt = JSON.parse(await readFile(join(backend, 'somnus-backend-build.json'), 'utf8'));
  if (receipt.schemaVersion !== 1 || receipt.producer !== 'SomnusNext PyInstaller' || receipt.sourceVersion !== expectedVersion) {
    throw new Error('Backend source-build receipt does not match this Somnus version');
  }
  return backend;
}

async function terminateOwnedProcess(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  let treeFailure;
  if (process.platform === 'win32') {
    const result = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (result.error) treeFailure = result.error;
    else if (result.status !== 0) treeFailure = new Error('Could not confirm termination of the owned child process tree: ' + result.stderr);
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') treeFailure = error; }
  }
  // Use the original process handle even when a restricted Windows host refuses
  // PID-based taskkill. A tree-cleanup failure is still reported, never hidden.
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  return treeFailure;
}

/** Run one owned command, optionally requiring its entire smoke process to exit by a deadline. */
export async function runOwnedProcess(command, cwd, env, { timeoutMs = 0 } = {}) {
  console.log('+ ' + command.join(' '));
  const child = spawn(command[0], command.slice(1), { cwd, env, windowsHide: true,
    detached: timeoutMs > 0 && process.platform !== 'win32', stdio: 'inherit' });
  const completed = new Promise((resolveRun, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command[0]} exited with ${code ?? signal}`)));
  });
  if (timeoutMs <= 0) return completed;
  let timer;
  const deadlineError = Object.assign(new Error(`Owned process exceeded its ${timeoutMs}ms exit deadline`), { childPid: child.pid });
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(deadlineError), timeoutMs); });
  try { return await Promise.race([completed, deadline]); }
  catch (error) {
    if (error === deadlineError) {
      const cleanupFailure = await terminateOwnedProcess(child);
      let cleanupTimer;
      try {
        await Promise.race([completed.catch(() => {}), new Promise((_, reject) => {
          cleanupTimer = setTimeout(() => reject(new Error('Owned smoke process did not exit after termination')), 5000);
        })]);
      } finally { clearTimeout(cleanupTimer); }
      if (cleanupFailure) {
        deadlineError.cause = cleanupFailure;
        deadlineError.message += '; the owned child exited but process-tree cleanup could not be confirmed: ' + cleanupFailure.message;
      }
    }
    throw error;
  } finally { clearTimeout(timer); }
}

const run = runOwnedProcess;

/** Exercise the fresh Electron ABI and its extracted terminal dependency without opening a GUI. */
export function sourceTerminalSmokeScript() {
  return `
const path = require('node:path');
const terminal = require(path.join(process.argv[1], 'resources/somnus/node_modules/node-pty'));
const pty = terminal.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo somnus-source-pty'], { cwd: process.argv[1], env: process.env, cols: 80, rows: 24 });
let output = '';
let finished = false;
let exitSubscription;
const dataSubscription = pty.onData(data => { output += data; });
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  dataSubscription.dispose();
  exitSubscription?.dispose();
  try { pty.kill(); } catch (killError) { error ??= killError; }
  if (error) { console.error(error.message); process.exitCode = 1; }
  else console.log('Somnus source terminal smoke passed');
}
const deadline = setTimeout(() => { finish(new Error('Source terminal smoke timed out')); process.exit(1); }, 10000);
exitSubscription = pty.onExit(event => { finish(event.exitCode !== 0 || !output.includes('somnus-source-pty') ? new Error('Source terminal smoke failed: ' + output) : undefined); });
`;
}

/** Exercise the fresh Electron ABI and terminal with independent child and parent deadlines. */
export async function smokeSourceTerminal(application, environment = process.env) {
  await run([join(application, 'Somnus.exe'), '-e', sourceTerminalSmokeScript(), application], application,
    { ...environment, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' }, { timeoutMs: 30000 });
}

async function recordProgress(stage) {
  currentReport = { ...currentReport, stage };
  await writeFile(join(currentReport.workspace, 'somnus-source-build.json'), JSON.stringify(currentReport, null, 2));
}

function requireNode(minimum) {
  const selected = process.versions.node.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (selected[i] > required[i]) return;
    if (selected[i] < required[i]) throw new Error(`Node.js >=${minimum} is required`);
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    check: { type: 'boolean' }, prepare: { type: 'boolean' }, install: { type: 'boolean' },
    compile: { type: 'boolean' }, build: { type: 'boolean' },
    source: { type: 'string' }, storage: { type: 'string' }, workspace: { type: 'string' },
    'pnpm-entry': { type: 'string' }, 'local-workspace': { type: 'boolean' }, 'backend-dir': { type: 'string' },
  }, allowPositionals: false });
  const lock = JSON.parse(await readFile(new URL('source-lock.json', import.meta.url), 'utf8'));
  requireNode(lock.nodeMinimum);
  const source = await realpath(values.source ? resolve(values.source) : join(root, lock.path));
  const identity = await inspectSource(source, lock);
  const product = JSON.parse(await readFile(join(root, 'electron/package.json'), 'utf8'));
  let backend;
  if (values.build) {
    if (!values['backend-dir']) throw new Error('--build requires --backend-dir from build_electron.py --backend-only; use --compile for source compilation only');
    backend = await inspectBackend(resolve(values['backend-dir']), product.version);
  }
  if (values['local-workspace'] && values.storage) throw new Error('--local-workspace owns its dedicated cache; omit --storage');
  const storage = values['local-workspace'] ? join(root, '.source-build-cache') : storageRoot(root, values.storage);
  const workspace = values.workspace ? resolve(values.workspace) : defaultWorkspace(storage, lock.commit);
  validateWorkspace(workspace, source, values['local-workspace']);
  const windowsRuntimePath = values.build || values.check ? assertWindowsRuntimePath(workspace) : undefined;
  if (values.check || !(values.prepare || values.install || values.compile || values.build)) {
    console.log(JSON.stringify({ ok: true, ...identity, source, workspace, windowsRuntimePath, originalAsarRequired: false }));
    return;
  }
  const prepared = await prepareWorkspace(source, workspace, lock, { localWorkspace: values['local-workspace'] });
  console.log(JSON.stringify(prepared));
  currentReport = { ok: false, ...identity, workspace, applicationReady: false, uiAccepted: false,
    localWorkspace: values['local-workspace'] === true, originalAsarRequired: false, installerCreated: false };
  await recordProgress('prepared');
  if (values.prepare && !(values.install || values.compile || values.build)) return;
  const pnpm = pnpmCommand(values['pnpm-entry']);
  const version = spawnSync(pnpm[0], [...pnpm.slice(1), '--version'], { encoding: 'utf8', windowsHide: true });
  if (version.status !== 0 || version.stdout.trim() !== lock.packageManager.slice(5)) throw new Error('pnpm version differs from source-lock.json');
  const env = { ...process.env, CI: 'true', PNPM_HOME: join(storage, 'pnpm-home'),
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1', DSH_DESKTOP_PACKAGE_CACHE_DIR: join(storage, 'cache/dsh-packages') };
  await recordProgress('install');
  await run([...pnpm, 'install', '--frozen-lockfile', '--store-dir', join(storage, 'cache/pnpm-store')], workspace, env);
  if (values.install && !(values.compile || values.build)) return;
  const overlay = await import('./source-overlay.mjs');
  await recordProgress('source-overlay');
  await overlay.prepareSomnusSourceOverlay(workspace, { somnusRoot: root, allowLocalWorkspace: values['local-workspace'] === true });
  const release = JSON.parse(await readFile(new URL('next-release.json', import.meta.url), 'utf8'));
  if (values.build) {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The current Somnus source desktop target requires Windows x64');
    await recordProgress('desktop-build');
    await run([...pnpm, '--filter', '@deepseek-ai/dsh-desktop', 'exec', 'tsx', 'scripts/package-target.ts',
      'win-x64', '--next', '--unsigned', '--dir', '--build-version', release.version], workspace, env);
    const unpacked = join(workspace, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked');
    await recordProgress('somnus-assembly');
    await overlay.applySomnusBuiltOverlay(unpacked, { sourceRoot: workspace, somnusRoot: root });
    await cp(backend, join(unpacked, 'resources/backend'), { recursive: true });
    await recordProgress('terminal-smoke');
    await smokeSourceTerminal(unpacked, env);
    const report = { ok: true, ...identity, workspace, application: unpacked,
      applicationReady: true, needsPythonBackend: false,
      uiAccepted: false, localWorkspace: values['local-workspace'] === true,
      terminalSmoke: true, originalAsarRequired: false, installerCreated: false };
    await writeFile(join(workspace, 'somnus-source-build.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } else {
    await recordProgress('compile-and-check');
    await run([...pnpm, 'run', 'build', '--profile', 'local'], workspace, env);
    const report = { ok: true, ...identity, workspace, originalAsarRequired: false, installerCreated: false,
      localWorkspace: values['local-workspace'] === true, compiled: true, applicationReady: false, uiAccepted: false };
    await writeFile(join(workspace, 'somnus-source-build.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => {
    if (currentReport) {
      currentReport = { ...currentReport, ok: false, error: error.message };
      try { await recordProgress(currentReport.stage); }
      catch (reportError) { console.error('Could not write build failure report: ' + reportError.message); }
    }
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
