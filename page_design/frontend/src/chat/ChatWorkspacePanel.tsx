import { PluginSidebar } from "../plugins/PluginSidebar";
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Alert, Button, Input, Select, Spin } from 'antd';
import { CloseOutlined, CodeOutlined, FileOutlined, FolderOutlined, GlobalOutlined, DiffOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ConversationWorktree, FileProposal } from './assistantApi';
import { FileChangeCards, FileProposalReview } from './FileProposalReview';
import { ProjectToolsPanel } from '../analysis/ProjectTools';
import { clampWorkspaceWidth, DEFAULT_WORKSPACE_WIDTH, WORKSPACE_WIDTH_KEY, workspaceWidthLimits } from '../app/workspacePanelWidth.mjs';
import './chatWorkspacePanel.css';
import { WorkspaceTerminal } from './WorkspaceTerminal';

type WebBounds = { x: number; y: number; width: number; height: number };
declare global {
  interface Window {
    somnusWorkspaceWeb?: {
      show: (url: string, bounds: WebBounds) => Promise<void>;
      bounds: (bounds: WebBounds) => Promise<void>;
      close: () => Promise<void>;
    };
  }
}

type Source = { source: string; label: string };
type Entry = { name: string; path: string; kind: 'folder' | 'file' };
type Listing = { entries: Entry[]; folders: Source[]; folder: string; source?: string; truncated?: boolean };
type Props = {
  conversationId: string;
  workspace: string;
  worktree?: ConversationWorktree | null;
  proposals: FileProposal[];
  webRequest?: { url: string; sequence: number };
  onDecision: (proposal: FileProposal) => void;
  onClose: () => void;
};

async function workspaceFiles<T>(cid: string, params: URLSearchParams, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api/assistant/conversations/' + encodeURIComponent(cid) + '/workspace-files?' + params,
    { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : '无法打开项目文件'));
  return data;
}

type FileWatchEvent={id:string;conversationId:string;kind:'changed'|'scope-changed'|'unavailable';paths:string[];rescan:boolean};
declare global { interface Window { somnusWorkspaceFiles?:{watch:(request:{projectId:string;conversationId:string;source?:string})=>Promise<{id:string}>;unwatch:(id:string,cid:string)=>Promise<void>;onChange:(listener:(event:FileWatchEvent)=>void)=>()=>void} } }
function WorkspaceFiles({ cid, filter, workspace }: { cid: string; filter: string;workspace:string }) {
  const [source, setSource] = useState('');
  const [folder, setFolder] = useState('');
  const [file, setFile] = useState<Entry>();
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<Listing>();
  const [content, setContent] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [watchState,setWatchState]=useState('正在连接文件监听…');
  const actualSource=source||listing?.source||listing?.folders[0]?.source;
  useEffect(()=>{
    const bridge=window.somnusWorkspaceFiles;
    if(!bridge){setWatchState('当前宿主不支持文件监听，请手动刷新');return;}
    if(!actualSource)return;
    let alive=true,id:string|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    setWatchState('正在连接文件监听…');
    const off=bridge.onChange(event=>{
      if(!alive||event.id!==id||event.conversationId!==cid)return;
      if(event.kind==='changed'){
        setWatchState('实时监听已连接');
        clearTimeout(timer);timer=setTimeout(()=>setRefresh(value=>value+1),180);
      }else{setWatchState(event.kind==='scope-changed'?'工作区已变更，请重新选择目录':'文件监听已断开，请手动刷新');}
    });
    void bridge.watch({projectId:workspace,conversationId:cid,source:actualSource}).then(result=>{
      id=result.id;if(!alive){void bridge.unwatch(id,cid).catch(()=>{});return;}setWatchState('实时监听已连接');setRefresh(value=>value+1);
    }).catch(()=>{if(alive)setWatchState('无法建立文件监听，请手动刷新');});
    return()=>{alive=false;off();clearTimeout(timer);if(id)void bridge.unwatch(id,cid).catch(()=>{});};
  },[workspace,cid,actualSource]);
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
  const entries = (listing?.entries || []).filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section aria-label="项目文件">
    <small role="status" className="workspace-file-watch">{watchState}</small>
    {sources.length > 1 && <Select
      aria-label="项目来源目录"
      className="workspace-panel-source"
      value={source || listing?.source || sources[0]?.source}
      onChange={value => { setSource(value); setFolder(''); setFile(undefined); setListing(undefined); }}
      options={sources.map(item => ({ label: item.label, value: item.source }))}
    />}
    <div className="workspace-panel-row">
      {(file || folder) && <Button size="small" onClick={() => file ? setFile(undefined) : setFolder(parent)}>上一级</Button>}
      {file || folder ? <code className="workspace-panel-path">{file?.path || folder}</code> : <h3>项目文件</h3>}
      <Button type="text" size="small" aria-label="刷新项目文件" icon={<ReloadOutlined />} onClick={() => setRefresh(value => value + 1)} />
    </div>
    {loading ? <Spin size="small" /> : error ? <Alert type="error" showIcon message={error} /> : file ?
      <pre className="workspace-panel-text" tabIndex={0}>{content}</pre> : <>
        {listing?.truncated && <p className="workspace-panel-hint">此目录还有更多文件。</p>}
        {entries.length ? <ul className="workspace-panel-files">{entries.map(entry =>
          <li key={entry.path}><button type="button" title={entry.name} onClick={() => {
            if (entry.kind === 'folder') setFolder(entry.path);
            else setFile(entry);
          }}>{entry.kind === 'folder' ? <FolderOutlined /> : <FileOutlined />}<span>{entry.name}</span></button></li>)}</ul>
          : <p className="workspace-panel-hint">{filter ? '此目录没有匹配的文件。' : sources.length ? '此目录没有可浏览的文件。' : '请先在项目设置中关联本机文件夹。'}</p>}
      </>}
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
  const { conversationId, workspace, worktree, proposals, onDecision, onClose, webRequest } = props;
  const [tab, setSelectedTab] = useState('home');
  const [terminalOpened, setTerminalOpened] = useState(false);
  function setTab(next: string) {
    if (next === 'terminal') setTerminalOpened(true);
    setSelectedTab(next);
  }
  const [query, setQuery] = useState('');
  const [fileFilter, setFileFilter] = useState('');
  const [pageForm, setPageForm] = useState(false);
  const [page, setPage] = useState('');
  const [viewError, setViewError] = useState('');
  const [pageError, setPageError] = useState('');
  const webAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!webRequest || !window.somnusWorkspaceWeb) return;
    setPageError('');
    setPage(webRequest.url);
    setTab('web');
  }, [webRequest]);

  useEffect(() => {
    const bridge = window.somnusWorkspaceWeb;
    const anchor = webAnchor.current;
    if (tab !== 'web' || !page || !bridge || !anchor) return;
    let live = true;
    let frame = 0;
    function getBounds() {
      if (document.querySelector('.ant-modal-wrap:not([style*="display: none"]),.ant-dropdown:not(.ant-dropdown-hidden),.ant-select-dropdown:not(.ant-select-dropdown-hidden)')) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      const rect = anchor!.getBoundingClientRect();
      const x = Math.max(0, Math.floor(rect.left));
      const y = Math.max(0, Math.floor(rect.top));
      return { x, y, width: Math.max(0, Math.min(window.innerWidth, Math.floor(rect.right)) - x),
        height: Math.max(0, Math.min(window.innerHeight, Math.floor(rect.bottom)) - y) };
    }
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (live) void bridge.bounds(getBounds()).catch(() => {});
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    observer?.observe(anchor);
    const overlays = new MutationObserver(resize);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    void bridge.show(page, getBounds()).then(resize).catch(failure => {
      if (live) setPageError(failure instanceof Error ? failure.message : '网页无法打开。');
    });
    window.addEventListener('resize', resize);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      overlays.disconnect();
      window.removeEventListener('resize', resize);
      void bridge.close().catch(() => {});
    };
  }, [tab, page]);

  function openFromLauncher() {
    const value = query.trim();
    if (!value) return;
    if (/^https?:\/\//i.test(value)) {
      if (!window.somnusWorkspaceWeb) {
        setViewError('请在 Somnus 桌面版中打开网页。');
        return;
      }
      setPageError('');
      setPage(value);
      setTab('web');
      return;
    }
    if (pageForm) {
      setViewError('请输入以 https:// 或 http:// 开头的网址。');
      return;
    }
    setFileFilter(value);
    setTab('files');
  }
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
    { key: 'home', label: '新标签页' },
    { key: 'changes', label: '改动' },
    { key: 'files', label: '文件' },
    { key: 'terminal', label: '终端' },
    { key: 'plugins', label: '插件' },
    ...(page ? [{ key: 'web', label: '网页' }] : []),
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
        <Button type="text" size="small" aria-label="新标签页" title="新标签页" icon={<PlusOutlined />}
          onClick={() => { setQuery(''); setViewError(''); setPageForm(false); setTab('home'); }} />
        <Button type="text" size="small" aria-label="打开会话笔记" title="会话笔记" icon={<FileOutlined />}
          onClick={() => { setNoteOpen(true); setTab('note'); }} />
        <Button type="text" size="small" aria-label="关闭工作区" title="关闭工作区" icon={<CloseOutlined />} onClick={onClose} />
      </div>
    </header>
    <div className="workspace-panel-content" role="tabpanel" id={tabsId + '-content'} aria-labelledby={tabsId + '-' + tab} tabIndex={0}>
      {tab === 'home' && <section className="workspace-launcher" aria-label="新标签页">
        <Input.Search key={pageForm ? 'address' : 'search'} autoFocus={pageForm}
          aria-label={pageForm ? '输入网页地址' : '筛选文件或输入网址'}
          placeholder={pageForm ? '输入网页地址（https://）' : '筛选项目文件或输入网址'}
          value={query} onChange={event => { setQuery(event.target.value); setViewError(''); }} onSearch={openFromLauncher} />
        {viewError && <Alert type="warning" showIcon message={viewError} />}
        <div className="workspace-launcher-grid">
          <button type="button" onClick={() => setTab('terminal')}><CodeOutlined />终端</button>
          <button type="button" onClick={() => { setQuery(''); setPageForm(true); setViewError(''); }}><GlobalOutlined />新建页面</button>
          <button type="button" onClick={() => setTab('changes')}><DiffOutlined />改动</button>
          <button type="button" onClick={() => { setFileFilter(''); setTab('files'); }}><FolderOutlined />文件</button>
        </div>
      </section>}
      {tab === 'web' && <section className="workspace-web-page" aria-label="网页">
        <div className="workspace-panel-row"><GlobalOutlined /><code title={page}>{page}</code>
          <Button type="text" size="small" aria-label="关闭网页" icon={<CloseOutlined />}
            onClick={() => { setPage(''); setPageForm(false); setQuery(''); setTab('home'); }} />
        </div>
        {pageError && <Alert type="error" showIcon message={pageError} />}
        <div className="workspace-web-anchor" ref={webAnchor} />
      </section>}
      {tab === 'changes' && <section aria-label="会话改动">
          {review ? <><Button size="small" onClick={() => setReviewId(undefined)}>返回改动列表</Button>
            <FileProposalReview key={review.id} preview={review} inline conversationId={conversationId}
              onDecision={onDecision} onClose={() => setReviewId(undefined)} /></> : <>
              {proposals.length > 0 ? <FileChangeCards conversationId={conversationId} items={proposals} onPreview={item => setReviewId(item.id)} />
                : <p className="workspace-panel-hint">此会话暂无文件改动。</p>}
              {workspace !== 'default' && window.vvmanProjects?.gitDiff && <>
                <Button size="small" onClick={() => setGitOpen(value => !value)} aria-expanded={gitOpen}>Git 差异</Button>
                {gitOpen && <ProjectToolsPanel workspace={workspace} open conversationId={conversationId} worktree={worktree} />}
              </>}
            </>}
      </section>}
      {tab === 'files' && <section><Input aria-label="筛选当前目录文件" placeholder="筛选当前目录文件" allowClear
        value={fileFilter} onChange={event => setFileFilter(event.target.value)} />
        <WorkspaceFiles cid={conversationId} filter={fileFilter} workspace={workspace} /></section>}
      {tab === 'plugins' && <PluginSidebar/>}
      {terminalOpened && <WorkspaceTerminal key={worktree?.commit || workspace} workspace={workspace}
        conversationId={conversationId} visible={tab === 'terminal'} />}
      {tab === 'note' && <WorkspaceNote cid={conversationId} />}
    </div>
  </aside>;
}
