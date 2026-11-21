import { useEffect, useState } from 'react'
import { HomeDashboard, HomeUpdate } from './LegacyHomeDashboard'
import { useWorkbench } from '../../../page_design/frontend/src/app/useWorkbench'
import type { Dashboard } from '../../../page_design/frontend/src/shared/types'
import './legacy-workbench.css'

const fallbackOptions: NonNullable<Dashboard['model_options']> = [{ value: 'all', label: '全部设备型号' }]

export function LegacyWorkbench() {
  const [dark, setDark] = useState(() => document.body.hasAttribute('data-ds-dark-theme'))
  const [model, setModel] = useState('all')
  const [auto, setAuto] = useState(true)
  const { data, error, loading, reload } = useWorkbench('live', model, auto)
  const options = data?.model_options?.length ? data.model_options : fallbackOptions
  const modelLabel = options.find(option => option.value === model)?.label ?? '全部设备型号'
  useEffect(() => {
    const update = () => setDark(document.body.hasAttribute('data-ds-dark-theme'))
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    update()
    return () => observer.disconnect()
  }, [])
  return <div className="somnus-native-home">
    <div className="home-workspace-panel somnus-legacy-home">
      <HomeUpdate data={data} loading={loading} error={error} auto={auto} model={model}
        modelOptions={options} onModelChange={setModel} onAutoChange={setAuto} onReload={reload} />
      {error && <p className="somnus-home-notice" role="alert">{error}</p>}
      {data?.source.mode === 'unconfigured' && !error &&
        <p className="somnus-home-notice" role="status">尚未配置数据连接，请在配置中心连接数据库。</p>}
      <HomeDashboard data={data} loading={loading} modelLabel={modelLabel} modelSpecific={model !== 'all'} dark={dark} />
    </div>
  </div>
}
