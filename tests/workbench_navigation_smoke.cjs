/* Read-only integration check against the unified launcher host. */
const assert = require('node:assert/strict');

async function main() {
  const base = new URL(process.argv[2] || 'http://127.0.0.1:8765/');
  const get = async path => {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin, 'navigation/resources must remain on the unified host');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, `${url.pathname} must load`);
    return { text: await response.text(), type: response.headers.get('content-type') || '' };
  };
  const home = await get('/');
  assert.match(home.type, /text\/html/);
  assert.match(home.text, /id="root"/);
  const assets = [...home.text.matchAll(/(?:src|href)="(\/workbench-assets\/[^\"]+)"/g)].map(match => match[1]);
  assert(assets.length >= 2, 'the production React shell must reference built local resources');
  const chunks = await Promise.all(assets.map(get));
  const scripts = chunks.filter(chunk => /javascript/.test(chunk.type)).map(chunk => chunk.text).join('\n');
  assert(scripts.includes('数据分析'), 'built workbench must expose the renamed analysis entry');
  assert(!scripts.includes('event-tool-entry'), 'the homepage detection quick card must be removed');
  assert(scripts.includes('数据丢失率'), 'data completeness must replace the alert-distribution card');
  assert(!scripts.includes('模拟无严重告警'), 'the replaced card must have no alert-scenario switch');
  assert.match(scripts, /href:["']#analysis["']/);
  assert(scripts.includes('/events?embedded=1'), 'analysis must embed the existing same-origin module');
  assert(!/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/events/.test(scripts), 'no fixed preview-port detection link');
  assert(scripts.includes('AI 数据助手'), 'the assistant must have a real workspace entry');
  const modelStatus = JSON.parse((await get('/api/assistant/status')).text);
  assert.equal(typeof modelStatus.configured, 'boolean');
  assert.equal(modelStatus.database_connected, false);
  const chatHistory = JSON.parse((await get('/api/assistant/conversations')).text);
  assert(Array.isArray(chatHistory.conversations), 'conversation history must be readable without a configured provider');
  const events = await get('/events');
  assert.match(events.type, /text\/html/);
  assert.match(events.text, /<option value="dynamic_baseline_v3" selected>/);
  assert.match(events.text, /<option value="patient_flow_v4">/);

  assert.match(events.text, /<a href="\/"[^>]*>← 返回主工作台<\/a>/);
  assert(events.text.includes('暂停与低通气筛查结果为待人工复核的工程候选'));
  assert(events.text.includes('events-global-header'), 'legacy analysis route retains its compatible shell');
  assert(events.text.includes('<h1>数据分析</h1>'));
  const embedded = await get('/events?embedded=1');
  assert.match(embedded.type, /text\/html/);
  assert(embedded.text.includes('id="file"'), 'embedded mode must retain CSV controls');
  const quality = JSON.parse((await get('/api/workbench?source=demo&model=all')).text).data_quality;
  assert.equal(quality.expected_records, quality.received_records + quality.lost_records);
  assert.equal(quality.loss_rate, quality.lost_records / quality.expected_records * 100);
  const unknown = JSON.parse((await get('/api/workbench?source=live&model=all')).text).data_quality;
  for (const key of ['expected_records', 'received_records', 'lost_records', 'loss_rate']) assert.equal(unknown[key], null);
  for (const path of ['/viewer.js', '/annotation-model.js', '/dashboard.css', '/ui/events.css']) await get(path);
  console.log(`PASS: unified ${base.origin} serves built workbench, visible same-origin detection entry, v3 default, optional v4, return link and all local resources`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
