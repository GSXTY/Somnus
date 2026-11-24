import { useState } from 'react'
import '../../../page_design/frontend/src/dashboard/home-dashboard.css'
import { LegacyChart } from './LegacyChart'
import { activityOption, eventsOption, homeTrendOption } from '../../../page_design/frontend/src/analysis/chartOptions'
import { comparison, formatNumber, numeric } from '../../../page_design/frontend/src/shared/logic.mjs'
import type { Dashboard, HomeMetric, Metric } from '../../../page_design/frontend/src/shared/types.ts'

type ActivityMetric = 'active_users' | 'treatment_hours'
const activityModes = [
  { value: 'active_users', label: '活跃人数' },
  { value: 'treatment_hours', label: '治疗时长' },
] satisfies { value: ActivityMetric; label: string }[]

const rangeOptions = [7, 14, 30] as const
type TrendRange = typeof rangeOptions[number]

/** Present the minute-based unit compactly under the KPI value. */
function displayUnit(unit?: string) {
  return unit === '小时' ? 'h' : unit ?? ''
}

function HomeValue({ metric, digits = 1 }: { metric?: HomeMetric; digits?: number }) {
  const hasValue = numeric(metric?.value)
  return <strong className="home-value" data-empty={!hasValue}>
    {formatNumber(metric?.value, digits)}
    {hasValue && <small>{displayUnit(metric?.unit)}</small>}
  </strong>
}

function MetricValue({ metric, digits = 1 }: { metric?: Pick<Metric, 'value' | 'unit'>; digits?: number }) {
  const hasValue = numeric(metric?.value)
  return <strong className="home-value" data-empty={!hasValue}>
    {formatNumber(metric?.value, digits)}
    {hasValue && <small>{displayUnit(metric?.unit)}</small>}
  </strong>
}

function Delta({ value, previous }: { value?: number | null; previous?: number | null }) {
  const change = comparison(value, previous)
  if (change.direction === 'unknown') return null
  const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : ''
  return <span className="home-delta" data-direction={change.direction}>{arrow} {change.text}</span>
}

/** Small inline trend; a dashed baseline marks a missing series without inventing points. */
function Sparkline({ values, variant = 'line', label }: {
  values: (number | null)[]; variant?: 'line' | 'bar'; label: string
}) {
  const known = values.filter((value): value is number => numeric(value))
  if (known.length < 2 || values.length < 2) {
    return <svg className="home-spark" data-empty="true" viewBox="0 0 220 34" preserveAspectRatio="none"
      role="img" aria-label={`${label}：暂无数据`}>
      <line x1="2" y1="17" x2="218" y2="17" />
    </svg>
  }
  const width = 220, top = 3, bottom = 31
  if (variant === 'bar') {
    const max = Math.max(...known, 0)
    const step = width / values.length
    const barWidth = Math.max(step * 0.55, 2)
    return <svg className="home-spark" viewBox={`0 0 ${width} 34`} preserveAspectRatio="none"
      role="img" aria-label={`${label}：近 ${values.length} 天`}>
      {values.map((value, index) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return null
        const height = max > 0 ? Math.max((value / max) * (bottom - top), 1) : 1
        return <rect key={index} className="home-spark-bar" x={index * step + (step - barWidth) / 2}
          y={bottom - height} width={barWidth} height={height} rx="2" />
      })}
    </svg>
  }
  const min = Math.min(...known), max = Math.max(...known)
  const span = max - min || 1
  const points = values.map((value, index) => typeof value === 'number' && Number.isFinite(value)
    ? { x: (index / (values.length - 1)) * width, y: top + (1 - (value - min) / span) * (bottom - top) }
    : null)
  const path = points.reduce((line, point) => point ? `${line}${line ? ' L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}` : line, '')
  const usable = points.filter(point => point)
  const first = usable[0], last = usable[usable.length - 1]
  const area = first && last ? `${path} L${last.x.toFixed(1)},34 L${first.x.toFixed(1)},34 Z` : ''
  return <svg className="home-spark" viewBox={`0 0 ${width} 34`} preserveAspectRatio="none"
    role="img" aria-label={`${label}：近 ${values.length} 天`}>
    <path className="home-spark-area" d={area} />
    <path className="home-spark-line" d={path} />
  </svg>
}

function EmptyTrend({ note }: { note: string }) {
  return <div className="home-plot">
    <svg viewBox="0 0 560 232" preserveAspectRatio="none" aria-hidden="true">
      <g className="home-plot-grid">
        {[30, 80, 130, 180, 210].map(y => <line key={y} x1="0" y1={y} x2="560" y2={y} />)}
      </g>
      <path className="home-plot-dash" d="M20,110 L105,90 L190,120 L275,84 L360,104 L445,76 L530,96" />
    </svg>
    <div className="home-plot-watermark"><span>{note}</span></div>
  </div>
}

export function HomeUpdate({ data, loading, error, auto, model, modelOptions, onModelChange, onAutoChange, onReload }: {
  data: Dashboard | null
  loading: boolean
  error: string
  auto: boolean
  model: string
  modelOptions: NonNullable<Dashboard['model_options']>
  onModelChange: (model: string) => void
  onAutoChange: (checked: boolean) => void
  onReload: () => void
}) {
  const time = data && data.source.mode !== 'unconfigured' ? data.generated_at.slice(11, 16) : undefined
  const status = loading ? '正在更新' : error ? '更新失败' : time ? `更新于 ${time}` : '暂无更新记录'
  const state = loading ? 'loading' : error ? 'error' : time ? 'fresh' : 'empty'

  return <section className="home-update" aria-labelledby="home-update-title">
    <div className="home-update-meta">
      <div className="home-update-heading">
        <h2 id="home-update-title">数据更新</h2>
        <span className="home-update-status" data-state={state} role="status">{status}</span>
      </div>
      {data && <div className="home-update-period">
        <span>昨日统计 {data.period.kpi_date}</span>
        <span>趋势 {data.period.start_date} — {data.period.end_date} · {data.period.time_zone}</span>
      </div>}
    </div>
    <div className="home-update-controls">
      <div className="home-device-filter">
        <label id="home-device-model-label" htmlFor="home-device-model">设备型号</label>
        <select id="home-device-model" aria-labelledby="home-device-model-label" value={model}
          onChange={event => onModelChange(event.target.value)}>
          {modelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="home-update-schedule">
        <span id="home-update-frequency">每小时自动更新</span>
        <input type="checkbox" role="switch" checked={auto} onChange={event => onAutoChange(event.target.checked)} aria-labelledby="home-update-frequency" />
      </div>
      <button type="button" className="home-update-button" disabled={loading} onClick={onReload}>立即更新</button>
    </div>
  </section>
}

function ModelDashboard({ home, modelLabel, loading, dark }: {
  home?: Dashboard['home']; modelLabel: string; loading: boolean; dark: boolean
}) {
  const metrics = home?.metrics
    .filter(metric => metric.label !== '昨日设备上报成功次数' || numeric(metric.value))
    .sort((left, right) => Number(right.unit === '人') - Number(left.unit === '人')) ?? []

  return <section className="home-dashboard home-model-dashboard" aria-busy={loading} aria-label={modelLabel}>
    {metrics.length ? <div className="home-model-metrics">
      {metrics.map(metric => <section className="home-metric" key={metric.label}>
        <h2>{metric.label}</h2>
        <HomeValue metric={metric} digits={metric.digits} />
      </section>)}
    </div> : null}
    {home?.charts.length ? <div className="home-trends">
      {home.charts.map(trend => <section className="home-trend" key={trend.label}>
        <div className="home-trend-heading"><h2>{trend.label}</h2></div>
        {trend.points.some(point => numeric(point.value))
          ? <LegacyChart height={238} label={trend.label} option={homeTrendOption(trend, dark)} />
          : <EmptyTrend note="暂无趋势数据" />}
      </section>)}
    </div> : null}
    {!metrics.length && !home?.charts.length && <div className="home-trend">
      <p className="somnus-home-empty" role="status">{loading ? `正在读取 ${modelLabel} 数据` : `${modelLabel} 暂无可展示的数据`}</p>
    </div>}
  </section>
}

export function HomeDashboard({ data, loading, modelLabel, modelSpecific, dark }: {
  data: Dashboard | null; loading: boolean; modelLabel: string; modelSpecific: boolean; dark: boolean
}) {
  const [activityMetric, setActivityMetric] = useState<ActivityMetric>('active_users')
  const [range, setRange] = useState<TrendRange>(7)
  if (data?.home || modelSpecific) {
    return <ModelDashboard home={data?.home} loading={loading} modelLabel={modelLabel} dark={dark} />
  }
  const kpis = data?.kpis
  const daily = data?.daily ?? []
  const connected = Boolean(data && data.source.mode !== 'unconfigured')
  const emptyNote = connected ? '数据源未提供该指标' : '等待接入'
  const average = daily.length === 7 && daily.every(day => numeric(day.active_users))
    ? daily.reduce((total, day) => total + day.active_users, 0) / 7 : null
  const active = kpis?.active_users
  const hours = kpis?.treatment_hours
  const events = kpis?.reported_events
  const ahi = kpis?.avg_ahi
  const perDevice = numeric(hours?.value) && numeric(active?.value) && active!.value! > 0
    ? hours!.value! / active!.value! : null
  const ranged = range < daily.length ? daily.slice(-range) : daily
  const hasActiveSeries = ranged.some(day => numeric(day[activityMetric]))
  const hasReportedEvents = ranged.some(day => numeric(day.event_count))
  const rangeNote = loading && !data ? '正在读取数据' : !connected ? '等待数据源 · 全部为未知' : null
  const trendNote = loading && !data ? '趋势加载中' : connected ? '数据源未提供该指标' : '示例曲线，仅示意布局'

  return <div className="home-dashboard" aria-busy={loading}>
    <div className="home-section">
      <h2>概览</h2>
      {data && <em>昨日 {data.period.kpi_date}</em>}
      {rangeNote && <span className="home-section-note">{rangeNote}</span>}
    </div>
    <div className="home-metrics">
      <section className="home-metric home-active" data-empty={!numeric(active?.value)}>
        <h2>昨日活跃用户 <span className="home-metric-tag">主指标</span></h2>
        <MetricValue metric={active} digits={0} />
        {numeric(active?.value)
          ? <div className="home-metric-sub">
            <Delta value={active?.value} previous={active?.previous} />
            <span>近 7 天日均 {formatNumber(average)}{average === null ? '' : ' 人'}</span>
          </div>
          : <p className="home-metric-note">{connected ? '数据源未提供活跃用户' : '连接后显示去重活跃用户与环比'}</p>}
        <Sparkline values={active?.trend ?? []} label="活跃用户趋势" />
        <div className="home-metric-foot">
          <span>近 7 天日均使用人数</span>
          <b>{formatNumber(average)}{average === null ? '' : ' 人'}</b>
        </div>
      </section>
      <section className="home-metric home-hours" data-empty={!numeric(hours?.value)}>
        <h2>昨日治疗时长 <span className="home-metric-tag">{hours?.unit || '小时'}</span></h2>
        <MetricValue metric={hours} />
        {numeric(hours?.value)
          ? <div className="home-metric-sub">
            <Delta value={hours?.value} previous={hours?.previous} />
            <span title="按昨日活跃用户数均摊">单台均 {formatNumber(perDevice)}{perDevice === null ? '' : ' h'}</span>
          </div>
          : <p className="home-metric-note">{emptyNote}</p>}
        <Sparkline values={hours?.trend ?? []} label="治疗时长趋势" />
      </section>
      <section className="home-metric home-events" data-empty={!numeric(events?.value)}>
        <h2>昨日设备上报事件 <span className="home-metric-tag">{events?.unit || '次'}</span></h2>
        <MetricValue metric={events} digits={0} />
        {numeric(events?.value)
          ? <div className="home-metric-sub">
            <Delta value={events?.value} previous={events?.previous} />
            <span>待复核 —</span>
          </div>
          : <p className="home-metric-note">{emptyNote}</p>}
        <Sparkline values={events?.trend ?? []} variant="bar" label="设备上报事件趋势" />
      </section>
      <section className="home-metric home-ahi" data-empty={!numeric(ahi?.value)}>
        <h2>{ahi?.label || '昨日设备上报平均 AHI'}
          <span className="home-metric-tag">{ahi?.unit ? `${ahi.unit} · 设备值` : '设备值'}</span></h2>
        <MetricValue metric={ahi} digits={2} />
        {numeric(ahi?.value)
          ? <div className="home-metric-sub"><span>设备上报值，不作诊断依据</span></div>
          : <p className="home-metric-note">{emptyNote}</p>}
        <Sparkline values={ahi?.trend ?? []} label="AHI 趋势" />
      </section>
    </div>

    <div className="home-section">
      <h2>趋势</h2>
      {data && <em>{data.period.start_date} — {data.period.end_date}</em>}
      <div className="home-range" role="group" aria-label="趋势时长">
        {rangeOptions.map(days => {
          const disabled = days > 7 && days > daily.length
          return <button type="button" key={days} aria-pressed={range === days} disabled={disabled}
            title={disabled ? '数据源当前仅提供近 7 天' : undefined}
            onClick={() => setRange(days)}>{days} 天</button>
        })}
      </div>
    </div>
    <div className="home-trends">
      <section className="home-trend">
        <div className="home-trend-heading">
          <h2>活跃度与治疗趋势</h2>
          <div className="somnus-home-segments" role="group" aria-label="活跃趋势">
            {activityModes.map(mode => <button type="button" key={mode.value}
              aria-pressed={activityMetric === mode.value} onClick={() => setActivityMetric(mode.value)}>{mode.label}</button>)}
          </div>
        </div>
        {hasActiveSeries
          ? <LegacyChart height={238} label={`近${range}天每日${activityMetric === 'active_users' ? '活跃人数' : '治疗时长'}`}
            option={activityOption(ranged, activityMetric, dark)} />
          : <EmptyTrend note={connected ? `近 ${range} 天暂无${activityMetric === 'active_users' ? '活跃人数' : '治疗时长'}数据` : trendNote} />}
      </section>
      <section className="home-trend">
        <div className="home-trend-heading">
          <h2>设备上报事件</h2>
          <span className="home-trend-tip">近 {range} 天</span>
        </div>
        {hasReportedEvents
          ? <LegacyChart height={238} label={`近${range}天每日设备上报事件`} option={eventsOption(ranged, dark)} />
          : <EmptyTrend note={connected ? '暂无设备上报事件计数' : trendNote} />}
      </section>
    </div>

    {data && <div className="home-footnote">
      <span><b>口径</b>：昨日统计按 {data.period.time_zone} 自然日；活跃用户为当日去重。</span>
      <span><b>边界</b>：设备上报指标（AHI / 呼吸事件指数）为设备侧口径，与工程候选事件不同口径，不作诊断依据。</span>
      <span><b>数据</b>：{data.source.label}；未连接时不展示推测数值。</span>
    </div>}
  </div>
}
