function chromeFallbackFill(dark) { return dark ? '#1b1b1c' : '#f4f8f6'; }
function chromeWindowOptions(platform, dark) {
  return { width: 1280, height: 820, minWidth: 520, minHeight: 600,
    ...(platform === 'win32' ? { backgroundColor: chromeFallbackFill(dark), titleBarStyle: 'hidden',
      titleBarOverlay: { height: 40, color: chromeFallbackFill(dark), symbolColor: dark ? '#f9fafb' : '#183630' } } : {}),
    ...(platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' } : {}) };
}
function registerNativeChrome({ ipcMain, getWindow, rendererOrigin, nativeTheme, Menu, app, readDeviceInfo, resolveDesktopLocale, actions = {} }) {
  let language = 'zh-CN';
  // New menu entries are absent from the injected shell locale catalogue, so the
  // native chrome owns their copy. The app pins zh-CN; other languages get English.
  const actionLabels = () => /^zh/i.test(language)
    ? { profiles: '运行配置…', recovery: '故障恢复…', logs: '打开日志文件夹' }
    : { profiles: 'Run Profiles…', recovery: 'Recovery…', logs: 'Open Logs Folder' };
  // The caller owns user-facing error reporting; this only prevents an action
  // failure from escaping as an uncaught exception or unhandled rejection.
  const runAction = run => () => {
    try {
      const result = run();
      if (result && typeof result.then === 'function') result.catch(error => console.error('Somnus menu action:', error));
    } catch (error) { console.error('Somnus menu action:', error); }
  };
  const applicationItems = copy => {
    const labels = actionLabels();
    const entries = [[actions.openProfiles, labels.profiles], [actions.openRecovery, labels.recovery], [actions.openLogs, labels.logs]]
      .filter(([run]) => typeof run === 'function')
      .map(([run, label]) => ({ label, click: runAction(run) }));
    const items = [{ role: 'about', label: copy.about }];
    if (entries.length) items.push({ type: 'separator' }, ...entries);
    items.push({ type: 'separator' }, { role: 'quit', label: copy.quit });
    return items;
  };
  const owned = event => { const window = getWindow(); return window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && !event.senderFrame.detached &&
    URL.parse(event.senderFrame.url)?.origin === rendererOrigin(); };
  const assertOwned = event => { if (!owned(event)) throw new Error('Desktop chrome rejected an unowned frame'); return getWindow(); };
  ipcMain.on('dsh-desktop:native-theme-set', (event, value) => {
    if (owned(event) && ['light', 'dark', 'system'].includes(value)) nativeTheme.themeSource = value;
  });
  ipcMain.on('dsh-desktop:windows-appearance', (event, nextLanguage, color, symbolColor) => {
    const valid = value => typeof value === 'string' && /^(?:#[0-9a-f]{6,8}|rgba?\([\d.,\s]+\))$/i.test(value);
    if (!owned(event) || !valid(color) || !valid(symbolColor)) return;
    language = typeof nextLanguage === 'string' ? nextLanguage : language;
    getWindow().setTitleBarOverlay({ color, symbolColor, height: 40 });
  });
  ipcMain.handle('dsh-desktop:windows-menu', (event, name, x, y) => {
    const window = assertOwned(event);
    if (!['application', 'edit'].includes(name) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 1e5 || y > 1e5) throw new Error('Invalid Desktop menu anchor');
    const copy = resolveDesktopLocale(language).messages;
    const editItem = (role, key, modifiers, accelerator) => ({ label: copy[role], accelerator,
      click: () => { window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers }); } });
    const items = name === 'application' ? applicationItems(copy) : [
      editItem('undo', 'Z', ['control'], 'Ctrl+Z'), editItem('redo', 'Y', ['control'], 'Ctrl+Y'), { type: 'separator' },
      editItem('cut', 'X', ['control'], 'Ctrl+X'), editItem('copy', 'C', ['control'], 'Ctrl+C'), editItem('paste', 'V', ['control'], 'Ctrl+V'),
      editItem('delete', 'Delete', []), { type: 'separator' }, editItem('selectAll', 'A', ['control'], 'Ctrl+A') ];
    const zoom = window.webContents.getZoomFactor();
    return new Promise(resolve => Menu.buildFromTemplate(items).popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: resolve }));
  });
  ipcMain.handle('dsh-desktop:updates-status', event => { assertOwned(event); return { phase: 'idle', supported: false }; });
  ipcMain.handle('dsh-desktop:updates-open', event => { assertOwned(event); return { supported: false, state: 'disabled' }; });
  ipcMain.handle('dsh-desktop:device-info', event => { assertOwned(event); return readDeviceInfo(); });
  ipcMain.handle('dsh-desktop:locale-bootstrap', event => { assertOwned(event); return { languages: app.getPreferredSystemLanguages(), preference: null }; });
  ipcMain.on('dsh-desktop:locale-changed', (event, value) => { if (owned(event) && typeof value === 'string') language = value; });
  ipcMain.on('dsh-desktop:onboarding-active', (event, active) => {
    if (!owned(event) || typeof active !== 'boolean') return;
    const window = getWindow(); window.setMinimumSize(active ? 960 : 520, 600);
    if (active) { const { width, height } = window.getBounds(); if (width < 960) window.setSize(960, height); }
  });
}
module.exports = { chromeFallbackFill, chromeWindowOptions, registerNativeChrome };
