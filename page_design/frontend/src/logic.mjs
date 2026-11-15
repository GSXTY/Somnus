export const numeric = value => typeof value === 'number' && Number.isFinite(value);
export const formatNumber = (value, digits = 1) => numeric(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
export function comparison(value, previous) {
  if (!numeric(value) || !numeric(previous)) return { text: '环比 —', direction: 'unknown' };
  if (previous === 0) return { text: value === 0 ? '与前日持平' : '前日为 0', direction: value === 0 ? 'flat' : 'up' };
  const change = (value - previous) / Math.abs(previous) * 100;
  return { text: `${change > 0 ? '+' : ''}${formatNumber(change)}% 较前日`, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat' };
}
export function filterUsers(users, priority, state) {
  return users.filter(user => (priority === 'all' || user.priority === priority) && (state === 'all' || user.state === state));
}
export function knownMean(values) {
  const valid = values.filter(numeric);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}
export function criticalAlerts(alerts) { return alerts.filter(alert => alert.severity === 'critical').slice(0, 3); }
export function scenarioDistribution(alerts) {
  const labels = { upload_gap: '数据上报', flow_signal: '信号复核', leak_hint: '漏气字段', review_pending: '复核待办' };
  const counts = new Map();
  for (const alert of alerts.filter(item => item.severity !== 'critical')) counts.set(alert.type, (counts.get(alert.type) || 0) + 1);
  return [...counts.entries()].map(([type, value]) => ({ name: labels[type] || type, value }));
}
export function formatOffset(seconds) {
  if (!numeric(seconds)) return '—';
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function candidateAreas(events) {
  return events.filter(event => numeric(event.start) && numeric(event.end) && event.start >= 0 && event.end >= event.start)
    .map(event => [{ name: event.type, xAxis: event.start }, { xAxis: event.end }]);
}
// Responses may finish after abort; only the current generation can commit.
export function createLatestGate() {
  let generation = 0;
  return { next: () => ++generation, current: token => token === generation, invalidate: () => ++generation };
}
export function validateDataQuality(quality, source) {
  if (!quality || quality.unit !== 'records' || typeof quality.basis !== 'string' || !quality.basis.trim()) throw new Error('数据丢失率口径不完整');
  const values = ['expected_records', 'received_records', 'lost_records', 'loss_rate'].map(key => quality[key]);
  if (values.every(value => value === null)) return quality;
  if (source === 'live') throw new Error('未连接来源返回了数据丢失率，请核对数据服务');
  const [expected, received, lost, rate] = values;
  if (![expected, received, lost].every(value => Number.isSafeInteger(value) && value >= 0) || expected !== received + lost) throw new Error('数据丢失计数不一致');
  if (expected === 0 ? rate !== null : !numeric(rate) || rate < 0 || rate > 100 || Math.abs(rate - lost / expected * 100) > 0.00501) throw new Error('数据丢失率与记录计数不一致');
  return quality;
}
export function validateDashboard(data, source) {
  if (!data || data.schema_version !== 1 || !data.source || !data.kpis || !data.period || !data.fleet || !Array.isArray(data.daily) || !Array.isArray(data.users) || !Array.isArray(data.alerts) || !Array.isArray(data.insights) || !Array.isArray(data.constraints) || !Array.isArray(data.alert_distribution)) throw new Error('工作台数据格式不符合约定');
  const mode = source === 'demo' ? 'demo' : 'live';
  if (data.source.mode !== mode) throw new Error('数据来源不匹配，已停止展示');
  if (mode === 'demo' && data.source.connected !== false) throw new Error('演示来源不应标记为已连接');
  if (mode === 'live' && data.source.connected !== true) throw new Error('真实数据源未连接，请检查只读数据库配置');
  const required = mode === 'demo'
    ? ['active_users', 'treatment_hours', 'reported_events', 'online_rate']
    : ['active_users', 'treatment_hours', 'reported_events', 'avg_ahi'];
  for (const key of required) {
    if (!data.kpis[key] || !Array.isArray(data.kpis[key].trend)) throw new Error('指标字段不完整');
  }
  validateDataQuality(data.data_quality, source);
  return data;
}
export function reportText(data, model) {
  const metricLines = Object.entries(data.kpis).filter(([key]) => key !== 'online_rate').map(([, metric]) => `${metric.label}: ${formatNumber(metric.value)} ${metric.unit}；前日 ${formatNumber(metric.previous)}`);
  return ['Somnus 数据巡检 · 本地报告', `来源：${data.source.label}（${data.source.mode}）`, `生成时间：${data.generated_at}`, `型号筛选：${model}`, `指标日期：${data.period.kpi_date}`, `趋势范围：${data.period.start_date} 至 ${data.period.end_date} ${data.period.time_zone}`, `日期依据：${data.period.date_basis}`, '', ...metricLines, '', '数据质量', `数据丢失率: ${formatNumber(data.data_quality.loss_rate, 2)}${numeric(data.data_quality.loss_rate) ? '%' : ''}`, `应上报 ${formatNumber(data.data_quality.expected_records, 0)} 条；已接收 ${formatNumber(data.data_quality.received_records, 0)} 条；数据丢失 ${formatNumber(data.data_quality.lost_records, 0)} 条`, `口径: ${data.data_quality.basis}`, '', '规则洞察（非大模型运行）', ...data.insights.flatMap(item => [item.title, item.text, ...item.evidence.map(text => '证据：' + text)]), '', '限制', ...data.constraints, '', '仅本地下载；未外发。本报告不提供临床诊断或调压建议。', '', '完整快照（追溯与核对）', JSON.stringify(data, null, 2)].join('\n');
}
