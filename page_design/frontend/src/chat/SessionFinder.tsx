import { useEffect, useState } from 'react';
import { Alert, Button, Dropdown, Input, Segmented, Select, Spin, Tag } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, PushpinOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { sessionIndex, workspaces } from './assistantApi';
import type { Conversation, ConversationAgent, ConversationOrganization, Workspace } from './assistantApi';
import { formatDateTime } from '../shared/format.mjs';
import './session-management.css';
import type { RuntimeTaskSnapshot } from '../runtime/runtimeTasks';
import { runtimeConversation } from '../runtime/runtimeTasks';

type Filter = 'active' | 'running' | 'attention' | 'archived';
type Row = { workspace: string; item: Conversation; agent?: ConversationAgent | null; status?: string; needsAttention: boolean; running: boolean };
type Props = {
  workspace: string;
  runtimeSnapshot?: RuntimeTaskSnapshot;
  currentItems: Conversation[];
  activeId?: string;
  activeTurns: ReadonlyMap<string, { workspace: string; conversation: Conversation; stopping: boolean; runningAgent?: ConversationAgent }>;
  attention: ReadonlyMap<string, { workspace: string; title: string; label: string }>;
  locked: boolean;
  onOpen: (workspace: string, id: string) => void;
  onOrganize: (item: Conversation, changes: ConversationOrganization) => Promise<Conversation>;
  onRename: (item: Conversation) => void;
  onDelete: (item: Conversation) => void;
};

export function SessionFinder({ runtimeSnapshot, workspace, currentItems, activeId, activeTurns, attention, locked, onOpen, onOrganize, onRename, onDelete }: Props) {
  const [projects, setProjects] = useState<Workspace[]>([]);
  const [index, setIndex] = useState<Conversation[]>([]);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [actionError, setActionError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string>();
  const runningIds = [...activeTurns.keys()].sort().join(',');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    void Promise.allSettled([workspaces(controller.signal), sessionIndex(controller.signal)]).then(([projectResult, indexResult]) => {
      if (controller.signal.aborted) return;
      if (projectResult.status === 'fulfilled') setProjects(projectResult.value);
      if (indexResult.status === 'fulfilled') {
        setIndex(indexResult.value.conversations);
        setTruncated(indexResult.value.truncated);
      }
      setLoadFailed(projectResult.status === 'rejected' || indexResult.status === 'rejected');
      setLoading(false);
    });
    return () => controller.abort();
  }, [refresh, runningIds]);

  async function organize(item: Conversation, changes: ConversationOrganization) {
    setBusy(item.id);
    setActionError('');
    try {
      const next = await onOrganize(item, changes);
      setIndex(old => [{ ...item, ...next }, ...old.filter(value => value.id !== item.id)]);
      setRefresh(value => value + 1);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : '会话状态更新失败');
    } finally {
      setBusy(undefined);
    }
  }

  const names = new Map(projects.map(project => [project.id, project.name]));
  const displayProject = (id: string) => names.get(id) || (id === 'default' ? '默认项目' : '项目');
  const listed = new Map(index.map(item => [item.id, item]));
  for (const item of currentItems) {
    if (!listed.has(item.id)) listed.set(item.id, { ...item, workspace_id: workspace });
  }
  for (const turn of activeTurns.values()) {
    if (!listed.has(turn.conversation.id)) {
      listed.set(turn.conversation.id, { ...turn.conversation, workspace_id: turn.workspace });
    }
  }
  const allRows: Row[] = [...listed.values()].map(item => {
    const live = activeTurns.get(item.id);
    const pending = attention.get(item.id);
    const runtime = runtimeSnapshot && runtimeSnapshot.availability !== 'legacy' ? runtimeConversation(runtimeSnapshot, item.id) : undefined;
    const running = runtime ? runtime.active_count > 0 : Boolean(live || item.running);
    return {
      item,
      workspace: item.workspace_id || live?.workspace || workspace,
      agent: (() => { const agent = live?.runningAgent || item.last_agent; return agent && agent.transport !== 'acp' ? { ...agent, name: 'Somnus' } : agent; })(),
      running,
      needsAttention: Boolean(pending || runtime && runtime.attention_count > 0),
      status: pending?.label || (runtime ? runtime.label : live?.stopping ? '正在停止' : running ? '运行中' : undefined),
    };
  });
  const agents = new Map<string, string>();
  for (const { agent } of allRows) {
    if (agent?.name) agents.set(agent.id || agent.name, agent.name);
  }
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows = allRows.filter(({ workspace, item, agent, running, needsAttention }) => {
    if (Boolean(item.archived) !== (filter === 'archived')) return false;
    if (projectFilter && workspace !== projectFilter) return false;
    if (agentFilter && (agent?.id || agent?.name) !== agentFilter) return false;
    if (filter === 'attention' && !needsAttention) return false;
    if (filter === 'running' && !running) return false;
    const searchable = [item.title || '新会话', displayProject(workspace), item.worktree?.branch, agent?.name, agent?.model]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }).sort((a, b) => b.item.updated_at - a.item.updated_at);

  function group(row: Row) {
    if (row.item.archived) return '归档会话';
    if (row.needsAttention) return '需要你处理';
    if (row.running) return '运行中';
    return row.item.pinned ? '置顶' : '最近会话';
  }

  function renderRow(row: Row) {
    const { item, workspace: project, agent, status, needsAttention, running } = row;
    const title = item.title || '新会话';
    const lockedRow = locked || loading || Boolean(busy);
    const items: MenuProps['items'] = item.archived
      ? [{ key: 'restore', label: '恢复会话' }]
      : [
          { key: 'pin', label: item.pinned ? '取消置顶' : '置顶会话' },
          { key: 'rename', label: '重命名', disabled: running || needsAttention },
          { key: 'archive', label: '归档会话', disabled: running || needsAttention },
          { type: 'divider' },
          { key: 'delete', label: '删除会话', danger: true, disabled: running || needsAttention },
        ];
    return <div key={item.id} className="session-manager-row" data-selected={item.id === activeId}
      onClick={event => { if (!locked && !busy && !item.archived && !(event.target as HTMLElement).closest('button, [role="menuitem"]')) onOpen(project, item.id); }}>
      <button type="button" className="session-manager-open" disabled={locked || Boolean(busy) || item.archived}
        aria-current={item.id === activeId ? 'true' : undefined} onClick={() => onOpen(project, item.id)}>
        <span className="session-manager-title">
          {item.pinned && <PushpinOutlined aria-label="已置顶" />}
          <strong title={title}>{title}</strong>
        </span>
        <span className="session-manager-meta">
          {displayProject(project)} · {formatDateTime(item.updated_at)}{item.worktree?.branch ? ' · ' + item.worktree.branch : ''}
        </span>
      </button>
      <div className="session-manager-state">
        {agent?.name && <span title={agent.model ? agent.name + ' · ' + agent.model : agent.name}>
          {agent.name}{agent.model ? ' · ' + agent.model : ''}
        </span>}
        {status && <Tag color={needsAttention ? 'gold' : 'processing'}>{status}</Tag>}
      </div>
      <Dropdown trigger={['click']} disabled={lockedRow} menu={{ items, onClick: ({ key }) => {
        if (key === 'pin') void organize(item, { pinned: !item.pinned });
        if (key === 'archive' || key === 'restore') void organize(item, { archived: key === 'archive' });
        if (key === 'rename') onRename(item);
        if (key === 'delete') onDelete(item);
      } }}>
        <Button type="text" size="small" icon={<EllipsisOutlined />} loading={busy === item.id}
          disabled={lockedRow} aria-label={`更多会话操作：${title}`} aria-haspopup="menu" />
      </Dropdown>
    </div>;
  }

  return <div className="session-manager">
    <div className="session-manager-search">
      <Input autoFocus allowClear prefix={<SearchOutlined />} aria-label="搜索会话"
        placeholder="搜索会话标题、项目、Agent 或分支" value={query} onChange={event => setQuery(event.target.value)} />
      <Button icon={<ReloadOutlined />} aria-label="刷新会话列表" title="刷新会话列表"
        loading={loading} disabled={Boolean(busy)} onClick={() => setRefresh(value => value + 1)} />
    </div>
    <div className="session-manager-filters">
      <Segmented aria-label="按会话状态筛选" value={filter} onChange={setFilter} options={[
        { label: '全部会话', value: 'active' }, { label: '运行中', value: 'running' },
        { label: '待处理', value: 'attention' }, { label: '已归档', value: 'archived' },
      ]} />
      <Select aria-label="按项目筛选" value={projectFilter} onChange={setProjectFilter} popupMatchSelectWidth={false}
        options={[{ label: '全部项目', value: '' }, ...projects.map(project => ({ label: project.name, value: project.id }))]} />
      <Select aria-label="按 Agent 筛选" value={agentFilter} onChange={setAgentFilter} popupMatchSelectWidth={false}
        options={[{ label: '全部 Agent', value: '' }, ...[...agents].sort((a, b) => a[1].localeCompare(b[1]))
          .map(([value, label]) => ({ label, value }))]} />
    </div>
    {runtimeSnapshot?.availability === 'offline' && <Alert showIcon type="warning" message="任务状态暂不可确认，已保留最后记录。" />}
    {loadFailed && <Alert showIcon type="warning" message="部分会话或项目暂时无法读取"
      action={<Button size="small" onClick={() => setRefresh(value => value + 1)}>重试</Button>} />}
    {actionError && <Alert showIcon type="error" message={actionError} />}
    {truncated && <p className="small-note">列表已达到读取上限，仅显示部分会话。</p>}
    <div className="session-manager-results" aria-busy={loading} aria-label="会话列表">
      {loading && <div className="session-manager-empty"><Spin size="small" /> 正在读取会话</div>}
      {!loading && !rows.length && <p className="session-manager-empty">没有符合条件的会话</p>}
      {['需要你处理', '运行中', '置顶', '最近会话', '归档会话'].map(label => {
        const section = rows.filter(row => group(row) === label);
        return section.length > 0 && <section key={label} aria-label={label} className="session-manager-section">
          <h3>{label} <span>{section.length}</span></h3>
          {section.map(renderRow)}
        </section>;
      })}
    </div>
  </div>;
}
