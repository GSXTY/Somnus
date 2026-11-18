import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDashboard } from './api';
import { createLatestGate } from './logic.mjs';
import type { Dashboard, Source } from './types';

const refreshIntervalMs = 60 * 60 * 1000;

type Snapshot = { data: Dashboard; receivedAt: number };
type RequestStatus = { key: string; loading: boolean; error: string; finishedAt?: number };

export function useWorkbench(source: Source, model: string, auto: boolean) {
  const key = `${source}|${model}`;
  const snapshots = useRef(new Map<string, Snapshot>());
  const [request, setRequest] = useState<RequestStatus>();
  const [visible, setVisible] = useState(!document.hidden);
  const controller = useRef<AbortController>();
  const gate = useRef(createLatestGate());

  const load = useCallback(async (force: boolean) => {
    const cached = snapshots.current.get(key);
    if (!force && cached && cached.data.source.mode !== 'unconfigured' && Date.now() - cached.receivedAt < refreshIntervalMs) {
      setRequest(current => current?.key === key ? undefined : current);
      return;
    }

    controller.current?.abort();
    const token = gate.current.next(), abort = new AbortController();
    controller.current = abort;
    setRequest({ key, loading: true, error: '' });
    try {
      const data = await fetchDashboard(source, model, abort.signal);
      if (!gate.current.current(token)) return;
      const receivedAt = Date.now();
      snapshots.current.set(key, { data, receivedAt });
      setRequest({ key, loading: false, error: '', finishedAt: receivedAt });
    } catch (failure) {
      if (!gate.current.current(token) || abort.signal.aborted) return;
      snapshots.current.delete(key);
      setRequest({ key, loading: false, error: failure instanceof Error ? failure.message : '请求失败', finishedAt: Date.now() });
    }
  }, [key, source, model]);

  const reload = useCallback(() => load(true), [load]);
  const cancel = useCallback(() => {
    gate.current.invalidate();
    controller.current?.abort();
  }, []);

  useEffect(() => {
    if (!document.hidden) void load(false);
    return cancel;
  }, [load, cancel]);
  useEffect(() => {
    const onVisibility = () => {
      setVisible(!document.hidden);
      if (document.hidden) {
        cancel();
        setRequest(current => current?.loading ? { ...current, loading: false } : current);
      } else void load(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [load, cancel]);

  const snapshot = snapshots.current.get(key);
  const status = request?.key === key ? request : undefined;
  const loading = status?.loading ?? (!snapshot && visible);
  const lastRead = snapshot?.receivedAt ?? status?.finishedAt;
  useEffect(() => {
    if (!auto || !visible || loading) return;
    const delay = lastRead === undefined ? refreshIntervalMs : Math.max(0, refreshIntervalMs - (Date.now() - lastRead));
    const timer = window.setTimeout(() => { if (!document.hidden) void reload(); }, delay);
    return () => window.clearTimeout(timer);
  }, [auto, visible, loading, lastRead, reload]);
  return { data: snapshot?.data ?? null, error: status?.error ?? '', loading, visible, reload };
}
