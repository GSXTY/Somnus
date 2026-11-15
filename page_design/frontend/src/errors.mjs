// One place decides how an API failure is shown, so error codes are visible
// and consistent instead of being lost in a generic message.

export function describeError(error, fallback = '操作失败，请稍后重试') {
  if (!error) return fallback;
  const text = typeof error === 'string' ? error : error.message || fallback;
  const code = typeof error === 'object' ? error.code : '';
  return code ? `${text}（${code}）` : text;
}

export function shortError(error, fallback = '操作失败，请稍后重试') {
  return describeError(error, fallback);
}
