import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import './somnus-workbench.css'
import './somnus-sidebar.css'
import { LegacyWorkbench } from './LegacyWorkbench'
import { NativeDocumentLibrary } from './NativeDocumentLibrary'
import { attachConfigurationRelay, nativeRefreshActivity } from '../../../page_design/frontend/src/configuration/embeddedConfigurationBridge.mjs'
import { NativeAgentSettings, NativeModelSettingsAction, NativeModelIdentity } from './NativeAgentSettings'
export { NativeAgentSettings, NativeModelIdentity } from './NativeAgentSettings'

export interface SomnusApiBridge {
  request(path: string): Promise<{ status: number; body: ArrayBuffer }>
  origin(): Promise<string>
  acp?(): Promise<{ url: string; token: string }>
  setAcpModel?(modelId: string): Promise<boolean>
  setAcpApproval?(mode: 'auto' | 'readonly'): Promise<boolean>
  purgeSession?(sessionId: string): Promise<number>
  configuration?(method: string, args: unknown[]): Promise<unknown>
  onConfigurationUpdate?(listener: (update: unknown) => void): () => void
}

const NativeTools = lazy(() => import('./NativeTools'))

const localeId = 'somnus-workbench'
let inspectNativeActivity = () => ({ known: false, active: true })
const zh = {
  chat: '会话管理',
  home: '主页',
  documents: '文档',
  tools: '工具',
  config: '配置中心',
  im: 'IM 机器人',
  codex: 'Codex',
  loading: '正在连接 Somnus…',
  imNotice: 'IM 机器人需要 DSH 插件宿主，稍后接入。',
}
const en: typeof zh = {
  chat: 'Chats',
  home: 'Home',
  documents: 'Documents',
  tools: 'Tools',
  config: 'Configuration',
  im: 'IM bot',
  codex: 'Codex',
  loading: 'Connecting to Somnus…',
  imNotice: 'The IM bot page needs the DSH plugin host and will be wired later.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'somnus-workbench': keyof typeof zh
  }
}

type PageKey = 'chat' | 'home' | 'documents' | 'tools' | 'config' | 'im' | 'codex'
type IconName = 'chat' | 'home' | 'documents' | 'tools' | 'config' | 'im' | 'codex'

const pages: readonly { id: MainPanelId; key: PageKey; view?: string; icon: IconName; order: number }[] = [
  { id: 'somnus-home' as MainPanelId, key: 'home', view: 'dashboard', icon: 'home', order: -10 },
  { id: 'somnus-documents' as MainPanelId, key: 'documents', view: 'documents', icon: 'documents', order: -9 },
  { id: 'somnus-tools' as MainPanelId, key: 'tools', view: 'plugins', icon: 'tools', order: -8 },
]

function PanelIcon({ size, name }: { size: number; name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    chat: <><path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z" /><path d="M8 9h8M8 12h5" /></>,
    home: <><path d="M4 11.2 12 4l8 7.2" /><path d="M6.5 10v9h11v-9" /></>,
    documents: <><path d="M7 3.5h7l3 3v14H7z" /><path d="M14 3.5v3.2h3.2" /><path d="M9.5 11h5M9.5 14.5h5" /></>,
    tools: <><path d="m14.5 5.5 4 4-9 9-4-4z" /><path d="M6.5 16.5 5 18a2.1 2.1 0 0 1-3-3l1.5-1.5" /></>,
    config: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" /></>,
    im: <><rect x="4" y="6" width="16" height="12" rx="3" /><path d="M8.5 21v-3M15.5 21v-3" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /></>,
    codex: <><path d="m8 6-4 6 4 6M16 6l4 6-4 6M13 5l-2 14" /></>,
  }
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {paths[name]}
  </svg>
}

function SomnusFrame({ view }: { view: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [origin, setOrigin] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const bridge = (window as Window & { somnusApi?: SomnusApiBridge }).somnusApi
    if (!bridge?.origin) { setError('Somnus API 桥未就绪'); return }
    void bridge.origin().then(value => { if (active) setOrigin(value) })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : '连接失败') })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!origin || !frame.current) return
    return attachConfigurationRelay(window, frame.current, new URL(origin).origin,
      (window as Window & { somnusApi?: SomnusApiBridge }).somnusApi, () => inspectNativeActivity())
  }, [origin, view])
  if (error) return <div className="somnus-frame-state" role="alert">{error}</div>
  if (!origin) return <div className="somnus-frame-state">正在连接 Somnus…</div>
  const className = view === 'dashboard' ? 'somnus-frame somnus-frame-dashboard' : 'somnus-frame'
  return <iframe ref={frame} key={view} className={className} title={view} src={`${origin}/workbench-assets/embed.html?somnus_parent_origin=${encodeURIComponent(window.location.origin)}#${view}`} />
}

function Panel({ page, t }: { page: typeof pages[number]; t: (key: keyof typeof zh) => string }) {
  if (page.key === 'home') return <LegacyWorkbench />
  if (page.key === 'documents') return <NativeDocumentLibrary />
  if (page.key === 'tools') return <Suspense fallback={<div className="somnus-frame-state">正在加载工具…</div>}><NativeTools /></Suspense>
  if (!page.view) return <div className="somnus-frame-state">{t('imNotice')}</div>
  return <SomnusFrame view={page.view} />
}

export function registerSomnusWorkbench(ctx: Context): void {
  ctx.inject(['somnusSettings'], scope => {
    const settings = (scope as unknown as { somnusSettings: { open(section?: string): void } }).somnusSettings
    scope.slots.inject('conversation.input.model.options', () => scope.slots.register({
      name: 'conversation.input.model.options',
    }, ({ dismiss }: { dismiss(): void }) => <NativeModelSettingsAction dismiss={dismiss} onOpen={() => settings.open('models')} />))
  })
  const configuration = (method: string, args: unknown[]) => {
    const bridge = (window as Window & { somnusApi?: SomnusApiBridge }).somnusApi
    if (!bridge?.configuration) return Promise.reject(new Error('Agent 配置连接尚未就绪'))
    return bridge.configuration(method, args)
  }
  ctx.inject(['somnusNativeModelStyles'], scope => {
    const styles = (scope as unknown as { somnusNativeModelStyles: Record<string, string> }).somnusNativeModelStyles
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section', id: 'somnus-external-agents', order: 12,
      label: () => '外部 Agent', inject: () => ({ configuration, styles }),
    }, NativeAgentSettings))
  })
  ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
    name: 'conversation.input.model.label',
  }, NativeModelIdentity))
  ctx.inject(['sessions'], scope => {
    const sessions = (scope as unknown as { sessions: { list: { getSnapshot(): unknown } } }).sessions
    scope.effect(() => {
      inspectNativeActivity = () => nativeRefreshActivity(sessions.list.getSnapshot())
      return () => { inspectNativeActivity = () => ({ known: false, active: true }) }
    }, 'Somnus safe model refresh status')
  })
  ctx.effect(() => ctx.locale.register(localeId, { zh, en }), 'Somnus workbench labels')
  const t = ctx.locale.bind(localeId)
  for (const page of pages) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: page.id,
      locale: localeId,
    }, (props: PropsLocale<typeof localeId>) => <Panel page={page} t={props.t} />))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: page.id,
      order: page.order,
      locale: localeId,
      label: () => t(page.key),
    }, ({ size }: PropsRuntime<'sidebar.panellist'>) => <PanelIcon size={size} name={page.icon} />))
  }
  ctx.inject(['uiWorkspace'], scope => {
    const workspace = scope.uiWorkspace as unknown as {
      archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
    }
    scope.slots.inject('sidebar.workspaces.session.menu.item', () => scope.slots.register({
      name: 'sidebar.workspaces.session.menu.item',
      id: 'somnus-purge-session',
      order: 600,
      locale: localeId,
    }, ({ sessionId, useMenuOpenState }: { sessionId?: string; useMenuOpenState: () => readonly [boolean, (open: boolean) => void] }) => {
      const [, setMenuOpen] = useMenuOpenState()
      if (!sessionId) return null
      return <button type="button" role="menuitem" className="somnus-menu-item"
        onClick={async () => {
          setMenuOpen(false)
          if (!window.confirm('彻底删除会话？此操作不可恢复。')) return
          try {
            await workspace.archiveSession(sessionId, { stopActivity: true })
            await window.somnusApi?.purgeSession?.(sessionId)
          } catch (error) {
            window.alert('删除会话失败：' + (error instanceof Error ? error.message : String(error)))
          }
        }}><span className="somnus-menu-icon" aria-hidden="true">🗑</span>彻底删除会话</button>
    }))
  })
}





