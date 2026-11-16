import { useEffect } from 'react';
import { Button, notification } from 'antd';

export function TaskAttentionNotices() {
  const [notices, holder] = notification.useNotification({ maxCount: 4 });
  useEffect(() => {
    const desktop = window.somnusTaskAttention;
    if (!desktop) return;
    let live = true;
    const showPending = () => {
      void desktop.takePending().then(items => {
        if (!live) return;
        for (const { key, title, hash, failed } of items) {
          notices.open({
            key, type: failed ? 'warning' : 'success', message: title, duration: 10,
            actions: <Button size="small" type="link" onClick={() => {
              notices.destroy(key);
              if (window.location.hash === hash) window.dispatchEvent(new Event('hashchange'));
              else window.location.hash = hash;
            }}>查看</Button>,
          });
        }
      }).catch(() => {});
    };
    queueMicrotask(() => { if (live && document.hasFocus()) showPending(); });
    window.addEventListener('focus', showPending);
    return () => { live = false; window.removeEventListener('focus', showPending); };
  }, [notices]);
  return holder;
}
