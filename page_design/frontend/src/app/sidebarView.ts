import { useEffect, useState } from 'react';

export type SidebarView = { group: 'workspace' | 'tree' | 'flat'; order: 'updated' | 'manual'; archived: 'hide' | 'show' | 'only'; manual: string[] };
const key = 'somnus.sidebar-view.v1';
const changed = 'somnus:sidebar-view-changed';
const defaults: SidebarView = { group: 'workspace', order: 'updated', archived: 'hide', manual: [] };
export function readSidebarView(): SidebarView {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return { group: ['workspace', 'tree', 'flat'].includes(value.group) ? value.group : defaults.group,
      order: value.order === 'manual' ? 'manual' : 'updated', archived: ['hide', 'show', 'only'].includes(value.archived) ? value.archived : 'hide',
      manual: Array.isArray(value.manual) ? value.manual.filter((id: unknown) => typeof id === 'string').slice(0, 10000) : [] };
  } catch { return defaults; }
}
export function saveSidebarView(patch: Partial<SidebarView>) {
  const next = { ...readSidebarView(), ...patch };
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* The current view still works without storage. */ }
  window.dispatchEvent(new CustomEvent(changed, { detail: next }));
}
export function useSidebarView(): SidebarView {
  const [view, setView] = useState(readSidebarView);
  useEffect(() => {
    const update = (event: Event) => setView((event as CustomEvent).detail || readSidebarView());
    window.addEventListener(changed, update); window.addEventListener('storage', update);
    return () => { window.removeEventListener(changed, update); window.removeEventListener('storage', update); };
  }, []);
  return view;
}
export function orderSidebarItems<T extends { id: string; pinned?: boolean; updated_at?: number }>(items: T[], view: SidebarView): T[] {
  const positions = new Map(view.manual.map((id, index) => [id, index]));
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    (view.order === 'manual' ? (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER) : (b.updated_at || 0) - (a.updated_at || 0)));
}
