const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchWorkspace } = require('./workspace-launch.cjs');
const { nativeRequest, trustWorkbench } = require('./project-folders.cjs');
const { projectPath } = require('./acp-project.cjs');
const { DEFAULT_EXECUTION_SETTINGS } = require('./acp-execution-settings.cjs');

const TEST_TOOL = 'run_project_tests';
const DIFF_TOOL = 'project_git_diff';
const POWERSHELL_TOOL = 'run_powershell';
const LIST_RUNNERS = 'list_project_test_runners';
const MAX_DEVELOPMENT_JOBS = 4;
const DEVELOPMENT_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const WORKSPACE = /^ws_[a-f0-9]{12}$/;
const ROOT_KEY = /^[a-f0-9]{64}$/;
const SOURCE = /^source_[1-9][0-9]?$/;
const ID = /^[a-f0-9-]{36}$/;
const SHELL_PROGRAM = /^(?:cmd|powershell|powershell_ise|pwsh|bash|sh|wsl|wscript|cscript|mshta|rundll32|regsvr32|wt|WindowsTerminal)\.exe$/i;
const MAX_OUTPUT = 64 * 1024;
const APPROVAL_TIMEOUT = 60_000;
const TEST_TIMEOUT = 90_000;
const GIT_TIMEOUT = 8000;
const CHECKOUT_TIMEOUT = 90_000;
const COMMIT = /^[a-f0-9]{40}$/;
const CANCEL_REASONS = {
  rejected: 'rejected', expired: 'approval_timeout', capacity: 'approval_busy', cancelled: 'request_ended',
};
const TEST_MESSAGES = {
  rejected: '测试未运行。本次运行请求已取消。',
  approval_timeout: '测试未运行。运行确认已超时。',
  approval_busy: '测试未运行。待处理的授权已达到上限。',
  request_ended: '测试请求已结束。',
  dialog_closed: '测试未运行。Windows 确认窗口异常关闭。',
};

function toolResult(data, isError = false) {
  return { isError, content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function shellToolResult(data, isError) {
  const result = toolResult(data, isError);
  // The native development-job receiver allows 90,000 characters per text block.
  // Escaped control characters may expand beyond that even at a 64 KiB capture limit.
  if (result.content[0].text.length <= 90_000) return result;
  let low = 0;
  let high = data.output.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const output = data.output.slice(0, middle).toWellFormed();
    if (JSON.stringify({ ...data, output, truncated: true }).length <= 90_000) low = middle;
    else high = middle - 1;
  }
  return toolResult({ ...data, output: data.output.slice(0, low).toWellFormed(), truncated: true }, isError);
}

function localPath(value) {
  return typeof value === 'string' && value.length <= 1024 && /^[a-z]:[\\/]/i.test(value) &&
    !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value);
}

async function localEntry(candidate, type) {
  if (!localPath(candidate)) return null;
  try {
    const canonical = await realpath(candidate);
    if (canonical.toLowerCase() !== path.resolve(candidate).toLowerCase()) return null;
    const info = await lstat(canonical);
    if (type === 'file' ? !info.isFile() : !info.isDirectory()) return null;
    return canonical;
  } catch {
    return null;
  }
}

async function runnerExecutable(executable) {
  const canonical = await localEntry(executable, 'file');
  if (!canonical || SHELL_PROGRAM.test(path.basename(canonical))) {
    throw new Error('请选择可用的测试 .exe。测试运行器不直接启动命令行或 Windows 脚本宿主。');
  }
  const { dev, ino, size, mtimeMs } = await stat(canonical);
  return { canonical, identity: [dev, ino, size, mtimeMs].join(':') };
}

function projectEnvironment(executableDirectory, inheritPath = false) {
  const env = process.env;
  const allowed = ['ALLUSERSPROFILE', 'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA', 'PROGRAMFILES',
    'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR'];
  const result = Object.fromEntries(Object.entries(env).filter(([key]) => allowed.includes(key.toUpperCase())));
  const system = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  const userPath = inheritPath ? Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] : undefined;
  result.PATH = [executableDirectory, path.join(system, 'System32'), system, userPath].filter(Boolean).join(path.delimiter);
  if (inheritPath) {
    // Windows PowerShell needs PATHEXT to recognize native commands such as python.exe.
    result.PATHEXT = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATHEXT')?.[1] ||
      '.COM;.EXE;.BAT;.CMD';
  }
  return result;
}

async function systemPowerShell() {
  const system = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const executable = await localEntry(path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'file');
  if (!executable) throw new Error('未找到系统 Windows PowerShell。');
  return executable;
}

function runProcess(executable, args, { cwd, signal, timeout, env, outputLimit = MAX_OUTPUT, mergeError = true }) {
  if (signal?.aborted) return Promise.resolve({ status: 'cancelled', exitCode: null, output: '', truncated: false });
  return new Promise(resolve => {
    let size = 0;
    let status;
    let truncated = false;
    const chunks = [];
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = data => {
      const use = Math.min(outputLimit - size, data.length);
      if (use > 0) {
        chunks.push(data.subarray(0, use));
        size += use;
      }
      if (use < data.length) truncated = true;
    };
    child.stdout.on('data', append);
    if (mergeError) child.stderr.on('data', append);
    else child.stderr.resume();
    let killDeadline;
    const stop = reason => {
      if (status) return;
      status = reason;
      if (!child.pid) return;
      if (child.exitCode !== null || child.signalCode !== null) {
        child.stdout.destroy();
        child.stderr.destroy();
        return;
      }
      const system = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const killer = spawn(path.join(system, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
        { env: projectEnvironment(), windowsHide: true, shell: false, stdio: 'ignore' });
      const fallback = () => child.kill();
      killer.once('error', fallback);
      killer.once('exit', code => { if (code !== 0) fallback(); });
      killDeadline = setTimeout(() => {
        killer.kill();
        fallback();
        child.stdout.destroy();
        child.stderr.destroy();
      }, 3000);
      killDeadline.unref();
    };
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('timeout'), timeout);
    timer.unref();
    child.once('error', () => { status ||= 'failed'; });
    child.once('close', code => {
      clearTimeout(timer);
      clearTimeout(killDeadline);
      signal?.removeEventListener('abort', abort);
      resolve({ status: status || (code === 0 ? 'passed' : 'failed'), exitCode: code,
        output: Buffer.concat(chunks).toString('utf8'), truncated });
    });
  });
}

function cleanRunner(input) {
  const { id, name, source, executable, args } = input || {};
  if ((id != null && (typeof id !== 'string' || !ID.test(id))) ||
      typeof name !== 'string' || !name.trim() || name.length > 80 ||
      /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(name) ||
      typeof source !== 'string' || !SOURCE.test(source) || !localPath(executable) || !/\.exe$/i.test(executable) ||
      !Array.isArray(args) || args.length > 24 || args.some(value => typeof value !== 'string' ||
        value.length > 500 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value))) {
    throw new Error('请填写运行器名称、项目来源、本机 .exe 和独立的启动参数。');
  }
  return { id: id || randomUUID(), name: name.trim(), source, executable, args: args.slice() };
}

function displayCommand(runner) {
  return [runner.executable, ...runner.args].map(value => JSON.stringify(value)).join(' ');
}

function publicRunner(runner, source = runner.source) {
  const { id, name, executable, args } = runner;
  return { id, name, executable, args, source };
}

function noRun(command, cwd, reason) {
  return { status: 'cancelled', exitCode: null, output: '', truncated: false, command, cwd, elapsedMs: 0, reason };
}

async function gitExecutable() {
  const installs = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']];
  for (const folder of installs) {
    if (!localPath(folder)) continue;
    const executable = await localEntry(path.join(folder, 'Git', 'cmd', 'git.exe'), 'file');
    if (executable) return executable;
  }
  throw new Error('未找到受支持的本机 Git，请安装 Git for Windows。');
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function gitMetadataText(file) {
  const safe = await localEntry(file, 'file');
  if (!safe) return null;
  const info = await lstat(safe);
  if (info.nlink !== 1 || info.size > 4096) return null;
  return (await readFile(safe, 'utf8')).trim();
}

async function baseMetadata(root) {
  const gitDir = await localEntry(path.join(root, '.git'), 'directory');
  if (!gitDir) throw new Error('请使用含 .git 目录的 Git 仓库根目录。');
  for (const relative of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates']) {
    if (await lstat(path.join(gitDir, relative)).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) throw new Error('此 Git 仓库使用独立对象目录，当前无法使用。');
  }
  if (!await localEntry(path.join(gitDir, 'objects'), 'directory')) throw new Error('Git 对象目录不可用。');
  return gitDir;
}

async function linkedMetadata(root, baseRoot) {
  const common = await baseMetadata(baseRoot);
  const pointer = path.join(root, '.git');
  const gitDir = (await gitMetadataText(pointer))?.match(/^gitdir: ([^\r\n]+)$/)?.[1];
  const worktrees = path.join(common, 'worktrees');
  const name = gitDir && path.basename(gitDir);
  const expected = name && path.join(worktrees, name);
  if (!localPath(gitDir) || !/^[a-f0-9-]+$/i.test(name) || name.toLowerCase() !== path.basename(root).toLowerCase() ||
      !samePath(gitDir, expected)) {
    throw new Error('工作树的 Git 目录已变更或不可访问。');
  }
  const copied = await localEntry(expected, 'directory');
  if (!copied) {
    throw new Error('工作树的 Git 目录已变更或不可访问。');
  }
  const [commonPointer, reversePointer] = await Promise.all([
    gitMetadataText(path.join(copied, 'commondir')), gitMetadataText(path.join(copied, 'gitdir')),
  ]);
  if (commonPointer !== '../..' || !reversePointer || !localPath(reversePointer) || !samePath(reversePointer, pointer)) {
    throw new Error('工作树与原仓库的 Git 关联无法验证。');
  }
  return { gitDir: copied, common };
}

async function ensureWorktreesParent(folder, base) {
  if (!localPath(folder) || path.basename(folder).toLowerCase() !== 'project-worktrees') {
    throw new Error('本机工作树目录不可用。');
  }
  const parent = await localEntry(path.dirname(folder), 'directory');
  if (!parent) throw new Error('本机工作树目录不可用。');
  const destination = path.join(parent, 'project-worktrees');
  const relative = path.relative(base, destination);
  if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw new Error('工作树目录必须位于原项目目录之外。');
  }
  return destination;
}

function gitEnvironment() {
  return { ...projectEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL',
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' };
}

function gitInvocation(git, options, disabledHooks) {
  return (args, extra = {}) => runProcess(git, ['--no-pager', '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=' + disabledHooks, ...args], { ...options, ...extra });
}

async function isolatedRepository(controlled, commit) {
  await mkdir(path.join(controlled, 'refs'));
  await mkdir(path.join(controlled, 'objects'));
  await writeFile(path.join(controlled, 'HEAD'), commit ? commit + '\n' : 'ref: refs/heads/main\n');
}

const INVALID_DIFF_PATH = '请选择一个有效的 Git 仓库相对文件路径。';
const EOL_SETTINGS = '^core\\.(autocrlf|eol)$';

async function gitLineEndingOptions(git, gitDir, controlled, options) {
  const env = { ...projectEnvironment(), HOME: os.homedir() };
  const configFile = await localEntry(path.join(gitDir, 'config'), 'file');
  const scopes = [['--system'], ['--global']];
  if (configFile) scopes.push(['--file', configFile]);
  const settings = new Map();
  for (const scope of scopes) {
    // The config query only parses these values; no includes or project commands.
    const config = await runProcess(git, ['config', ...scope, '--no-includes', '--null', '--get-regexp', EOL_SETTINGS],
      { ...options, cwd: controlled, env, outputLimit: 4096, mergeError: false });
    if (config.status !== 'passed' || config.truncated) continue;
    for (const row of config.output.split('\0').filter(Boolean)) {
      const separator = row.indexOf('\n');
      const key = separator < 0 ? row : row.slice(0, separator);
      const value = separator < 0 ? 'true' : row.slice(separator + 1);
      const normalized = value.trim().toLowerCase();
      if (key === 'core.autocrlf') {
        if (['true', 'yes', 'on', '1'].includes(normalized)) settings.set(key, 'true');
        else if (['false', 'no', 'off', '0', ''].includes(normalized)) settings.set(key, 'false');
        else if (normalized === 'input') settings.set(key, 'input');
      } else if (key === 'core.eol' && ['lf', 'crlf', 'native'].includes(normalized)) {
        settings.set(key, normalized);
      }
    }
  }
  return [...settings].flatMap(([name, value]) => ['-c', name + '=' + value]);
}

async function validateWorkTreeFile(root, file) {
  const parts = file.split('/');
  let entry = root;
  for (const [index, part] of parts.entries()) {
    entry = path.join(entry, part);
    const info = await lstat(entry).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return;
    if (!await localEntry(entry, index === parts.length - 1 ? 'file' : 'directory')) {
      throw new Error(INVALID_DIFF_PATH);
    }
  }
}

async function readGitDiff(root, signal, file, baseRoot) {
  if (file) await validateWorkTreeFile(root, file);
  const common = baseRoot ? null : await baseMetadata(root);
  const metadata = baseRoot ? await linkedMetadata(root, baseRoot) : { gitDir: common, common };
  const gitDir = metadata.gitDir;
  const git = await gitExecutable();
  const controlled = await mkdtemp(path.join(os.tmpdir(), 'vvman-git-view-'));
  const env = gitEnvironment();
  const options = { cwd: root, signal, timeout: GIT_TIMEOUT, env, mergeError: false };
  try {
    const lineEndings = await gitLineEndingOptions(git, metadata.common, controlled, options);
    const execute = gitInvocation(git, options, path.join(controlled, 'disabled-hooks'));
    const head = await execute(['--git-dir=' + gitDir, 'rev-parse', '--verify', 'HEAD']);
    const headHash = head.output.trim();
    if (head.status === 'passed' && !COMMIT.test(headHash)) {
      throw new Error('当前 Git 差异查看支持标准 SHA-1 仓库。');
    }
    const format = await execute(['--git-dir=' + gitDir, 'rev-parse', '--show-object-format']);
    if (format.output.trim() !== 'sha1') throw new Error('当前 Git 差异查看支持标准 SHA-1 仓库。');
    await isolatedRepository(controlled, head.status === 'passed' ? headHash : null);
    const safeEnv = { ...env, GIT_DIR: controlled, GIT_WORK_TREE: root,
      GIT_INDEX_FILE: path.join(gitDir, 'index'), GIT_OBJECT_DIRECTORY: path.join(metadata.common, 'objects') };
    const filespec = file ? [file] : [];
    const gitView = args => execute([...lineEndings, ...(file ? ['--literal-pathspecs'] : []), ...args, '--', ...filespec],
      { env: safeEnv });
    if (file) {
      const indexed = await gitView(['ls-files', '--stage', '-z']);
      // A literal Git pathspec can still match all descendants of a directory.
      if (indexed.status !== 'passed' || indexed.truncated ||
          indexed.output.split('\0').some(item => item &&
            (!/^100[0-7]{3} [a-f0-9]{40} [0-3]\t/.test(item) || item.slice(item.indexOf('\t') + 1) !== file))) {
        throw new Error(INVALID_DIFF_PATH);
      }
      if (head.status === 'passed') {
        const previous = await gitView(['ls-tree', '-z', '--full-tree', 'HEAD']);
        if (previous.status !== 'passed' || previous.truncated ||
            previous.output.split('\0').some(item => item &&
              (!/^100[0-7]{3} blob [a-f0-9]{40}\t/.test(item) || item.slice(item.indexOf('\t') + 1) !== file))) {
          throw new Error(INVALID_DIFF_PATH);
        }
      }
    }
    // The temporary repo has only the selected line-ending settings, with no configured filters.
    const diff = ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--no-color'];
    if (file) diff.push('--no-renames');
    const staged = await gitView([...diff, '--cached']);
    const unstaged = await gitView(diff);
    const untracked = await gitView(['ls-files', '--others', '--exclude-standard', '-z']);
    if ([staged, unstaged, untracked].some(item => item.status !== 'passed')) throw new Error('无法读取当前 Git 差异。');
    const names = untracked.output.split('\0');
    names.pop();
    return { staged: staged.output, unstaged: unstaged.output,
      untracked: file ? names.filter(name => name === file) : names.slice(0, 200),
      truncated: names.length > 200 || [staged, unstaged, untracked].some(item => item.truncated) };
  } finally {
    // Remove only our newly created temp directory and its known contents.
    await rm(controlled, { recursive: true, force: true }).catch(() => {});
  }
}

class ProjectWorkflow {
  constructor({ origin, token, dialog, shell, window, ipcMain, profileDir, executionSettings }) {
    this.origin = origin;
    this.token = token;
    this.dialog = dialog;
    this.shell = shell;
    this.window = window;
    this.executionSettings = executionSettings;
    this.file = path.join(profileDir, 'project-test-runners.json');
    this.queue = Promise.resolve();
    this.running = new Set();
    this.developmentJobs = new Map();
    this.creatingWorktrees = new Set();
    this.windowScope = new AbortController();
    if (token) this.register(ipcMain);
  }

  reset() {
    this.windowScope.abort();
    this.windowScope = new AbortController();
  }

  async registry() {
    try {
      if ((await stat(this.file)).size > 2 * 1024 * 1024) throw new Error('registry too large');
      const records = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(records) || records.length > 256) throw new Error('invalid registry');
      return records.map(record => ({ ...cleanRunner(record), workspaceId: record.workspaceId, rootKey: record.rootKey }));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error('无法读取项目测试运行器设置。');
    }
  }

  change(update) {
    const operation = this.queue.then(async () => {
      const records = await this.registry();
      const result = await update(records);
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(records, null, 2), { flag: 'wx' });
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async target(workspaceId, name, scope, signal, conversationId) {
    if (typeof workspaceId !== 'string' || !WORKSPACE.test(workspaceId)) throw new Error('请选择有效的项目。');
    const endpoint = conversationId === undefined ? '/workspaces/' + workspaceId : this.conversationPath(conversationId);
    return this.checkTarget(await nativeRequest(this.origin, this.token,
      endpoint + '/development-target', { name, ...scope }, signal), workspaceId);
  }

  async checkTarget(target, workspaceId) {
    if (target?.workspace_id !== workspaceId || !ROOT_KEY.test(target.root_key) || !SOURCE.test(target.source)) {
      throw new Error('项目来源已变更或不可用，请重新选择。');
    }
    const root = await localEntry(target.root_path, 'directory');
    if (!root) throw new Error('项目文件夹已移走或无法访问，请重新绑定。');
    if (target.base_root_path !== undefined || target.base_root_key !== undefined) {
      const baseRoot = await localEntry(target.base_root_path, 'directory');
      if (!baseRoot || !ROOT_KEY.test(target.base_root_key) || samePath(root, baseRoot)) {
        throw new Error('聊天工作树与原项目的关联已失效。');
      }
      return { root, rootKey: target.root_key, source: target.source, baseRoot, baseRootKey: target.base_root_key };
    }
    return { root, rootKey: target.root_key, source: target.source };
  }

  conversationPath(id) {
    if (typeof id !== 'string' || !DEVELOPMENT_ID.test(id)) throw new Error('请选择有效的聊天。');
    return '/conversations/' + id;
  }

  async createWorktree(conversationId, source, signal) {
    const endpoint = this.conversationPath(conversationId);
    if (typeof source !== 'string' || !SOURCE.test(source)) throw new Error('请选择有效的项目来源。');
    if (this.creatingWorktrees.has(conversationId)) throw new Error('此聊天正在创建工作树。');
    this.creatingWorktrees.add(conversationId);
    let controlled;
    let destination;
    let registered = false;
    try {
      const target = await nativeRequest(this.origin, this.token, endpoint + '/worktree-target', { source }, signal);
      if (!WORKSPACE.test(target.workspace_id) || target.source !== source) throw new Error('无法验证工作树来源。');
      const base = await this.checkTarget(target, target.workspace_id);
      const common = await baseMetadata(base.root);
      const parent = await ensureWorktreesParent(target.worktrees_path, base.root);
      const basename = conversationId + '-' + randomBytes(8).toString('hex');
      const branch = 'vvman/' + basename;
      destination = path.join(parent, basename);
      const git = await gitExecutable();
      const env = gitEnvironment();
      const options = { cwd: base.root, signal, timeout: GIT_TIMEOUT, env, mergeError: false };
      controlled = await mkdtemp(path.join(os.tmpdir(), 'vvman-git-checkout-'));
      const execute = gitInvocation(git, options, path.join(controlled, 'disabled-hooks'));
      const format = await execute(['--git-dir=' + common, 'rev-parse', '--show-object-format']);
      if (format.status !== 'passed' || format.output.trim() !== 'sha1') throw new Error('当前支持标准 SHA-1 Git 仓库。');
      const head = await execute(['--git-dir=' + common, 'rev-parse', '--verify', 'HEAD^{commit}']);
      const commit = head.output.trim();
      if (head.status !== 'passed' || !COMMIT.test(commit)) throw new Error('原仓库没有可用于创建工作树的提交。');
      const answer = await this.withConfirmation({ type: 'warning', title: '创建聊天工作树',
        message: '从当前提交创建独立工作树？',
        detail: '原项目：' + base.root + '\n提交：' + commit + '\n新分支：' + branch + '\n新目录：' + destination +
          '\n\n原目录中的未提交改动不会复制。此聊天的文件、Git 差异和测试将使用该独立目录。',
      }, signal, AbortSignal.timeout(APPROVAL_TIMEOUT));
      if (!answer.approved) {
        if (answer.reason === 'dialog_closed') throw new Error('Windows 确认窗口异常关闭，工作树未创建。');
        return null;
      }
      const latest = await nativeRequest(this.origin, this.token, endpoint + '/worktree-target', { source }, signal);
      const latestBase = await this.checkTarget(latest, target.workspace_id);
      if (latestBase.rootKey !== base.rootKey || !samePath(latestBase.root, base.root) ||
          !samePath(await ensureWorktreesParent(latest.worktrees_path, base.root), parent)) {
        throw new Error('工作树来源已变更，请重新创建。');
      }
      await mkdir(parent, { recursive: true });
      if (!await localEntry(parent, 'directory')) throw new Error('本机工作树目录不可用。');
      signal.throwIfAborted();
      const add = await execute(['--git-dir=' + common, 'worktree', 'add', '--no-checkout', '-b', branch, '--', destination, commit],
        { timeout: CHECKOUT_TIMEOUT });
      registered = add.status === 'passed' || await lstat(destination).then(() => true, () => false);
      if (add.status !== 'passed') throw new Error('Git 未能创建聊天工作树。');
      const linked = await linkedMetadata(destination, base.root);
      const lineEndings = await gitLineEndingOptions(git, common, controlled, options);
      await isolatedRepository(controlled, commit);
      const checkoutEnv = { ...env, GIT_DIR: controlled, GIT_WORK_TREE: destination,
        GIT_INDEX_FILE: path.join(linked.gitDir, 'index'), GIT_OBJECT_DIRECTORY: path.join(common, 'objects') };
      const checkedOut = await execute([...lineEndings, '-c', 'core.symlinks=false', 'read-tree', '--reset', '-u', commit],
        { cwd: destination, env: checkoutEnv, timeout: CHECKOUT_TIMEOUT });
      if (checkedOut.status !== 'passed') throw new Error('Git 未能填充聊天工作树。');
      signal.throwIfAborted();
      return await nativeRequest(this.origin, this.token, endpoint + '/worktree', {
        source, root_path: destination, base_root_key: base.rootKey, branch, commit,
      }, signal);
    } catch (error) {
      if (registered) throw new Error('工作树已留在本机，但未能完成聊天绑定。目录：' + destination);
      throw error;
    } finally {
      if (controlled) await rm(controlled, { recursive: true, force: true }).catch(() => {});
      this.creatingWorktrees.delete(conversationId);
    }
  }

  async runners(workspaceId) {
    await this.queue;
    return (await this.registry()).filter(record => record.workspaceId === workspaceId);
  }

  async prepareTools(prepared, tools) {
    if (prepared?.permission_mode !== 'full') tools = tools.filter(tool => tool.name !== POWERSHELL_TOOL);
    const powershell = tools.find(tool => tool.name === POWERSHELL_TOOL);
    if (powershell) delete powershell.requires_confirmation;
    const diff = tools.find(tool => tool.name === DIFF_TOOL);
    if (diff) {
      diff.description += ' 仅查看一个文件时，提供精确的仓库相对路径 path。';
      diff.inputSchema = { ...diff.inputSchema, properties: { ...diff.inputSchema.properties,
        path: { type: 'string', description: '单个文件的仓库相对路径（例如 RELEASE_NOTES.md 或 docs/setup.md）。' },
      } };
    }
    const test = tools.find(tool => tool.name === TEST_TOOL);
    if (!test) return tools;
    const availableKeys = new Set((prepared.project_sources || []).map(item => item.root_key));
    const runners = (await this.runners(prepared.workspace_id)).filter(record => availableKeys.has(record.rootKey));
    if (!runners.length) return tools.filter(tool => tool !== test);
    // This tool uses a native confirmation that names the actual command and exact directory.
    delete test.requires_confirmation;
    test.inputSchema = { type: 'object', properties: { preset_id: { type: 'string',
      oneOf: runners.map(runner => ({ const: runner.id, title: runner.name })) } }, required: ['preset_id'], additionalProperties: false };
    return tools;
  }

  async withConfirmation(options, signal, timeout) {
    if (signal.aborted || this.window.isDestroyed()) return { reason: 'request_ended' };
    if (this.confirming) throw new Error('请先处理已经打开的项目操作确认。');
    const dialogSignal = timeout ? AbortSignal.any([signal, timeout]) : signal;
    try {
      this.confirming = true;
      const result = await this.dialog.showMessageBox(this.window, { ...options,
        buttons: ['取消', '继续'], cancelId: 0, defaultId: 0, noLink: true, signal: dialogSignal });
      if (signal.aborted || this.window.isDestroyed()) return { reason: 'request_ended' };
      if (timeout?.aborted) return { reason: 'approval_timeout' };
      if (result.response === 1) return { approved: true };
      return { reason: result.response === 0 ? 'rejected' : 'dialog_closed' };
    } finally {
      this.confirming = false;
    }
  }

  async saveRunner(workspaceId, input, signal) {
    const runner = cleanRunner(input);
    const target = await this.target(workspaceId, TEST_TOOL, { source: runner.source }, signal);
    const executable = await runnerExecutable(runner.executable);
    runner.executable = executable.canonical;
    const root = target.root;
    const confirmation = await this.withConfirmation({ type: 'warning', title: '保存测试运行器',
      message: '为这个项目保存测试命令',
      detail: '目录：' + root + '\n命令：' + displayCommand(runner) + '\n\n程序会以当前 Windows 用户权限运行。每次运行仍需确认。',
    }, signal);
    if (!confirmation.approved) throw new Error(confirmation.reason === 'dialog_closed'
      ? 'Windows 确认窗口异常关闭，测试运行器未保存。'
      : '已取消保存测试运行器。');
    return this.change(records => {
      signal.throwIfAborted();
      const index = records.findIndex(item => item.workspaceId === workspaceId && item.id === runner.id);
      if (input.id && index < 0) throw new Error('这个测试运行器已不存在。');
      const record = { ...runner, workspaceId, rootKey: target.rootKey };
      if (index >= 0) records[index] = record;
      else {
        if (records.length >= 256 || records.filter(item => item.workspaceId === workspaceId).length >= 12) {
          throw new Error('项目测试运行器已达数量上限。');
        }
        records.push(record);
      }
      return publicRunner(record);
    });
  }

  async runTests(workspaceId, presetId, resolveTarget, signal, approve) {
    if (typeof presetId !== 'string' || !ID.test(presetId)) throw new Error('请选择已保存的测试运行器。');
    const getRunner = async () => (await this.runners(workspaceId)).find(item => item.id === presetId);
    const runner = await getRunner();
    if (!runner) throw new Error('这个测试运行器已不存在。');
    const target = await resolveTarget(TEST_TOOL, { root_key: runner.rootKey });
    const executable = await runnerExecutable(runner.executable);
    const command = displayCommand(runner);
    const cwd = target.root;
    if (this.running.has(target.rootKey)) return noRun(command, cwd, 'approval_busy');
    this.running.add(target.rootKey);
    try {
      const confirmation = approve ? await approve({ executable: executable.canonical, args: runner.args, cwd, presetName: runner.name }) :
        await this.withConfirmation({ type: 'warning', title: '运行项目测试',
          message: '允许运行这条测试命令？',
          detail: '目录：' + cwd + '\n命令：' + command + '\n\n测试将在项目目录中以当前 Windows 用户权限运行。',
        }, signal, AbortSignal.timeout(APPROVAL_TIMEOUT));
      if (signal.aborted) return noRun(command, cwd, 'request_ended');
      if (!confirmation.approved) return noRun(command, cwd, confirmation.reason);
      const current = await resolveTarget(TEST_TOOL, { root_key: runner.rootKey });
      const verifiedExecutable = await runnerExecutable(runner.executable);
      if (current.root !== cwd || current.rootKey !== target.rootKey || verifiedExecutable.identity !== executable.identity ||
          JSON.stringify(await getRunner()) !== JSON.stringify(runner)) throw new Error('项目或测试运行器已变更，请重新确认。');
      const start = performance.now();
      const result = await runProcess(executable.canonical, runner.args,
        { cwd, signal, timeout: TEST_TIMEOUT, env: projectEnvironment(path.dirname(executable.canonical)) });
      return { ...result, ...(result.status === 'cancelled' ? { reason: 'request_ended' } : {}),
        command, cwd, elapsedMs: Math.round(performance.now() - start) };
    } finally {
      this.running.delete(target.rootKey);
    }
  }

  async tool(turn, client, request, signal) {
    const { name, arguments: args } = request;
    const workspaceId = turn.project?.prepared.workspace_id;
    const resolveTarget = async (tool, scope) => this.checkTarget(
      await client.projectRoot(turn, { name: tool, ...scope }, signal), workspaceId);
    if (name === POWERSHELL_TOOL && turn.project?.prepared.permission_mode !== 'full') {
      throw new Error('PowerShell 仅在此会话的完全访问模式下可用。');
    }
    if (name === TEST_TOOL) {
      const approve = async details => {
        const decision = await turn.live?.requestDecision({
          title: '允许运行项目测试？',
          kind: 'test', details,
          options: [{ id: 'allow_once', kind: 'allow_once', name: '继续' },
            { id: 'reject_once', kind: 'reject_once', name: '取消' }],
        }, signal);
        return decision?.status === 'selected' && decision.optionId === 'allow_once'
          ? { approved: true } : { reason: CANCEL_REASONS[decision?.status] || 'request_ended' };
      };
      return this.developmentTool(workspaceId, name, args, resolveTarget, signal, approve);
    }
    return this.developmentTool(workspaceId, name, args, resolveTarget, signal, undefined, turn.executionSettings?.shell);
  }

  async runPowerShell(args, resolveTarget, signal, settings = DEFAULT_EXECUTION_SETTINGS.shell) {
    const { source, command } = args;
    if (typeof command !== 'string' || !command.trim() || command.length > 4000 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(command) ||
        Object.keys(args).some(key => key !== 'command' && key !== 'source') ||
        (source !== undefined && (typeof source !== 'string' || !SOURCE.test(source)))) {
      throw new Error('请指定有效的 PowerShell 命令和项目来源。');
    }
    const scope = source === undefined ? {} : { source };
    const target = await resolveTarget(POWERSHELL_TOOL, scope);
    const cwd = target.root;
    if (this.running.has(target.rootKey)) return noRun(command, cwd, 'approval_busy');
    this.running.add(target.rootKey);
    try {
      const executable = await systemPowerShell();
      const verified = await resolveTarget(POWERSHELL_TOOL, scope);
      if (verified.root !== cwd || verified.rootKey !== target.rootKey || verified.source !== target.source ||
          await systemPowerShell() !== executable) throw new Error('项目或 PowerShell 已变更，请重新发起。');
      // Encoding the exact command avoids another shell interpreting its arguments.
      const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
        '$OutputEncoding = [Console]::OutputEncoding; $ProgressPreference = "SilentlyContinue";\n' + command;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const start = performance.now();
      const result = await runProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { cwd, signal, timeout: settings.timeoutSeconds * 1000, outputLimit: settings.outputKiB * 1024,
          env: projectEnvironment(path.dirname(executable), true) });
      return { ...result, ...(result.status === 'cancelled' ? { reason: 'request_ended' } : {}),
        elapsedMs: Math.round(performance.now() - start) };
    } finally {
      this.running.delete(target.rootKey);
    }
  }

  async developmentTool(workspaceId, name, args, resolveTarget, signal, approve, shellSettings = DEFAULT_EXECUTION_SETTINGS.shell) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('项目工具参数无效。');
    if (name === TEST_TOOL) {
      if (Object.keys(args).some(key => key !== 'preset_id')) throw new Error('测试工具只接受已保存的运行器。');
      const { command, cwd, ...result } = await this.runTests(workspaceId, args.preset_id, resolveTarget, signal, approve);
      const message = TEST_MESSAGES[result.reason];
      return { ...toolResult({ ...result, ...(message ? { message } : {}) }, result.status !== 'passed'), message };
    }
    if (name === POWERSHELL_TOOL) {
      const { command, cwd, ...result } = await this.runPowerShell(args, resolveTarget, signal, shellSettings);
      const message = result.reason && result.status === 'cancelled' ? 'PowerShell 命令未运行或已结束。' : undefined;
      return { ...shellToolResult({ ...result, ...(message ? { message } : {}) }, result.status !== 'passed'), message };
    }
    if (name === LIST_RUNNERS) {
      if (Object.keys(args).length) throw new Error('列出测试运行器无需参数。');
      const available = [];
      for (const runner of await this.runners(workspaceId)) {
        signal.throwIfAborted();
        try {
          const target = await resolveTarget(name, { root_key: runner.rootKey });
          available.push({ id: runner.id, name: runner.name, source: target.source });
        } catch (error) {
          if (signal.aborted) throw error;
          // Removed and rebound roots no longer expose their runners.
        }
      }
      return toolResult({ runners: available });
    }
    if (name !== DIFF_TOOL) throw new Error('项目工具不在当前授权范围内。');
    if (Object.keys(args).some(key => !['source', 'path'].includes(key)) ||
        (args.source !== undefined && (typeof args.source !== 'string' || !SOURCE.test(args.source)))) {
      throw new Error('请选择有效的项目来源。');
    }
    if (Object.hasOwn(args, 'path') && (!projectPath('source_1', args.path) ||
        args.path.split('/').some(part => part.toLowerCase() === '.git'))) throw new Error(INVALID_DIFF_PATH);
    const { root, baseRoot } = await resolveTarget(DIFF_TOOL, args.source === undefined ? {} : { source: args.source });
    return toolResult(await readGitDiff(root, signal, args.path, baseRoot));
  }

  developmentKey(conversationId, id) {
    if (typeof conversationId !== 'string' || !DEVELOPMENT_ID.test(conversationId) ||
        typeof id !== 'string' || !DEVELOPMENT_ID.test(id)) throw new Error('无效的项目工具请求。');
    return conversationId + '/' + id;
  }

  async executeDevelopment(state, conversationId, id) {
    const endpoint = '/conversations/' + conversationId + '/development-jobs/' + id;
    const signal = state.signal;
    const job = await nativeRequest(this.origin, this.token, endpoint + '/claim', {}, signal);
    const { name, workspace_id: workspaceId, arguments: args } = job;
    if (!WORKSPACE.test(workspaceId)) throw new Error('本机项目工具请求无效。');
    const resolveTarget = async (_name, scope) => this.checkTarget(
      await nativeRequest(this.origin, this.token, endpoint + '/target', scope, signal), workspaceId);
    const approve = details => {
      signal.throwIfAborted();
      state.preview.resolve({ kind: 'approval', details });
      const timeout = setTimeout(() => state.decision.resolve({ reason: 'approval_timeout' }), APPROVAL_TIMEOUT);
      timeout.unref();
      return state.decision.promise.finally(() => clearTimeout(timeout));
    };
    let result;
    try {
      result = await this.developmentTool(workspaceId, name, args, resolveTarget, signal, approve, state.shellSettings);
    } catch {
      result = toolResult({ message: '项目工具未完成。请检查当前授权、目录和参数。' }, true);
    }
    if (!signal.aborted) {
      const { content, isError } = result;
      await nativeRequest(this.origin, this.token, endpoint + '/complete', { result: { content, isError } }, signal);
    }
    return { kind: 'complete' };
  }

  prepareDevelopment(conversationId, id, windowSignal) {
    const key = this.developmentKey(conversationId, id);
    const current = this.developmentJobs.get(key);
    if (current) return current.preview.promise;
    if (this.developmentJobs.size >= MAX_DEVELOPMENT_JOBS) throw new Error('正在处理的项目请求已达上限。');
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, windowSignal]);
    const state = { abort, signal, preview: Promise.withResolvers(), decision: Promise.withResolvers(),
      shellSettings: this.executionSettings?.get().shell };
    const cancel = () => state.decision.resolve({ reason: 'request_ended' });
    signal.addEventListener('abort', cancel, { once: true });
    this.developmentJobs.set(key, state);
    state.completion = this.executeDevelopment(state, conversationId, id).finally(() => {
      this.developmentJobs.delete(key);
      signal.removeEventListener('abort', cancel);
    });
    state.completion.then(state.preview.resolve, state.preview.reject);
    return state.preview.promise;
  }

  async respondDevelopment(conversationId, id, approved) {
    const state = this.developmentJobs.get(this.developmentKey(conversationId, id));
    if (!state || state.responded || state.signal.aborted || typeof approved !== 'boolean') {
      throw new Error('这个项目授权请求已结束。');
    }
    const preview = await state.preview.promise;
    if (preview.kind !== 'approval' || state.responded || state.signal.aborted) throw new Error('这个项目授权请求已结束。');
    state.responded = true;
    state.decision.resolve(approved ? { approved: true } : { reason: 'rejected' });
    return state.completion;
  }

  register(ipcMain) {
    const handle = (action, use) => ipcMain.handle('vvman-projects:' + action, (event, ...args) => {
      trustWorkbench(event, this.window, this.origin);
      if (process.platform !== 'win32') throw new Error('当前项目测试和 Git 差异仅支持 Windows。');
      return use(this.windowScope.signal, ...args);
    });
    handle('choose-test-executable', async signal => {
      const result = await this.dialog.showOpenDialog(this.window, { title: '选择测试程序', properties: ['openFile'],
        filters: [{ name: 'Windows 程序', extensions: ['exe'] }] });
      return signal.aborted || result.canceled ? null : result.filePaths[0] || null;
    });
    handle('list-test-runners', async (_signal, workspaceId) => (await this.runners(workspaceId)).map(runner => publicRunner(runner)));
    handle('save-test-runner', (signal, workspaceId, runner) => this.saveRunner(workspaceId, runner, signal));
    handle('remove-test-runner', (signal, workspaceId, id) => this.change(records => {
      signal.throwIfAborted();
      const index = records.findIndex(item => item.workspaceId === workspaceId && item.id === id);
      if (index < 0) throw new Error('这个测试运行器已不存在。');
      records.splice(index, 1);
    }));
    handle('run-tests', (signal, workspaceId, id, conversationId) => this.runTests(workspaceId, id,
      (name, scope) => this.target(workspaceId, name, scope, signal, conversationId), signal));
    handle('git-diff', async (signal, workspaceId, source, conversationId) => {
      if (source !== undefined && (typeof source !== 'string' || !SOURCE.test(source))) {
        throw new Error('请选择有效的项目来源。');
      }
      const { root, baseRoot } = await this.target(workspaceId, DIFF_TOOL,
        source === undefined ? {} : { source }, signal, conversationId);
      return readGitDiff(root, signal, undefined, baseRoot);
    });
    handle('create-worktree', (signal, conversationId, source) => this.createWorktree(conversationId, source, signal));
    const worktreeLocation = async (signal, conversationId) => {
      const endpoint = this.conversationPath(conversationId);
      const location = await nativeRequest(this.origin, this.token, endpoint + '/worktree-location', {}, signal);
      const directory = await localEntry(location?.root_path, 'directory');
      signal.throwIfAborted();
      if (!directory) throw new Error('无法找到此聊天的工作树。');
      return directory;
    };
    handle('worktree-location', worktreeLocation);
    handle('open-worktree', async (signal, conversationId, target = 'explorer') => {
      const directory = await worktreeLocation(signal, conversationId);
      await launchWorkspace(this.shell, directory, target, { signal });
    });
    handle('prepare-development', (signal, conversationId, id) => this.prepareDevelopment(conversationId, id, signal));
    handle('respond-development', (_signal, conversationId, id, approved) => this.respondDevelopment(conversationId, id, approved));
    handle('cancel-development', (_signal, conversationId, id) => {
      this.developmentJobs.get(this.developmentKey(conversationId, id))?.abort.abort();
    });
  }
}

module.exports = { ProjectWorkflow, TEST_TOOL, DIFF_TOOL, POWERSHELL_TOOL };
