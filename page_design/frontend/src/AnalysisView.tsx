import { useEffect, useRef } from 'react';

// Mounted once on first entry. Hiding this view never reloads the CSV workspace.
export function AnalysisView({ active }: { active: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  function notify() {
    frame.current?.contentWindow?.postMessage({ source: 'data-workbench', type: 'analysis:visibility', visible: active }, window.location.origin);
  }
  useEffect(() => { const request = window.requestAnimationFrame(notify); return () => window.cancelAnimationFrame(request); }, [active]);
  return <iframe ref={frame} className="analysis-workspace-frame" src="/events?embedded=1" title="数据分析工作区" onLoad={() => window.requestAnimationFrame(notify)} />;
}
