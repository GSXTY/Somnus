import { useRef, useState } from 'react';
import { Button, Dropdown, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { saveConversationPermission } from './assistantApi';
import type { ConversationPermission } from './assistantApi';

const modes = [
  { id: 'read_only', label: '只读', hint: '读取项目文件；可用查询工具取决于各项配置' },
  { id: 'workspace_write', label: '修改前确认', hint: '更改项目文件前须审阅，可启动分析任务，需确认的 MCP 调用会单独询问' },
] as const;

export function PermissionSwitch({ conversationId, permission, disabled, onChange, onBusyChange, external = false }: {
  conversationId?: string;
  permission?: ConversationPermission;
  external?: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onChange: (permission: ConversationPermission) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notifications, holder] = message.useMessage();
  const mode = permission === 'workspace_write' || permission === 'full' ? modes[1] : modes[0];

  async function choose(next: 'read_only' | 'workspace_write') {
    if (!conversationId || disabled || lock.current || next === permission) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const saved = await saveConversationPermission(conversationId, next);
      onChange(saved);
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : '保存会话权限失败');
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return <>{holder}<Dropdown trigger={['click']} disabled={!conversationId || disabled || busy} menu={{
    items: modes.map(item => ({ key: item.id, label: <span>{item.label}<br /><small>{external && item.id === 'workspace_write' ? '审阅项目修改；适用的 Agent 操作仍需逐次确认' : item.hint}</small></span> })),
    selectedKeys: [mode.id],
    onClick: ({ key }) => { if (key === 'read_only' || key === 'workspace_write') void choose(key); },
  }}>
    <Button size="small" type="text" icon={<LockOutlined />} loading={busy} disabled={!conversationId || disabled}
      title={conversationId ? '会话文件权限' : '新会话默认只读，创建后可更改'}>{mode.label}</Button>
  </Dropdown></>;
}
