/**
 * 业务工具插件客户端入口：深度分析。
 *
 * 页面组件复用仓库源码（不重写）：page_design/frontend/src/analysis/DeepAnalysis.tsx。
 * 本插件只做三件事：注册 `main` 面板、向 `somnusTools` 注册表登记一张卡片、注入样式。
 *
 * 深度分析需要两个外部输入，插件自己提供：
 *   - dataConnection：`useDataConnection()`（只读数据连接状态）
 *   - assetOrigin：本机 Somnus 服务地址，来自 `window.somnusApi.origin()`
 */
import { useEffect, useState } from 'react'
import { DeepAnalysis } from '../../../../page_design/frontend/src/analysis/DeepAnalysis'
import { useDataConnection } from '../../../../page_design/frontend/src/configuration/DataConnection'
import nativeToolsCss from '../../../../desktop/dsh_next/client/native-tools.css'
import deepAnalysisCss from '../../../../page_design/frontend/src/analysis/deep-analysis.css'
import deepAnalysisReportCss from '../../../../page_design/frontend/src/analysis/deep-analysis-report.css'

const PANEL_ID = 'plugin-tool-deep-analysis'
const LOCALE = 'somnus-tool-deep-analysis'
const STYLE_MARK = 'somnus-tool-deep-analysis'
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
  style.dataset.somnusToolDeepAnalysis = 'styles'
  style.textContent = [
    nativeToolsCss,
    `${SCOPE} {\n${deepAnalysisCss}\n}`,
    `${SCOPE} {\n${deepAnalysisReportCss}\n}`,
  ].join('\n')
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** 本机 Somnus 服务地址；拿不到时保持空串（深分析只影响产物链接的绝对地址）。 */
function useServiceOrigin(): string {
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    let alive = true
    const bridge = (window as unknown as { somnusApi?: { origin?: () => Promise<string> } }).somnusApi
    void bridge?.origin?.().then(value => { if (alive && typeof value === 'string') setOrigin(value) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return origin
}

function DeepAnalysisPage() {
  const connection = useDataConnection()
  const origin = useServiceOrigin()
  return <div className="somnus-native-tools">
    <DeepAnalysis stateKey={PANEL_ID} dataConnection={connection} assetOrigin={origin} />
  </div>
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), 'somnus-tool-deep-analysis: styles')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: LOCALE,
  }, () => <DeepAnalysisPage />))

  ctx.inject(['somnusTools'], scope => {
    const registry = scope.get('somnusTools') as ToolRegistryLike | undefined
    if (!registry) return
    ctx.effect(() => registry.register({
      id: 'deep-analysis',
      title: '深度分析',
      hint: '独立模型分析表格、生成图表与报告',
      prereq: 'model',
      icon: 'spark',
      panelKey: PANEL_ID,
      order: 2,
    }), 'somnus tool card: deep-analysis')
  })
}
