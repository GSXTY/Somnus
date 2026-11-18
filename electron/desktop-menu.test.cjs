const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { registerDesktopMenu } = require('./desktop-menu.cjs');

test('desktop actions require the live workbench and confirm interruption once', async () => {
  const window = new EventEmitter();
  const origin = 'http://127.0.0.1:4319';
  const frame = { url: origin + '/#assistant' };
  window.webContents = { mainFrame: frame };
  const event = { senderFrame: frame, sender: window.webContents };
  let invoke;
  let answer;
  let available = true;
  const actions = [];
  registerDesktopMenu({
    window, origin, available: () => available,
    ipcMain: {
      handle(channel, callback) { assert.equal(channel, 'somnus-desktop:run'); invoke = callback; },
      removeHandler(channel) { assert.equal(channel, 'somnus-desktop:run'); invoke = undefined; },
    },
    dialog: { showMessageBox: () => new Promise(resolve => { answer = resolve; }) },
    actions: { reload: () => actions.push('reload'), 'open-logs': () => actions.push('open-logs') },
  });
  await assert.rejects(invoke({ ...event, senderFrame: { ...frame } }, 'open-logs'));
  await assert.rejects(invoke(event, 'constructor'));
  assert.equal(await invoke(event, 'open-logs'), true);
  const declined = invoke(event, 'reload');
  assert.equal(await invoke(event, 'reload'), false);
  answer({ response: 0 });
  assert.equal(await declined, false);
  const unavailable = invoke(event, 'reload');
  available = false;
  answer({ response: 1 });
  await assert.rejects(unavailable);
  available = true;
  const accepted = invoke(event, 'reload');
  answer({ response: 1 });
  assert.equal(await accepted, true);
  assert.deepEqual(actions, ['open-logs', 'reload']);
  window.emit('closed');
  assert.equal(invoke, undefined);
});
