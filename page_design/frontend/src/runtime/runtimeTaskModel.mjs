export const ACTIVE_TASK_STATUSES = new Set(['queued', 'connecting', 'running', 'waiting_approval', 'cancelling']);
export const ATTENTION_TASK_STATUSES = new Set(['waiting_approval', 'failed', 'interrupted', 'disconnected']);
export const TASK_LABELS = { queued: '排队中', connecting: '连接中', running: '工作中', waiting_approval: '等待你处理', cancelling: '正在停止', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断', disconnected: '连接中断，状态待确认' };
export function taskIsActive(task, available = true) { return available && ACTIVE_TASK_STATUSES.has(task.status); }
export function taskLabel(task, available = true) { return !available && ACTIVE_TASK_STATUSES.has(task.status) ? '状态暂不可确认' : TASK_LABELS[task.status] || '未知状态'; }
export function taskNeedsAttention(task, available = true) { return ATTENTION_TASK_STATUSES.has(task.status) || !available && ACTIVE_TASK_STATUSES.has(task.status); }
export function conversationTaskState(tasks, conversationId, available = true) {
 const scoped = tasks.filter(task => task.conversation_id === conversationId && !task.parent_task_id);
 const active = scoped.filter(task => taskIsActive(task, available));
 const latest = [...scoped].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
 const pending = scoped.filter(task => task.status === 'waiting_approval' || task.status === 'disconnected' || !available && ACTIVE_TASK_STATUSES.has(task.status));
 const attention = new Set(pending.map(task => task.id));
 if (latest && ['failed', 'interrupted'].includes(latest.status)) attention.add(latest.id);
 const status = active.some(task => task.status === 'waiting_approval') ? 'waiting_approval' : active.length ? 'running'
  : pending.length ? 'disconnected' : latest?.status;
 return { tasks: scoped, active_count: active.length, attention_count: attention.size, status, label: status ? TASK_LABELS[status] : undefined };
}
export function taskMessageStatus(task, available = true) {
 if (task.status === 'completed') return 'complete';
 if (task.status === 'cancelled') return 'cancelled';
 return taskIsActive(task, available) ? 'streaming' : 'error';
}
export function validTaskSnapshot(value) {
 return value && typeof value.epoch === 'string' && Number.isSafeInteger(value.cursor) && value.cursor >= 0 && Array.isArray(value.tasks) && value.tasks.every(task => task && typeof task.id === 'string' && typeof task.conversation_id === 'string' && typeof task.agent_id === 'string' && Object.hasOwn(TASK_LABELS, task.status) && Number.isSafeInteger(task.revision) && task.revision >= 0);
}

export function snapshotCanAdvance(previous, next) {
 if (!validTaskSnapshot(next)) return false;
 if (!previous?.epoch || previous.epoch !== next.epoch) return true;
 if (next.cursor < previous.cursor && !next.reset) return false;
 const old = new Map(previous.tasks.map(task => [task.id, task]));
 return next.tasks.every(task => {
  const prior = old.get(task.id); if (!prior) return true;
  if (task.revision < prior.revision || task.revision === prior.revision && task.status !== prior.status) return false;
  return !['completed', 'failed', 'cancelled'].includes(prior.status) || !ACTIVE_TASK_STATUSES.has(task.status);
 });
}
