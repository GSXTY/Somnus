import { useRetainedToolState } from '../../../page_design/frontend/src/shared/useRetainedToolState'
import { useEffect, useRef, useState } from 'react'
import { ConfigProvider, theme } from 'antd'
import { SqlQuery } from '../../../page_design/frontend/src/dashboard/SqlQuery'
import { DeepAnalysis } from '../../../page_design/frontend/src/analysis/DeepAnalysis'
import { deepStatus } from '../../../page_design/frontend/src/analysis/deepAnalysisApi.mjs'
import { useDataConnection } from '../../../page_design/frontend/src/configuration/DataConnection'
import { useWorkspacePlugins } from '../../../page_design/frontend/src/plugins/workspacePlugins'
import type { WorkspaceTool } from '../../../page_design/frontend/src/plugins/workspacePlugins'
import { NativeWaveform } from './NativeWaveform'
import './native-tools.css'

type ToolMeta = { prereq?: 'database' | 'files' | 'model'; icon: 'database' | 'wave' | 'spark' | 'tool' }
type ToolState = { ready: boolean | null; reason?: string }

const prereqLabels = { database: '需数据库', files: '本机文件', model: '需配置模型' } as const

/** Prerequisite metadata for built-in tools; plugin entries carry no declaration. */
function metaFor(tool: WorkspaceTool): ToolMeta {
  if (tool.key === 'sql') return { prereq: 'database', icon: 'database' }
  if (tool.key === 'analysis') return { prereq: 'files', icon: 'wave' }
  if (tool.key === 'deep-analysis') return { prereq: 'model', icon: 'spark' }
  return { icon: 'tool' }
}

function ToolIcon({ kind }: { kind: ToolMeta['icon'] }) {
  if (kind === 'database') return <svg viewBox="0 0 24 24" aria-hidden="true">
    <ellipse cx="12" cy="5" rx="7" ry="2.6" />
    <path d="M5 5v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V5" />
    <path d="M5 11c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
  </svg>
  if (kind === 'wave') return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 13h3l2.5-7 3.5 14 3-10 2 3H22" />
  </svg>
  if (kind === 'spark') return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M11 3.5 12.7 8l4.5 1.7-4.5 1.7L11 16l-1.7-4.6L4.8 9.7 9.3 8z" />
    <path d="M18 15l.8 2.2 2.2.8-2.2.8L18 21l-.8-2.2-2.2-.8 2.2-.8z" />
  </svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
    <path d="M17 13.5v7M13.5 17h7" />
  </svg>
}

export default function NativeTools() {
  const root = useRef<HTMLDivElement>(null)
  const [active, setActive] = useRetainedToolState('native-tools:active', '')
  const [visited, setVisited] = useRetainedToolState('native-tools:visited', new Set<string>())
  const [dark, setDark] = useState(document.body.hasAttribute('data-ds-dark-theme'))
  const [palette, setPalette] = useState<Record<string, string>>({})
  const [origin, setOrigin] = useState('')
  const [originError, setOriginError] = useState('')
  const [search, setSearch] = useState('')
  const [deep, setDeep] = useState<ToolState>({ ready: null })
  const connection = useDataConnection()
  const manifest = useWorkspacePlugins()
  useEffect(() => {
    let current = true
    const bridge = (window as unknown as { somnusApi?: { origin(): Promise<string> } }).somnusApi
    void bridge?.origin().then(value => { if (current) setOrigin(value) })
      .catch(failure => { if (current) setOriginError(failure instanceof Error ? failure.message : '无法连接工具服务') })
    const update = () => {
      setDark(document.body.hasAttribute('data-ds-dark-theme'))
      const style = getComputedStyle(root.current!)
      const token = (name: string) => style.getPropertyValue('--dsw-alias-' + name).trim()
      setPalette({ colorPrimary: token('brand-primary'), colorBgContainer: token('bg-layer-1'),
        colorBgElevated: token('bg-layer-2'), colorBgLayout: token('bg-base'), colorText: token('label-primary'),
        colorTextSecondary: token('label-secondary'), colorBorder: token('border-l2') })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => { current = false; observer.disconnect() }
  }, [])
  useEffect(() => {
    // Readiness is a local service check; an unknown result never marks a tool unready.
    const controller = new AbortController()
    let current = true
    void deepStatus(controller.signal).then(status => {
      if (current) setDeep({ ready: Boolean(status.configured && status.execution_ready), reason: status.execution_reason })
    }).catch(() => { if (current) setDeep({ ready: null }) })
    return () => { current = false; controller.abort() }
  }, [])

  function open(key: string) {
    setActive(key)
    setVisited(value => new Set([...value, key]))
  }

  function stateFor(tool: WorkspaceTool): ToolState {
    if (tool.key === 'sql') {
      if (connection.mode === 'loading') return { ready: null }
      if (connection.mode === 'local' || connection.mode === 'remote') return { ready: true }
      return { ready: false, reason: connection.mode === 'invalid'
        ? '数据连接配置有误，打开后可重新配置只读连接'
        : '无法读取数据连接设置，打开后可在配置中心检查' }
    }
    if (tool.key === 'analysis') return { ready: true }
    if (tool.key === 'deep-analysis') return deep.ready === false
      ? { ready: false, reason: deep.reason || '需先配置分析模型与执行环境' }
      : { ready: deep.ready }
    return { ready: null }
  }

  const query = search.trim().toLowerCase()
  const tools = manifest.tools.filter(tool => !query || `${tool.label} ${tool.hint}`.toLowerCase().includes(query))

  function card(tool: WorkspaceTool) {
    const meta = metaFor(tool)
    const state = stateFor(tool)
    const blocked = state.ready === false
    const body = <>
      <span className="somnus-tool-tile"><ToolIcon kind={meta.icon} /></span>
      <strong className="somnus-tool-name">{tool.label}</strong>
      <span className="somnus-tool-hint">{tool.hint}</span>
      {meta.prereq && <span className="somnus-tool-meta">
        <span className="somnus-tool-tag">{prereqLabels[meta.prereq]}</span>
      </span>}
      {blocked && state.reason && <span className="somnus-tool-reason">{state.reason}</span>}
      <span className="somnus-tool-open">
        <span>{tool.href ? '新窗口打开' : blocked ? '配置后可用' : '打开工具'}</span>
        <span aria-hidden="true">{tool.href ? '↗' : '→'}</span>
      </span>
    </>
    return tool.href
      ? <a key={tool.key} className="somnus-tool-card" data-state={blocked ? 'blocked' : 'ready'}
        href={origin + tool.href} target="_blank" rel="noreferrer">{body}</a>
      : <button key={tool.key} type="button" className="somnus-tool-card" data-state={blocked ? 'blocked' : 'ready'}
        onClick={() => open(tool.key)}>{body}</button>
  }

  return <div ref={root} className="somnus-native-tools">
    <ConfigProvider prefixCls="somnus-tool" getPopupContainer={() => root.current!}
      theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { ...palette, fontSize: 13, borderRadius: 8 } }}>
      <header className="somnus-tools-heading">
        <div>
          <h1>工具</h1>
          {!active && <p>与本机数据源、波形和模型配合的分析工具 · 全部在本机执行</p>}
        </div>
        <div className="somnus-tools-heading-actions">
          {active
            ? <button type="button" className="somnus-tools-back" onClick={() => setActive('')}>返回工具列表</button>
            : <label className="somnus-tools-search">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input type="search" value={search} onChange={event => setSearch(event.target.value)}
                placeholder="搜索工具…" aria-label="搜索工具" />
            </label>}
        </div>
      </header>
      {originError && <p className="somnus-tools-alert" role="alert">{originError}</p>}
      {manifest.status === 'error' && <div className="somnus-tools-alert" role="alert">
        读取插件工具列表失败，以下仅显示本机内置工具。
        <button type="button" onClick={manifest.retry}>重试</button>
      </div>}
      {!active && (manifest.status === 'ready' && !manifest.tools.length
        ? <section className="somnus-tools-empty" aria-label="暂无工具">
          <h2>暂无可用工具</h2>
          <p>在插件中心安装带 workspace_entries 的插件后，其工具会自动出现在这里。当前没有可显示的占位工具。</p>
          <button type="button" onClick={manifest.retry}>重新读取</button>
        </section>
        : manifest.status === 'loading' && !tools.length
          ? <p className="somnus-tools-status" role="status">正在读取工具列表…</p>
          : !tools.length
            ? <section className="somnus-tools-empty" aria-label="没有匹配的工具">
              <h2>没有匹配的工具</h2>
              <p>当前工具列表中没有名称或说明包含“{search.trim()}”的项。</p>
            </section>
            : <div className="somnus-tools-grid" aria-label="工具列表">{tools.map(card)}</div>)}
      {visited.has('sql') && <section hidden={active !== 'sql'} aria-label="数据查询"><SqlQuery stateKey="native-sql" dataConnection={connection} /></section>}
      {visited.has('deep-analysis') && <section hidden={active !== 'deep-analysis'} aria-label="深度分析"><DeepAnalysis stateKey="native-deep" dataConnection={connection} assetOrigin={origin} /></section>}
      {visited.has('analysis') && <section hidden={active !== 'analysis'} aria-label="波形分析"><NativeWaveform active={active === 'analysis'} /></section>}
    </ConfigProvider>
  </div>
}
