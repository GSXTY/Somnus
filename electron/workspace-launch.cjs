const { spawn } = require('node:child_process');
const { stat } = require('node:fs/promises');
const path = require('node:path');

async function windowsLauncher(target, env, inspect) {
  const candidates = {
    vscode: [
      [env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'],
      [env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'],
      [env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'],
    ],
    'git-bash': [
      [env.ProgramFiles, 'Git', 'git-bash.exe'],
      [env['ProgramFiles(x86)'], 'Git', 'git-bash.exe'],
      [env.LOCALAPPDATA, 'Programs', 'Git', 'git-bash.exe'],
    ],
    terminal: [[env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe']],
  };
  const labels = { vscode: 'VS Code', 'git-bash': 'Git Bash', terminal: 'Windows PowerShell' };
  if (!Object.hasOwn(candidates, target)) throw new Error('请选择支持的工作区应用。');
  for (const [base, ...name] of candidates[target]) {
    if (typeof base !== 'string' || !/^[a-z]:\\/i.test(base)) continue;
    const executable = path.win32.join(base, ...name);
    if ((await inspect(executable).catch(() => null))?.isFile()) return executable;
  }
  throw new Error(`找不到 ${labels[target]}。请确认它已安装在 Windows 的标准安装目录。`);
}

async function launchWorkspace(shell, folder, target = 'explorer', options = {}) {
  if (target === 'explorer') {
    if (!shell || await shell.openPath(folder)) throw new Error('无法打开项目文件夹。');
    return;
  }
  const { platform = process.platform, env = process.env, inspect = stat, launch = spawn, signal } = options;
  if (platform !== 'win32') throw new Error('该工作区应用入口仅在 Windows 支持。');
  if (typeof target !== 'string') throw new Error('请选择支持的工作区应用。');
  const application = await windowsLauncher(target, env, inspect);
  const terminal = target === 'terminal';
  const executable = terminal ? path.win32.join(path.win32.dirname(application), '..', '..', 'cmd.exe') : application;
  // Start a real interactive console using cmd's built-in start. Only the
  // fixed Windows executable and flags enter the command, not the folder.
  if (terminal && /["%&|<>^!]/.test(application)) throw new Error('Windows PowerShell 路径无效。');
  const args = terminal ? ['/d', '/c', 'start', '""', `"${application}"`, '-NoLogo'] :
    target === 'vscode' ? [folder] : [`--cd=${folder}`];
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = launch(executable, args, {
      cwd: folder, detached: true, stdio: 'ignore', shell: false,
      windowsHide: terminal, windowsVerbatimArguments: terminal,
    });
    child.once('error', () => reject(new Error('无法启动所选工作区应用。')));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = { launchWorkspace };
