const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } = require('node:fs/promises');
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
  const cid = 'a'.repeat(32);
  const pid = 'edit_' + 'b'.repeat(32);
  const routes = [];
  let savedDirectory = directory;
  let sourceFolders;
  let approvedTarget;
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
    } else if (request.url.endsWith('/open-target')) {
      assert.equal(request.url, `/api/assistant/conversations/${cid}/file-proposals/${pid}/open-target`);
      assert.equal(request.method, 'POST');
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.deepEqual(JSON.parse(body), {});
      if (!approvedTarget) response.writeHead(404).end('{}');
      else response.end(JSON.stringify(approvedTarget));
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
  const revealed = [];
  let openFailure = '';
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
    shell: { openPath: async value => { opened.push(value); return openFailure; },
      showItemInFolder: value => revealed.push(value) },
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

  const lookupApproved = handlers.get('vvman-projects:approved-file-location');
  const openApproved = handlers.get('vvman-projects:open-approved-file');
  const source = path.join(secondDirectory, 'example.c');
  await writeFile(source, 'int main(void) { return 0; }');
  await writeFile(path.join(secondDirectory, 'script.js'), 'console.log("test");');
  await assert.rejects(openApproved(trusted, cid, pid), /无法找到/);
  approvedTarget = { root_path: directory, relative_path: 'second/example.c' };
  assert.equal(await lookupApproved(trusted, cid, pid), source);
  await assert.rejects(openApproved(trusted, 'other', pid), /有效|请选择/);
  await assert.rejects(openApproved({ ...trusted, senderFrame: {} }, cid, pid), /工作台/);
  await openApproved(trusted, cid, pid, 'C:\\forged.txt');
  assert.equal(opened.at(-1), source);
  openFailure = 'no file association';
  await openApproved(trusted, cid, pid);
  assert.deepEqual(revealed, [source]);
  openFailure = '';
  approvedTarget.relative_path = 'second/script.js';
  const shellOpenCount = opened.length;
  await openApproved(trusted, cid, pid);
  assert.equal(opened.length, shellOpenCount);
  assert.equal(revealed.at(-1), path.join(secondDirectory, 'script.js'));

  for (const unsafe of ['../second/example.c', 'second/example.c:stream', 'linked/second/example.c', 'absent.c']) {
    approvedTarget.relative_path = unsafe;
    await assert.rejects(openApproved(trusted, cid, pid), /已移动/);
  }
  const hardlink = path.join(secondDirectory, 'linked-file.c');
  await link(source, hardlink);
  approvedTarget.relative_path = 'second/linked-file.c';
  await assert.rejects(openApproved(trusted, cid, pid), /已移动/);
});
