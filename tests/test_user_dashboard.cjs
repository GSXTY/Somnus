'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../page_design/dashboard.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../page_design/dashboard.js'), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this._text = ''; this.hidden = false; this.disabled = false; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Unsafe HTML insertion'); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; this._text = ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  focus() { this.focused = true; }
  fire(type) { return this.listeners[type]?.({preventDefault() {}}); }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const requests = [];
  vm.runInNewContext(script, {document: {getElementById(id) { assert.ok(elements[id], 'Missing element ' + id); return elements[id]; }, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag)}, window: {addEventListener() {}}, URLSearchParams, Intl, Date, fetch(url) { const pending = deferred(); requests.push({url, ...pending}); return pending.promise; }});
  return {elements, requests};
}
const payload = (demo = false, overrides = {}) => ({schema_version: 2, scope: 'users', source: {mode: demo ? 'demo' : 'unconfigured', connected: false}, metrics: {total_users: null, new_users: null, active_users: null, avg_daily_usage_minutes: null}, daily: [], users: [], warnings: [], ...overrides});
const respond = async (request, data) => { request.resolve({ok: true, json: async () => data}); await settle(); };
function findTag(el, tag) { return [...el.children.filter(child => child.tagName === tag), ...el.children.flatMap(child => findTag(child, tag))]; }
(async () => {
  const {elements: el, requests} = setup();
  assert.equal(requests.length, 1);
  let query = new URL(requests[0].url, 'http://local').searchParams;
  assert.equal(query.get('source'), 'live');
  assert.equal((Date.parse(query.get('end_date')) - Date.parse(query.get('start_date'))) / 86400000 + 1, 30);
  assert.equal(el['dashboard-content'].attrs['aria-busy'], 'true');
  await respond(requests[0], payload(false, {metrics: {total_users: 999}}));
  assert.equal(el['total-users'].textContent, '—', 'Unconfigured sources must never imply known metrics');
  assert.match(el['source-badge'].textContent, /未连接/);
  assert.equal(el['refresh'].disabled, false);
  el['source-toggle'].fire('click');
  assert.match(el['source-notice'].textContent, /演示模式/);
  const dangerous = '<img src=x onerror=alert(1)>';
  await respond(requests[1], payload(true, {metrics: {total_users: 0, new_users: 0, active_users: 0, avg_daily_usage_minutes: null}, daily: [{date: '2026-11-01', new_users: 0, avg_daily_usage_minutes: null}, {date: '2026-11-02', new_users: 2, avg_daily_usage_minutes: 0}, {date: '2026-11-03', new_users: 1, avg_daily_usage_minutes: null}], users: [{user_id: dangerous, display_name: dangerous, registered_at: dangerous, usage_minutes: 0, active_days: 0, avg_daily_usage_minutes: null, recordings_available: true}]}));
  assert.equal(el['total-users'].textContent, '0');
  assert.equal(el['avg-usage'].textContent, '—');
  assert.match(el['source-badge'].textContent, /演示.*合成/);
  assert.match(el['users-body'].textContent, /<img/);
  assert.match(el['users-body'].textContent, /记录待接入/);
  assert.equal(findTag(el['users-body'], 'a').length, 0);
  assert.equal(findTag(el['users-body'], 'button').length, 0);
  assert.equal(findTag(el['registration-chart'], 'svg').length, 1);
  assert.equal(findTag(el['usage-chart'], 'circle').length, 1, 'Null days are gaps, zero remains a plotted value');
  assert.equal(findTag(el['usage-chart'], 'polyline').length, 0, 'Missing days must not be bridged');
  el['range-7'].fire('click');
  el['range-30'].fire('click');
  const old = requests[2], latest = requests[3];
  await respond(latest, payload(true, {metrics: {total_users: 30}}));
  await respond(old, payload(true, {metrics: {total_users: 7}}));
  assert.equal(el['total-users'].textContent, '30');
  assert.match(el['users-empty'].textContent, /暂无用户/);
  assert.equal(el['users-table-wrap'].hidden, true);
  el['range-7'].fire('click');
  const lateJson = deferred();
  requests[4].resolve({ok: true, json: () => lateJson.promise}); await settle();
  el['source-toggle'].fire('click');
  await respond(requests[5], payload());
  lateJson.resolve(payload(true, {metrics: {total_users: 777}})); await settle();
  assert.equal(el['total-users'].textContent, '—', 'A late JSON body cannot overwrite the latest source');
  assert.match(el['source-badge'].textContent, /未连接/);
  el['range-custom'].fire('click'); assert.equal(el['start-date'].focused, true);
  el['start-date'].value = '2026-11-09'; el['end-date'].value = '2026-11-01'; el['date-form'].fire('submit');
  assert.equal(requests.length, 6); assert.match(el['error'].textContent, /有效日期/);
  el['start-date'].value = '2024-01-01'; el['end-date'].value = '2026-11-01'; el['date-form'].fire('submit');
  assert.equal(requests.length, 6);
  el['start-date'].value = '2026-02-30'; el['date-form'].fire('submit'); assert.equal(requests.length, 6);
  el['start-date'].value = '2026-11-01'; el['end-date'].value = '2026-11-09'; el['date-form'].fire('submit');
  query = new URL(requests[6].url, 'http://local').searchParams;
  assert.equal(query.get('start_date'), '2026-11-01');
  requests[6].reject(new Error('<script>network</script>')); await settle();
  assert.equal(el['error'].hidden, false); assert.match(el['error'].textContent, /<script>/);
  assert.equal(el['refresh'].disabled, false); assert.equal(el['dashboard-content'].attrs['aria-busy'], 'false');
  assert.equal(el['total-users'].textContent, '—');
  el['refresh'].fire('click'); requests[7].resolve({ok: false, status: 503}); await settle(); assert.match(el['error'].textContent, /503/);
  el['refresh'].fire('click'); await respond(requests[8], {schema_version: 1}); assert.match(el['error'].textContent, /格式或来源/);
  el['refresh'].fire('click'); await respond(requests[9], payload(true)); assert.match(el['error'].textContent, /格式或来源/);
  assert.match(html, /活跃用户日/); assert.match(html, /href="\/events"/); assert.match(html, /ui\/bootstrap.min.css/);
  console.log('PASS: user dashboard live/demo separation, ranges, null/zero, SVG gaps, safe text, empty/error/loading states and stale request protection');
})().catch(error => { console.error(error); process.exitCode = 1; });
