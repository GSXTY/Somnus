import { useState } from 'react';
import { Empty, Segmented } from 'antd';
import { Chart } from './Chart';
import { activityOption, eventsOption } from './chartOptions';
import { comparison, formatNumber, numeric } from './logic.mjs';
import type { Dashboard, Metric } from './types';
import './home-dashboard.css';

type ActivityMetric = 'active_users' | 'treatment_hours';
const activityModes = [
  { value: 'active_users', label: '活跃人数' },
  { value: 'treatment_hours', label: '治疗时长' },
] satisfies { value: ActivityMetric; label: string }[];

function HomeValue({ metric, digits = 1 }: { metric?: Metric; digits?: number }) {
  return <strong className="home-value">
    {formatNumber(metric?.value, digits)}
    {numeric(metric?.value) && <small>{metric?.unit}</small>}
  </strong>;
}

export function HomeDashboard({ data, loading }: { data: Dashboard | null; loading: boolean }) {
  const [activityMetric, setActivityMetric] = useState<ActivityMetric>('active_users');
  const kpis = data?.kpis;
  const daily = data?.daily ?? [];
  const average = daily.length === 7 && daily.every(day => numeric(day.active_users))
    ? daily.reduce((total, day) => total + day.active_users, 0) / 7 : null;
  const change = comparison(kpis?.active_users.value, kpis?.active_users.previous);
  const chartPlaceholder = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
    description={loading ? '趋势加载中' : '暂无趋势数据'} />;

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
        <h2>昨日设备上报平均 AHI</h2>
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
        {daily.length ? <Chart height={238} label="近7天每日设备上报事件"
          option={eventsOption(daily)} /> : chartPlaceholder}
      </section>
    </div>
  </div>;
}
