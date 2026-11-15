import test from 'node:test';
import assert from 'node:assert/strict';
import { deepStatus, uploadAnalysisFile, createAnalysisTask, getAnalysisTask, cancelAnalysisTask, safeArtifactUrl, imageArtifact, activeTaskStates } from '../src/deepAnalysisApi.mjs';
import { readWorkspaceView, workspacePath, isStandardView } from '../src/workspaceNavigation.mjs';
import { commands } from '../src/glassLogic.mjs';

test('deep analysis is a separate in-shell route and command, preserving the waveform view route', () => {
  assert.equal(readWorkspaceView(new URL('http://localhost/#deep-analysis')), 'deep-analysis');
  assert.equal(readWorkspaceView(new URL('http://localhost/?view=deep-analysis')), 'deep-analysis');
  assert.equal(workspacePath('deep-analysis', 'http://localhost/?filter=YA70#analysis'), '/?filter=YA70#deep-analysis');
  assert.equal(isStandardView('deep-analysis'), false);
  assert.equal(commands.filter(item => item.key === 'deep-analysis').length, 1);
  assert.equal(readWorkspaceView(new URL('http://localhost/#analysis')), 'analysis');
});

test('status and blocked tasks remain explicit; no execution-ready fallback is invented', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/status') ? { configured: false, execution_ready: false, docker_available: false, image_ready: false } : { task: { id: 'blocked-test', status: 'blocked', error: 'Docker未就绪', answer: '', artifacts: [] } } };
  };
  const status = await deepStatus(); assert.equal(status.execution_ready, false);
  const task = await createAnalysisTask('file-test', ' 比较合成日报 ');
  assert.equal(task.status, 'blocked'); assert(!activeTaskStates.has(task.status));
  assert.equal(calls[1].url, '/api/deep-analysis/tasks');
  assert.deepEqual(JSON.parse(calls[1].options.body), { file_id: 'file-test', question: '比较合成日报' });
  assert(!calls.some(call => call.url.includes('/api/assistant')));
});

test('CSV upload is bounded to the selected local file; invalid input does not call transport', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ file: { id: 'selected', columns: ['userid'] } }) }; };
  await assert.rejects(uploadAnalysisFile({ name: 'bad.exe', size: 10 }), /CSV/); assert.equal(request, undefined);
  const selected = { name: '合成日报.csv', size: 80 };
  await uploadAnalysisFile(selected);
  assert.equal(request.options.body, selected);
  assert.equal(request.options.headers['X-Filename'], encodeURIComponent(selected.name));
  assert.equal(request.url, '/api/deep-analysis/files');
});

test('task polling, cancellation and failures never silently load a different task', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ task: { id: 'other', status: 'complete' } }) });
  await assert.rejects(getAnalysisTask('target'), /不匹配/);
  let init;
  globalThis.fetch = async (_url, options) => { init = options; return { ok: true, json: async () => ({ task: { id: 'target', status: 'cancelled' } }) }; };
  assert.equal((await cancelAnalysisTask('target')).status, 'cancelled'); assert.equal(init.method, 'POST');
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: '环境尚未就绪' } }) });
  await assert.rejects(deepStatus(), /环境尚未就绪/);
});

test('only same-origin controlled artifacts can be displayed or downloaded; HTML and SVG are not image previews', () => {
  const valid = '/api/deep-analysis/artifacts/result-1';
  assert.equal(safeArtifactUrl(valid), valid);
  for (const url of ['https://evil.example/a.png', '//evil/a', '/api/deep-analysis/artifacts/../secret', 'javascript:alert(1)', valid + '?file=secret']) assert.equal(safeArtifactUrl(url), null);
  assert(imageArtifact({ url: valid, mime: 'image/png' }));
  assert(!imageArtifact({ url: valid, mime: 'image/svg+xml' }));
  assert(!imageArtifact({ url: valid, mime: 'text/html' }));
});
