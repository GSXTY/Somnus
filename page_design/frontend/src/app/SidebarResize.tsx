
import { useEffect, useRef, useState } from 'react';

const storageKey = 'vvman.sidebar-width';
const defaultWidth = 268;
const minWidth = 216;
const maxWidth = 400;
const compactBreakpoint = 992;
const keyStep = 16;

function limit(width: number, max = maxWidth) {
  return Math.round(Math.min(max, Math.max(minWidth, width)));
}

export function useSidebarLayout() {
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) return limit(saved);
    } catch { /* optional preference */ }
    return defaultWidth;
  });
  const [moving, setMoving] = useState<number>();
  useEffect(() => {
    const update = () => setViewport(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const compact = viewport < compactBreakpoint;
  const max = compact ? maxWidth : Math.min(maxWidth, Math.floor(viewport * .38));
  const width = limit(moving ?? preferred, max);
  function commit(next: number) {
    const value = limit(next, max);
    setMoving(undefined);
    setPreferred(value);
    try { localStorage.setItem(storageKey, String(value)); } catch { /* optional preference */ }
  }
  return { compact, max, width, preview: setMoving, commit, cancel: () => setMoving(undefined) };
}

export function SidebarResizeHandle({ width, max, onPreview, onCommit, onCancel }: {
  width: number; max: number; onPreview: (width: number) => void; onCommit: (width: number) => void; onCancel: () => void;
}) {
  const drag = useRef<{ pointer: number; start: number; width: number; moved: boolean }>();
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => { if (drag.current) onCancel(); }, []);
  return <div className="workspace-sidebar-resize" role="separator" tabIndex={0} aria-label="调整侧栏宽度"
    aria-orientation="vertical" aria-controls="workbench-sidebar" aria-valuemin={minWidth} aria-valuemax={max}
    aria-valuenow={width} data-dragging={dragging} title="拖动调整侧栏宽度，双击恢复默认"
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      drag.current = { pointer: event.pointerId, start: event.clientX, width, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (current?.pointer !== event.pointerId || event.clientX === current.start && !current.moved) return;
      current.moved = true;
      onPreview(limit(current.width + event.clientX - current.start, max));
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (current?.pointer !== event.pointerId) return;
      drag.current = undefined;
      setDragging(false);
      if (current.moved || event.clientX !== current.start) onCommit(current.width + event.clientX - current.start);
    }}
    onLostPointerCapture={event => {
      if (drag.current?.pointer !== event.pointerId) return;
      drag.current = undefined;
      setDragging(false);
      onCancel();
    }}
    onDoubleClick={() => onCommit(defaultWidth)}
    onKeyDown={event => {
      const steps: Record<string, number> = { ArrowLeft: width - keyStep, ArrowRight: width + keyStep, Home: minWidth, End: max };
      const next = Object.hasOwn(steps, event.key) ? steps[event.key] : undefined;
      if (next === undefined) return;
      event.preventDefault();
      onCommit(next);
    }} />;
}

