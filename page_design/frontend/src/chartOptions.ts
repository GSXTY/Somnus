import type { EChartsCoreOption } from 'echarts/core';
import type { Dashboard, Waveform, Candidate, DataQuality } from './types';
import { candidateAreas, formatOffset } from './logic.mjs';

const blue = '#1e6fff', green = '#00a887', purple = '#8b7fc7';
const textStyle = { fontFamily: 'Inter, Microsoft YaHei, sans-serif', color: '#697d93', fontSize: 11 };
const axisLine = { lineStyle: { color: '#e5ecf3' } };
const splitLine = { lineStyle: { color: '#edf2f7' } };
const animation = { animationDuration: 0, animationDurationUpdate: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 };
function dailyBars(daily: Dashboard['daily'], key: 'active_users' | 'treatment_hours' | 'event_count',
  label: string, unit: string, color: string): EChartsCoreOption {
  return {
    ...animation,
    textStyle,
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 12, top: 26, bottom: 4, containLabel: true },
    xAxis: { type: 'category', data: daily.map(d => d.date.slice(5)), axisLine, axisTick: { show: false } },
    yAxis: { name: unit, type: 'value', min: 0, splitLine },
    series: [{
      type: 'bar', name: label, data: daily.map(day => day[key]), barMaxWidth: 30,
      itemStyle: { color, borderRadius: [5, 5, 0, 0] },
    }],
  };
}
export function activityOption(daily: Dashboard['daily'], key: 'active_users' | 'treatment_hours'): EChartsCoreOption {
  return key === 'active_users'
    ? dailyBars(daily, key, '活跃人数', '人', '#287c6d')
    : dailyBars(daily, key, '治疗时长', '小时', '#287c6d');
}
export function eventsOption(daily: Dashboard['daily']): EChartsCoreOption {
  return dailyBars(daily, 'event_count', '设备上报事件', '次', purple);
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
