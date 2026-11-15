import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDashboard } from './api';
import { createLatestGate } from './logic.mjs';
import type { Dashboard, Source } from './types';

export function useWorkbench(source: Source, model: string, auto: boolean) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [dataKey, setDataKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(!document.hidden);
  const controller = useRef<AbortController>();
  const inFlight = useRef(false);
  const gate = useRef(createLatestGate());
  const reload = useCallback(async () => {
    controller.current?.abort();
    const token = gate.current.next(), abort = new AbortController();
    controller.current = abort; inFlight.current = true; setLoading(true); setError('');
    try {
      const result = await fetchDashboard(source, model, abort.signal);
      if (gate.current.current(token)) { setDataKey(`${source}|${model}`); setData(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result); }
    } catch (failure) {
      if (gate.current.current(token) && !abort.signal.aborted) { setData(null); setError(failure instanceof Error ? failure.message : '请求失败'); }
    } finally { if (gate.current.current(token)) { inFlight.current = false; setLoading(false); } }
  }, [source, model]);
  useEffect(() => {
    setData(null);
    if (!document.hidden) void reload(); else setLoading(false);
    return () => { controller.current?.abort(); inFlight.current = false; gate.current.invalidate(); };
  }, [reload]);
  useEffect(() => {
    const onVisibility = () => { setVisible(!document.hidden); if (document.hidden) { controller.current?.abort(); inFlight.current = false; gate.current.invalidate(); setLoading(false); } else void reload(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [reload]);
  useEffect(() => {
    if (!auto || !visible) return;
    const timer = window.setInterval(() => { if (!document.hidden && !inFlight.current) void reload(); }, 3600000);
    return () => window.clearInterval(timer);
  }, [auto, visible, reload]);
  return { data: dataKey === `${source}|${model}` ? data : null, error, loading, visible, reload };
}
