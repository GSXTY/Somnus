'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const number = value => finite(value) ? value.toLocaleString('zh-CN', {maximumFractionDigits: 1}) : '—';
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  };
  const svgNode = (tag, attrs, text) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = String(text);
    return el;
  };
  let source = 'live', requestId = 0;
  function today() {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function selectPreset(days) {
    const end = today(), start = new Date(`${end}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    $('start-date').value = start.toISOString().slice(0, 10);
    $('end-date').value = end;
    markRange(days);
  }
  function markRange(days) {
    for (const value of [7, 30, 'custom']) $('range-' + value).setAttribute('aria-pressed', String(value === days));
  }
  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
  }
  function resetDisplay(message) {
    for (const id of ['total-users', 'new-users', 'active-users', 'avg-usage']) $(id).textContent = '—';
    for (const id of ['registration-chart', 'usage-chart']) $(id).replaceChildren(node('div', 'empty', message));
    $('users-body').replaceChildren();
    $('users-table-wrap').hidden = true;
    $('users-empty').hidden = false;
    $('users-empty').textContent = message;
    $('user-count').textContent = '— 位用户';
  }
  function renderChart(id, daily, key, label, unit) {
    const container = $(id); container.replaceChildren();
    const values = daily.map(item => finite(item[key]) ? item[key] : null);
    if (!values.some(value => value !== null)) {
      container.append(node('div', 'empty', daily.length ? '所选范围无有效统计值；无活动日期不记为零。' : '所选范围暂无趋势数据。'));
      return;
    }
    const width = 640, height = 240, left = 55, right = 20, top = 20, bottom = 42;
    const max = Math.max(1, ...values.filter(value => value !== null));
    const x = index => left + (daily.length === 1 ? .5 : index / (daily.length - 1)) * (width - left - right);
    const y = value => height - bottom - value / max * (height - top - bottom);
    const svg = svgNode('svg', {viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label + '，横轴为上海日期，纵轴单位为' + unit});
    svg.append(svgNode('title', {}, label + '（' + unit + '）'));
    for (let tick = 0; tick <= 4; tick++) {
      const value = max * tick / 4, py = y(value);
      svg.append(svgNode('line', {x1: left, y1: py, x2: width - right, y2: py, class: 'chart-grid'}), svgNode('text', {x: left - 10, y: py + 4, 'text-anchor': 'end', class: 'chart-label'}, number(value)));
    }
    let segment = [];
    const flush = () => { if (segment.length > 1) svg.append(svgNode('polyline', {points: segment.join(' '), class: 'chart-line'})); segment = []; };
    values.forEach((value, index) => { if (value === null) flush(); else segment.push(`${x(index)},${y(value)}`); }); flush();
    values.forEach((value, index) => {
      if (value === null) return;
      const circle = svgNode('circle', {cx: x(index), cy: y(value), r: daily.length > 90 ? 2 : 3, class: 'chart-point'});
      circle.append(svgNode('title', {}, `${daily[index].date}：${number(value)} ${unit}`)); svg.append(circle);
    });
    const indices = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])];
    for (const index of indices) svg.append(svgNode('text', {x: x(index), y: height - 15, 'text-anchor': index === 0 ? 'start' : index === daily.length - 1 ? 'end' : 'middle', class: 'chart-label'}, daily[index].date));
    container.append(svg);
    const details = node('details', 'chart-data'), summary = node('summary', '', '查看每日数值'); details.append(summary);
    const list = node('ul', '');
    daily.forEach((item, index) => list.append(node('li', '', `${item.date}：${number(values[index])}${values[index] === null ? '（暂无有效值）' : ' ' + unit}`)));
    details.append(list); container.append(details);
  }
  function render(data) {
    const demo = data.source.mode === 'demo';
    const available = demo || data.source.connected === true;
    $('source-badge').textContent = demo ? '演示模式 · 合成数据' : available ? '已连接用户数据源' : '未连接数据库';
    $('source-badge').className = demo ? 'badge demo-badge' : 'badge';
    $('source-notice').className = demo ? 'source-notice demo-notice' : 'source-notice';
    const warnings = Array.isArray(data.warnings) ? data.warnings.filter(value => typeof value === 'string').join(' ') : '';
    const notice = demo ? '演示模式：以下用户、指标与趋势全部为合成数据，不代表真实运营情况。' : available ? '当前展示已连接用户数据源的统计。' : '尚未连接用户数据库，指标暂不可用。可切换演示模式查看合成数据。';
    $('source-notice').textContent = notice + (warnings ? ' ' + warnings : '');
    if (!available) { resetDisplay('尚未连接用户数据库。'); return; }
    const metrics = data.metrics || {};
    for (const [id, key] of [['total-users', 'total_users'], ['new-users', 'new_users'], ['active-users', 'active_users'], ['avg-usage', 'avg_daily_usage_minutes']]) $(id).textContent = number(metrics[key]);
    const daily = Array.isArray(data.daily) ? data.daily.filter(item => item && typeof item.date === 'string').slice().sort((a, b) => a.date.localeCompare(b.date)) : [];
    renderChart('registration-chart', daily, 'new_users', '每日注册趋势', '人');
    renderChart('usage-chart', daily, 'avg_daily_usage_minutes', '每日日均使用趋势', '分钟');
    const users = Array.isArray(data.users) ? data.users.filter(item => item && typeof item === 'object') : [];
    $('user-count').textContent = `${users.length.toLocaleString('zh-CN')} 位用户`;
    $('users-body').replaceChildren();
    $('users-empty').hidden = users.length > 0;
    $('users-empty').textContent = '所选范围暂无用户汇总。';
    $('users-table-wrap').hidden = !users.length;
    for (const user of users) {
      const row = node('tr', ''), identity = node('td', '');
      identity.append(node('strong', 'user-name', user.display_name || user.user_id || '未命名用户'), node('small', 'user-id', user.user_id || '—'));
      row.append(identity);
      for (const value of [user.registered_at || '—', number(user.usage_minutes), number(user.active_days), number(user.avg_daily_usage_minutes)]) row.append(node('td', '', value));
      const record = node('td', ''); record.append(node('span', 'pill', '记录待接入')); row.append(record);
      $('users-body').append(row);
    }
  }
  async function refresh() {
    const id = ++requestId, requestedSource = source;
    const start = $('start-date').value, end = $('end-date').value;
    const first = parseDate(start), last = parseDate(end);
    $('error').hidden = true;
    if (!Number.isFinite(first) || !Number.isFinite(last) || first > last || (last - first) / 86400000 + 1 > 366) {
      $('error').textContent = '请选择有效日期：结束日期不能早于开始日期，范围最多 366 天。'; $('error').hidden = false;
      $('refresh').disabled = false; $('dashboard-content').setAttribute('aria-busy', 'false');
      $('load-status').textContent = '日期范围未应用。'; return;
    }
    $('refresh').disabled = true; $('dashboard-content').setAttribute('aria-busy', 'true');
    $('load-status').textContent = `正在读取 ${start} 至 ${end} 的${requestedSource === 'demo' ? '演示' : '用户'}统计…`;
    $('source-badge').textContent = requestedSource === 'demo' ? '演示模式 · 正在加载' : '用户数据源 · 正在检查';
    $('source-notice').className = requestedSource === 'demo' ? 'source-notice demo-notice' : 'source-notice';
    $('source-notice').textContent = requestedSource === 'demo' ? '演示模式：正在加载合成数据，不代表真实用户。' : '正在检查用户数据源连接状态。';
    resetDisplay('正在加载所选范围…');
    try {
      const params = new URLSearchParams({source: requestedSource, start_date: start, end_date: end});
      const response = await fetch('/api/dashboard?' + params, {cache: 'no-store'});
      if (id !== requestId) return;
      if (!response.ok) throw new Error(`服务返回 ${response.status}`);
      const data = await response.json();
      if (id !== requestId) return;
      if (!data || data.schema_version !== 2 || data.scope !== 'users' || !data.source || (requestedSource === 'demo' ? data.source.mode !== 'demo' : data.source.mode === 'demo')) throw new Error('用户统计数据格式或来源不匹配');
      render(data);
      $('load-status').textContent = `${start} 至 ${end} · Asia/Shanghai · 含首尾日期 · 更新于 ${new Date().toLocaleTimeString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}`;
    } catch (error) {
      if (id !== requestId) return;
      resetDisplay('数据读取失败，请重试。');
      $('error').textContent = `暂时无法读取用户统计。${error.message || ''} 请点击“刷新数据”重试。`; $('error').hidden = false;
      $('load-status').textContent = '当前范围未取得数据。';
      $('source-badge').textContent = requestedSource === 'demo' ? '演示模式 · 读取失败' : '用户数据源 · 读取失败';
      $('source-notice').textContent = requestedSource === 'demo' ? '演示模式：合成数据加载失败，当前没有可展示的统计。' : '未取得用户数据源状态，当前没有可展示的统计。';
    } finally {
      if (id === requestId) { $('refresh').disabled = false; $('dashboard-content').setAttribute('aria-busy', 'false'); }
    }
  }
  for (const days of [7, 30]) $('range-' + days).addEventListener('click', () => { selectPreset(days); refresh(); });
  $('range-custom').addEventListener('click', () => { markRange('custom'); $('start-date').focus(); });
  for (const id of ['start-date', 'end-date']) $(id).addEventListener('change', () => markRange('custom'));
  $('date-form').addEventListener('submit', event => { event.preventDefault(); markRange('custom'); refresh(); });
  $('source-toggle').addEventListener('click', () => { source = source === 'live' ? 'demo' : 'live'; $('source-toggle').textContent = source === 'demo' ? '返回真实数据源' : '查看演示数据'; $('source-toggle').setAttribute('aria-pressed', String(source === 'demo')); refresh(); });
  $('refresh').addEventListener('click', refresh);
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  selectPreset(30); refresh();
})();
