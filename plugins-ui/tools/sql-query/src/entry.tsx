/**
 * 业务工具插件客户端入口：数据查询。
 *
 * 页面组件复用仓库源码（不重写）：page_design/frontend/src/dashboard/SqlQuery.tsx。
 * 本插件只做三件事：
 *   1) 注册 `main` 面板（key 与卡片里的 panelKey 一致）；
 *   2) 向内置「工具」页的注册表 `somnusTools` 登记一张卡片；
 *   3) 注入样式（工具页外壳基础样式 + 本工具样式，按内置构建的作用域包裹）。
 *
 * JSX 走 esbuild 经典转换，React 由 build.mjs 生成的 factory 提供（`var React = require('react')`）。
 */
import { SqlQuery } from '../../../../page_design/frontend/src/dashboard/SqlQuery'
import { useDataConnection } from '../../../../page_design/frontend/src/configuration/DataConnection'
import nativeToolsCss from '../../../../desktop/dsh_next/client/native-tools.css'
import sqlQueryCss from '../../../../page_design/frontend/src/dashboard/sql-query.css'

const PANEL_ID = 'plugin-tool-sql'
const LOCALE = 'somnus-tool-sql'
const STYLE_MARK = 'somnus-tool-sql'
const SCOPE = '.somnus-native-tools'

type SlotsLike = {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: (props: any) => any): () => void
}

type ToolRegistryLike = {
  register(entry: Record<string, unknown>): () => void
}

type ClientContext = {
  slots: SlotsLike
  effect(setup: () => (() => void) | void, label?: string): () => void
  inject(deps: string[], callback: (scope: any) => void): void
}

function injectStyles(): () => void {
  if (typeof document === 'undefined' || document.head === null) return () => {}
  const selector = `style[data-${STYLE_MARK}="styles"]`
  if (document.head.querySelector(selector) !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.somnusToolSql = 'styles'
  style.textContent = [nativeToolsCss, `${SCOPE} {\n${sqlQueryCss}\n}`].join('\n')
  document.head.appendChild(style)
  return () => { style.remove() }
}

function SqlToolPage() {
  const connection = useDataConnection()
  return <div className="somnus-native-tools">
    <SqlQuery stateKey={PANEL_ID} dataConnection={connection} />
  </div>
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), 'somnus-tool-sql: styles')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: LOCALE,
  }, () => <SqlToolPage />))

  ctx.inject(['somnusTools'], scope => {
    const registry = scope.get('somnusTools') as ToolRegistryLike | undefined
    if (!registry) return
    ctx.effect(() => registry.register({
      id: 'sql',
      title: '数据查询',
      hint: '自然语言生成只读 SQL 并执行',
      prereq: 'database',
      icon: 'database',
      panelKey: PANEL_ID,
      order: 3,
    }), 'somnus tool card: sql')
  })
}
