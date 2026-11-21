// SSE is parsed from UTF-8 chunks, never treated as executable markup.
export async function readAssistantEvents(response, onEvent) {
  if (!response.body) throw new Error('服务器未返回对话内容');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', name = 'message', lines = [], terminal = false;
  const dispatch = () => {
    if (lines.length) {
      let data;
      try { data = JSON.parse(lines.join('\n')); } catch { throw new Error('对话响应格式不正确，请重新加载历史'); }
      if (['done', 'error', 'cancelled'].includes(name)) terminal = true;
      onEvent({ type: name, data });
    }
    name = 'message'; lines = [];
  };
  const line = value => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(':')) return;
    const separator = value.indexOf(':');
    const field = separator < 0 ? value : value.slice(0, separator);
    const content = separator < 0 ? '' : value.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') name = content;
    if (field === 'data') lines.push(content);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1); }
      if (done) break;
    }
    if (buffer) line(buffer.replace(/\r$/, ''));
    dispatch();
    if (!terminal) throw new Error('对话连接中断，已显示的回答可能不完整；可重新加载历史后继续提问');
  } finally { reader.releaseLock(); }
}
