import { useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Empty, Segmented, Select, Switch } from 'antd';
import { Chart } from './Chart';
import { activityOption, eventsOption, homeTrendOption } from './chartOptions';
import { comparison, formatNumber, numeric } from './logic.mjs';
import type { Dashboard, HomeMetric } from './types';
import './home-dashboard.css';

type ActivityMetric = 'active_users' | 'treatment_hours';
const activityModes = [
  { value: 'active_users', label: '活跃人数' },
  { value: 'treatment_hours', label: '治疗时长' },
] satisfies { value: ActivityMetric; label: string }[];

function HomeValue({ metric, digits = 1 }: { metric?: HomeMetric; digits?: number }) {
  return <strong className="home-value">
    {formatNumber(metric?.value, digits)}
    {numeric(metric?.value) && <small>{metric?.unit}</small>}
  </strong>;
}

export function HomeUpdate({ data, loading, error, auto, model, modelOptions, onModelChange, onAutoChange, onReload }: {
  data: Dashboard | null;
  loading: boolean;
  error: string;
  auto: boolean;
  model: string;
  modelOptions: NonNullable<Dashboard['model_options']>;
  onModelChange: (model: string) => void;
  onAutoChange: (checked: boolean) => void;
  onReload: () => void;
}) {
  const time = data && data.source.mode !== 'unconfigured' ? data.generated_at.slice(11, 16) : undefined;
  const status = loading ? '正在更新' : error ? '更新失败' : time ? `更新于 ${time}` : '暂无更新记录';
  const state = loading ? 'loading' : error ? 'error' : time ? 'fresh' : 'empty';

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
        <Select id="home-device-model" aria-labelledby="home-device-model-label" value={model}
          onChange={onModelChange} options={modelOptions} showSearch optionFilterProp="label" />
      </div>
      <div className="home-update-schedule">
        <span id="home-update-frequency">每小时自动更新</span>
        <Switch size="small" checked={auto} onChange={onAutoChange} aria-labelledby="home-update-frequency" />
      </div>
      <Button className="home-update-button" icon={<ReloadOutlined />} loading={loading} onClick={onReload}>立即更新</Button>
    </div>
  </section>;
}

function ModelDashboard({ home, modelLabel, loading }: {
  home?: Dashboard['home']; modelLabel: string; loading: boolean;
}) {
  const metrics = home?.metrics
    .filter(metric => metric.label !== '昨日设备上报成功次数' || numeric(metric.value))
    .sort((left, right) => Number(right.unit === '人') - Number(left.unit === '人')) ?? [];

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
          ? <Chart height={238} label={trend.label} option={homeTrendOption(trend)} />
          : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" />}
      </section>)}
    </div> : null}
    {!metrics.length && !home?.charts.length && <div className="home-trend">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? `正在读取 ${modelLabel} 数据` : `${modelLabel} 暂无可展示的数据`} />
    </div>}
  </section>;
}

export function HomeDashboard({ data, loading, modelLabel, modelSpecific }: {
  data: Dashboard | null; loading: boolean; modelLabel: string; modelSpecific: boolean;
}) {
  const [activityMetric, setActivityMetric] = useState<ActivityMetric>('active_users');
  if (data?.home || modelSpecific) {
    return <ModelDashboard home={data?.home} loading={loading} modelLabel={modelLabel} />;
  }
  const kpis = data?.kpis;
  const daily = data?.daily ?? [];
  const average = daily.length === 7 && daily.every(day => numeric(day.active_users))
    ? daily.reduce((total, day) => total + day.active_users, 0) / 7 : null;
  const change = comparison(kpis?.active_users.value, kpis?.active_users.previous);
  const chartPlaceholder = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
    description={loading ? '趋势加载中' : '暂无趋势数据'} />;
  const hasReportedEvents = daily.some(day => numeric(day.event_count));

  return <div className="home-dashboard" aria-busy={loading}>
    <div className="home-metrics">
      <section className="home-metric home-active">
        <h2>昨日活跃用户</h2>
        <HomeValue metric={kpis?.active_users} digits={0} />
        {change.direction !== 'unknown' && <span className="home-delta">{change.text}</span>}
        <div className="home-weekly">
          <span>近7天日均使用人数</span>
          <b>{formatNumber(average)}{average === null ? '' : ' 人'}</b>
        </div>
      </section>
      <section className="home-metric home-hours">
        <h2>昨日治疗时长</h2>
        <HomeValue metric={kpis?.treatment_hours} />
      </section>
      <section className="home-metric home-events">
        <h2>昨日设备上报事件</h2>
        <HomeValue metric={kpis?.reported_events} digits={0} />
      </section>
      <section className="home-metric home-ahi">
        <h2>{kpis?.avg_ahi?.label || '昨日设备上报平均 AHI'}</h2>
        <HomeValue metric={kpis?.avg_ahi} digits={2} />
      </section>
    </div>
    <div className="home-trends">
      <section className="home-trend">
        <div className="home-trend-heading">
          <h2>近7天 · 活跃度与治疗趋势</h2>
          <Segmented<ActivityMetric> aria-label="趋势指标" options={activityModes}
            value={activityMetric} onChange={setActivityMetric} size="small" />
        </div>
        {daily.length ? <Chart height={238} label={activityMetric === 'active_users' ? '近7天每日活跃人数' : '近7天每日治疗时长'}
          option={activityOption(daily, activityMetric)} /> : chartPlaceholder}
      </section>
      <section className="home-trend">
        <div className="home-trend-heading"><h2>近7天 · 设备上报事件</h2></div>
        {hasReportedEvents ? <Chart height={238} label="近7天每日设备上报事件"
          option={eventsOption(daily)} /> : daily.length
          ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无设备上报事件计数" />
          : chartPlaceholder}
      </section>
    </div>
  </div>;
}
