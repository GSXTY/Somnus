import { useRetainedToolState } from '../../../page_design/frontend/src/shared/useRetainedToolState'
import { useEffect, useRef, useState } from 'react'
import { ConfigProvider, theme } from 'antd'
import { SqlQuery } from '../../../page_design/frontend/src/dashboard/SqlQuery'
import { DeepAnalysis } from '../../../page_design/frontend/src/analysis/DeepAnalysis'
import { useDataConnection } from '../../../page_design/frontend/src/configuration/DataConnection'
import { useWorkspacePlugins } from '../../../page_design/frontend/src/plugins/workspacePlugins'
import { NativeWaveform } from './NativeWaveform'
import './native-tools.css'

export default function NativeTools() {
  const root = useRef<HTMLDivElement>(null)
  const [active, setActive] = useRetainedToolState('native-tools:active', '')
  const [visited, setVisited] = useRetainedToolState('native-tools:visited', new Set<string>())
  const [dark, setDark] = useState(document.body.hasAttribute('data-ds-dark-theme'))
  const [palette, setPalette] = useState<Record<string, string>>({})
  const [origin, setOrigin] = useState('')
  const [originError, setOriginError] = useState('')
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
  function open(key: string) {
    setActive(key)
    setVisited(value => new Set([...value, key]))
  }
  return <div ref={root} className="somnus-native-tools">
    <ConfigProvider prefixCls="somnus-tool" getPopupContainer={() => root.current!}
      theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { ...palette, fontSize: 13, borderRadius: 8 } }}>
      <header className="somnus-tools-heading"><h1>工具</h1>
        {active && <button type="button" onClick={() => setActive('')}>返回工具列表</button>}
      </header>
      {originError && <p role="alert">{originError}</p>}
      {manifest.status === 'error' && <p role="alert">读取工具列表失败 <button onClick={manifest.retry}>重试</button></p>}
      {!active && <nav className="somnus-tools-list" aria-label="工具列表">
        {manifest.tools.map(tool => tool.href ? <a key={tool.key} href={origin + tool.href} target="_blank" rel="noreferrer">
          <strong>{tool.label}</strong><span>{tool.hint}</span></a> :
          <button type="button" key={tool.key} onClick={() => open(tool.key)}><strong>{tool.label}</strong><span>{tool.hint}</span></button>)}
      </nav>}
      {visited.has('sql') && <section hidden={active !== 'sql'} aria-label="数据查询"><SqlQuery stateKey="native-sql" dataConnection={connection} /></section>}
      {visited.has('deep-analysis') && <section hidden={active !== 'deep-analysis'} aria-label="深度分析"><DeepAnalysis stateKey="native-deep" dataConnection={connection} assetOrigin={origin} /></section>}
      {visited.has('analysis') && <section hidden={active !== 'analysis'} aria-label="波形分析"><NativeWaveform active={active === 'analysis'} /></section>}
    </ConfigProvider>
  </div>
}
