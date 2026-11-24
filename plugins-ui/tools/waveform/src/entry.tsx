/**
 * 业务工具插件客户端入口：波形分析。
 *
 * 页面组件复用仓库源码（不重写）：desktop/dsh_next/client/NativeWaveform.tsx。
 * 它内部把后端 `/events` 页面抓进 shadow DOM，并用 `window.somnusApi` 发请求；
 * 相关 `?somnus-native` 资源由 build.mjs 复用内置构建的同一个 esbuild 插件处理。
 *
 * 本插件只做三件事：注册 `main` 面板、向 `somnusTools` 注册表登记一张卡片、注入基础样式。
 */
import { NativeWaveform } from '../../../../desktop/dsh_next/client/NativeWaveform'
import nativeToolsCss from '../../../../desktop/dsh_next/client/native-tools.css'

const PANEL_ID = 'plugin-tool-waveform'
const LOCALE = 'somnus-tool-waveform'
const STYLE_MARK = 'somnus-tool-waveform'

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
  style.dataset.somnusToolWaveform = 'styles'
  // NativeWaveform 自带 shadow DOM 内的样式，这里只需要工具页外壳的基础样式。
  style.textContent = nativeToolsCss
  document.head.appendChild(style)
  return () => { style.remove() }
}

function WaveformPage() {
  return <div className="somnus-native-tools">
    <NativeWaveform active={true} />
  </div>
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), 'somnus-tool-waveform: styles')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: LOCALE,
  }, () => <WaveformPage />))

  ctx.inject(['somnusTools'], scope => {
    const registry = scope.get('somnusTools') as ToolRegistryLike | undefined
    if (!registry) return
    ctx.effect(() => registry.register({
      id: 'waveform',
      title: '波形分析',
      hint: '打开或选择记录后分析 CSV 波形和复核事件',
      prereq: 'files',
      icon: 'wave',
      panelKey: PANEL_ID,
      order: 1,
    }), 'somnus tool card: waveform')
  })
}
