const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDesktopTray, folderLaunchArgument, keepWindowInTray } = require('./desktop-tray.cjs');
const { openProjectFolder } = require('./project-folders.cjs');

test('tray keeps the window resident, opens common commands, and remembers independent notification switches', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'somnus-tray-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let native, selected;
  class Tray extends EventEmitter {
    constructor() { super(); native = this; }
    setToolTip(label) { this.label = label; }
    setContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const options = {
    Tray, Menu: { buildFromTemplate: menu => menu }, dataDir: dir,
    show: () => { selected = 'show'; }, openProfiles: () => { selected = 'profiles'; },
    openRecovery: () => { selected = 'recovery'; }, quit: () => { selected = 'quit'; },
  };
  const controller = await createDesktopTray(options);
  assert.equal(native.menu.some(item => item.label === '打开 DSH 终端'), false);
  native.emit('click');
  assert.equal(selected, 'show');
  native.menu.find(item => item.label === '运行配置…').click();
  assert.equal(selected, 'profiles');
  native.menu.find(item => item.label === '故障恢复…').click();
  assert.equal(selected, 'recovery');
  const switches = native.menu.find(item => item.label === '任务通知').submenu;
  switches[0].click({ checked: false });
  switches[3].click({ checked: false });
  await controller.flush();
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'desktop-notifications.json'), 'utf8')), {
    assistantComplete: false, assistantFailed: true, analysisComplete: true, analysisFailed: false,
  });
  assert.equal(controller.allowsNotification('assistant', false), false);
  assert.equal(controller.allowsNotification('assistant', true), true);
  assert.equal(controller.allowsNotification('deep-analysis', false), true);
  assert.equal(controller.allowsNotification('deep-analysis', true), false);
  let hidden = 0;
  let closeIntercepted = 0;
  let resident = true;
  const window = new EventEmitter();
  window.hide = () => { hidden++; };
  keepWindowInTray(window, () => resident);
  const event = { preventDefault() { closeIntercepted++; } };
  window.emit('close', event);
  resident = false;
  window.emit('close', event);
  assert.equal(hidden, 1);
  assert.equal(closeIntercepted, 1);
  native.menu.find(item => item.label === '退出 Somnus').click();
  assert.equal(selected, 'quit');
  controller.destroy();
  assert.equal(native.destroyed, true);
  const reopened = await createDesktopTray(options);
  assert.equal(reopened.allowsNotification('deep-analysis', true), false);
  reopened.destroy();
});

test('shortcut folder arguments resolve against the caller and skip profile paths', () => {
  const cwd = path.resolve('project-root');
  const target = path.resolve(cwd, 'folder with space');
  assert.equal(folderLaunchArgument(['Somnus.exe', 'folder with space'], cwd), target);
  assert.equal(folderLaunchArgument(['Somnus.exe', '--open-folder', 'folder with space'], cwd), target);
  assert.equal(folderLaunchArgument(['Somnus.exe', '--user-data-dir', 'profile'], cwd), null);
  assert.equal(folderLaunchArgument(['electron.exe', 'electron/main.cjs', '--open-folder=folder with space'], cwd, true), target);
  assert.equal(folderLaunchArgument(['Somnus.exe', 'one', 'two'], cwd), null);
});

test('folder opening reuses an existing project and creates new projects with a native folder grant', async () => {
  const folder = 'D:\\Project root\\Respiration';
  const origin = 'http://127.0.0.1:9999';
  const id = 'ws_1234567890ab';
  const expectedGrant = { root_path: folder, folder_grant: 'single-use' };
  const makeRequests = workspaces => {
    const calls = [];
    return { calls, request: async (_origin, _token, endpoint, data) => {
      calls.push([endpoint, data]);
      if (endpoint === '/project-folder-grants') return expectedGrant;
      if (endpoint === '/workspaces' && !data) return { workspaces };
      return { workspace: { id } };
    } };
  };
  const previous = makeRequests([{ id, source_folders: [folder.toLowerCase()] }]);
  assert.equal(await openProjectFolder(origin, 'token', folder, previous.request), id);
  assert.equal(previous.calls.length, 2);
  const fresh = makeRequests([]);
  assert.equal(await openProjectFolder(origin, 'token', folder, fresh.request), id);
  assert.deepEqual(fresh.calls[2], ['/workspaces', { name: 'Respiration', source_folders: [expectedGrant] }]);
  const archived = makeRequests([{ id, root_path: folder, archived: true }]);
  await assert.rejects(openProjectFolder(origin, 'token', folder, archived.request), /归档/);
  assert.equal(archived.calls.length, 2);
});
