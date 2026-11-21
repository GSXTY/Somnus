import { useCallback, useEffect, useState } from 'react'
import './somnus-dashboard.css'

type Metric = { label: string; value: number | null; unit: string; digits?: number }
type TrendPoint = { date: string; value: number | null }
type Trend = { label: string; unit: string; points: TrendPoint[] }
type Dashboard = {
  source: { mode: 'demo' | 'live' | 'unconfigured'; label: string; connected: boolean }
  generated_at: string
  period: { kpi_date: string; start_date: string; end_date: string; time_zone: string }
  home?: { metrics: Metric[]; charts: Trend[] }
  kpis?: { active_users: Metric; treatment_hours: Metric; reported_events: Metric; avg_ahi?: Metric }
  daily?: { date: string; active_users: number; treatment_hours: number; event_count: number | null }[]
}

type ApiResponse = { status: number; body: ArrayBuffer }

declare global {
  interface Window {
    somnusApi?: {
      request(path: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<ApiResponse>
    }
  }
}

const refreshMs = 60 * 60 * 1000

function metricValue(metric: Metric | undefined, digits = 1) {
  if (!metric || metric.value === null || metric.value === undefined || Number.isNaN(metric.value)) return '—'
  return `${metric.value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}${metric.unit ? ` ${metric.unit}` : ''}`
}

function TrendChart({ trend, color }: { trend: Trend; color: string }) {
  const values = trend.points.map(point => point.value).filter((value): value is number => typeof value === 'number')
  if (values.length === 0) return <p className="somnus-dash-empty">暂无趋势数据</p>
  const max = Math.max(...values, 1)
  const width = 320
  const height = 120
  const step = trend.points.length > 1 ? width / (trend.points.length - 1) : width
  const points = trend.points.map((point, index) => {
    const value = typeof point.value === 'number' ? point.value : 0
    return `${Math.round(index * step)},${Math.round(height - (value / max) * (height - 16) - 8)}`
  }).join(' ')
  return <div className="somnus-dash-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={trend.label}>
      <line x1="0" y1={height - 8} x2={width} y2={height - 8} className="somnus-dash-axis" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
    <div className="somnus-dash-chart-labels">
      <span>{trend.points[0]?.date.slice(5)}</span>
      <span>{trend.points[trend.points.length - 1]?.date.slice(5)}</span>
    </div>
  </div>
}

export function SomnusDashboard() {
  const [data, setData] = useState<Dashboard>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'live' | 'demo'>('live')

  const load = useCallback(async (nextSource: 'live' | 'demo') => {
    const api = typeof window === 'undefined' ? undefined : window.somnusApi
    if (!api) {
      setError('本地 API 桥未就绪。')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.request(`/api/workbench?source=${nextSource}&model=all`)
      if (response.status !== 200) throw new Error(`服务返回 ${response.status}`)
      const text = new TextDecoder().decode(response.body)
      setData(JSON.parse(text) as Dashboard)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '请求失败')
      setData(undefined)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(source) }, [load, source])
  useEffect(() => {
    const timer = window.setInterval(() => { void load(source) }, refreshMs)
    return () => window.clearInterval(timer)
  }, [load, source])

  const kpis = data?.kpis
  const metrics: Metric[] = data?.home?.metrics ?? (kpis ? [
    kpis.active_users, kpis.treatment_hours, kpis.reported_events,
    ...(kpis.avg_ahi ? [kpis.avg_ahi] : []),
  ] : [])
  const trends: Trend[] = data?.home?.charts ?? (data?.daily ? [
    { label: '近 7 天活跃人数', unit: '人', points: data.daily.map(day => ({ date: day.date, value: day.active_users })) },
    { label: '近 7 天治疗时长', unit: '小时', points: data.daily.map(day => ({ date: day.date, value: day.treatment_hours })) },
  ] : [])
  const unconfigured = data?.source.mode === 'unconfigured'

  return <section className="somnus-dash" aria-busy={loading}>
    <div className="somnus-dash-toolbar">
      <div className="somnus-dash-source">
        <span className={`somnus-dash-dot${data?.source.connected ? ' live' : ''}`} aria-hidden="true" />
        <strong>{data?.source.label ?? '读取中'}</strong>
        {data && <span>更新于 {data.generated_at.slice(11, 16)} · {data.period.kpi_date}</span>}
      </div>
      <div className="somnus-dash-actions">
        <button type="button" className={source === 'live' ? 'active' : ''} onClick={() => setSource('live')}>实时</button>
        <button type="button" className={source === 'demo' ? 'active' : ''} onClick={() => setSource('demo')}>演示</button>
        <button type="button" onClick={() => void load(source)} disabled={loading}>{loading ? '更新中' : '刷新'}</button>
      </div>
    </div>

    {error && <div className="somnus-dash-notice" role="alert">{error}</div>}
    {unconfigured && !error && <div className="somnus-dash-notice">
      未连接公司数据库。指标保持未知，不显示伪造零值；可切换到“演示”查看合成数据。
    </div>}

    <div className="somnus-dash-metrics">
      {metrics.length === 0 && !loading && !error && !unconfigured
        ? <p className="somnus-dash-empty">暂无指标。</p>
        : metrics.map(metric => <article className="somnus-dash-metric" key={metric.label}>
          <h3>{metric.label}</h3>
          <strong>{metricValue(metric, metric.digits ?? 1)}</strong>
        </article>)}
    </div>

    <div className="somnus-dash-trends">
      {trends.map((trend, index) => <article className="somnus-dash-trend" key={trend.label}>
        <header><h3>{trend.label}</h3><span>{trend.unit}</span></header>
        <TrendChart trend={trend} color={index % 2 === 0 ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-success-primary)'} />
      </article>)}
    </div>
  </section>
}
