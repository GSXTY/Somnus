/**
 * 内置「工具」页外壳（恢复版）。
 *
 * 与旧实现的区别：卡片不再硬编码，也不再来自 `/api/plugins` 或内置导航；
 * 而是读取 `toolRegistry` 里的登记项。三个具体工具（SQL 查询、深度分析、
 * 波形分析）已改为独立插件，各自注册一个 `main` 面板并向注册表登记卡片。
 *
 * 本页只负责：
 *   - 列表 / 搜索 / 前置条件标签 / 空态；
 *   - 点击卡片时调用 `registry.open(panelKey)`，由外壳切到对应插件面板；
 *   - 不判断工具 readiness（留待下一步由插件自报）。
 */
import { useEffect, useState } from 'react'
import { somnusToolRegistry } from './toolRegistry'
import type { ToolEntry, ToolIcon } from './toolRegistry'
import './native-tools.css'

/** 前置条件标签沿用旧文案。 */
const prereqLabels = { database: '需数据库', files: '本机文件', model: '需配置模型' } as const

/** 与旧实现逐字相同的 24×24 线性图标。 */
function ToolIcon({ kind = 'tool' }: { kind?: ToolIcon }) {
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

/** 一张工具卡片；`data-*` 与类名沿用旧版，样式不依赖具体工具。 */
function ToolCard({ entry }: { entry: ToolEntry }) {
  return <button key={entry.id} type="button" className="somnus-tool-card" data-state="ready"
    data-tool-id={entry.id} data-panel-key={entry.panelKey}
    aria-label={`打开工具：${entry.title}`}
    onClick={() => somnusToolRegistry.open(entry.panelKey)}>
    <span className="somnus-tool-tile"><ToolIcon kind={entry.icon} /></span>
    <strong className="somnus-tool-name">{entry.title}</strong>
    <span className="somnus-tool-hint">{entry.hint}</span>
    {entry.prereq && <span className="somnus-tool-meta">
      <span className="somnus-tool-tag">{prereqLabels[entry.prereq]}</span>
    </span>}
    <span className="somnus-tool-open">
      <span>打开工具</span>
      <span aria-hidden="true">→</span>
    </span>
  </button>
}

export default function NativeTools() {
  const [search, setSearch] = useState('')
  const [tools, setTools] = useState<ToolEntry[]>(() => somnusToolRegistry.entries())

  // 订阅注册表：插件在任意时刻注册/注销卡片，这里都会重渲染。
  useEffect(() => somnusToolRegistry.subscribe(() => setTools(somnusToolRegistry.entries())), [])

  const query = search.trim().toLowerCase()
  const shown = query ? tools.filter(tool => `${tool.title} ${tool.hint}`.toLowerCase().includes(query)) : tools

  return <div className="somnus-native-tools">
    <header className="somnus-tools-heading">
      <div>
        <h1>工具</h1>
        <p>与本机数据源、波形和模型配合的分析工具 · 全部在本机执行</p>
      </div>
      <div className="somnus-tools-heading-actions">
        <label className="somnus-tools-search">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder="搜索工具…" aria-label="搜索工具" />
        </label>
      </div>
    </header>
    {!tools.length
      ? <section className="somnus-tools-empty" aria-label="暂无工具">
        <h2>没有可用的工具插件</h2>
        <p>在「插件」页安装业务工具插件后，工具会出现在这里。</p>
      </section>
      : !shown.length
        ? <section className="somnus-tools-empty" aria-label="没有匹配的工具">
          <h2>没有匹配的工具</h2>
          <p>当前工具列表中没有名称或说明包含“{search.trim()}”的项。</p>
        </section>
        : <div className="somnus-tools-grid" aria-label="工具列表">
          {shown.map(entry => <ToolCard key={entry.id} entry={entry} />)}
        </div>}
  </div>
}
