import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Modal, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { saveConversationPermission } from './assistantApi';
import type { ConversationPermission } from './assistantApi';
import './permission-switch.css';

const modes = [
  { id: 'read_only', label: '只读', hint: '读取项目文件；可用查询工具取决于各项配置' },
  { id: 'workspace_write', label: '修改前确认', hint: '更改项目文件前须审阅，可启动分析任务，需确认的 MCP 调用会单独询问' },
  { id: 'workspace_direct', label: '工作区直接修改', hint: '允许在当前项目工作区内直接修改文件；工作区外的操作仍需授权' },
  { id: 'full', label: '完全访问', hint: '使用当前 Windows 用户的权限访问文件和目录，直接运行 PowerShell' },
] as const;

export function PermissionSwitch({ conversationId, permission, disabled, onChange, onBusyChange, external = false, allowFullAccess = false, defer = false, openRequest }: {
  conversationId?: string;
  permission?: ConversationPermission;
  external?: boolean;
  allowFullAccess?: boolean;
  defer?: boolean;
  openRequest?: number;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onChange: (permission: ConversationPermission) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const handledOpen = useRef(openRequest);
  useEffect(() => {
    if (openRequest !== handledOpen.current && !disabled && !busy) {
      handledOpen.current = openRequest;
      setOpen(true);
    }
  }, [openRequest, disabled, busy]);
  const [confirmFull, setConfirmFull] = useState(false);
  const [confirmDirect, setConfirmDirect] = useState(false);
  const lock = useRef(false);
  const [notifications, holder] = message.useMessage();
  const mode = modes.find(item => item.id === permission) ?? modes[0];

  async function choose(next: ConversationPermission) {
    if (disabled || lock.current || next === mode.id || next === 'full' && !allowFullAccess) return;
    if (defer || !conversationId) {
      onChange(next);
      setConfirmFull(false);
      setConfirmDirect(false);
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const saved = await saveConversationPermission(conversationId, next);
      onChange(saved);
      setConfirmFull(false);
      setConfirmDirect(false);
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : '保存会话权限失败');
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return <>{holder}<Dropdown trigger={['click']} overlayClassName="conversation-permission-menu" disabled={disabled || busy} open={open} onOpenChange={setOpen} menu={{
    items: modes.filter(item => item.id !== 'full' || allowFullAccess).map(item => ({
      key: item.id, label: <span>{item.label}<br /><small>{external && item.id === 'workspace_write' ? '审阅项目修改，适用的 Agent 操作会单独确认' : external && item.id === 'workspace_direct' ? '支持此能力的 Agent 可直接修改工作区，具体操作取决于其协议和权限支持' : item.hint}</small></span>,
    })),
    selectedKeys: [mode.id],
    onClick: ({ key }) => {
      setOpen(false);
      if (key === 'workspace_direct' && permission !== 'workspace_direct') setConfirmDirect(true);
      if (key === 'full' && allowFullAccess && permission !== 'full') setConfirmFull(true);
      if (key === 'read_only' || key === 'workspace_write') void choose(key);
    },
  }}>
    <Button size="small" type="text" icon={<LockOutlined />} loading={busy} disabled={disabled}
      title={!conversationId ? '新会话的文件权限' : defer ? '下一条消息使用的文件权限' : '会话文件权限'}>{mode.label}</Button>
  </Dropdown>
    {allowFullAccess && <Modal title={!conversationId ? '为新会话启用完全访问？' : defer ? '为下一条消息启用完全访问？' : '为当前会话启用完全访问？'} open={confirmFull} confirmLoading={busy}
      okText="启用完全访问" cancelText="取消" okButtonProps={{ disabled }}
      onCancel={() => { if (!busy) setConfirmFull(false); }} onOk={() => void choose('full')}>
      <p>此会话的 Agent 可以访问当前 Windows 用户有权读取或写入的文件和目录，也可以直接运行 PowerShell 命令。开启后，PowerShell 命令无需逐条确认。</p>
    </Modal>}
    <Modal title="启用工作区直接修改？" open={confirmDirect} confirmLoading={busy} okText="启用直接修改" cancelText="取消" okButtonProps={{ disabled }}
      onCancel={() => { if (!busy) setConfirmDirect(false); }} onOk={() => void choose('workspace_direct')}>
      <p>{external ? '支持此能力的 Agent 可直接修改工作区；具体操作仍受其协议和权限支持约束。工作区外的操作仍需单独授权。' : 'Somnus 可以直接修改当前项目工作区中的文件，不再逐项生成待审提案。工作区外的操作仍需单独授权。'}</p>
      <p>如需先看差异再应用，请继续使用「修改前确认」。</p>
    </Modal>
  </>;
}
