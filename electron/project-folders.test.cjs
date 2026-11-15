const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { mkdir, mkdtemp, realpath, rm, symlink } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { registerProjectFolders, trustWorkbench } = require('./project-folders.cjs');

test('project IPC requires the same main window, frame, origin and workbench route', () => {
  const origin = 'http://127.0.0.1:8765';
  const contents = { mainFrame: { url: origin + '/#assistant' } };
  const window = { webContents: contents };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.doesNotThrow(() => trustWorkbench(event, window, origin));
  assert.throws(() => trustWorkbench({ ...event, sender: {} }, window, origin));
  assert.throws(() => trustWorkbench({ ...event, senderFrame: { url: origin + '/' } }, window, origin));
  for (const location of [origin + '/events', 'https://example.com/', 'http://127.0.0.1:8766/']) {
    contents.mainFrame.url = location;
    assert.throws(() => trustWorkbench(event, window, origin));
  }
});

test('native grant and Explorer open are scoped to selected and persisted directories', async t => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vvman-project-folders-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const missing = path.join(directory, 'missing');
  const token = 'native-project-secret';
  const projectId = 'ws_0123456789ab';
  const routes = [];
  let savedDirectory = directory;
  let sourceFolders;
  const server = http.createServer(async (request, response) => {
    routes.push(request.url);
    assert.equal(request.headers['x-data-agent-native'], token);
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/project-folder-grants')) {
      assert.equal(request.method, 'POST');
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.deepEqual(JSON.parse(body), { path: directory });
      response.end(JSON.stringify({ root_path: directory, folder_grant: 'bound-folder-grant' }));
    } else {
      response.end(JSON.stringify({ workspaces: [{ id: projectId, root_path: savedDirectory, source_folders: sourceFolders }] }));
    }
  });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const opened = [];
  let cookie;
  let outgoing;
  const handlers = new Map();
  const webContents = {
    mainFrame: { url: origin + '/' },
    session: {
      cookies: { set: async value => { cookie = value; } },
      webRequest: { onBeforeSendHeaders: handler => { outgoing = handler; } },
    },
  };
  const window = { webContents };
  await registerProjectFolders({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [directory] }) },
    shell: { openPath: async value => { opened.push(value); return ''; } },
    window, origin, token,
  });
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'strict');
  assert.equal(cookie.value, createHmac('sha256', token).update('vvman-project-browser-session').digest('hex'));
  const cookieHeader = `other=ok; respiratory_desktop=${cookie.value}`;
  for (const [url, expected] of [[origin + '/api/assistant/workspaces', cookieHeader], ['http://127.0.0.1:9999/', 'other=ok']]) {
    outgoing({ url, requestHeaders: { Cookie: cookieHeader } }, result => assert.equal(result.requestHeaders.Cookie, expected));
  }

  const trusted = { sender: webContents, senderFrame: webContents.mainFrame };
  const choose = handlers.get('vvman-projects:choose-directory');
  const open = handlers.get('vvman-projects:open-directory');
  assert.deepEqual(await choose(trusted), { root_path: directory, folder_grant: 'bound-folder-grant' });
  await assert.rejects(open(trusted, directory), /有效/);
  await open(trusted, projectId);
  assert.deepEqual(opened, [directory]);
  assert.deepEqual(routes, ['/api/assistant/project-folder-grants', '/api/assistant/workspaces']);
  savedDirectory = missing;
  await assert.rejects(open(trusted, projectId), /移走/);
  savedDirectory = path.join(directory, 'linked');
  await symlink(await realpath(directory), savedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(open(trusted, projectId), /移走/);
  assert.deepEqual(opened, [directory]);
  const secondDirectory = path.join(directory, 'second');
  await mkdir(secondDirectory);
  sourceFolders = [directory, secondDirectory];
  await open(trusted, projectId);
  await open(trusted, projectId, 1);
  await assert.rejects(open(trusted, projectId, 2), /未绑定/);
  await assert.rejects(open(trusted, projectId, secondDirectory), /有效/);
  sourceFolders = [];
  await assert.rejects(open(trusted, projectId), /未绑定/);
  assert.deepEqual(opened, [directory, directory, secondDirectory]);
});
