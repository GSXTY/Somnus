// One place decides how an API failure is shown, so error codes are visible
// and consistent instead of being lost in a generic message.

export function describeError(error, fallback = '操作失败，请稍后重试') {
  if (!error) return fallback;
  const text = typeof error === 'string' ? error : error.message || fallback;
  const code = typeof error === 'object' ? error.code : '';
  const message = String(text).replace(/DeepSeek Harness|\bDSH\b/g, '原生运行环境');
  return code ? `${message}（${code}）` : message;
}

export function displayAgentName(name) {
  return /^(?:DeepSeek Harness(?: 官方 ACP)?|DSH 插件运行时)$/i.test(name) ? 'DeepSeek 官方 Agent' : name;
}

export function shortError(error, fallback = '操作失败，请稍后重试') {
  return describeError(error, fallback);
}
