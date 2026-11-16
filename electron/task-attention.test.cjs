const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { registerTaskAttention } = require('./task-attention.cjs');

const origin = 'http://127.0.0.1:43189';
const conversation = 'a'.repeat(32);
const reply = 'b'.repeat(32);
const task = 'c'.repeat(32);

function windowHarness({ status = 'complete', supportsNotification = true, allowsNotification } = {}) {
  const handlers = new Map();
  const notices = [], flashes = [], opens = [], requests = [];
  const window = Object.assign(new EventEmitter(), { focused: false });
  window.isFocused = () => window.focused;
  window.flashFrame = value => flashes.push(value);
  window.loadURL = async url => { opens.push(url); };
  window.webContents = {
    mainFrame: { url: origin + '/' },
    send: (_channel, hash) => opens.push(hash),
    session: {
      async fetch(url, options) {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ task: { id: task, status } }) };
      },
    },
  };
  class Notification extends EventEmitter {
    static isSupported() { return supportsNotification; }
    constructor(options) { super(); this.options = options; }
    show() { notices.push(this); }
    close() { this.emit('close'); }
  }
  registerTaskAttention({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    Notification, window, origin, allowsNotification, focusWindow: () => { window.focused = true; window.emit('focus'); },
  });
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const handler = name => handlers.get('somnus-task-attention:' + name);
  return { window, event, handler, notices, flashes, opens, requests };
}

test('per-category preferences suppress desktop and in-app attention for the disabled category', () => {
  const h = windowHarness({ allowsNotification: (kind, failed) => kind === 'assistant' && failed });
  h.handler('turn')(h.event, conversation, reply, 'complete');
  assert.equal(h.notices.length, 0);
  assert.equal(h.flashes.length, 0);
  h.handler('turn')(h.event, conversation, 'd'.repeat(32), 'error');
  assert.equal(h.notices.length, 1);
  assert.deepEqual(h.flashes, [true]);
  h.window.emit('closed');
});

test('completed background conversation raises a generic notification and opens the exact conversation', () => {
  const { window, event, handler, notices, flashes, opens } = windowHarness();
  handler('turn')({ ...event, senderFrame: { url: origin + '/' } }, conversation, reply, 'complete');
  handler('turn')(event, conversation, reply, 'cancelled');
  assert.equal(notices.length, 0);
  handler('turn')(event, conversation, reply, 'complete');
  handler('turn')(event, conversation, reply, 'complete');
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].options, { title: 'Somnus', body: 'AI 会话已完成。' });
  assert.deepEqual(flashes, [true]);
  notices[0].emit('click');
  assert.deepEqual(opens, ['#assistant?conversation=' + conversation]);
  assert.deepEqual(flashes, [true, false]);
  assert.deepEqual(handler('take-pending')(event), []);
  window.emit('closed');
});

test('analysis is watched once on the same origin and can restore directly from the detection page', async () => {
  const { window, event, handler, notices, opens, requests } = windowHarness({ status: 'failed' });
  handler('analysis')(event, task);
  handler('analysis')(event, task);
  window.webContents.mainFrame.url = origin + '/events';
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, origin + '/api/deep-analysis/tasks/' + task);
  assert.equal(requests[0].options.credentials, 'include');
  assert.deepEqual(notices[0].options, { title: 'Somnus', body: '深度分析需要查看。' });
  notices[0].emit('click');
  assert.deepEqual(opens, [origin + '/#deep-analysis?task=' + task]);
  window.emit('closed');
});

test('taskbar and in-app feedback remain available without system notification support', () => {
  const { window, event, handler, notices, flashes } = windowHarness({ supportsNotification: false });
  window.focused = true;
  handler('turn')(event, conversation, 'd'.repeat(32), 'complete');
  assert.deepEqual(flashes, []);
  window.focused = false;
  handler('turn')(event, conversation, reply, 'error');
  assert.equal(notices.length, 0);
  assert.deepEqual(flashes, [true]);
  assert.deepEqual(handler('take-pending')(event), []);
  window.focused = true;
  const pending = handler('take-pending')(event);
  assert.equal(pending[0].hash, '#assistant?conversation=' + conversation);
  assert.equal(pending[0].failed, true);
  assert.deepEqual(handler('take-pending')(event), []);
  window.emit('closed');
});
