import { useEffect, useState } from 'react';
import { conversationTaskState, snapshotCanAdvance, TASK_LABELS, validTaskSnapshot } from './runtimeTaskModel.mjs';
export type RuntimeTaskStatus = 'queued' | 'connecting' | 'running' | 'waiting_approval' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'disconnected';
export type RuntimeTask = { id: string; task_id: string; conversation_id: string; agent_id: string; agent_name: string; runtime: string; parent_task_id: string | null; message_id: string; title?: string; user_message_id?: string; status: RuntimeTaskStatus; revision: number; created_at: number; updated_at: number; started_at?: number | null; ended_at?: number | null; progress: { stage?: string; title?: string } | null; error: { code: string; message: string } | null; recoverable: boolean; can_cancel?: boolean; received_late?: boolean };
export type RuntimeTaskSnapshot = { tasks: RuntimeTask[]; cursor: number; epoch: string; availability: 'loading' | 'ready' | 'offline' | 'legacy'; conversations?: Array<{ conversation_id: string; status: RuntimeTaskStatus; active_count: number; attention_count: number }>; truncated?: boolean; error?: string };
const listeners = new Set<(value: RuntimeTaskSnapshot) => void>();
let current: RuntimeTaskSnapshot = { tasks: [], cursor: 0, epoch: '', availability: 'loading' };
let timer: ReturnType<typeof setTimeout> | undefined;
let request: AbortController | undefined;
function emit(value: RuntimeTaskSnapshot) { current = value; listeners.forEach(listener => listener(value)); }
async function refresh() {
 if (request || !listeners.size) return;
 const controller = new AbortController(); request = controller;
 const deadline = setTimeout(() => controller.abort(), 8000);
 try {
  const response = await fetch('/api/assistant/runtime-tasks' + (current.epoch ? '?after=' + current.cursor + '&epoch=' + encodeURIComponent(current.epoch) : ''), { cache: 'no-store', signal: controller.signal });
  if (response.status === 404) { emit({ ...current, availability: 'legacy', error: '当前服务尚未提供统一任务状态。' }); return; }
  if (!response.ok) throw Error('任务状态服务暂时无法连接');
  const data = await response.json();
  if (data.unchanged === true && data.epoch === current.epoch && data.cursor === current.cursor) { emit({ ...current, conversations: data.conversations || current.conversations, truncated: data.truncated, availability: 'ready', error: undefined }); return; }
  if (!validTaskSnapshot(data)) throw Error('任务状态响应无效');
  if (!snapshotCanAdvance(current, data)) throw Error('任务状态版本落后或不一致');
  emit({ tasks: data.tasks, cursor: data.cursor, epoch: data.epoch, conversations: data.conversations, truncated: data.truncated, availability: 'ready' });
 } catch (failure) {
  if (listeners.size) emit({ ...current, availability: 'offline', error: failure instanceof Error && failure.name !== 'AbortError' ? failure.message : '任务状态连接已中断' });
 } finally {
  clearTimeout(deadline); if (request === controller) request = undefined;
  if (listeners.size) timer = setTimeout(() => void refresh(), current.availability === 'legacy' ? 15000 : 2000);
 }
}
export function refreshRuntimeTasks() { if (timer) clearTimeout(timer); timer = undefined; void refresh(); }
export function useRuntimeTasks() {
 const [snapshot, setSnapshot] = useState(current);
 useEffect(() => {
  listeners.add(setSnapshot); setSnapshot(current); if (listeners.size === 1) refreshRuntimeTasks();
  return () => { listeners.delete(setSnapshot); if (!listeners.size) { if (timer) clearTimeout(timer); timer = undefined; request?.abort(); } };
 }, []);
 return snapshot;
}

export function runtimeConversation(snapshot: RuntimeTaskSnapshot, id: string) {
 const state = conversationTaskState(snapshot.tasks, id, snapshot.availability === 'ready');
 const canonical = snapshot.availability === 'ready' ? snapshot.conversations?.find(item => item.conversation_id === id) : undefined;
 return canonical ? { ...state, ...canonical, label: TASK_LABELS[canonical.status] } : state;
}

export function useFocusedRuntimeTasks(snapshot: RuntimeTaskSnapshot, conversationId: string | undefined, enabled: boolean) {
 const [detail, setDetail] = useState<{ id: string; epoch: string; tasks: RuntimeTask[]; truncated?: boolean }>();
 useEffect(() => {
  if (!enabled || !conversationId || snapshot.availability === 'legacy') return;
  const controller = new AbortController();
  void fetch('/api/assistant/conversations/' + encodeURIComponent(conversationId) + '/runtime-tasks', { cache: 'no-store', signal: controller.signal }).then(async response => {
   if (!response.ok) return;
   const data = await response.json(); if (validTaskSnapshot(data) && !controller.signal.aborted) setDetail({ id: conversationId, epoch: data.epoch, tasks: data.tasks, truncated: data.truncated });
  }).catch(() => {});
  return () => controller.abort();
 }, [enabled, conversationId, snapshot.epoch]);
 if (!enabled || !detail || detail.id !== conversationId || detail.epoch !== snapshot.epoch) return snapshot;
 const merged = new Map(detail.tasks.map(task => [task.id, task]));
 for (const task of snapshot.tasks.filter(task => task.conversation_id === conversationId)) {
  if ((merged.get(task.id)?.revision ?? -1) <= task.revision) merged.set(task.id, task);
 }
 return { ...snapshot, tasks: [...merged.values()], truncated: detail.truncated };
}
