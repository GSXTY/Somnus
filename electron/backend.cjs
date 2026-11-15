const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const APP_ID = 'vvfly-respiratory-viewer';
const HOST = '127.0.0.1';
const PREFERRED_PORT = 8765;

function backendCommand({ packaged, resourcesPath, sourceRoot, platform = process.platform, env = process.env }) {
  if (packaged) {
    const directory = path.join(resourcesPath, 'backend');
    const suffix = platform === 'win32' ? '.exe' : '';
    const executable = path.join(directory, 'SomnusBackend' + suffix);
    const legacy = path.join(directory, 'RespiratoryViewer' + suffix);
    // Permit updating the desktop shell before replacing the frozen service.
    const selected = !fs.existsSync(executable) && fs.existsSync(legacy) ? legacy : executable;
    return { executable: selected, args: [], cwd: directory };
  }
  return {
    executable: env.RESPIRATORY_VIEWER_PYTHON || (platform === 'win32' ? 'python' : 'python3'),
    args: [path.join(sourceRoot, 'launcher.py')],
    cwd: sourceRoot,
  };
}

function startupUrl(record, childPid) {
  if (!Number.isInteger(childPid) || childPid < 1 || record?.pid !== childPid ||
      !Number.isInteger(record?.port) || record.port < 1 || record.port > 65535) {
    throw new Error('本机服务返回了无法验证的启动信息。');
  }
  return `http://${HOST}:${record.port}`;
}

function checkHealth(origin, signal) {
  return new Promise((resolve, reject) => {
    // A direct loopback request must work even with a system HTTP proxy.
    const request = http.get(origin + '/api/health', { agent: false, signal }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve(false);
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('error', reject);
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) request.destroy(new Error('本机服务状态响应过大。'));
      });
      response.on('end', () => {
        try {
          const health = JSON.parse(body);
          resolve(health?.app_id === APP_ID && health.framework === 'fastapi');
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

async function waitForBackend({ child, readyFile, getExit, signal, timeoutMs }) {
  const deadline = performance.now() + timeoutMs;
  let origin;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const failure = getExit();
    if (failure) throw failure;

    if (!origin) {
      let record;
      try {
        record = await fs.promises.readFile(readyFile, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (record !== undefined) origin = startupUrl(JSON.parse(record), child.pid);
    }
    if (origin) {
      const healthSignal = AbortSignal.any([signal, AbortSignal.timeout(1000)]);
      // An already-bound service may still be finishing its startup.
      const healthy = await checkHealth(origin, healthSignal).catch(() => false);
      signal.throwIfAborted();
      const failure = getExit();
      if (failure) throw failure;
      if (healthy) return origin;
    }
    await delay(100, undefined, { signal });
  }
  throw new Error('等待本机分析服务启动超时。');
}

function startBackend(command, logFile, { timeoutMs = 45_000, shutdownMs = 8_000, env = process.env } = {}) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respiratory-viewer-'));
  const readyFile = path.join(tempDir, 'ready.json');
  const control = new AbortController();
  let child;
  let log;
  try {
    log = fs.openSync(logFile, 'w');
    child = spawn(command.executable, [
      ...command.args, '--host', HOST, '--port', String(PREFERRED_PORT),
      '--no-window', '--no-browser', '--ready-file', readyFile, '--shutdown-on-stdin-close',
    ], { cwd: command.cwd, stdio: ['pipe', log, log], windowsHide: true, env });
  } catch (error) {
    fs.rmdirSync(tempDir);
    throw error;
  } finally {
    if (log !== undefined) fs.closeSync(log);
  }
  let exit;
  const exited = new Promise(resolve => {
    child.on('error', error => {
      exit = error;
      resolve(error);
    });
    child.once('exit', (code, signal) => {
      exit = new Error(`本机分析服务已退出（${signal || code}）。`);
      resolve(exit);
    });
  });
  // The backend may already have closed its input when a startup error occurs.
  child.stdin.on('error', () => {});

  let stopping;
  function stop() {
    stopping ??= (async () => {
      control.abort();
      child.stdin.end();
      const force = setTimeout(() => { if (!exit) child.kill('SIGKILL'); }, shutdownMs);
      try {
        await exited;
      } finally {
        clearTimeout(force);
        await fs.promises.rm(readyFile, { force: true }).catch(() => {});
        await fs.promises.rmdir(tempDir).catch(() => {});
      }
    })();
    return stopping;
  }

  return {
    exited,
    ready: waitForBackend({ child, readyFile, getExit: () => exit, signal: control.signal, timeoutMs }),
    stop,
  };
}

module.exports = { backendCommand, startBackend };
