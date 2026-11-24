const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'somnus-native-tools-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let browser, python, server, socket;
  try {
    const requireFrontend = createRequire(path.join(root, 'page_design/frontend/package.json'));
    const { build } = createRequire(requireFrontend.resolve('vite/package.json'))('esbuild');
    const { waveformBuildPlugin } = await import(pathToFileURL(path.join(root, 'desktop/dsh_next/client/waveform-build.mjs')));
    const fixture = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import NativeTools from './plugins-ui/tools-probe/src/NativeTools';
      window.failNext = false; window.calls = []; window.errors = [];
      window.addEventListener('error', event => errors.push(event.message));
      window.addEventListener('unhandledrejection', event => errors.push(event.reason?.stack || String(event.reason)));
      window.somnusApi = {
        origin: async () => location.origin,
        request: async (path, init) => {
          calls.push(path);
          if (window.failNext) { window.failNext = false; return { status: 503, body: new TextEncoder().encode('{"error":"Fixture failure"}').buffer }; }
          const response = await fetch(path, init);
          return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.arrayBuffer() };
        },
      };
      let mount;
      window.remount = () => { mount = createRoot(document.getElementById('root')); mount.render(<NativeTools />); };
      window.unmount = () => mount.unmount();
      window.remount();
    `;
    await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: root }, bundle: true,
      jsx: 'automatic', outfile: path.join(directory, 'fixture.js'),
      nodePaths: [path.join(root, 'page_design/frontend/node_modules')],
      plugins: [waveformBuildPlugin, { name: 'scoped-styles', setup(builder) {
        builder.onLoad({ filter: /(?:sql-query|deep-analysis|deep-analysis-report)\.css$/ }, ({ path: file }) => ({
          contents: '.somnus-native-tools {\n' + fs.readFileSync(file, 'utf8') + '\n}', loader: 'css',
        }));
      } }],
    });
    const tokens = JSON.parse(fs.readFileSync(path.join(root, 'desktop/dsh_next/branding.json'))).themeTokens;
    const css = ['light', 'dark'].map(mode => (mode === 'light' ? ':root' : 'body[data-ds-dark-theme]') + '{' +
      Object.entries(tokens).map(([key, value]) => key + ':' + value[mode]).join(';') + '}').join('');
    fs.writeFileSync(path.join(directory, 'index.html'), `<style>${css}html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>`);
    const csv = ['timestamp,流量', ...Array.from({ length: 1500 }, (_, index) =>
      new Date(Date.UTC(2026, 0, 1) + index * 40).toISOString() + ',' + (Math.sin(index / 20) * 20).toFixed(3))].join('\n');
    fs.writeFileSync(path.join(directory, 'wave.csv'), csv);
    const pythonSource = `
import os,socket
from pathlib import Path
import uvicorn
from server.app import create_app
folder=Path(os.environ['SOMNUS_TEST_DIRECTORY'])/'backend'
app=create_app(data_dir=folder,session_mode='isolated',mcp_management=False)
sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen()
print(sock.getsockname()[1],flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='error')).run(sockets=[sock])
`;
    python = spawn('python', ['-B', '-u', '-c', pythonSource], { cwd: root, windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', SOMNUS_TEST_DIRECTORY: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    let pythonErrors = '';
    python.stderr.on('data', value => { pythonErrors += value; });
    const backendPort = await new Promise((resolve, reject) => {
      python.stdout.once('data', value => resolve(String(value).trim()));
      python.once('exit', code => reject(Error('Backend ' + code + ': ' + pythonErrors)));
    });
    const tasks = new Map();
    server = http.createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        let result;
        if (pathname === '/api/plugins') result = { plugins: [{ key: 'respiratory', workspace_entries: [{ id: 'analysis', title: '波形分析', slot: 'sidebar', mode: 'embedded', path: '/events', access: 'selected-record' }] }] };
        else if (pathname === '/api/remote-data/status') result = { mode: 'local', url: null };
        else if (pathname === '/api/sql/schema') result = { database: 'fixture', driver: 'fixture', max_rows: 20, tables: [{ table: 'fixture', columns: [{ name: 'value', type: 'int' }] }] };
        else if (pathname.startsWith('/api/sql/')) result = { sql: 'SELECT 1 AS value', columns: ['value'], rows: [[1]], elapsed_ms: 1, truncated: false };
        else if (pathname === '/api/deep-analysis/status') result = { configured: true, execution_ready: true, docker_available: true, image_ready: true, model: 'fixture-only', limits: { max_file_bytes: 1024 * 1024 } };
        else if (pathname === '/api/deep-analysis/files') result = { file: { id: 'fixture-file', name: 'wave.csv', size: body.length, columns: ['timestamp', 'flow'], row_count: 1500, sha256: 'fixture' } };
        else if (pathname === '/api/deep-analysis/tasks' && request.method === 'POST') {
          const value = JSON.parse(body); const id = (tasks.size ? 'b' : 'a').repeat(32);
          const task = { id, file_id: value.file_id, question: value.question, status: 'running', updated_at: Date.now(), answer: '', steps: [], artifacts: [] };
          tasks.set(id, task); result = { task };
        } else if (pathname === '/api/deep-analysis/tasks') result = { tasks: [...tasks.values()] };
        else if (pathname.startsWith('/api/deep-analysis/tasks/')) {
          const id = pathname.split('/')[4]; const task = tasks.get(id);
          if (pathname.endsWith('/cancel')) task.status = 'cancelled';
          else if (task.question === 'finish fixture') { task.status = 'complete'; task.answer = '**Fixture completed**'; }
          result = { task };
        } else if (pathname === '/api/deep-analysis/sample.csv') { response.end(csv); return; }
        else if (pathname.startsWith('/api/')) {
          const headers = { ...request.headers }; delete headers.host; delete headers.origin; delete headers.referer;
          const upstream = await fetch('http://127.0.0.1:' + backendPort + request.url, { method: request.method, headers,
            ...(body.length ? { body } : {}) });
          response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
          response.end(Buffer.from(await upstream.arrayBuffer())); return;
        } else {
          const file = pathname === '/' ? 'index.html' : pathname.slice(1);
          response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
          response.end(fs.readFileSync(path.join(directory, file))); return;
        }
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + path.join(directory, 'profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = fs.readFileSync(path.join(directory, 'profile/DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {}
      await pause(100);
    }
    assert(port, 'Chrome must start');
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    const pending = new Map(); let sequence = 0;
    socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id) {
      const action = pending.get(value.id); pending.delete(value.id);
      value.error ? action.reject(Error(JSON.stringify(value.error))) : action.resolve(value.result);
    } });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    const check = async (expression, message) => assert(await evaluate(expression), message + ': ' + await evaluate('document.body.textContent.slice(-1600)'));
    const click = async (label, scope = 'document') => {
      await evaluate(`(()=>{const button=[...${scope}.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing '+${JSON.stringify(label)});button.click()})()`);
      await pause(250);
    };
    const fill = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' }); await pause(1600);
    await check('document.querySelectorAll(".somnus-tools-list button").length===3', 'Separate tool entries');
    await evaluate('document.querySelectorAll(".somnus-tools-list button")[2].click()'); await pause(500);
    await fill('#sql-question', 'fixture question'); await click('生成并查询');
    await check('document.querySelector(".sql-editor").value.includes("SELECT 1")', 'SQL generation');
    await click('执行 SQL'); await check('document.querySelector(".sql-result").textContent.includes("value")', 'SQL result');
    await click('返回工具列表'); await evaluate('document.querySelectorAll(".somnus-tools-list button")[1].click()'); await pause(500);
    const documentNode = await send('DOM.getDocument');
    const fileInput = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '.deep-file-box input' });
    await send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [path.join(directory, 'wave.csv')] }); await pause(400);
    await fill('#deep-question', 'cancel fixture'); await click('开始深度分析');
    await click('取消任务');
    await fill('#deep-question', 'finish fixture'); await click('开始深度分析'); await pause(1800);
    await check('document.querySelector(".deep-answer").textContent.includes("Fixture completed")', 'Task polling');
    await click('返回工具列表'); await evaluate('document.querySelectorAll(".somnus-tools-list button")[0].click()'); await pause(700);
    await check('!document.querySelector("iframe")', 'No iframe');
    await evaluate('window.waveRoot=document.querySelector(".somnus-native-waveform").shadowRoot');
    await check('!!waveRoot.querySelector("#file")', 'Waveform mounted');
    await evaluate(`(()=>{const input=waveRoot.querySelector('#file');const files=new DataTransfer();files.items.add(new File([${JSON.stringify(csv)}],'wave.csv',{type:'text/csv'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await pause(2400);
    assert(await evaluate('waveRoot.querySelectorAll("#plots canvas").length>0&&!waveRoot.querySelector("#error").textContent'),
      'Waveform: ' + await evaluate('JSON.stringify({error:waveRoot.querySelector("#error").textContent,status:waveRoot.querySelector("#status").textContent,errors:window.errors,calls:window.calls.slice(-10)})'));
    const range = await evaluate('waveRoot.querySelector("#range").textContent');
    await evaluate('waveRoot.querySelector("#in").click()'); await pause(400);
    assert.notEqual(await evaluate('waveRoot.querySelector("#range").textContent'), range, 'Zoom must change range');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(directory, 'downloads') });
    await evaluate('waveRoot.querySelector("#scan-all").click()');
    for (let attempt = 0; attempt < 40; attempt++) {
      await pause(200);
      if (await evaluate('!waveRoot.querySelector("#scan-all").disabled')) break;
    }
    assert.equal(await evaluate('waveRoot.querySelector("#error").textContent'), '', 'Detection must complete');
    await evaluate('waveRoot.querySelector("#export-events-csv").click()'); await pause(400);
    assert(fs.readFileSync(path.join(directory, 'downloads/wave.events.csv'), 'utf8').includes('"id"'), 'Export must download the event CSV');
    await click('返回工具列表'); await evaluate('document.querySelectorAll(".somnus-tools-list button")[2].click()'); await pause(100);
    await check('document.querySelector("#sql-question").value==="fixture question"', 'SQL draft retained');
    await evaluate('window.unmount();window.remount()'); await pause(600);
    await check('document.querySelector("#sql-question").value==="fixture question"', 'Main-panel remount retains draft');
    const light = await evaluate('getComputedStyle(document.querySelector(".somnus-native-tools")).backgroundColor');
    await evaluate('document.body.setAttribute("data-ds-dark-theme", "")'); await pause(200);
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".somnus-native-tools")).backgroundColor'), light);
    for (const width of [1200, 440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }); await pause(100);
      await check('(()=>{const node=document.querySelector(".somnus-native-tools");return node.scrollWidth<=node.clientWidth+1})()', 'Responsive tools ' + width);
    }
    assert.deepEqual(await evaluate('window.errors'), [], 'No browser errors');
    console.log('PASS native tools: SQL, upload, cancellation, polling, real Python waveform upload/zoom, retained drafts, theme, responsive layout, no iframe.');
    console.log('SQL and deep execution used fixtures; waveform used the real isolated Python service.');
  } finally {
    socket?.close(); browser?.kill(); python?.kill(); server?.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
