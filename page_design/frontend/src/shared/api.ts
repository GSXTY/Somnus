import type { Dashboard, Source, UserDetail } from './types';
import { validateDashboard } from './logic.mjs';
import { nativeFetch } from './nativeFetch.mjs';

async function readJSON(url: string, signal: AbortSignal) {
  const response = await nativeFetch(url, { signal, cache: 'no-store' });
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = typeof body.error === 'string' ? `：${body.error}` : ''; } catch { /* preserve HTTP status */ }
    throw new Error(`服务返回 ${response.status}${detail}`);
  }
  return response.json();
}
export async function fetchDashboard(source: Source, model: string, signal: AbortSignal): Promise<Dashboard> {
  const data = await readJSON('/api/workbench?' + new URLSearchParams({ source, model }), signal);
  return validateDashboard(data, source) as Dashboard;
}
export async function fetchUser(id: string, source: Source, signal: AbortSignal): Promise<UserDetail> {
  const data = await readJSON(`/api/workbench/users/${encodeURIComponent(id)}?` + new URLSearchParams({ source }), signal);
  if (!data || data.source?.mode !== 'demo' || source !== 'demo' || data.user?.id !== id || data.waveform?.origin !== 'synthetic' || !Array.isArray(data.waveform?.channels) || !Array.isArray(data.events) || data.event_count !== data.events.length || data.event_count !== data.user.events_24h) throw new Error('用户详情来源、目标或事件数量不匹配');
  return data as UserDetail;
}
