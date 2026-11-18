import { useEffect, useRef, useState } from 'react';
import { TeamOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';

export function ComposerTeamwork({ conversationId, draftEnabled, visible, disabled, onDraftChange, onChanging, onError }: {
  conversationId?: string; draftEnabled: boolean; visible: boolean; disabled: boolean;
  onDraftChange: (enabled: boolean) => void; onChanging: (changing: boolean) => void; onError: (error: unknown) => void;
}) {
  const bridge = window.somnusDesktop;
  const [status, setStatus] = useState<{ available: boolean; enabled: boolean }>();
  const [changing, setChanging] = useState(false);
  const pending = useRef(false);
  const currentView = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    currentView.current = visible;
    if (!visible || !bridge?.teamwork) return;
    let active = true;
    const refresh = () => {
      if (pending.current) return;
      const version = ++request.current;
      void bridge.teamwork!(conversationId).then(value => {
        if (active && version === request.current && !pending.current) setStatus(value);
      }).catch(() => { if (active && version === request.current && !pending.current) setStatus(undefined); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; currentView.current = false; window.removeEventListener('focus', refresh); };
  }, [visible, bridge, conversationId]);
  if (!status?.available || !bridge?.setTeamwork) return null;
  const enabled = conversationId ? status.enabled : draftEnabled;
  const label = enabled ? 'Teamwork 已开启' : '启用 Teamwork';
  return <Tooltip title={enabled ? '在此会话关闭 Teamwork' : '在此会话开启 Teamwork'}>
    <Button size="small" type="text" icon={<TeamOutlined />} loading={changing} disabled={disabled}
      aria-label={label} aria-pressed={enabled} onClick={async () => {
        if (pending.current || disabled) return;
        if (!conversationId) { onDraftChange(!enabled); return; }
        pending.current = true;
        ++request.current;
        onChanging(true);
        setChanging(true);
        try {
          const value = await bridge.setTeamwork!(conversationId, !enabled);
          if (currentView.current) setStatus(value);
        } catch (error) { if (currentView.current) onError(error); }
        finally {
          pending.current = false;
          onChanging(false);
          setChanging(false);
        }
      }}>Teamwork</Button>
  </Tooltip>;
}
