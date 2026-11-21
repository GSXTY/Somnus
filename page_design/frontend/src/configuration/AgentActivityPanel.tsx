import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Alert, Button, Tooltip } from 'antd';
import { ApartmentOutlined, CheckOutlined, CloseOutlined, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { AgentAvatar } from '../chat/ConversationAgents';
import { SubagentDetail } from '../chat/ExecutionDetails';
import type { ChatMessage, ExecutionStep, ExecutionSummary } from '../chat/assistantApi';
import { mainChatBridge } from '../chat/assistantAcp';
import type { AcpConnectionState, AcpStage, ExternalAgent } from '../chat/assistantAcp';
import { clampWorkspaceWidth, DEFAULT_WORKSPACE_WIDTH, WORKSPACE_WIDTH_KEY, workspaceWidthLimits } from '../app/workspacePanelWidth.mjs';
import './agentActivityPanel.css';
import type { RuntimeTask, RuntimeTaskSnapshot } from '../runtime/runtimeTasks';
import { refreshRuntimeTasks } from '../runtime/runtimeTasks';
import { taskIsActive, taskLabel } from '../runtime/runtimeTaskModel.mjs';
import { RuntimeTaskDetails } from '../runtime/RuntimeTaskDetails';

export function useAgentConnections(conversationId: string | undefined, members: string[]) {
  const [snapshot, setSnapshot] = useState<{ id: string; states: AcpConnectionState[] }>();
  const memberKey = members.join(',');
  useEffect(() => {
    const bridge = mainChatBridge();
    if (!conversationId || !bridge?.connectionStates || !bridge.warmConversation) return;
    let live = true;
    let timer: number | undefined;
    const apply = (states: AcpConnectionState[]) => { if (live) setSnapshot({ id: conversationId, states }); };
    async function refresh() {
      try { apply(await bridge!.connectionStates!({ conversationId: conversationId! })); }
      catch { /* A failed status read must not stop or resend a task. */ }
      if (live) timer = window.setTimeout(() => void refresh(), 2000);
    }
    if (members.length) void bridge.warmConversation!({ conversationId, agentIds: members }).then(apply).catch(() => {});
    void refresh();
    return () => { live = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [conversationId, memberKey]);
  return snapshot && snapshot.id === conversationId ? snapshot.states : [];
}

export type AgentActivityLane = {
  messageId?: string; agentId?: string; name: string; startedAt: number; stage?: AcpStage;
  stopping?: boolean; approval?: boolean; error?: string; execution?: ExecutionSummary;
};
type Item = { key: string; name: string; title: string; status: string; working: boolean; failed?: boolean;
  messageId?: string; at?: number; detail?: string; step?: ExecutionStep; duration?: number; task?: RuntimeTask; uncertain?: boolean };
const stageLabels: Record<AcpStage, string> = { preparing: '准备中', connecting: '连接中', working: '工作中', thinking: '思考中', responding: '回复中' };
function elapsed(ms: number) { return ms < 1000 ? '小于 1 秒' : ms < 60000 ? Math.round(ms / 1000) + ' 秒' : Math.floor(ms / 60000) + ' 分 ' + Math.round(ms % 60000 / 1000) + ' 秒'; }

export function AgentActivityPanel({ conversationId, members, available, connections, messages, lanes, runtimeSnapshot, onJump, onClose }: {
  conversationId: string; members: string[]; available: ExternalAgent[]; connections: AcpConnectionState[];
  messages: ChatMessage[]; lanes: AgentActivityLane[]; runtimeSnapshot?: RuntimeTaskSnapshot; onJump: (id: string) => void; onClose: () => void;
}) {
  const [focusedTask, setFocusedTask] = useState<string>();
  const canonical = Boolean(runtimeSnapshot && runtimeSnapshot.availability !== 'legacy');
  const verified = runtimeSnapshot?.availability === 'ready';
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<{ messageId: string; step: ExecutionStep }>();
  const [retrying, setRetrying] = useState<string>();
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try { return Number(localStorage.getItem(WORKSPACE_WIDTH_KEY)) || DEFAULT_WORKSPACE_WIDTH; } catch { return DEFAULT_WORKSPACE_WIDTH; }
  });
  const [availableWidth, setAvailableWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [, tick] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; width: number }>();
  const width = clampWorkspaceWidth(preferredWidth, availableWidth);
  const limits = workspaceWidthLimits(availableWidth);
  useEffect(() => {
    const container = panel.current?.parentElement;
    if (!container) return;
    const measure = () => setAvailableWidth(container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!lanes.length && !runtimeSnapshot?.tasks.some(task => task.conversation_id === conversationId && taskIsActive(task, verified))) return; const timer = window.setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, [lanes.length, runtimeSnapshot?.tasks.some(task => task.conversation_id === conversationId && taskIsActive(task, verified))]);
  function save(value: number) { setPreferredWidth(value); try { localStorage.setItem(WORKSPACE_WIDTH_KEY, String(value)); } catch { /* optional width */ } }
  function start(event: PointerEvent<HTMLDivElement>) { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, width }; setDragging(true); }
  function move(event: PointerEvent<HTMLDivElement>) { const from = drag.current; if (from?.id === event.pointerId) setPreferredWidth(clampWorkspaceWidth(from.width + from.x - event.clientX, availableWidth)); }
  function end(event: PointerEvent<HTMLDivElement>) { const from = drag.current; if (from?.id !== event.pointerId) return; drag.current = undefined; setDragging(false); if (event.type === 'pointerup') save(clampWorkspaceWidth(from.width + from.x - event.clientX, availableWidth)); else setPreferredWidth(from.width); }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) { const next = { ArrowLeft: width + 24, ArrowRight: width - 24, Home: limits.min, End: limits.max }[event.key]; if (next !== undefined) { event.preventDefault(); save(clampWorkspaceWidth(next, availableWidth)); } }
  const byId = new Map(available.map(agent => [agent.id, agent]));
  const all: Item[] = [];
  for (const message of messages.filter(message => message.role === 'assistant')) {
    const lane = lanes.find(item => item.messageId === message.id);
    const execution = lane?.execution || message.reply_meta?.execution;
    const native = message.reply_meta?.transport === 'dsh-native' || lane?.name === 'Somnus';
    const agent = lane?.name || (native ? 'Somnus' : message.reply_meta?.provider_name || 'Somnus');
    if (lane || message.reply_meta?.transport === 'acp') {
      const previous = messages[messages.indexOf(message) - 1];
      const currentStep = execution?.steps.find(step => step.status === 'in_progress');
      all.push({ key: message.id, name: agent, title: previous?.role === 'user' ? previous.content : agent + ' 的任务',
        messageId: message.id, working: Boolean(lane), failed: Boolean(lane?.error) || message.status === 'error',
        status: lane ? lane.stopping ? '正在停止' : lane.approval ? '等待你处理' : stageLabels[lane.stage || 'working'] : message.status === 'complete' ? '已完成' : message.status === 'cancelled' ? '已停止' : '未完成',
        at: lane?.startedAt, duration: message.reply_meta?.elapsed_ms, detail: lane?.error || currentStep?.title });
    }
    for (const step of execution?.steps.filter(step => step.kind === 'subagent') || []) {
      const working = Boolean(lane) && (step.status === 'in_progress' || step.status === 'pending');
      all.push({ key: message.id + ':' + step.id, name: 'Somnus 子 Agent', title: step.title,
        status: working ? step.status === 'pending' ? '等待中' : '工作中' : step.status === 'completed' ? '已完成' : step.status === 'failed' ? '失败' : '未完成',
        working, failed: step.status === 'failed', messageId: message.id, detail: step.failure_reason, duration: step.duration_ms,
        ...(native && window.somnusNativeDshChat?.subagentDetail ? { step } : {}) });
    }
  }
  for (const lane of lanes.filter(lane => !lane.messageId)) all.push({ key: lane.agentId || 'Somnus', name: lane.name, title: '正在准备任务', working: true, status: '准备中', at: lane.startedAt });
  if (canonical && runtimeSnapshot) {
    all.length = 0;
    for (const task of runtimeSnapshot.tasks.filter(task => task.conversation_id === conversationId)) {
      const message = messages.find(message => message.id === task.message_id);
      const execution = lanes.find(lane => lane.messageId === task.message_id)?.execution || message?.reply_meta?.execution;
      const stepId = task.id.startsWith(task.message_id + ':') ? task.id.slice(task.message_id.length + 1) : undefined;
      const step = task.parent_task_id ? execution?.steps.find(step => step.id === stepId) : undefined;
      const working = taskIsActive(task, verified);
      const uncertain = task.status === 'disconnected' || task.status === 'interrupted' || !verified && ['queued', 'connecting', 'running', 'waiting_approval', 'cancelling'].includes(task.status);
      all.push({ key: task.id, task, name: task.agent_name || (task.parent_task_id ? 'Somnus 子 Agent' : 'Somnus'),
        title: task.title || (task.parent_task_id && step?.title) || (task.agent_name || 'Agent') + ' 的任务',
        messageId: task.message_id, status: taskLabel(task, verified), working, uncertain,
        failed: task.status === 'failed', detail: task.error?.message || task.progress?.title,
        at: working && task.started_at ? task.started_at * 1000 : undefined,
        duration: task.ended_at && task.started_at ? Math.max(0, task.ended_at - task.started_at) * 1000 : undefined,
        ...(step && !uncertain && window.somnusNativeDshChat?.subagentDetail ? { step } : {}) });
    }
  }
  const active = all.filter(item => item.working);
  const uncertain = all.filter(item => item.uncertain);
  const done = all.filter(item => !item.working && !item.uncertain).reverse();
  function row(item: Item) {
    return <button type="button" className="agent-activity-task" key={item.key} data-failed={item.failed || undefined}
      onClick={() => item.step && item.messageId ? setDetail({ messageId: item.messageId, step: item.step }) : item.task ? setFocusedTask(item.task.id) : item.messageId && onJump(item.messageId)}>
      <span className="agent-activity-task-avatar">{item.step ? <ApartmentOutlined /> : <AgentAvatar name={item.name} />}</span>
      <span className="agent-activity-task-copy"><strong>{item.title || item.name + ' 的任务'}</strong><small>{item.name} · {item.status}</small>{item.detail && <span className="agent-activity-task-detail">{item.detail}</span>}</span>
      <span className="agent-activity-task-time">{item.working ? <LoadingOutlined /> : item.failed || item.uncertain ? <span aria-label={item.failed ? '失败' : '需要确认'}>!</span> : <CheckOutlined />}{item.at ? elapsed(Date.now() - item.at) : item.duration !== undefined ? elapsed(item.duration) : ''}</span>
    </button>;
  }
  return <aside ref={panel} className="chat-workspace-panel agent-activity-panel" aria-label="Agent 任务面板" style={{ width }} data-resizing={dragging || undefined}>
    <div className="workspace-panel-resizer" role="separator" aria-label="调整任务面板宽度" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={keyboard} />
    <header className="agent-activity-heading"><div><strong>Agent 任务</strong><small>当前会话的成员与执行情况</small></div><Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭任务面板" onClick={onClose} /></header>
    <div className="agent-activity-content">
      {runtimeSnapshot?.availability === 'loading' && <p className="agent-activity-empty" role="status">正在同步任务状态…</p>}
      {runtimeSnapshot?.availability === 'offline' && <Alert type="warning" showIcon message="任务状态暂不可确认" description="这里只显示最后记录；不会自动重发任务。" action={<Button size="small" onClick={refreshRuntimeTasks}>重试</Button>} />}
      {runtimeSnapshot?.truncated && <p className="agent-activity-empty">任务记录已达到读取上限，较早内容仍保留在会话日志中。</p>}
      {runtimeSnapshot?.availability === 'legacy' && <p className="agent-activity-empty">当前服务尚未提供统一状态，以下仅为本页可见记录。</p>}
      {members.length > 0 && <section className="agent-activity-members" aria-label="Agent 连接状态"><h3>会话成员 <span>{members.length}</span></h3>{members.map(id => {
        const state = connections.find(item => item.agentId === id);
        const name = byId.get(id)?.name || 'Agent 不可用';
        const lane = canonical ? undefined : lanes.find(item => item.agentId === id);
        const task = runtimeSnapshot?.tasks.filter(task => task.conversation_id === conversationId && task.agent_id === id && !task.parent_task_id).sort((a, b) => b.created_at - a.created_at)[0];
        const taskLabelText = canonical && task && (taskIsActive(task, verified) || task.status === 'disconnected' || !verified && ['queued', 'connecting', 'running', 'waiting_approval', 'cancelling'].includes(task.status)) ? taskLabel(task, verified) : undefined;
        const terminalConnection = canonical && task && verified && !taskIsActive(task, verified) && task.status !== 'disconnected' && (state?.state === 'running' || state?.state === 'approval');
        const unverifiedConnection = canonical && (state?.state === 'running' || state?.state === 'approval') && (!verified || !task);
        const label = taskLabelText || (unverifiedConnection ? '任务状态待确认' : terminalConnection ? '待命' : lane ? lane.approval ? '等待你处理' : lane.stopping ? '正在停止' : '工作中' : !state ? '连接中' : { ready: '待命', running: '工作中', approval: '等待你处理', connecting: '连接中', disconnected: '已断开', error: '连接失败' }[state.state]);
        const reconnect = !taskLabelText && (state?.state === 'error' || state?.state === 'disconnected');
        return <div className="agent-activity-member" key={id}><AgentAvatar name={name} /><span><strong>{name}</strong><small>{label}</small></span><i data-state={unverifiedConnection ? 'disconnected' : terminalConnection ? 'ready' : taskLabelText ? task?.status === 'waiting_approval' ? 'approval' : verified && task?.status !== 'disconnected' ? 'running' : 'disconnected' : lane ? lane.approval ? 'approval' : 'running' : state?.state || 'connecting'} />{reconnect && <Tooltip title={state?.error || '重新连接'}><Button type="text" size="small" aria-label={'重新连接 ' + name} loading={retrying === id} icon={<ReloadOutlined />} onClick={() => {
          setRetrying(id); void mainChatBridge()?.warmConversation?.({ conversationId, agentIds: [id] }).catch(() => {}).finally(() => setRetrying(undefined));
        }} /></Tooltip>}</div>;
      })}</section>}
      <section className="agent-activity-section" aria-label="进行中的 Agent 任务"><h3>进行中 <span>{active.length}</span></h3>{active.length ? active.map(row) : <p className="agent-activity-empty">暂无进行中的任务</p>}</section>
      {uncertain.length > 0 && <section className="agent-activity-section" aria-label="需要确认的 Agent 任务"><h3>需要确认 <span>{uncertain.length}</span></h3>{uncertain.map(row)}</section>}
      <section className="agent-activity-section" aria-label="已结束的 Agent 任务"><h3>已结束 <span>{done.length}</span></h3>{done.length ? (showAll ? done : done.slice(0, 6)).map(row) : <p className="agent-activity-empty">任务完成后会显示在这里</p>}{done.length > 6 && <Button type="text" className="agent-activity-more" onClick={() => setShowAll(value => !value)}>{showAll ? '收起记录' : '再显示 ' + (done.length - 6) + ' 项'}</Button>}</section>
    </div>
    {focusedTask && runtimeSnapshot?.tasks.find(task => task.id === focusedTask) && <RuntimeTaskDetails task={runtimeSnapshot.tasks.find(task => task.id === focusedTask)!} available={verified} onJump={onJump} onClose={() => setFocusedTask(undefined)} />}
    {detail && <SubagentDetail scope={{ conversationId, turnId: detail.messageId }} step={all.find(item => item.key === detail.messageId + ':' + detail.step.id)?.step || detail.step} onClose={() => setDetail(undefined)} />}
  </aside>;
}
