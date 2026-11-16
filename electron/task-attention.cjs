const ID = /^[a-f0-9]{32}$/;
const TERMINAL_CHAT_STATES = new Set(['complete', 'error']);
const ACTIVE_ANALYSIS_STATES = new Set(['queued', 'running']);
const MAX_TASK_AGE_MS = 6 * 60 * 60 * 1000;

function registerTaskAttention({ ipcMain, Notification, window, origin, focusWindow, allowsNotification = () => true }) {
  const announced = new Set();
  const watched = new Map();
  const notifications = new Set();
  const pending = new Map();
  let closed = false;

  function rootFrame(frame) {
    if (!frame) return false;
    try {
      const url = new URL(frame.url);
      return url.origin === origin && url.pathname === '/';
    } catch {
      return false;
    }
  }

  function trusted(event) {
    return !closed && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame && rootFrame(event.senderFrame);
  }

  function announce(kind, target, key, failed) {
    if (closed || announced.has(key)) return;
    announced.add(key);
    if (announced.size > 256) announced.delete(announced.values().next().value);
    if (window.isFocused() || !allowsNotification(kind, failed)) return;

    const label = kind === 'assistant' ? 'AI 会话' : '深度分析';
    const hash = kind === 'assistant' ? '#assistant?conversation=' + target : '#deep-analysis?task=' + target;
    const title = label + (failed ? '需要查看' : '已完成');
    pending.set(key, { key, title, hash, failed });
    if (pending.size > 32) pending.delete(pending.keys().next().value);
    window.flashFrame(true);
    if (!Notification.isSupported()) return;
    const notice = new Notification({ title: 'Somnus', body: title + '。' });
    notifications.add(notice);
    const release = () => notifications.delete(notice);
    notice.once('close', release);
    notice.once('failed', release);
    notice.once('click', () => {
      release();
      if (closed) return;
      pending.delete(key);
      focusWindow();
      if (rootFrame(window.webContents.mainFrame)) {
        window.webContents.send('somnus-task-attention:open', hash);
      } else {
        void window.loadURL(origin + '/' + hash).catch(() => {});
      }
    });
    notice.show();
    if (notifications.size > 32) {
      const oldest = notifications.values().next().value;
      notifications.delete(oldest);
      oldest.close();
    }
  }

  ipcMain.handle('somnus-task-attention:turn', (event, conversationId, replyId, status) => {
    if (!trusted(event) || ![conversationId, replyId].every(id => typeof id === 'string' && ID.test(id)) ||
        !TERMINAL_CHAT_STATES.has(status)) return;
    announce('assistant', conversationId, 'turn:' + replyId, status === 'error');
  });
  ipcMain.handle('somnus-task-attention:take-pending', event => {
    if (!trusted(event) || !window.isFocused()) return [];
    const items = [...pending.values()];
    pending.clear();
    return items;
  });

  ipcMain.handle('somnus-task-attention:analysis', (event, id) => {
    if (!trusted(event) || typeof id !== 'string' || !ID.test(id) || watched.has(id) ||
        announced.has('analysis:' + id) || watched.size >= 64) return;
    const expires = Date.now() + MAX_TASK_AGE_MS;
    const controller = new AbortController();
    const watch = { controller, timer: undefined };
    watched.set(id, watch);

    const poll = async () => {
      if (closed || Date.now() >= expires) { watched.delete(id); return; }
      let delay = 3000;
      try {
        const response = await window.webContents.session.fetch(origin + '/api/deep-analysis/tasks/' + id, {
          credentials: 'include',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        if (response.status === 404 || response.status === 403) { watched.delete(id); return; }
        if (!response.ok) throw new Error('Analysis status unavailable');
        const { task } = await response.json();
        if (task?.id !== id) throw new Error('Analysis status mismatch');
        if (!ACTIVE_ANALYSIS_STATES.has(task.status)) {
          watched.delete(id);
          if (task.status === 'complete' || task.status === 'failed') {
            announce('deep-analysis', id, 'analysis:' + id, task.status === 'failed');
          }
          return;
        }
      } catch {
        delay = 8000;
      }
      if (!closed) watch.timer = setTimeout(poll, delay);
    };
    void poll();
  });

  window.once('closed', () => {
    closed = true;
    ipcMain.removeHandler('somnus-task-attention:turn');
    ipcMain.removeHandler('somnus-task-attention:analysis');
    ipcMain.removeHandler('somnus-task-attention:take-pending');
    for (const { controller, timer } of watched.values()) {
      clearTimeout(timer);
      controller.abort();
    }
    watched.clear();
    for (const notice of notifications) notice.close();
    notifications.clear();
    pending.clear();
  });
  window.on('focus', () => window.flashFrame(false));
}

module.exports = { registerTaskAttention };
