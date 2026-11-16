const { randomUUID } = require('node:crypto');
const { readFile, rename, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');

const notificationItems = [
  ['assistantComplete', 'AI 会话完成'],
  ['assistantFailed', 'AI 会话失败'],
  ['analysisComplete', '深度分析完成'],
  ['analysisFailed', '深度分析失败'],
];

async function createDesktopTray({ Tray, Menu, icon, dataDir, show, openFolder, openProfiles, openRecovery, quit }) {
  const file = path.join(dataDir, 'desktop-notifications.json');
  const stored = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  let settings = Object.fromEntries(notificationItems.map(([key]) => [key, stored?.[key] !== false]));
  let pendingWrite = Promise.resolve();
  const tray = new Tray(icon);
  tray.setToolTip('Somnus');
  tray.on('click', show);
  tray.on('double-click', show);

  function updateMenu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 Somnus', click: show },
      ...(openFolder ? [{ label: '打开项目文件夹…', click: openFolder }] : []),
      ...(openProfiles ? [{ label: '运行配置…', click: openProfiles }] : []),
      ...(openRecovery ? [{ label: '故障恢复…', click: openRecovery }] : []),
      { type: 'separator' },
      { label: '任务通知', submenu: notificationItems.map(([key, label]) => ({
        label, type: 'checkbox', checked: settings[key], click: item => saveSetting(key, item.checked),
      })) },
      { type: 'separator' },
      { label: '退出 Somnus', click: quit },
    ]));
  }

  function saveSetting(key, enabled) {
    settings = { ...settings, [key]: enabled };
    const value = JSON.stringify(settings);
    pendingWrite = pendingWrite.then(async () => {
      const candidate = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(candidate, value, { flag: 'wx' });
        await rename(candidate, file);
      } finally {
        await unlink(candidate).catch(() => {});
      }
    }).catch(error => console.error('Unable to save Somnus notification settings', error.message));
  }

  updateMenu();
  return {
    allowsNotification(kind, failed) {
      const scope = kind === 'assistant' ? 'assistant' : 'analysis';
      return settings[scope + (failed ? 'Failed' : 'Complete')];
    },
    flush() { return pendingWrite; },
    destroy() { tray.destroy(); },
  };
}

function keepWindowInTray(workspace, readyToHide) {
  workspace.on('close', event => {
    if (!readyToHide()) return;
    event.preventDefault();
    workspace.hide();
  });
}

function folderLaunchArgument(argv, cwd, defaultApp = false) {
  const args = argv.slice(defaultApp ? 2 : 1);
  const explicit = args.findIndex(argument => argument === '--open-folder' || argument.startsWith('--open-folder='));
  if (explicit >= 0) {
    const option = args[explicit];
    const folder = option === '--open-folder' ? args[explicit + 1] : option.slice('--open-folder='.length);
    return folder && !folder.startsWith('--') ? path.resolve(cwd, folder) : null;
  }
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === '--user-data-dir' || value === '--somnus-profile') { i++; continue; }
    if (value === '--') { positional.push(...args.slice(i + 1)); break; }
    if (!value.startsWith('-')) positional.push(value);
  }
  return positional.length === 1 && positional[0] ? path.resolve(cwd, positional[0]) : null;
}

module.exports = { createDesktopTray, keepWindowInTray, folderLaunchArgument };
