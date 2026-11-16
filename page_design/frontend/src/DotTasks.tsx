import { useEffect, useRef, useState } from 'react';
import { createDotTask, dotTaskStatus, listDotTasks } from './assistantApi';
import type { DotTask, DotTaskList, DotTaskStatus } from './assistantApi';
import { describeError } from './errors.mjs';

export const DOT_PROMPT_LIMIT = 4000;
const POLL_INTERVAL_MS = 2000;
const taskLabels = { pending: '等待 Dot 返回', complete: '已完成', error: '执行失败' };

export function useDotTasks(conversationId: string | undefined, visible: boolean) {
  const [verified, setVerified] = useState<DotTaskStatus & { scope: string }>();
  const [snapshots, setSnapshots] = useState<Record<string, DotTaskList>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(() => new Set());
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(new Set<string>());
  const revisions = useRef(new Map<string, number>());
  const snapshot = conversationId ? snapshots[conversationId] : undefined;
  const scope = conversationId || '';
  const availability = visible && verified?.scope === scope ? verified : undefined;

  useEffect(() => {
    if (!visible) {
      setVerified(undefined);
      return;
    }
    if (conversationId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let shouldPoll = Boolean(availability?.enabled || availability?.paused);
    async function loadStatus() {
      try {
        const next = await dotTaskStatus(controller.signal);
        if (controller.signal.aborted) return;
        setVerified({ ...next, scope });
        shouldPoll = next.enabled || next.paused;
      } catch {
        if (!controller.signal.aborted) setVerified(undefined);
      }
      if (shouldPoll && !controller.signal.aborted) timer = setTimeout(() => void loadStatus(), POLL_INTERVAL_MS);
    }
    void loadStatus();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [visible, conversationId]);

  useEffect(() => {
    if (!visible || !conversationId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let shouldPoll = snapshot && (snapshot.enabled || snapshot.paused || snapshot.tasks.some(task => task.status === 'pending'));
    async function poll(id: string) {
      const revision = revisions.current.get(id);
      try {
        const next = await listDotTasks(id, controller.signal);
        if (controller.signal.aborted || revision !== revisions.current.get(id)) return;
        setSnapshots(previous => ({ ...previous, [id]: next }));
        setVerified({ enabled: next.enabled, ready: next.ready, paused: next.paused, scope: id });
        shouldPoll = next.enabled || next.paused || next.tasks.some(task => task.status === 'pending');
      } catch {
        if (!controller.signal.aborted && revision === revisions.current.get(id)) setVerified(undefined);
      }
      if (shouldPoll && !controller.signal.aborted) timer = setTimeout(() => void poll(id), POLL_INTERVAL_MS);
    }
    void poll(conversationId);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [conversationId, refresh, visible]);

  async function dispatch(id: string, draft: string) {
    const prompt = draft.trim();
    const currentAvailability = availability;
    if (!currentAvailability?.enabled || !currentAvailability.ready || currentAvailability.paused || !prompt ||
      Array.from(prompt).length > DOT_PROMPT_LIMIT || inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    setSubmitting(new Set(inFlight.current));
    setErrors(previous => ({ ...previous, [id]: '' }));
    try {
      const task = await createDotTask(id, prompt);
      revisions.current.set(id, (revisions.current.get(id) || 0) + 1);
      setSnapshots(previous => {
        const current = previous[id] || { ...currentAvailability, tasks: [] };
        return { ...previous, [id]: { ...current, tasks: [task, ...current.tasks.filter(item => item.id !== task.id)] } };
      });
      setRefresh(value => value + 1);
      return task.status !== 'error';
    } catch (error) {
      setErrors(previous => ({ ...previous, [id]: describeError(error, '发送给 Dot 失败。') }));
      setRefresh(value => value + 1);
      return false;
    } finally {
      inFlight.current.delete(id);
      setSubmitting(new Set(inFlight.current));
    }
  }

  return { snapshot, availability, dispatch, submitting: Boolean(conversationId && submitting.has(conversationId)), error: conversationId && errors[conversationId] };
}

export function DotTaskCards({ tasks }: { tasks: DotTask[] }) {
  if (!tasks.length) return null;
  return <div className="assistant-dot-tasks">
    {tasks.slice().reverse().map(task => <article className="assistant-dot-task" key={task.id}>
      <header><strong>Dot</strong><span>{taskLabels[task.status]}</span></header>
      <p className="assistant-dot-task-prompt">{task.prompt}</p>
      {task.status === 'error' && task.error && <p>{task.error}</p>}
      {task.status === 'complete' && task.result && <p>{task.result}</p>}
    </article>)}
  </div>;
}
