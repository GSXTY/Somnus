import type { EChartsCoreOption } from 'echarts/core';
import type { Dashboard, Metric, Waveform, Candidate, DataQuality } from './types';
import { candidateAreas, formatOffset } from './logic.mjs';

const blue = '#1e6fff', green = '#00a887', purple = '#8b7fc7';
const textStyle = { fontFamily: 'Inter, Microsoft YaHei, sans-serif', color: '#697d93', fontSize: 11 };
const axisLine = { lineStyle: { color: '#e5ecf3' } };
const splitLine = { lineStyle: { color: '#edf2f7' } };
const animation = { animationDuration: 0, animationDurationUpdate: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 };
export function sparkline(metric: Metric): EChartsCoreOption {
  return { ...animation, grid: { left: 0, right: 0, top: 4, bottom: 3 }, xAxis: { type: 'category', show: false, data: metric.trend.map((_, i) => i) }, yAxis: { type: 'value', show: false, min: 0 }, tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value ?? '—'} ${metric.unit}` }, series: [{ type: 'line', data: metric.trend, symbol: 'none', smooth: false, connectNulls: false, lineStyle: { color: blue, width: 2 }, areaStyle: { color: '#edf4ff' } }] };
}
export function activityOption(daily: Dashboard['daily']): EChartsCoreOption {
  return { ...animation, textStyle, tooltip: { trigger: 'axis' }, legend: { data: ['治疗时长（小时）', '活跃用户（人）'], bottom: 0, itemWidth: 12, itemHeight: 8, textStyle }, grid: { left: 46, right: 42, top: 28, bottom: 48 }, xAxis: { type: 'category', data: daily.map(d => d.date.slice(5)), axisLine, axisTick: { show: false } }, yAxis: [{ type: 'value', name: '小时', min: 0, splitLine, axisLabel: { color: '#697d93' } }, { type: 'value', name: '人', min: 0, splitLine: { show: false }, axisLabel: { color: '#697d93' } }], series: [{ name: '治疗时长（小时）', type: 'bar', data: daily.map(d => d.treatment_hours), barMaxWidth: 23, itemStyle: { color: blue, borderRadius: [4, 4, 0, 0] } }, { name: '活跃用户（人）', type: 'line', yAxisIndex: 1, data: daily.map(d => d.active_users), smooth: false, symbolSize: 5, lineStyle: { color: green, width: 2 }, itemStyle: { color: green } }] };
}
export function eventsOption(daily: Dashboard['daily']): EChartsCoreOption {
  return {
    ...animation,
    textStyle,
    tooltip: { trigger: 'axis' },
    grid: { left: 46, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: daily.map(d => d.date.slice(5)), axisLine, axisTick: { show: false } },
    yAxis: { name: '事件次数', type: 'value', min: 0, splitLine },
    series: [{
      type: 'line', name: '事件次数', data: daily.map(d => d.event_count), smooth: false,
      connectNulls: false, symbolSize: 4, itemStyle: { color: purple },
      markPoint: { symbolSize: 32, label: { fontSize: 10 }, data: [{ type: 'max', name: '最高' }, { type: 'min', name: '最低' }] },
    }],
  };
}
export function distributionOption(values: Dashboard['alert_distribution']): EChartsCoreOption {
  return { ...animation, tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle, itemWidth: 10 }, series: [{ type: 'pie', stillShowZeroSum: false, radius: ['45%', '67%'], center: ['50%', '42%'], label: { show: false }, data: values, color: ['#7196dc', '#efb96c', '#a49acd', '#7bbeb0'] }] };
}
export function waveformOption(waveform: Waveform, events: Candidate[] = [], compact = false): EChartsCoreOption {
  const channels = compact ? waveform.channels.slice(0, 2) : waveform.channels;
  const units = [...new Set(channels.map(channel => channel.unit))];
  return { ...animation, textStyle, tooltip: { trigger: 'axis', renderMode: 'richText' }, legend: { data: channels.map(c => `${c.label} (${c.unit})`), top: 0, textStyle, itemWidth: 12 }, grid: { left: compact ? 35 : 50, right: 35, top: 40, bottom: compact ? 25 : 58 }, xAxis: { type: 'value', min: 0, max: waveform.duration_seconds, axisLine, name: '相对时间', axisLabel: { formatter: (value: number) => compact ? `${Math.round(value)}s` : formatOffset(value), hideOverlap: true } }, yAxis: units.map((unit, index) => ({ type: 'value', name: unit, position: index % 2 ? 'right' : 'left', splitLine: index ? { show: false } : splitLine, axisLabel: { hideOverlap: true } })), dataZoom: compact ? [] : [{ type: 'inside', start: 0, end: 100 }, { type: 'slider', bottom: 6, height: 22, start: 0, end: 100 }], series: channels.map((channel, index) => ({ name: `${channel.label} (${channel.unit})`, type: 'line', yAxisIndex: units.indexOf(channel.unit), showSymbol: false, smooth: false, connectNulls: false, data: channel.points, lineStyle: { width: compact ? 1 : 1.5, color: [blue, green, purple][index % 3] }, ...(index === 0 && events.length ? { markArea: { silent: true, label: { show: false }, itemStyle: { color: 'rgba(239, 181, 91, 0.13)' }, data: candidateAreas(events) } } : {}) })) };
}

export function dataLossOption(quality?: DataQuality): EChartsCoreOption {
  const known = typeof quality?.expected_records === 'number' && quality.expected_records > 0 && typeof quality.loss_rate === 'number';
  return { ...animation, tooltip: known ? { trigger: 'item', renderMode: 'richText', valueFormatter: (value: number) => `${value.toLocaleString('zh-CN')} 条` } : { show: false }, series: [{ type: 'pie', silent: !known, radius: ['45%', '67%'], center: ['50%', '42%'], label: { show: false }, stillShowZeroSum: false, color: known ? ['#7196dc', '#efb96c'] : ['#edf1f6'], data: known ? [{ name: '已接收', value: quality!.received_records }, { name: '数据丢失', value: quality!.lost_records }] : [{ name: '未知覆盖情况', value: 1, itemStyle: { color: '#edf1f6' } }] }] };
}
