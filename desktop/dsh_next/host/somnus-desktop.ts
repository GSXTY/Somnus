import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell, Tray, WebContentsView } from 'electron'

interface BackendProcess {
  ready: Promise<string>
  exited: Promise<Error>
  stop: () => Promise<void>
}

interface BackendModule {
  backendCommand: (options: { packaged: boolean; resourcesPath: string; sourceRoot: string }) => unknown
  startBackend: (command: unknown, logFile: string, options: { env: NodeJS.ProcessEnv }) => BackendProcess
}

interface ProfileStoreModule {
  DesktopProfileStore: new(directory: string, isolated: boolean) => {
    read: () => { active: string }
    resolve: (id: string) => { roamingDir: string; dataDir?: string }
    prepare: (profile: { roamingDir: string; dataDir?: string }) => void
  }
}

interface LocalWorkbench {
  origin: string
  env: NodeJS.ProcessEnv
  profileDir: string
  baseDir: string
  modules: string
  token: string
}

const require = createRequire(import.meta.url)
const startupPageKey = 'vvman.startup-page'

function moduleDirectory() {
  if (app.isPackaged) return join(process.resourcesPath, 'somnus')
  const sourceRoot = process.env.SOMNUS_EXPLORER_ROOT ?? ''
  if (!isAbsolute(sourceRoot)) throw new Error('SOMNUS_EXPLORER_ROOT must point to the Somnus project when running from source')
  return join(sourceRoot, 'electron')
}

export function configureSomnusPaths() {
  const override = app.commandLine.getSwitchValue('user-data-dir')
  const baseDir = override ? resolve(override) : join(app.getPath('appData'), 'RespiratoryViewer')
  mkdirSync(baseDir, { recursive: true })
  app.setPath('userData', baseDir)
  app.setPath('sessionData', baseDir)
  try {
    const { DesktopProfileStore } = require(join(moduleDirectory(), 'desktop-profiles.cjs')) as ProfileStoreModule
    const store = new DesktopProfileStore(baseDir, Boolean(override))
    const profile = store.resolve(store.read().active)
    if (profile.roamingDir !== baseDir) app.setPath('sessionData', profile.roamingDir)
  } catch (error) {
    // The existing profile recovery controls will surface invalid registry data.
    console.error('Somnus profile browser storage:', error)
  }
}

/** Carry the original startup preference into the isolated workbench browser session. */
async function copyStartupPreference(window: BrowserWindow, origin: string) {
  const boot = origin + '/api/health'
  const reader = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const read = `localStorage.getItem(${JSON.stringify(startupPageKey)})`
  try {
    await Promise.all([window.loadURL(boot), reader.loadURL(boot)])
    if (window.webContents.getURL() !== boot || reader.webContents.getURL() !== boot) return
    const preference = await reader.webContents.executeJavaScript(read)
    if (preference !== 'dashboard' && preference !== 'chat') return
    const key = JSON.stringify(startupPageKey)
    await window.webContents.executeJavaScript(`if (localStorage.getItem(${key}) === null) localStorage.setItem(${key}, ${JSON.stringify(preference)})`)
  } finally { if (!reader.isDestroyed()) reader.destroy() }
}

/** Own the Somnus workbench and its launcher service across agent engine restarts. */
export function createSomnusDesktop() {
  let backend: BackendProcess | undefined
  let opening: Promise<LocalWorkbench> | undefined
  let stopped = false
  let localWindow: BrowserWindow | undefined
  let activeOrigin: string | undefined
  let pageQueue = Promise.resolve()
  let pendingFolder: string | null = null
  let openFolder: ((folder: string) => Promise<void>) | undefined
  let pickFolder: (() => Promise<void>) | undefined
  let profiles: {
    active: { roamingDir: string }, baseDir: string, safeMode: boolean, isRecovery: boolean,
    focus: () => boolean, openProfiles: () => Promise<void>, openRecovery: (error?: Error) => Promise<void>,
    environment: () => NodeJS.ProcessEnv, markHealthy: () => void,
  } | undefined
  let tray: { allowsNotification: (kind: 'assistant' | 'analysis', failed: boolean) => boolean;
    flush: () => Promise<void>; destroy: () => void } | undefined

  const profileControls = () => {
    if (profiles) return profiles
    const { createDesktopProfiles } = require(join(moduleDirectory(), 'desktop-recovery.cjs'))
    profiles = createDesktopProfiles({ app, BrowserWindow, ipcMain, dialog, baseDir: app.getPath('userData'),
      isolatedDefault: app.commandLine.hasSwitch('user-data-dir'),
      restart: (args: string[]) => { app.relaunch({ args }); app.quit() } })
    return profiles!
  }

  const focus = () => {
    const window = localWindow
    if (!window || window.isDestroyed() || stopped) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const start = () => opening ??= (async () => {
    if (stopped) throw new Error('Somnus service is closing')
    const sourceRoot = process.env.SOMNUS_EXPLORER_ROOT ?? ''
    const modules = moduleDirectory()
    const { backendCommand, startBackend } = require(join(modules, 'backend.cjs')) as BackendModule
    const profile = profileControls()
    const token = randomBytes(32).toString('hex')
    const env = {
      ...process.env,
      RESPIRATORY_VIEWER_PROJECT_TOKEN: token,
      ...profile.environment(),
    }
    const command = backendCommand({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, sourceRoot })
    const started = startBackend(command, join(app.getPath('logs'), 'somnus-backend.log'), { env })
    backend = started
    try {
      const origin = await started.ready
      void started.exited.then(() => {
        if (backend === started) {
          backend = undefined
          opening = undefined
          void started.stop()
        }
      })
      return { origin, profileDir: profile.active.roamingDir, baseDir: profile.baseDir, modules, token, env: {
        DSH_SOMNUS_BRIDGE_ORIGIN: origin,
        DSH_SOMNUS_BRIDGE_TOKEN: token,
        DSH_SOMNUS_LEGACY_PROFILE: profile.active.roamingDir,
      } }
    } catch (error) {
      await started.stop()
      if (backend === started) backend = undefined
      throw error
    }
  })().catch((error: unknown) => { opening = undefined; throw error })

  const navigate = async (page: unknown): Promise<void> => {
    if (page !== 'workbench' && page !== 'waveform') throw new Error('Unknown Somnus page')
    const { origin, profileDir, baseDir, modules, token } = await start()
    if (stopped) return
    if (activeOrigin !== origin) localWindow?.destroy()
    activeOrigin = origin
    if (localWindow === undefined) {
      const workbenchSession = session.fromPartition('persist:somnus-workbench')
      workbenchSession.setPermissionCheckHandler(() => false)
      workbenchSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
      const created = new BrowserWindow({
        title: 'Somnus', width: 1360, height: 900, minWidth: 880, minHeight: 600, show: false,
        backgroundColor: '#F4F8F6', autoHideMenuBar: true,
        titleBarStyle: 'hidden', titleBarOverlay: { color: 'rgba(0, 0, 0, 0)', symbolColor: '#202A28', height: 41 },
        icon: join(process.resourcesPath, 'somnus.ico'),
        webPreferences: { session: workbenchSession, preload: join(modules, 'project-preload.cjs'),
          contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false },
      })
      localWindow = created
      const handlers = new Set<string>()
      const windowIpc = {
        handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
          ipcMain.handle(channel, listener)
          handlers.add(channel)
        },
        removeHandler(channel: string) { ipcMain.removeHandler(channel); handlers.delete(channel) },
      }
      created.once('closed', () => {
        localWindow = undefined
        openFolder = undefined
        pickFolder = undefined
        for (const name of handlers) ipcMain.removeHandler(name)
      })
      created.on('close', event => {
        if (!stopped && tray) { event.preventDefault(); created.hide() }
      })
      // The two pages share the same launcher origin and local data services.
      const guard = (event: Electron.Event, target: string) => {
        if (URL.parse(target)?.origin !== activeOrigin) event.preventDefault()
      }
      created.webContents.on('will-navigate', guard)
      created.webContents.on('will-redirect', guard)
      created.webContents.on('will-frame-navigate', (event, details) => guard(event, typeof details === 'string' ? details : details?.url ?? event.url))
      created.webContents.setWindowOpenHandler(({ url, disposition }) => {
        const target = URL.parse(url)
        if (target?.origin === origin) return { action: 'allow', overrideBrowserWindowOptions: {
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        } }
        if (target?.protocol === 'https:' && !target.username && !target.password &&
            ['foreground-tab', 'background-tab', 'new-window'].includes(disposition)) void shell.openExternal(url).catch(console.error)
        return { action: 'deny' }
      })
      created.webContents.on('did-create-window', child => {
        child.webContents.on('will-navigate', guard)
        child.webContents.on('will-redirect', guard)
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      })
      // The Somnus workbench continues to run existing conversations and custom ACP providers.
      const { registerProjectFolders, openProjectFolder } = require(join(modules, 'project-folders.cjs'))
      const { registerAcpAgents } = require(join(modules, 'acp-ipc.cjs'))
      try {
        await registerProjectFolders({ ipcMain: windowIpc, dialog, shell, window: created, origin, token })
        if (stopped || created.isDestroyed()) return
        const local = { ipcMain: windowIpc, dialog, shell, window: created, origin, token, profileDir }
        const profile = profileControls()
        if (!profile.safeMode) {
          registerAcpAgents({ ...local, app, dshRuntimeDir: baseDir, version: app.getVersion(), WebContentsView, session })
          require(join(modules, 'workspace-web.cjs')).registerWorkspaceWeb({ ...local, WebContentsView, session })
          require(join(modules, 'acp-plugin-workspace.cjs')).registerPluginWorkspace(local)
        }
        require(join(modules, 'acp-document-library.cjs')).registerDocumentLibrary({ ...local,
          tempDir: app.getPath('temp'), defaultSharedDir: join(process.resourcesPath, 'shared-documents') })
        require(join(modules, 'task-attention.cjs')).registerTaskAttention({ ...local, Notification, focusWindow: focus,
          allowsNotification: (kind: 'assistant' | 'analysis', failed: boolean) => tray?.allowsNotification(kind, failed) ?? true })
        if (!profile.safeMode) openFolder = async folder => {
          const id: unknown = await openProjectFolder(origin, token, folder)
          if (typeof id !== 'string' || !/^ws_[a-f0-9]{12}$/.test(id)) throw new Error('Could not open the Somnus project folder')
          if (stopped || created.isDestroyed()) return
          const destination = '#assistant?project=' + id
          if (URL.parse(created.webContents.getURL())?.pathname === '/') {
            await created.webContents.executeJavaScript('location.hash = ' + JSON.stringify(destination))
          } else await created.loadURL(origin + '/' + destination)
          focus()
        }
        pickFolder = async () => {
          if (!openFolder) return
          const chosen = await dialog.showOpenDialog(created, { properties: ['openDirectory'], title: '打开项目文件夹' })
          if (!chosen.canceled && chosen.filePaths[0]) await openFolder(chosen.filePaths[0])
        }
        const { registerDesktopMenu } = require(join(modules, 'desktop-menu.cjs'))
        const { relaunchArguments } = require(join(modules, 'desktop-recovery.cjs'))
        registerDesktopMenu({ ...local, available: () => !stopped && !created.isDestroyed(), actions: {
          'open-project': () => pickFolder?.(),
          'open-logs': async () => { const error = await shell.openPath(app.getPath('logs')); if (error) throw new Error(error) },
          profiles: () => profile.openProfiles(),
          recovery: () => profile.openRecovery(),
          reload: () => created.webContents.reload(),
          restart: () => { app.relaunch({ args: relaunchArguments(app, profile.safeMode ? 'safe-mode' : undefined) }); app.quit() },
          quit: () => app.quit(),
        } })
        await copyStartupPreference(created, origin).catch((error: unknown) => console.error('Somnus startup preference:', error))
      } catch (error) {
        if (!created.isDestroyed()) created.destroy()
        throw error
      }
    }
    const window = localWindow
    if (!window || window.isDestroyed()) return
    await window.loadURL(origin + (page === 'waveform' ? '/events' : '/'))
    profiles?.markHealthy()
    if (page === 'workbench' && pendingFolder) {
      const folder = pendingFolder
      pendingFolder = null
      await openFolder?.(folder)
    }
    focus()
  }

  const openPage = (page: unknown) => {
    const request = pageQueue.then(() => navigate(page))
    pageQueue = request.catch(() => {})
    return request
  }

  const openHome = () => {
    const profile = profileControls()
    if (profile.focus()) return Promise.resolve()
    if (profile.isRecovery) return profile.openRecovery()
    if (localWindow && !localWindow.isDestroyed() && localWindow.webContents.getURL().startsWith(activeOrigin + '/')) {
      focus()
      return Promise.resolve()
    }
    return openPage('workbench')
  }
  const launchFolder = (argv: string[], cwd: string) => {
    const { folderLaunchArgument } = require(join(moduleDirectory(), 'desktop-tray.cjs'))
    const folder = folderLaunchArgument(argv, cwd, process.defaultApp)
    if (!folder) return
    if (openFolder) void openFolder(folder).catch((error: Error) => dialog.showErrorBox('Somnus', error.message))
    else pendingFolder = folder
  }
  const setupTray = async () => {
    if (process.platform !== 'win32' || tray || stopped) return
    const profile = profileControls()
    const { createDesktopTray } = require(join(moduleDirectory(), 'desktop-tray.cjs'))
    const report = (error: Error) => dialog.showErrorBox('Somnus', error.message)
    tray = await createDesktopTray({ Tray, Menu, icon: join(process.resourcesPath, 'somnus.ico'),
      dataDir: profile.active.roamingDir, show: () => void openHome().catch(report),
      openFolder: profile.safeMode || profile.isRecovery ? undefined : () => void openHome().then(() => pickFolder?.()).catch(report),
      openProfiles: () => void profile.openProfiles().catch(report),
      openRecovery: () => void profile.openRecovery().catch(report),
      quit: () => app.quit() })
    if (stopped) { tray?.destroy(); tray = undefined }
  }

  return { start, openHome, launchFolder, setupTray,
    openRecovery: (error: Error) => profileControls().openRecovery(error),
    engineEnabled: () => !profileControls().safeMode && !profileControls().isRecovery,
    close: async () => {
    stopped = true
    localWindow?.destroy()
    const currentTray = tray
    tray = undefined
    try { await Promise.all([backend?.stop(), currentTray?.flush()]) }
    finally { currentTray?.destroy() }
  } }
}
