// A bounded public summary for a single native-tool approval, never a raw credential dump.
function approvalPreview(value) {
  const secret = /api[_-]?key|token|secret|password|passwd|authorization|cookie|credential/i;
  const clean = text => String(text)
    .replace(/Bearer\s+[A-Za-z0-9_.~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization|cookie)\s*[=:]\s*)[^\s,;"'}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/data:[^\s;]+;base64,[A-Za-z0-9+/=]+/g, '[binary omitted]');
  function visit(item, depth) {
    if (depth > 4) return '[nested value omitted]';
    if (typeof item === 'string') return clean(item).slice(0, 1600);
    if (Array.isArray(item)) return item.slice(0, 20).map(value => visit(value, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 40)
      .map(([key, value]) => [key, secret.test(key) ? '[redacted]' : visit(value, depth + 1)]));
    return item;
  }
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return clean(value).slice(0, 6000); }
  }
  return JSON.stringify(visit(value, 0), null, 2).slice(0, 6000);
}
module.exports = { approvalPreview };
