const { trustWorkbench } = require('./project-folders.cjs');

const CHANNEL = 'somnus-desktop:run';
const INTERRUPTIONS = new Map([
  ['reload', ['重新加载工作台', '重新加载可能中断正在进行的会话和终端操作。']],
  ['restart', ['重启 Somnus', '重启会结束正在进行的任务和终端操作。']],
  ['quit', ['退出 Somnus', '退出会结束正在进行的任务和终端操作。']],
]);

function registerDesktopMenu({ ipcMain, window, origin, dialog, available, actions }) {
  let confirming = false;
  function assertAvailable(event) {
    trustWorkbench(event, window, origin);
    if (!available()) throw new Error('Somnus 工作台暂时无法执行此操作。');
  }
  ipcMain.handle(CHANNEL, async (event, action) => {
    assertAvailable(event);
    if (typeof action !== 'string' || !Object.hasOwn(actions, action)) throw new Error('无法识别此菜单操作。');
    const confirmation = INTERRUPTIONS.get(action);
    if (confirmation) {
      if (confirming) return false;
      confirming = true;
      try {
        const [label, detail] = confirmation;
        const result = await dialog.showMessageBox(window, {
          type: 'warning', title: 'Somnus', message: label + '？', detail,
          buttons: ['取消', label], defaultId: 0, cancelId: 0,
        });
        if (result.response !== 1) return false;
        assertAvailable(event);
        await actions[action]();
      } finally {
        confirming = false;
      }
    } else {
      await actions[action]();
    }
    return true;
  });
  window.once('closed', () => ipcMain.removeHandler(CHANNEL));
}

module.exports = { registerDesktopMenu };
