import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin, Tag } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { describeError } from '../shared/errors.mjs';

type ImBounds = { x: number; y: number; width: number; height: number };
type ImBridge = {
  status: () => Promise<{ installed: boolean }>;
  show: (bounds: ImBounds) => Promise<void>;
  bounds: (bounds: ImBounds) => Promise<void>;
  close: () => Promise<void>;
};

declare global {
  interface Window { somnusDshIm?: ImBridge }
}

function ImPane({ bridge }: { bridge: ImBridge }) {
  const mount = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    let alive = true;
    let frame = 0;
    const measure = () => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return { x: left, y: top, width, height };
    };
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (alive) void bridge.bounds(measure()).catch(() => {});
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    void bridge.show(measure()).then(() => {
      if (alive) {
        setLoading(false);
        resize();
      }
    }).catch(failure => {
      if (alive) {
        setLoading(false);
        setError(describeError(failure, '无法打开 IM 机器人配置页。'));
      }
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', resize, true);
      void bridge.close().catch(() => {});
    };
  }, [bridge]);
  return <div className="dsh-im-pane" ref={mount} aria-label="IM 机器人配置页" aria-busy={loading}>
    {loading && <div className="dsh-im-loading"><Spin size="small" />启动 IM 机器人…</div>}
    {error && <Alert showIcon type="error" message={error} />}
  </div>;
}

export function DshImConfiguration({ revision, openRequest }: { revision: number; openRequest?: number }) {
  const bridge = window.somnusDshIm;
  const [installed, setInstalled] = useState<boolean>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const handledRequest = useRef<number>();
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    setError('');
    void bridge.status().then(status => {
      if (alive) {
        setInstalled(status.installed);
        if (status.installed && openRequest !== undefined && openRequest !== handledRequest.current) {
          handledRequest.current = openRequest;
          setOpen(true);
        }
      }
    }).catch(failure => {
      if (alive) {
        setInstalled(undefined);
        setError(describeError(failure, '无法读取 IM 机器人安装状态。'));
      }
    });
    return () => { alive = false; };
  }, [bridge, revision, openRequest]);
  if (!bridge) return null;
  return <section className="plugin-section" aria-label="IM 机器人">
    <article className="plugin-im-card">
      <span className="plugin-symbol" aria-hidden="true"><MessageOutlined /></span>
      <div className="plugin-row-copy">
        <strong>IM 机器人</strong>
        <small>在本机配置微信、飞书等机器人。</small>
      </div>
      <div className="plugin-im-actions">
        {installed !== undefined && <Tag color={installed ? 'green' : undefined}>{installed ? '已安装' : '未安装'}</Tag>}
        <Button disabled={!installed} onClick={() => setOpen(true)}>配置机器人</Button>
      </div>
    </article>
    {error && <Alert showIcon type="error" message={error} />}
    <Modal title="IM 机器人" width="min(1100px, 94vw)" open={open} destroyOnHidden onCancel={() => setOpen(false)}
      footer={null} maskClosable={false} style={{ top: 24 }}>
      <p className="dsh-im-help">在下方打开「设置 → IM 机器人」。机器人任务使用此配置的账号、模型和会话。</p>
      {open && <ImPane bridge={bridge} />}
    </Modal>
  </section>;
}
