const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { trustWorkbench } = require('./project-folders.cjs');
const { DIFF_TOOL } = require('./acp-project-workflow.cjs');

const PREFIX = 'somnus-workspace-terminal:';
const MAX_TERMINALS = 4;

function loadPty(resourcesPath) {
  if (resourcesPath) {
    const unpacked = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty');
    try { return require(unpacked); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  return require('node-pty');
}

function dimensions(cols, rows) {
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) ||
      cols < 2 || cols > 500 || rows < 2 || rows > 300) {
    throw new Error('终端尺寸无效。');
  }
  return { cols, rows };
}

function registerWorkspaceTerminal({ ipcMain, window, origin, workflow, resourcesPath, dshStartup, pty = () => loadPty(resourcesPath) }) {
  const terminals = new Map();
  const pending = new Set();
  const channels = [];
  const contents = window.webContents;

  function handle(action, listener) {
    const channel = PREFIX + action;
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      trustWorkbench(event, window, origin);
      return listener(event, ...args);
    });
  }

  function dispose(id, terminal) {
    terminals.delete(id);
    terminal.data?.dispose();
    terminal.exit?.dispose();
  }

  function stop(id) {
    const terminal = terminals.get(id);
    if (!terminal) return;
    dispose(id, terminal);
    try { terminal.process.kill(); } catch {}
  }

  function reset() {
    for (const controller of pending) controller.abort();
    for (const id of terminals.keys()) stop(id);
  }

  handle('start', async (event, projectId, sourceIndex, conversationId, cols, rows) => {
    const size = dimensions(cols, rows);
    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex > 99) {
      throw new Error('请选择有效的项目来源。');
    }
    if (pending.size + terminals.size >= MAX_TERMINALS) throw new Error('请先关闭一个项目终端。');
    const controller = new AbortController();
    pending.add(controller);
    try {
      const { root } = await workflow.target(projectId, DIFF_TOOL, { source: 'source_' + (sourceIndex + 1) },
        controller.signal, conversationId ?? undefined);
      const startup = await dshStartup?.().catch(() => null);
      controller.signal.throwIfAborted();
      trustWorkbench(event, window, origin);
      const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows',
        'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      let processHandle;
      try {
        processHandle = pty().spawn(executable, ['-NoLogo', ...(startup?.args ?? [])], {
          name: 'xterm-256color', ...size, cwd: root, env: { ...process.env, ...startup?.env, TERM: 'xterm-256color' },
        });
      } catch (error) {
        throw new Error('无法启动内嵌 PowerShell 终端。', { cause: error });
      }
      const id = randomUUID();
      const terminal = { process: processHandle };
      terminals.set(id, terminal);
      terminal.data = processHandle.onData(data => {
        if (!contents.isDestroyed()) contents.send(PREFIX + 'data', id, data);
      });
      terminal.exit = processHandle.onExit(({ exitCode }) => {
        dispose(id, terminal);
        if (!contents.isDestroyed()) contents.send(PREFIX + 'exit', id, exitCode);
      });
      return id;
    } finally {
      pending.delete(controller);
    }
  });
  handle('write', (_event, id, data) => {
    if (typeof data !== 'string' || data.length > 256 * 1024) throw new Error('终端输入过长。');
    terminals.get(id)?.process.write(data);
  });
  handle('resize', (_event, id, cols, rows) => {
    const size = dimensions(cols, rows);
    terminals.get(id)?.process.resize(size.cols, size.rows);
  });
  handle('stop', (_event, id) => stop(id));

  contents.on('did-start-navigation', (_event, details) => {
    if (details.isMainFrame && !details.isSameDocument) reset();
  });
  contents.on('render-process-gone', reset);
  window.once('closed', () => {
    reset();
    for (const channel of channels) ipcMain.removeHandler(channel);
  });
}

module.exports = { registerWorkspaceTerminal };
