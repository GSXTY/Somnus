/**
 * DSH 客户端模块入口：把 Somnus 主页接成插件页面。
 *
 * 三件事：
 *   1) 注册 `main` 主面板（key = sidebar id = `plugin-home`），渲染 LegacyWorkbench；
 *   2) 注册 `sidebar.panellist` 侧边栏入口，标签为「主页」；
 *   3) 注入样式（主页外壳 + 仪表盘 + 侧边栏入口细节）；
 *   4) 仅当 `layout` 还没有活动面板（activePanelId === null）时，把自己设为启动默认页。
 *
 * 页面渲染代码与原来的内置主页是同一份源码（src/LegacyWorkbench.tsx →
 * src/LegacyHomeDashboard.tsx → src/LegacyChart.tsx），没有重写。
 *
 * JSX 说明：构建走 esbuild 经典转换（React.createElement）。本文件不 import React，
 * 由 build.mjs 生成的 factory 顶部 `var React = require('react')` 提供标识符。
 */
import { LegacyWorkbench } from './LegacyWorkbench'
import workbenchCss from './legacy-workbench.css'
// 与内置构建（desktop/dsh_next/client/overlay.mjs 的 somnus-scoped-home-styles）
// 保持一致：home-dashboard.css 整体收在 .somnus-native-home 之下，避免污染宿主样式。
import homeDashboardCss from '../../../page_design/frontend/src/dashboard/home-dashboard.css'
import homeShellCss from './home-shell.css'

const PANEL_ID = 'plugin-home'
const LOCALE = 'somnus-home-plugin'
const STYLE_MARK = 'somnus-home-plugin'

type SlotEntryView = { options: { key?: string; id?: string } }

type SlotsLike = {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: (props: any) => any): () => void
  entries(key: string): readonly SlotEntryView[]
  subscribe(key: string, fn: () => void): () => void
}

type LayoutLike = {
  panelInfo: { getSnapshot(): { activePanelId: string | null } }
  selectPanel(id: string): void
}

type ClientContext = {
  slots: SlotsLike
  effect(setup: () => (() => void) | void, label?: string): () => void
  inject(deps: string[], callback: (scope: any) => void): void
}

/** 侧边栏入口图标：与内置主页同一套 24×24 线性图标的「房子」路径。 */
function HomeIcon({ size = 20 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11.2 12 4l8 7.2" />
    <path d="M6.5 10v9h11v-9" />
  </svg>
}

/**
 * 把三份样式注入 <head>，用 data 属性去重，避免重复装载/HMR 重入时叠加。
 * 样式文本在构建时从同一批 .css 文件取（esbuild text loader），与内置版本同源。
 */
function injectHomeStyles(): () => void {
  if (typeof document === 'undefined' || document.head === null) return () => {}
  const selector = `style[data-${STYLE_MARK}="styles"]`
  if (document.head.querySelector(selector) !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.somnusHomePlugin = 'styles'
  style.textContent = [
    homeShellCss,
    workbenchCss,
    `.somnus-native-home {\n${homeDashboardCss}\n}`,
  ].join('\n')
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** 只做一次「首次打开时选默认页」的决定，之后用户怎么选都不再干预。 */
let firstOpenDecided = false

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // 1) 注入样式。
  ctx.effect(() => injectHomeStyles(), 'somnus-home-plugin: home styles')

  // 2) 主面板：key 与侧边栏入口 id 相同，都是 plugin-home。
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: LOCALE,
  }, () => <LegacyWorkbench />))

  // 3) 侧边栏入口：标签固定为「主页」，与原来的内置入口同名同位。
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: -10,
    locale: LOCALE,
    label: () => '主页',
  }, ({ size }: { size: number }) => <HomeIcon size={size} />))

  // 4) 仅当用户还没选过面板（activePanelId === null）时，把自己设为默认页。
  //    layout 服务与 main 面板声明的先后顺序不保证，因此等 main 里出现
  //    plugin-home 这个 key 之后再 selectPanel，避免
  //    `main panel "plugin-home" is not registered`。
  ctx.inject(['layout'], (scope) => {
    const layout = scope.get('layout') as LayoutLike | undefined
    if (!layout) return
    ctx.effect(() => {
      let disposed = false
      let settled = firstOpenDecided
      let off: (() => void) | undefined

      const stop = () => {
        const release = off
        off = undefined
        release?.()
      }

      const decide = () => {
        if (disposed || settled) return
        if (layout.panelInfo.getSnapshot().activePanelId !== null) {
          // 用户已经选过面板：尊重用户选择，永久放弃默认页行为。
          settled = true
          firstOpenDecided = true
          stop()
          return
        }
        if (!ctx.slots.entries('main').some(entry => entry.options.key === PANEL_ID)) return
        settled = true
        firstOpenDecided = true
        stop()
        layout.selectPanel(PANEL_ID)
      }

      off = ctx.slots.subscribe('main', decide)
      decide()
      return () => {
        disposed = true
        stop()
      }
    }, 'somnus-home-plugin: select home on first open')
  })
}
