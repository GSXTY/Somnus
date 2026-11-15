import test from 'node:test';
import assert from 'node:assert/strict';
import { readAssistantEvents } from '../src/assistantProtocol.mjs';
import { assistantStatus, conversations, conversation, createConversation, renameConversation, deleteConversation, sendMessage, cancelConversation } from '../src/assistantApi.ts';

const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function stream(text, tiny = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    if (tiny) for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1)); else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream;charset=utf-8' } });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const summary = { id: 'saved', title: '统计口径', created_at: 1794182400, updated_at: 1794182400, message_count: 2 };
const partial = { id: 'answer', role: 'assistant', content: '保留的部分回答', status: 'cancelled', created_at: 1794182400 };

test('SSE parses single-byte UTF-8 chunks, CRLF, comments and ordered terminal events', async () => {
  const events = [], response = stream((': heartbeat\n\n' + event('start', { conversation_id: 'saved' }) + event('delta', { text: '中文🙂\n下一行' }) + event('done', { message: { ...partial, status: 'complete' } })).replaceAll('\n', '\r\n'), true);
  await readAssistantEvents(response, value => events.push(value));
  assert.deepEqual(events.map(value => value.type), ['start', 'delta', 'done']);
  assert.equal(events[1].data.text, '中文🙂\n下一行');
});

test('SSE accepts multi-line data but rejects truncated streams and malformed JSON', async () => {
  const received = [];
  await readAssistantEvents(stream('event: done\ndata: {"message":\ndata: {"content":"ok"}}\n\n'), value => received.push(value));
  assert.equal(received[0].data.message.content, 'ok');
  const fragments = [];
  await assert.rejects(readAssistantEvents(stream(event('delta', { text: '已收到的内容' })), value => fragments.push(value)), /连接中断/);
  assert.equal(fragments[0].data.text, '已收到的内容');
  await assert.rejects(readAssistantEvents(stream('event: done\ndata: invalid\n\n'), () => {}), /格式/);
});

test('cancelled and error terminal events preserve partial content and do not invent a complete answer', async () => {
  for (const [type, data] of [['cancelled', { message: partial }], ['error', { code: 'upstream_error', message: '模型失败', assistant_message: { ...partial, status: 'error' } }]]) {
    const received = []; await readAssistantEvents(stream(event(type, data)), value => received.push(value));
    assert.equal(received[0].type, type);
    const saved = received[0].data.assistant_message || received[0].data.message;
    assert.equal(saved.content, '保留的部分回答'); assert.notEqual(saved.status, 'complete');
  }
});

test('unconfigured status and provider errors remain explicit; empty input makes no request', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ configured: false, connection_status: 'not_configured', model: null, database_connected: false, capabilities: { chat: false, sql_execution: false }, message: '未配置' }); };
  assert.equal((await assistantStatus()).configured, false);
  await assert.rejects(sendMessage('saved', ' \n ', new AbortController().signal, () => {}), /请输入/); assert.equal(calls, 1);
  globalThis.fetch = async () => json({ error: { code: 'not_configured', message: '尚未配置模型' } }, 503);
  await assert.rejects(sendMessage('saved', '问题', new AbortController().signal, () => {}), /尚未配置模型/);
});

test('conversation history, create and rename use same-origin service and retain incomplete history', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/conversations') && !options.method) return json({ conversations: [summary] });
    if (url.endsWith('/saved')) return json({ conversation: summary, messages: [partial] });
    return json({ conversation: summary });
  };
  assert.equal((await conversations())[0].id, 'saved');
  assert.equal((await conversation('saved')).messages[0].status, 'cancelled');
  await createConversation(); await renameConversation('saved', ' 新名称 ');
  assert(requests.every(item => item.url.startsWith('/api/assistant/')));
  assert.equal(JSON.parse(requests.at(-1).options.body).title, '新名称');
  await assert.rejects(renameConversation('saved', '  '), /请输入/);
  await assert.rejects(renameConversation('saved', 'a'.repeat(81)), /80/);
});

test('send streams only typed content through backend, and cancel calls the conversation endpoint', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return url.endsWith('/cancel') ? json({ cancelled: true }) : stream(event('start', { conversation_id: 'saved' }) + event('delta', { text: '思路' }) + event('done', { message: { ...partial, content: '思路', status: 'complete' }, conversation: summary })); };
  const received = [], abort = new AbortController();
  await sendMessage('saved', ' 分析口径 ', abort.signal, value => received.push(value));
  assert.deepEqual(JSON.parse(requests[0].options.body), { content: '分析口径' });
  assert.equal(requests[0].options.signal, abort.signal); assert.equal(received.at(-1).type, 'done');
  await cancelConversation('saved'); assert.equal(requests.at(-1).url, '/api/assistant/conversations/saved/cancel');
  assert(requests.every(item => !/https?:/.test(item.url)), 'the browser never calls a model provider directly');
});

test('network aborts and invalid stream responses propagate without synthetic fallback', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(sendMessage('saved', '问题', new AbortController().signal, () => {}), error => error.name === 'AbortError');
  globalThis.fetch = async () => json({ answer: '不应当作流式回答' });
  await assert.rejects(sendMessage('saved', '问题', new AbortController().signal, () => {}), /流式/);
});


test('delete calls the soft-delete endpoint and rejects failed or mismatched acknowledgement', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; }); let sent;
  globalThis.fetch = async (url, options) => { sent = { url, options }; return json({ deleted: true, conversation_id: 'saved' }); };
  assert.equal((await deleteConversation('saved')).deleted, true);
  assert.equal(sent.url, '/api/assistant/conversations/saved/delete'); assert.deepEqual(JSON.parse(sent.options.body), {});
  globalThis.fetch = async () => json({ error: { code: 'conversation_busy', message: '生成中不可移除' } }, 409);
  await assert.rejects(deleteConversation('saved'), /生成中/);
  globalThis.fetch = async () => json({ deleted: true, conversation_id: 'other' });
  await assert.rejects(deleteConversation('saved'), /未确认/);
});

test('multimodal request permits pure image content and forwards only names and local image data', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; }); let body;
  globalThis.fetch = async (url, options) => { body = JSON.parse(options.body); return stream(event('done', { message: { ...partial, status: 'complete' } })); };
  const image = { name: 'synthetic.png', data_url: 'data:image/png;base64,AA==', mime: 'image/png', size: 1, width: 1, height: 1 };
  await sendMessage('saved', '', new AbortController().signal, () => {}, [image]);
  assert.deepEqual(body, { content: '', attachments: [{ name: image.name, data_url: image.data_url }] });
});
