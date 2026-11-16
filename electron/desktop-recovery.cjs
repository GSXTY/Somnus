const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DesktopProfileStore, DEFAULT, atomicWrite, fileBytes, plainDirectory, RUNTIME_PROFILES } = require('./desktop-profiles.cjs');
const { page } = require('./desktop-recovery-page.cjs');

const CHANNEL = 'somnus-runtime-profiles';
const BACKUP_NAME = /^dsh-recovery-[a-f0-9-]{36}$/;
const DSH_FILES = ['package.json', 'cordis.yml', 'cordis.patch.yml'];

function relaunchArguments(app, mode) {
  const args = process.defaultApp && process.argv[1] ? [process.argv[1]] : [];
  const override = app.commandLine.getSwitchValue('user-data-dir');
  if (override) args.push('--user-data-dir=' + path.resolve(override));
  if (mode) args.push('--' + mode);
  return args;
}

function dshProfileRoot(profile) {
  return plainDirectory(path.join(plainDirectory(path.join(profile.roamingDir, 'dsh-home')), 'profiles'));
}

function latestDshBackup(profile) {
  const entries = fs.readdirSync(profile.roamingDir, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !BACKUP_NAME.test(entry.name)) continue;
    const folder = path.join(profile.roamingDir, entry.name);
    try {
      const info = fs.lstatSync(plainDirectory(folder));
      fileBytes(path.join(folder, 'complete'), 1);
      backups.push({ folder, time: info.mtimeMs });
    } catch {}
  }
  return backups.sort((left, right) => right.time - left.time)[0]?.folder ?? null;
}

function replaceDshFiles(profile, root, plan, restore) {
  if (!plan.size) throw new Error('此运行配置没有可恢复的 DSH 插件组合。');
  const prefix = restore ? 'dsh-pre-restore-' : 'dsh-recovery-';
  const backup = path.join(profile.roamingDir, prefix + randomUUID());
  fs.mkdirSync(backup);
  for (const [file, { original }] of plan) {
    const name = path.relative(root, file);
    const target = path.join(backup, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, original, { flag: 'wx' });
  }
  fs.writeFileSync(path.join(backup, 'complete'), '', { flag: 'wx' });
  const written = [];
  try {
    for (const [file, { next }] of plan) {
      atomicWrite(file, next);
      written.push(file);
    }
  } catch (error) {
    for (const file of written) atomicWrite(file, plan.get(file).original);
    throw error;
  }
}

function disableDshExtensions(profile) {
  const root = dshProfileRoot(profile);
  const plan = new Map();
  for (const [mode, bundle] of Object.entries(RUNTIME_PROFILES)) {
    const folder = path.join(root, mode);
    try { plainDirectory(folder); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const manifest = path.join(folder, 'package.json');
    const original = fileBytes(manifest);
    const data = JSON.parse(original.toString('utf8'));
    const bundles = data?.dsh?.profile?.bundles;
    if (data?.name !== 'dsh-profile-' + mode || data.private !== true || !Array.isArray(bundles)) {
      throw new Error('无法识别当前 DSH 配置，已保留原文件。');
    }
    const existingOfficial = Array.isArray(data.vvman?.installedOfficialPlugins) ? data.vvman.installedOfficialPlugins : [];
    const official = bundles.filter(item => typeof item === 'string' && item.startsWith('@deepseek-ai/') &&
      !['@deepseek-ai/dsh-base', bundle].includes(item));
    data.vvman = { ...data.vvman, installedOfficialPlugins: [...new Set([...existingOfficial, ...official])] };
    data.dsh.profile.bundles = ['@deepseek-ai/dsh-base', bundle];
    plan.set(manifest, { original, next: JSON.stringify(data, null, 2) + '\n' });
    for (const entry of DSH_FILES.slice(1)) {
      const file = path.join(folder, entry);
      try { plan.set(file, { original: fileBytes(file), next: '[]\n' }); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  replaceDshFiles(profile, root, plan, false);
}

function restoreDshExtensions(profile) {
  const backup = latestDshBackup(profile);
  if (!backup) throw new Error('未找到此配置的 DSH 插件备份。');
  const root = dshProfileRoot(profile);
  const plan = new Map();
  for (const mode of Object.keys(RUNTIME_PROFILES)) {
    const snapshot = path.join(backup, mode);
    try { plainDirectory(snapshot); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const folder = plainDirectory(path.join(root, mode));
    for (const entry of DSH_FILES) {
      let next;
      try { next = fileBytes(path.join(snapshot, entry)); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      const file = path.join(folder, entry);
      plan.set(file, { original: fileBytes(file), next });
    }
  }
  replaceDshFiles(profile, root, plan, true);
}

function createDesktopProfiles({ app, BrowserWindow, ipcMain, dialog, baseDir, isolatedDefault, restart }) {
  const store = new DesktopProfileStore(baseDir, isolatedDefault);
  let active;
  let startupError = false;
  try {
    active = store.resolve(store.read().active);
    store.prepare(active);
  } catch {
    active = store.resolve(DEFAULT, store.initial());
    startupError = true;
  }
  const safeMode = app.commandLine.hasSwitch('safe-mode');
  const isRecovery = app.commandLine.hasSwitch('recovery') || startupError;
  let recoveryWindow;
  let profileWindow;
  let launchFailed = false;
  let restarting = false;

  function view(kind) {
    let state;
    let registryValid = true;
    try { state = store.read(); } catch { registryValid = false; state = store.initial(); }
    const rollback = store.rollbackTarget(state);
    const rows = [{ id: DEFAULT, name: '默认配置' }, ...state.profiles];
    return { kind, profiles: rows, selected: state.active, active: active.id, safeMode, registryValid,
      startupError, launchFailed, rollback: rows.find(row => row.id === rollback) ?? null,
      dshAvailable: fs.existsSync(path.join(active.roamingDir, 'dsh-home', 'profiles')),
      dshBackupAvailable: kind === 'recovery' && Boolean(latestDshBackup(active)) };
  }

  async function ask(window, message, detail) {
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: 'Somnus', message, detail, buttons: ['取消', '继续'], cancelId: 0, defaultId: 0,
    });
    return result.response === 1;
  }

  function restartWith(mode) {
    restart(relaunchArguments(app, mode));
  }

  async function exportDiagnostics(window) {
    const result = await dialog.showSaveDialog(window, {
      title: '导出启动诊断', defaultPath: 'Somnus-startup-diagnostics.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const state = view('recovery');
    const report = {
      time: new Date().toISOString(), somnus: app.getVersion(), electron: process.versions.electron,
      os: os.platform(), architecture: os.arch(), osRelease: os.release(),
      profileType: active.id === DEFAULT ? 'default' : 'named', registryValid: state.registryValid,
      safeMode, startupFailed: launchFailed || startupError, hasRollback: Boolean(state.rollback),
      dshProfilePresent: state.dshAvailable,
    };
    atomicWrite(result.filePath, JSON.stringify(report, null, 2) + '\n');
    return true;
  }

  ipcMain.handle(CHANNEL, async (event, action, value) => {
    const isProfile = profileWindow && !profileWindow.isDestroyed() && event.sender === profileWindow.webContents;
    const isRecoveryView = recoveryWindow && !recoveryWindow.isDestroyed() && event.sender === recoveryWindow.webContents;
    const window = isProfile ? profileWindow : isRecoveryView ? recoveryWindow : null;
    if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('这项操作只能在运行配置窗口使用。');
    const state = view(isProfile ? 'profiles' : 'recovery');
    if (action === 'status') return state;
    if (restarting) throw new Error('正在重启，请稍候。');
    if (action === 'create' && isProfile && state.registryValid) {
      store.create(value);
      return view('profiles');
    }
    if (action === 'select' && typeof value === 'string' && state.registryValid) {
      const profile = store.resolve(value);
      if (!await ask(window, '切换运行配置并重启 Somnus？', profile.name)) return false;
      if (restarting) return false;
      store.select(value);
      restarting = true;
      restartWith();
      return true;
    }
    if (!isRecoveryView) throw new Error('无效的运行配置操作。');
    if (action === 'diagnostics') return exportDiagnostics(window);
    if (action === 'rollback' && state.rollback) {
      if (!await ask(window, '返回上次可用配置？', state.rollback.name)) return false;
      if (restarting) return false;
      store.select(state.rollback.id);
    } else if (action === 'reset-registry' && !state.registryValid) {
      if (!await ask(window, '恢复默认运行配置？', '损坏的配置清单会在本机保留，所有运行配置目录和历史数据仍在。')) return false;
      if (restarting) return false;
      store.resetRegistry();
    } else if (action === 'disable-dsh' && state.dshAvailable) {
      if (!await ask(window, '停用当前配置的 DSH 扩展？', '插件安装文件、原配置副本及会话记录都会保留。')) return false;
      if (restarting) return false;
      disableDshExtensions(active);
    } else if (action === 'restore-dsh' && state.dshBackupAvailable) {
      if (!await ask(window, '恢复上次停用前的 DSH 插件组合？', '当前组合也会备份，插件可能重新影响 DSH 运行。')) return false;
      if (restarting) return false;
      restoreDshExtensions(active);
    } else if (action === 'retry' || action === 'safe') {
      if (!await ask(window, '重启 Somnus？', action === 'safe' ? '本次以安全模式打开工作台。' : '重新加载当前配置。')) return false;
      if (restarting) return false;
    } else {
      throw new Error('无效的故障恢复操作。');
    }
    restarting = true;
    restartWith(action === 'safe' ? 'safe-mode' : undefined);
    return true;
  });

  function show(window) {
    if (!window || window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return true;
  }

  async function open(kind) {
    if (show(kind === 'profiles' ? profileWindow : recoveryWindow)) return;
    const window = new BrowserWindow({
      width: 640, height: 650, minWidth: 510, minHeight: 450, autoHideMenuBar: true, show: false,
      backgroundColor: '#f4f8f6', title: kind === 'profiles' ? 'Somnus 运行配置' : 'Somnus 故障恢复',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
        partition: 'somnus-profile-window-' + randomUUID(), preload: path.join(__dirname, 'desktop-recovery-preload.cjs') },
    });
    if (kind === 'profiles') profileWindow = window;
    else recoveryWindow = window;
    window.webContents.on('will-frame-navigate', event => event.preventDefault());
    window.webContents.on('will-redirect', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.on('closed', () => {
      if (kind === 'profiles') profileWindow = undefined;
      else recoveryWindow = undefined;
    });
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    show(window);
  }

  return {
    active, baseDir: store.baseDir, safeMode, isRecovery,
    focus: () => show(recoveryWindow) || show(profileWindow),
    environment() {
      return {
        ...(active.dataDir ? { AI_AGENT_DATA_DIR: active.dataDir } : {}),
        ...(safeMode || active.dataDir ? { SOMNUS_PROFILE_CONFIG_ONLY: safeMode ? 'safe' : '1' } : {}),
      };
    },
    markHealthy: () => { if (!safeMode && !isRecovery) store.markHealthy(active.id); },
    openProfiles: () => isRecovery ? open('recovery') : open('profiles'),
    openRecovery: async error => {
      launchFailed ||= Boolean(error);
      if (recoveryWindow && !recoveryWindow.isDestroyed()) recoveryWindow.webContents.send(CHANNEL + ':refresh');
      await open('recovery');
    },
  };
}

module.exports = { createDesktopProfiles, disableDshExtensions, restoreDshExtensions, relaunchArguments };
