/**
 * DSH 客户端模块入口：以插件形式渲染「工具」页（内置实现已移除，本插件是唯一实现）。
 *
 * 做的事只有四件：
 *   1) 收集依赖图里出现的全部 CSS，拼成一个 <style data-somnus-tools-probe="styles">；
 *   2) 注册 `main` 主面板（key = sidebar id = `plugin-tools`），渲染本插件自带的 NativeTools；
 *   3) 注册 `sidebar.panellist` 侧边栏入口，标签「工具（插件）」，order -7.5；
 *   4) 不调用 layout.selectPanel —— 工具页不是启动默认页。
 *
 * 页面渲染代码与原先的内置工具页是同一份源码（现已从
 * desktop/dsh_next/client/ 移入本插件的 src/，由插件自带），没有重写。
 * 内置页已从软件本体移除，原始实现备份在
 * plugins-ui/_backup/builtin-tools-2026-11-24/。
 *
 * JSX 说明：构建走 esbuild 经典转换（React.createElement）。本文件不 import React，
 * 由 build.mjs 生成的 factory 顶部 `var React = require('react')` 提供标识符。
 */
import NativeTools from './NativeTools'
// 工具页样式：插件自带（已从 desktop/ 移入本目录），不额外加作用域包裹。
import nativeToolsCss from './native-tools.css'
// 工具页内嵌的两个子页面样式。原内置构建（desktop/dsh_next/client/overlay.mjs 的
// somnus-scoped-tool-styles）把这三份整体收在 .somnus-native-tools 之下；这里用
// 同样的包裹方式，避免污染宿主样式，并保持与内置版一致的视觉。
import sqlQueryCss from '../../../page_design/frontend/src/dashboard/sql-query.css'
import deepAnalysisCss from '../../../page_design/frontend/src/analysis/deep-analysis.css'
import deepAnalysisReportCss from '../../../page_design/frontend/src/analysis/deep-analysis-report.css'
// NativeWaveform 的 CSS 不走这里：它自带 ?somnus-native 文本导入并在 shadow DOM 内注入。

const PANEL_ID = 'plugin-tools'
const LOCALE = 'somnus-tools-probe'
const STYLE_MARK = 'somnus-tools-probe'
const SCOPE = '.somnus-native-tools'

type SlotEntryView = { options: { key?: string; id?: string } }

type SlotsLike = {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: (props: any) => any): () => void
  entries(key: string): readonly SlotEntryView[]
}

type ClientContext = {
  slots: SlotsLike
  effect(setup: () => (() => void) | void, label?: string): () => void
}

/** 与内置 overlay.mjs 的 scoping 写法逐字一致：`<scope> {\n<css>\n}`。 */
function scoped(css: string): string {
  return `${SCOPE} {\n${css}\n}`
}

/** 侧边栏入口图标：与内置「工具」页同一套 24×24 线性图标的扳手/螺丝刀路径。 */
function ToolsIcon({ size = 20 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="m14.5 5.5 4 4-9 9-4-4z" />
    <path d="M6.5 16.5 5 18a2.1 2.1 0 0 1-3-3l1.5-1.5" />
  </svg>
}

/**
 * 把整页样式注入 <head>：一个 <style>、data 属性去重，重复装载/HMR 重入不会叠加。
 * CSS 文本来自构建时的 import（esbuild text loader），与内置版本同源同文件。
 */
function injectToolStyles(): () => void {
  if (typeof document === 'undefined' || document.head === null) return () => {}
  const selector = `style[data-${STYLE_MARK}="styles"]`
  if (document.head.querySelector(selector) !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.somnusToolsProbe = 'styles'
  style.textContent = [
    nativeToolsCss,
    scoped(sqlQueryCss),
    scoped(deepAnalysisCss),
    scoped(deepAnalysisReportCss),
  ].join('\n')
  document.head.appendChild(style)
  return () => { style.remove() }
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // 1) 整页样式。
  ctx.effect(() => injectToolStyles(), 'somnus-tools-probe: tool page styles')

  // 2) 主面板：key 与侧边栏入口 id 相同，都是 plugin-tools。
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: LOCALE,
  }, () => <NativeTools />))

  // 3) 侧边栏入口：紧挨内置「工具」（order -8）之后的 order -7.5。
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: -7.5,
    locale: LOCALE,
    label: () => '工具（插件）',
  }, ({ size }: { size: number }) => <ToolsIcon size={size} />))
}
