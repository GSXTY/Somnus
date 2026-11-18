import { appendFile, lstat, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, dialog } from 'electron';
import { configureSomnusPaths, createSomnusDesktop } from './somnus-desktop.mjs';

const require = createRequire(import.meta.url);

async function engineHome(profileDir) {
  const engine = join(profileDir, 'engine');
  const home = join(engine, 'harness');
  for (const directory of [engine, home]) {
    await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Somnus engine requires its own profile directory');
  }
  return home;
}

export function startSomnus({ DesktopHostProcess, DesktopBackendController, DesktopProjectManager,
  resolveDesktopPaths, desktopClientVersion }) {
  app.setName('Somnus');
  configureSomnusPaths();
  app.setAppLogsPath();
  if (process.platform === 'win32') app.setAppUserModelId('com.vvfly.respiratoryviewer');
  // No inherited DSH Desktop settings participate in either Somnus app process.
  for (const key of Object.keys(process.env)) if (/^DSH_/i.test(key)) delete process.env[key];
  const workbench = createSomnusDesktop();
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }

  let engine;
  let engineOpening;
  let stopping = false;
  let closed = false;
  const openWorkbench = () => workbench.openHome().catch(reportWorkbenchError);
  const reportWorkbenchError = error => workbench.openRecovery(error).catch(recoveryError => {
    dialog.showErrorBox('Somnus', recoveryError?.message ?? error?.message ?? 'Somnus could not start.');
  });
  const engineLog = message => {
    const line = `${new Date().toISOString()} ${message}\n`;
    void appendFile(join(app.getPath('logs'), 'somnus-engine.log'), line).catch(error => console.error(error));
  };
  const startEngine = async () => {
    if (stopping || !workbench.engineEnabled()) return;
    const service = await workbench.start();
    const home = await engineHome(service.profileDir);
    if (stopping) return;
    const runtime = join(process.resourcesPath, 'runtime');
    const primary = join(runtime, 'primary-runtime');
    const resources = { node: process.execPath, dsh: join(app.getAppPath(), 'dsh'), nodeBin: join(runtime, 'bin'),
      pnpm: join(primary, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
    const paths = resolveDesktopPaths(home);
    const manager = new DesktopProjectManager(paths, resources);
    const { processEnvironment } = require(join(service.modules, 'acp-stdio.cjs'));
    const environment = { ...processEnvironment(), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
      DSH_CLIENT_VERSION: desktopClientVersion(), ...service.env };
    engine = new DesktopBackendController(onFailure => new DesktopHostProcess(resources.node, resources.dsh,
      paths.profile, undefined, environment, onFailure, primary, resources), state => {
      if (state.phase === 'ready') engineLog('Somnus engine ready');
      if (state.phase === 'error') engineLog(`Somnus engine error: ${state.failure?.message ?? 'engine unavailable'}`);
    });
    await engine.start(() => manager.applyRelease());
  };

  app.on('second-instance', (_event, argv, cwd) => {
    if (stopping || !app.isReady()) return;
    workbench.launchFolder(argv, cwd);
    void openWorkbench();
  });
  app.on('activate', () => { if (!stopping) void openWorkbench(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (closed) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    void (async () => {
      try { await engine?.close(); } catch (error) { engineLog(`Somnus engine shutdown: ${error.message}`); }
      try { await workbench.close(); } catch (error) { console.error(error); }
      await engineOpening;
    })().finally(() => { closed = true; app.quit(); });
  });

  void app.whenReady().then(async () => {
    if (stopping) return;
    await workbench.setupTray().catch(error => console.error('Somnus tray:', error));
    workbench.launchFolder(process.argv, process.cwd());
    await workbench.openHome();
    engineOpening = startEngine().catch(error => { if (!stopping) engineLog(`Somnus engine startup: ${error.message}`); });
  }).catch(reportWorkbenchError);
}
