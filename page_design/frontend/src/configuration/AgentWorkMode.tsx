import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Popover, Spin } from 'antd';
import { AppstoreOutlined, CheckOutlined, DownOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons';
import type { DshAgentMode, DshAgentModes } from '../chat/assistantAcp';
import './agentWorkMode.css';

type Props = {
  conversationId?: string; workspaceId: string; selectedId?: string | null; visible: boolean;
  disabled: boolean; running: boolean; unconfirmed?: boolean; revision: number;
  onSelect: (modeId: string, newConversation: boolean) => Promise<DshAgentModes>;
  onConfirmationRequired: () => void;
};

export function AgentWorkMode({ conversationId, workspaceId, selectedId, visible, disabled, running, unconfirmed, revision, onSelect, onConfirmationRequired }: Props) {
  const [snapshot, setSnapshot] = useState<{ key: string; value: DshAgentModes }>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [next, setNext] = useState<DshAgentMode>();
  const request = useRef(0);
  const key = workspaceId + ':' + (conversationId || 'new');
  const state = snapshot?.key === key ? snapshot.value : undefined;
  const confirmationRequired = Boolean(unconfirmed || state?.needsConfirmation);
  useEffect(() => { if (state?.needsConfirmation) onConfirmationRequired(); }, [key, state?.needsConfirmation]);
  const currentId = state?.selectedId ?? selectedId;
  const current = state?.modes.find(mode => mode.id === currentId);
  const label = current?.name || (selectedId ? '已选工作模式' : '工作模式');
  async function refresh() {
    const load = window.somnusNativeDshChat?.listAgentModes;
    if (!load) return;
    const token = ++request.current;
    setLoading(true); setError('');
    try {
      const value = await load({ conversationId, workspaceId });
      if (token === request.current) setSnapshot({ key, value });
    } catch (failure) {
      if (token === request.current) setError(failure instanceof Error ? failure.message : '暂时无法读取工作模式');
    } finally { if (token === request.current) setLoading(false); }
  }
  useEffect(() => {
    setOpen(false); setNext(undefined);
    if (visible) void refresh();
    return () => { request.current += 1; };
  }, [key, selectedId, visible, running, revision]);
  async function apply(mode: DshAgentMode, fresh: boolean) {
    setSaving(true); setError('');
    try {
      const value = await onSelect(mode.id, fresh);
      if (!fresh) setSnapshot({ key, value });
      setOpen(false); setNext(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '工作模式未能切换，请重试'); }
    finally { setSaving(false); }
  }
  const locked = Boolean(state?.locked);
  const content = <div className="agent-work-mode-menu" role="region" aria-label="Somnus 工作模式">
    <header><div><strong>工作模式</strong><small>决定 Somnus 使用的工具与执行方式</small></div><Button type="text" size="small" icon={<ReloadOutlined />} aria-label="刷新工作模式" disabled={loading || saving} onClick={() => void refresh()} /></header>
    {error && <Alert type="error" showIcon message={error} />}
    {confirmationRequired && <Alert type="warning" showIcon message="请选择并确认工作模式后再发送。" />}
    {loading && !state ? <div className="agent-work-mode-empty"><Spin size="small" />读取可用模式…</div> : state?.modes.length ? <div className="agent-work-mode-options">{state.modes.map(mode => {
      const selected = mode.id === currentId;
      return <button type="button" key={mode.id} className="agent-work-mode-option" data-selected={selected || undefined}
        aria-label={(locked && (!selected || confirmationRequired) ? '新建会话使用 ' : '选择工作模式 ') + mode.name} aria-pressed={selected}
        disabled={!mode.available || disabled || running || saving || selected && !confirmationRequired}
        onClick={() => { if (locked) { setNext(mode); setOpen(false); } else void apply(mode, !conversationId); }}>
        <span><strong>{mode.name}{mode.isDefault && <em>默认</em>}</strong>{mode.description && <small>{mode.description}</small>}{!mode.available && <small>{mode.reason || '此模式暂不可用'}</small>}</span>
        {selected ? <CheckOutlined /> : locked ? <span className="agent-work-mode-new">新会话</span> : null}
      </button>;
    })}</div> : !loading && <p className="agent-work-mode-empty">当前运行时尚未提供可用工作模式。</p>}
    {(locked || running) && <p className="agent-work-mode-note"><LockOutlined />{running ? '任务运行中，完成后可新建会话选择其他模式。' : state?.reason || '当前会话的工作模式已固定。选择其他模式会创建新会话。'}</p>}
    <p className="agent-work-mode-foot">文件访问范围由权限菜单独立控制。<span>子任务沿用父任务权限，额外授权由主 Agent 处理。</span></p>
  </div>;
  return <><Popover placement="topRight" trigger="click" content={content} open={open} onOpenChange={value => { setOpen(value); if (value) void refresh(); }} overlayClassName="agent-work-mode-popover">
    <Button type="text" size="small" className="agent-work-mode-trigger" aria-label={'工作模式 · ' + label} aria-expanded={open}
      disabled={disabled || saving} loading={saving} icon={<AppstoreOutlined />} title={current ? current.name + (locked ? ' · 当前会话已固定' : '') : '选择 Somnus 工作模式'}>
      <span>{label.replace(/ mode$/i, '')}</span><DownOutlined />
    </Button>
  </Popover><Modal title={'新建 ' + (next?.name || '') + ' 会话？'} open={Boolean(next)} confirmLoading={saving}
    okText="新建并使用此模式" cancelText="取消" onCancel={() => { if (!saving) setNext(undefined); }} onOk={() => next && void apply(next, true)}>
    <p>沿用当前项目和文件权限。原会话及其历史记录会保留。</p>
    {next?.description && <p className="agent-work-mode-dialog-hint">{next.description}</p>}
    {error && <Alert type="error" showIcon message={error} />}
    {confirmationRequired && <Alert type="warning" showIcon message="请选择并确认工作模式后再发送。" />}
  </Modal></>;
}
