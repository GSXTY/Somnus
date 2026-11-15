const { createHmac } = require('node:crypto');
const { lstat, realpath } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const cookieName = 'respiratory_desktop';
const secretScope = 'vvman-project-browser-session';
const apiRoot = '/api/assistant';

function trustWorkbench(event, window, origin) {
  const contents = window?.webContents;
  const frame = event.senderFrame;
  const url = frame ? URL.parse(frame.url) : null;
  if (!origin || !contents || contents !== event.sender || frame !== contents.mainFrame ||
      url?.origin !== origin || url.pathname !== '/') {
    throw new Error('请在 Somnus 工作台中使用项目文件夹。');
  }
}

function nativeRequest(origin, token, endpoint, payload, signal) {
  return new Promise((resolve, reject) => {
    const headers = { 'X-Data-Agent-Native': token };
    let body;
    if (payload) {
      body = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const timeout = AbortSignal.timeout(5000);
    const request = http.request(origin + apiRoot + endpoint, {
      agent: false,
      method: body ? 'POST' : 'GET',
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error('本机服务无法验证这个项目文件夹。'));
        return;
      }
      response.setEncoding('utf8');
      let result = '';
      response.on('error', reject);
      response.on('data', chunk => {
        result += chunk;
        if (result.length > 2_000_000) request.destroy(new Error('项目列表过大。'));
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(result));
        } catch {
          reject(new Error('无法读取本机服务的项目文件夹结果。'));
        }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function registerProjectFolders({ ipcMain, dialog, shell, window, origin, token }) {
  const session = window.webContents.session;
  // Cookies are host-scoped, so remove this capability from requests to any other port.
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (URL.parse(details.url)?.origin !== origin) {
      const name = Object.keys(headers).find(key => key.toLowerCase() === 'cookie');
      if (name) {
        headers[name] = headers[name].split(';').map(item => item.trim())
          .filter(item => !item.startsWith(cookieName + '=')).join('; ');
      }
    }
    callback({ requestHeaders: headers });
  });
  await session.cookies.set({
    url: origin + apiRoot,
    name: cookieName,
    value: createHmac('sha256', token).update(secretScope).digest('hex'),
    httpOnly: true,
    sameSite: 'strict',
    path: apiRoot,
  });

  ipcMain.handle('vvman-projects:choose-directory', async event => {
    trustWorkbench(event, window, origin);
    const result = await dialog.showOpenDialog(window, {
      title: '选择项目文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    trustWorkbench(event, window, origin);
    const grant = await nativeRequest(origin, token, '/project-folder-grants', { path: result.filePaths[0] });
    if (typeof grant?.root_path !== 'string' || typeof grant.folder_grant !== 'string') {
      throw new Error('未能绑定选中的项目文件夹。');
    }
    return { root_path: grant.root_path, folder_grant: grant.folder_grant };
  });

  ipcMain.handle('vvman-projects:open-directory', async (event, projectId, sourceIndex = 0) => {
    trustWorkbench(event, window, origin);
    if (typeof projectId !== 'string' || !/^ws_[a-f0-9]{12}$/.test(projectId)) {
      throw new Error('请选择有效的项目。');
    }
    if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0) {
      throw new Error('请选择有效的项目来源文件夹。');
    }
    const { workspaces } = await nativeRequest(origin, token, '/workspaces');
    const project = workspaces.find(item => item.id === projectId);
    const sources = Array.isArray(project?.source_folders) ? project.source_folders : [project?.root_path];
    const folder = sources[sourceIndex];
    if (!project || project.archived || typeof folder !== 'string' ||
        !path.isAbsolute(folder) || (process.platform === 'win32' && !/^[a-z]:\\/i.test(folder))) {
      throw new Error('这个项目未绑定可打开的文件夹。');
    }
    const [info, resolved] = await Promise.all([
      lstat(folder).catch(() => null),
      realpath(folder).catch(() => ''),
    ]);
    const normalized = path.resolve(folder);
    const samePath = process.platform === 'win32' ? resolved.toLowerCase() === normalized.toLowerCase() : resolved === normalized;
    if (!info?.isDirectory() || !samePath) {
      throw new Error('项目文件夹已移走或无法访问，请重新选择文件夹。');
    }
    trustWorkbench(event, window, origin);
    if (await shell.openPath(normalized)) throw new Error('无法打开项目文件夹。');
  });
}

module.exports = { registerProjectFolders, trustWorkbench, nativeRequest };
