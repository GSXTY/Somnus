import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Spin } from 'antd';
import type { InstalledDshPlugin } from './DshPluginMarket';
import { describeError } from './errors.mjs';

type Bounds = { x: number; y: number; width: number; height: number };
export const DSH_IM_PLUGIN = '@xmanrui/dsh-im';
export type OwnedPluginPage = { id: string; pluginId: string; label: string; sidebar: boolean };
type PluginPageBridge = {
  status: (id: string, source: InstalledDshPlugin['source']) => Promise<{ available: boolean }>;
  show: (id: string, source: InstalledDshPlugin['source'], bounds: Bounds) => Promise<void>;
  bounds: (bounds: Bounds) => Promise<void>;
  close: () => Promise<void>;
  list?: () => Promise<OwnedPluginPage[]>;
  showOwned?: (id: string, bounds: Bounds) => Promise<void>;
};
declare global {
  interface Window { somnusDshPluginPage?: PluginPageBridge }
}

type PageTarget = { label: string; id: string; source?: InstalledDshPlugin['source'] };

function PluginPageDialog({ target, onClose }: { target: PageTarget; onClose: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const bridge = window.somnusDshPluginPage;
    const element = mount.current;
    if (!bridge || !element) {
      setError('插件页面需要 Somnus Windows 桌面版。');
      return;
    }
    let active = true;
    let frame = 0;
    function measure() {
      const rect = element!.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }
    function resize() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (active) void bridge!.bounds(measure()).catch(() => {});
      });
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    const open = target.source ? bridge.show(target.id, target.source, measure()) :
      bridge.showOwned ? bridge.showOwned(target.id, measure()) : Promise.reject(new Error('无法打开插件页面。'));
    void open.then(() => {
      if (active) { setReady(true); resize(); }
    }).catch(failure => {
      if (active) setError(describeError(failure, '无法打开插件页面。'));
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', resize, true);
      void bridge.close().catch(() => {});
    };
  }, [target.id, target.source]);
  return <Modal open width="min(1100px, 94vw)" style={{ top: 24 }} footer={null} maskClosable={false} title={target.label} onCancel={onClose}>
    <div className="dsh-im-pane" ref={mount} aria-label={target.label} aria-busy={!ready && !error}>
      {error ? <Alert type="error" showIcon message={error} /> : !ready && <div className="dsh-im-loading" role="status"><Spin size="small" />正在打开{target.label}…</div>}
    </div>
  </Modal>;
}

export function DshPluginPage({ plugin, onClose }: { plugin: InstalledDshPlugin; onClose: () => void }) {
  return <PluginPageDialog target={{ id: plugin.id, label: plugin.name, source: plugin.source }} onClose={onClose} />;
}

export function OwnedDshPluginPage({ page, onClose }: { page: OwnedPluginPage; onClose: () => void }) {
  return <PluginPageDialog target={page} onClose={onClose} />;
}
