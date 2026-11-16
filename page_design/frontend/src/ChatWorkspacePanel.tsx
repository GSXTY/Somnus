import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Alert, Button, Input, Select, Spin } from 'antd';
import { CloseOutlined, CodeOutlined, FileOutlined, FolderOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { conversationTrace } from './assistantApi';
import type { ConversationTraceEvent, ConversationWorktree, FileProposal } from './assistantApi';
import { FileChangeCards, FileProposalReview } from './FileProposalReview';
import { ProjectToolsPanel } from './ProjectTools';
import { clampWorkspaceWidth, DEFAULT_WORKSPACE_WIDTH, WORKSPACE_WIDTH_KEY, workspaceWidthLimits } from './workspacePanelWidth.mjs';
import './chatWorkspacePanel.css';

type Source = { source: string; label: string };
type Entry = { name: string; path: string; kind: 'folder' | 'file' };
type Listing = { entries: Entry[]; folders: Source[]; folder: string; source?: string; truncated?: boolean };
type TerminalRequest = { command: string; cwd: string; timeoutSeconds: number };
type Props = {
  conversationId: string;
  workspace: string;
  worktree?: ConversationWorktree | null;
  proposals: FileProposal[];
  onDecision: (proposal: FileProposal) => void;
  onClose: () => void;
  onRequestCommand?: (command: string) => void;
  terminalApproval?: TerminalRequest;
  running?: boolean;
};

async function workspaceFiles<T>(cid: string, params: URLSearchParams, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api/assistant/conversations/' + encodeURIComponent(cid) + '/workspace-files?' + params,
    { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : '无法打开项目文件'));
  return data;
}

function WorkspaceFiles({ cid }: { cid: string }) {
  const [source, setSource] = useState('');
  const [folder, setFolder] = useState('');
  const [file, setFile] = useState<Entry>();
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<Listing>();
  const [content, setContent] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setContent(undefined);
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    if (file) params.set('file', file.path);
    else params.set('folder', folder);
    async function load() {
      try {
        if (file) {
          const result = await workspaceFiles<{ file: { content: string } }>(cid, params, controller.signal);
          if (typeof result.file?.content !== 'string') throw new Error('无法预览此文件');
          if (!controller.signal.aborted) setContent(result.file.content);
        } else {
          const result = await workspaceFiles<Listing>(cid, params, controller.signal);
          if (!Array.isArray(result.entries) || !Array.isArray(result.folders)) throw new Error('文件列表格式不正确');
          if (!controller.signal.aborted) setListing(result);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '无法读取项目文件');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [cid, source, folder, file, refresh]);
  const sources = listing?.folders || [];
  const parent = folder.split('/').slice(0, -1).join('/');
  return <section aria-label="项目文件">
    {sources.length > 1 && <Select
      aria-label="项目来源目录"
      className="workspace-panel-source"
      value={source || listing?.source || sources[0]?.source}
      onChange={value => { setSource(value); setFolder(''); setFile(undefined); setListing(undefined); }}
      options={sources.map(item => ({ label: item.label, value: item.source }))}
    />}
    <div className="workspace-panel-row">
      {(file || folder) && <Button size="small" onClick={() => file ? setFile(undefined) : setFolder(parent)}>上一级</Button>}
      <code>{file?.path || folder || '项目文件'}</code>
      <Button type="text" size="small" aria-label="刷新项目文件" icon={<ReloadOutlined />} onClick={() => setRefresh(value => value + 1)} />
    </div>
    {loading ? <Spin size="small" /> : error ? <Alert type="error" showIcon message={error} /> : file ?
      <pre className="workspace-panel-text" tabIndex={0}>{content}</pre> : <>
        {listing?.truncated && <p className="workspace-panel-hint">此目录还有更多文件。</p>}
        {listing?.entries.length ? <ul className="workspace-panel-files">{listing.entries.map(entry =>
          <li key={entry.path}><button type="button" title={entry.name} onClick={() => {
            if (entry.kind === 'folder') setFolder(entry.path);
            else setFile(entry);
          }}>{entry.kind === 'folder' ? <FolderOutlined /> : <FileOutlined />}<span>{entry.name}</span></button></li>)}</ul>
          : <p className="workspace-panel-hint">{sources.length ? '此目录没有可浏览的文件。' : '请先在项目设置中关联本机文件夹。'}</p>}
      </>}
  </section>;
}

const states: Record<string, string> = {
  pending: '等待处理', completed: '完成', approved: '已批准', failed: '失败',
  rejected: '已拒绝', closed: '已关闭', interrupted: '已中断', cancelled: '已取消',
};

function TerminalView({ conversationId, onRequestCommand, terminalApproval, running }: Props) {
  const [command, setCommand] = useState('');
  const [events, setEvents] = useState<ConversationTraceEvent[]>([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    conversationTrace(conversationId, controller.signal).then(result => {
      if (!controller.signal.aborted) setEvents(result.events.filter(event =>
        /执行命令|PowerShell|项目测试|run_project_tests|run_project_powershell/i.test(event.title)).slice(-12).reverse());
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '无法读取执行状态');
    });
    return () => controller.abort();
  }, [conversationId, running, refresh]);
  return <section aria-label="PowerShell">
    <div className="workspace-panel-row"><h3><CodeOutlined /> PowerShell</h3>
      <Button type="text" size="small" aria-label="刷新执行状态" icon={<ReloadOutlined />} onClick={() => setRefresh(value => value + 1)} />
    </div>
    {terminalApproval && <div className="workspace-terminal-approval">
      <strong>等待会话确认</strong>
      <pre className="workspace-panel-text">{terminalApproval.command}</pre>
      <code>{terminalApproval.cwd}</code>
      <p className="workspace-panel-hint">超时 {terminalApproval.timeoutSeconds} 秒。请在会话中确认。</p>
    </div>}
    {onRequestCommand && <div className="workspace-terminal-draft">
      <Input.TextArea aria-label="PowerShell 命令" placeholder="输入 PowerShell 命令" value={command}
        onChange={event => setCommand(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={4000} />
      <Button disabled={!command.trim()} onClick={() => onRequestCommand(command.trim())}>填入会话</Button>
      <p className="workspace-panel-hint">发送后由 Agent 发起执行申请。</p>
    </div>}
    {error && <Alert type="error" showIcon message={error} />}
    {events.length ? <ul className="workspace-terminal-events">{events.map(event => <li key={event.id}>
      <span>{event.title}</span><small>{states[event.status] || event.status}</small>
    </li>)}</ul> : !error && <p className="workspace-panel-hint">此会话暂无已记录的命令或测试结果。</p>}
  </section>;
}

function WorkspaceNote({ cid }: { cid: string }) {
  const storageKey = 'somnus-workspace-note:' + cid;
  const [note, setNote] = useState(() => sessionStorage.getItem(storageKey) || '');
  return <section aria-label="会话笔记">
    <h3>会话笔记</h3>
    <Input.TextArea aria-label="会话笔记内容" placeholder="记下待办、链接或想法…" value={note}
      autoSize={{ minRows: 8, maxRows: 20 }} maxLength={20000} onChange={event => {
        setNote(event.target.value);
        sessionStorage.setItem(storageKey, event.target.value);
      }} />
  </section>;
}

export function ChatWorkspacePanel(props: Props) {
  const { conversationId, workspace, worktree, proposals, onDecision, onClose } = props;
  const [tab, setTab] = useState('changes');
  const [reviewId, setReviewId] = useState<string>();
  const [noteOpen, setNoteOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try { return Number(localStorage.getItem(WORKSPACE_WIDTH_KEY)) || DEFAULT_WORKSPACE_WIDTH; }
    catch { return DEFAULT_WORKSPACE_WIDTH; }
  });
  const [dragging, setDragging] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; width: number }>();
  const tabsId = useId();
  const width = clampWorkspaceWidth(preferredWidth, availableWidth);
  const limits = workspaceWidthLimits(availableWidth);
  useEffect(() => {
    const container = panel.current?.parentElement;
    if (!container) return;
    const measure = () => setAvailableWidth(container.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  function saveWidth(value: number) {
    try { localStorage.setItem(WORKSPACE_WIDTH_KEY, String(value)); } catch { /* The split still works in memory. */ }
  }
  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, width };
    setDragging(true);
  }
  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start?.id === event.pointerId) {
      setPreferredWidth(clampWorkspaceWidth(start.width + start.x - event.clientX, availableWidth));
    }
  }
  function endResize(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start?.id !== event.pointerId) return;
    drag.current = undefined;
    setDragging(false);
    if (event.type === 'pointerup') {
      const next = clampWorkspaceWidth(start.width + start.x - event.clientX, availableWidth);
      setPreferredWidth(next);
      saveWidth(next);
    } else setPreferredWidth(start.width);
  }
  function keyboardResize(event: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowLeft: width + 24, ArrowRight: width - 24, Home: limits.min, End: limits.max }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const clamped = clampWorkspaceWidth(next, availableWidth);
    setPreferredWidth(clamped);
    saveWidth(clamped);
  }
  const review = proposals.find(item => item.id === reviewId);
  const tabs = [
    { key: 'changes', label: '改动' },
    { key: 'files', label: '文件' },
    { key: 'terminal', label: '终端' },
    ...(noteOpen ? [{ key: 'note', label: '笔记' }] : []),
  ];
  function keyboardTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next = { ArrowLeft: index === 0 ? last : index - 1, ArrowRight: index === last ? 0 : index + 1,
      Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const selected = tabs[next].key;
    setTab(selected);
    panel.current?.querySelector<HTMLButtonElement>(`[data-tab="${selected}"]`)?.focus();
  }
  return <aside ref={panel} className="chat-workspace-panel" aria-label="会话工作区"
    data-resizing={dragging || undefined} style={{ width }}>
    <div className="workspace-panel-resizer" role="separator" aria-label="调整工作区宽度" aria-orientation="vertical"
      aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width} aria-valuetext={width + ' 像素'} tabIndex={0}
      onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}
      onLostPointerCapture={endResize} onKeyDown={keyboardResize} />
    <header className="workspace-panel-header">
      <div className="workspace-panel-tabs" role="tablist" aria-label="工作区视图">
        {tabs.map(({ key, label }, index) => <button key={key} id={tabsId + '-' + key} data-tab={key}
          type="button" role="tab" aria-selected={tab === key} aria-controls={tabsId + '-content'}
          tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => keyboardTabs(event, index)}>{label}</button>)}
      </div>
      <div className="workspace-panel-buttons">
        <Button type="text" size="small" aria-label="新建笔记页" title="新建笔记页" icon={<PlusOutlined />}
          onClick={() => { setNoteOpen(true); setTab('note'); }} />
        <Button type="text" size="small" aria-label="关闭工作区" title="关闭工作区" icon={<CloseOutlined />} onClick={onClose} />
      </div>
    </header>
    <div className="workspace-panel-content" role="tabpanel" id={tabsId + '-content'} aria-labelledby={tabsId + '-' + tab} tabIndex={0}>
      {tab === 'changes' && <section aria-label="会话改动">
          {review ? <><Button size="small" onClick={() => setReviewId(undefined)}>返回改动列表</Button>
            <FileProposalReview key={review.id} preview={review} inline conversationId={conversationId}
              onDecision={onDecision} onClose={() => setReviewId(undefined)} /></> : <>
              {proposals.length > 0 ? <FileChangeCards items={proposals} onPreview={item => setReviewId(item.id)} />
                : <p className="workspace-panel-hint">此会话暂无文件改动。</p>}
              {workspace !== 'default' && window.vvmanProjects?.gitDiff && <>
                <Button size="small" onClick={() => setGitOpen(value => !value)} aria-expanded={gitOpen}>Git 差异</Button>
                {gitOpen && <ProjectToolsPanel workspace={workspace} open conversationId={conversationId} worktree={worktree} />}
              </>}
            </>}
      </section>}
      {tab === 'files' && <WorkspaceFiles cid={conversationId} />}
      {tab === 'terminal' && <TerminalView {...props} />}
      {tab === 'note' && <WorkspaceNote cid={conversationId} />}
    </div>
  </aside>;
}
