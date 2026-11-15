// Shared display formatting so dates and numbers look the same on every page.

const DATE_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const DATE_ONLY = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 2026-11-12 09:21 (Asia/Shanghai); seconds optional. */
export function formatDateTime(value, { seconds = false } = {}) {
  const date = toDate(value);
  if (!date) return '—';
  const text = DATE_TIME.format(date);
  if (!seconds) return text;
  const pad = number => String(number).padStart(2, '0');
  return `${text}:${pad(date.getSeconds())}`;
}

/** 2026-11-12 */
export function formatDate(value) {
  const date = toDate(value);
  return date ? DATE_ONLY.format(date) : '—';
}

/** 1,234,567 */
export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
