import { SomnusMark } from './SomnusMark';
import { DshRecommendationCards } from './DshRecommendationCards';
import { ActionApproval, ExecutionDetails } from './ExecutionDetails';
import { DelegationOutcome, DelegationReview } from './DelegationReview';
import type { PendingDelegation } from './DelegationReview';
import type { AcpPermission } from './assistantAcp';
import type { ContextUsage, DshRecommendation, ExecutionStep, ExecutionSummary, McpApprovalBlocked, ReplyUsage } from './assistantApi';
import { mainChatBridge } from './assistantAcp';
import type { ExternalReasoning, ExternalSelection } from './assistantAcp';
import { ModelSwitch } from './ModelSwitch';
import type { ReasoningEffort } from './assistantApi';
import { PluginChips, PluginPicker } from './PluginPicker';
import type { InstalledPlugin } from './assistantApi';
import { SkillChips, SkillPicker } from './SkillPicker';
import type { Skill } from './assistantApi';
import { PermissionSwitch } from './PermissionSwitch';
import { ChatWorktree, ProjectTools } from './ProjectTools';
import { associateFileProposals, FileChangeCards, FileProposalReview, useFileProposals } from './FileProposalReview';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RecentSessions } from './RecentSessions';
import { Alert, Button, Input, Modal, Skeleton, Space, Spin, Tag, Tooltip } from 'antd';
import { DeleteOutlined, ArrowDownOutlined, FileTextOutlined, LoadingOutlined, PaperClipOutlined, CloseOutlined, EditOutlined, MessageOutlined, PlusOutlined, ReloadOutlined, ArrowUpOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import { assistantStatus, beginExternalTurn, finishExternalTurn, cancelConversation, conversation, conversations, createConversation, deleteConversation, renameConversation, respondToDelegation, respondToMcpApproval, sendMessage } from './assistantApi';
import type { DelegationResult } from './assistantApi';
import type { AssistantStatus, ChatEvent, ChatMessage, ChatAttachment, Conversation, FileProposal } from './assistantApi';

import { isLocalImage, prepareImages } from './assistantImages.mjs';
import { Markdown } from './MarkdownView';
import { formatDateTime } from './format.mjs';
import { describeError } from './errors.mjs';

const tokenFormat = new Intl.NumberFormat('zh-CN');
const ratioFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

function contextFraction(context?: ContextUsage) {
  if (!context || !Number.isFinite(context.used_tokens) || context.used_tokens < 0 ||
    !Number.isFinite(context.max_tokens) || context.max_tokens <= 0) return;
  return Math.min(1, context.used_tokens / context.max_tokens);
}

function ContextMeter({ context }: { context?: ContextUsage }) {
  const used = contextFraction(context);
  if (!context || used === undefined) return null;
  const count = tokenFormat.format(context.used_tokens) + ' / ' + tokenFormat.format(context.max_tokens) + ' tokens';
  const ratios = '已用 ' + ratioFormat.format(used) + ' · 剩余 ' + ratioFormat.format(1 - used);
  return <Tooltip title={<>上下文用量<br />{ratios}<br />{count}</>} trigger={['hover', 'focus']}>
    <button type="button" className="assistant-context-meter" aria-label={'上下文用量，' + ratios + '，' + count}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <circle cx="10" cy="10" r="7" className="assistant-context-track" />
        {used > 0 && <circle cx="10" cy="10" r="7" className="assistant-context-fill" pathLength="100"
          strokeDasharray={(used * 100) + ' 100'} transform="rotate(-90 10 10)" />}
      </svg>
      <span aria-hidden="true">{ratioFormat.format(used)}</span>
    </button>
  </Tooltip>;
}

const statusText = { complete: '已完成', streaming: '生成中', error: '回答未完成', cancelled: '已停止' };

const failureText = (error: unknown) => describeError(error, '请求失败，请稍后重试');

type Draft = {
  text: string; skills: Skill[]; plugins: InstalledPlugin[]; attachments: ChatAttachment[];
  dataFile: { id: string; name: string; row_count: number; columns: string[]; acpOnly?: boolean } | null;
  docFile: { id: string; name: string; kind: string; chars: number; note?: string } | null;
};
type PendingApproval = { conversationId: string; request: AcpPermission; localMcp?: boolean; development?: boolean };
type RunningTurn = {
  conversation: Conversation; workspace: string; messages: ChatMessage[];
  controller?: AbortController; stopping: boolean; error?: string; toolNote?: string;
  contextUsage?: ContextUsage; permission?: PendingApproval; development?: string; developmentJobs?: Set<string>; execution?: { assistantId: string; data: ExecutionSummary };
  delegation?: PendingDelegation;
};

type Props = {
  allowLocalAnalysisUpload?: boolean;
  onModelConfig?: () => void;
  workspace: string;
  visible: boolean;
  sidebar: HTMLElement | null;
  newChatSignal: number;
  onLockedChange: (locked: boolean) => void;
  onOpenChat: () => void;
  onOpenDshPlugin?: (id: string) => void;
};

export function AIAssistant({ workspace, visible, sidebar, newChatSignal, onLockedChange, onOpenChat, onModelConfig, onOpenDshPlugin, allowLocalAnalysisUpload = true }: Props) {
  const [chosenModel, setChosenModel] = useState<{ id?: string; effort?: ReasoningEffort }>(() => {
    try { return JSON.parse(localStorage.getItem('vvman.chat-model') || '{}') || {}; } catch { return {}; }
  });
  function chooseModel(id?: string, effort?: ReasoningEffort) {
    setChosenModel({ id, effort });
    try { localStorage.setItem('vvman.chat-model', JSON.stringify({ id, effort })); } catch { /* optional preference */ }
  }
  const [external, setExternal] = useState<ExternalSelection>();
  const externalBridge = mainChatBridge();
  const [reasoning, setReasoning] = useState<{ key: string; settings?: ExternalReasoning }>();
  const [reasoningChoices, setReasoningChoices] = useState<Record<string, string>>({});
  const [companyRuntime, setCompanyRuntime] = useState<{ model?: string; agentId: string }>();
  const turns = useRef(new Map<string, RunningTurn>());
  const drafts = useRef(new Map<string, Draft>());
  const turnErrors = useRef(new Map<string, string>());
  const creatingTurn = useRef(false);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [, setTurnRevision] = useState(0);
  const refreshTurns = () => { if (alive.current) setTurnRevision(version => version + 1); };
  const lastKey = workspace === 'default' ? 'ya70-assistant-last-conversation' : 'ya70-assistant-last-conversation.' + workspace;
  const [status, setStatus] = useState<AssistantStatus | null>(null), [statusLoading, setStatusLoading] = useState(true);
  const [items, setItems] = useState<Conversation[]>([]), [active, setActive] = useState<Conversation | null>(null);
  const [history, setMessages] = useState<ChatMessage[]>([]), [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const selectedTurn = active ? turns.current.get(active.id) : undefined;
  const messages = selectedTurn?.messages || history;
  const busy = Boolean(selectedTurn);
  const stopping = Boolean(selectedTurn?.stopping);
  const [error, setError] = useState(''), [statusError, setStatusError] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]), [imageLoading, setImageLoading] = useState(false);
  const [dataFile, setDataFile] = useState<{ id: string; name: string; row_count: number; columns: string[]; acpOnly?: boolean } | null>(null);
  const [dataUploading, setDataUploading] = useState(false);
  const [docFile, setDocFile] = useState<{ id: string; name: string; kind: string; chars: number; note?: string } | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null), [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), imageLock = useRef(false), deleteLock = useRef(false), listToken = useRef(0);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null), [name, setName] = useState(''), [renameError, setRenameError] = useState(''), [renameBusy, setRenameBusy] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const openSearch = () => { setSearchQuery(''); setSearchOpen(true); };
    window.addEventListener('workbench:search-conversations', openSearch);
    return () => window.removeEventListener('workbench:search-conversations', openSearch);
  }, []);
  const [fileProposals, setFileProposals] = useState<Record<string, FileProposal[]>>({});
  const [proposalPreview, setProposalPreview] = useState<{ conversationId: string; item: FileProposal }>();
  const proposalConversation = window.vvmanProjects ? active?.id : undefined;
  const proposals = useFileProposals(proposalConversation, proposalConversation ? fileProposals[proposalConversation] : undefined);
  const { byReply: proposalReplies, legacy: legacyProposals } = associateFileProposals(proposals.items, messages);
  function previewProposal(item: FileProposal) {
    if (proposalConversation) setProposalPreview({ conversationId: proposalConversation, item });
  }
  const liveExecution = selectedTurn?.execution;
  const permissionRequest = selectedTurn?.permission;
  const toolNote = selectedTurn?.toolNote;
  const visibleError = error || selectedTurn?.error || (active && turnErrors.current.get(active.id));
  const [mcpBlocked, setMcpBlocked] = useState<Record<string, McpApprovalBlocked>>({});
  const alive = useRef(true), activeId = useRef<string | null>(null), historyToken = useRef(0), log = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);
  const canChat = Boolean(external ? externalBridge : !statusLoading && status?.configured && status.capabilities.chat);
  const companyAgent = !external && !chosenModel.effort && !statusLoading && companyRuntime?.model === chosenModel.id && companyRuntime
    ? { agentId: companyRuntime.agentId, agentName: '公司默认', modelName: status?.model || undefined }
    : undefined;
  const selectedAgent = external || companyAgent;
  const reasoningAgentId = selectedAgent?.agentId;
  const lastReply = messages.slice().reverse().find(message => message.role === 'assistant')?.reply_meta;
  const lastReplyMatches = reasoningAgentId ? lastReply?.provider_id === reasoningAgentId &&
    (!external?.modelName || lastReply.model === external.modelName) : !statusLoading &&
    (chosenModel.id ? lastReply?.provider_id === chosenModel.id : lastReply?.model === status?.model);
  const savedContext = lastReplyMatches ? lastReply?.context : undefined;
  const activeContext = selectedTurn ? selectedTurn.contextUsage : savedContext;
  const reasoningModelId = external?.modelId;
  const reasoningKey = reasoningAgentId && JSON.stringify([reasoningAgentId, reasoningModelId]);
  const reasoningSettings = reasoningKey && reasoning?.key === reasoningKey ? reasoning.settings : undefined;
  const reasoningChoice = reasoningKey ? reasoningChoices[reasoningKey] : undefined;
  const reasoningValue = reasoningSettings?.options.some(option => option.id === reasoningChoice) ? reasoningChoice : undefined;
  useEffect(() => {
    if (!externalBridge?.discoverModels || !reasoningAgentId || !reasoningKey || !visible) return;
    let current = true;
    void externalBridge.discoverModels(reasoningAgentId, reasoningModelId).then(result => {
      if (current) setReasoning({ key: reasoningKey, settings: result.reasoning });
    }).catch(() => { if (current) setReasoning({ key: reasoningKey }); });
    return () => { current = false; };
  }, [externalBridge, reasoningAgentId, reasoningModelId, reasoningKey, visible]);
  const agentReasoning = reasoningKey ? {
    settings: reasoningSettings,
    value: reasoningValue,
    onChange: (value: string) => setReasoningChoices(previous => ({ ...previous, [reasoningKey]: value })),
  } : undefined;
  const [permissionSaving, setPermissionSaving] = useState(false);
  const worktreeLock = useRef(false);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const navigationLocked = worktreeBusy || permissionSaving || creatingTurn.current || loading || deleteBusy || renameBusy || imageLoading || dataUploading || docUploading;
  const locked = navigationLocked || busy;
  useEffect(() => onLockedChange(navigationLocked), [navigationLocked, onLockedChange]);
  const imageBlocked = !external && attachments.length > 0 && !status?.capabilities.vision;
  async function addImages(files: File[]) {
    if (locked || imageLock.current || !files.length) return;
    imageLock.current = true; setImageLoading(true); setError('');
    try { const next = await prepareImages(files, attachments); if (alive.current) setAttachments(next); }
    catch (failure) { if (alive.current) setError(failureText(failure)); }
    finally { imageLock.current = false; if (alive.current) setImageLoading(false); }
  }
  function choose(item: Conversation) {
    activeId.current = item.id; setActive(item);
    try { localStorage.setItem(lastKey, item.id); } catch { /* history remains on server */ }
  }
  function updateItem(item: Conversation) { setItems(old => [item, ...old.filter(value => value.id !== item.id)].sort((a, b) => b.updated_at - a.updated_at)); }
  const statusRequest = useRef(0);
  async function loadStatus() {
    const request = ++statusRequest.current;
    setStatusLoading(true); setStatusError('');
    setCompanyRuntime(undefined);
    try {
      const [next, runtime] = await Promise.all([
        assistantStatus(undefined, chosenModel.id),
        externalBridge?.companyRuntime?.(chosenModel.id).catch(() => null),
      ]);
      if (alive.current && request === statusRequest.current) {
        setStatus(next);
        setCompanyRuntime(runtime ? { model: chosenModel.id, agentId: runtime.agentId } : undefined);
      }
    }
    catch (failure) { if (alive.current && request === statusRequest.current) { setStatus(null); setStatusError(failureText(failure)); } }
    finally { if (alive.current && request === statusRequest.current) setStatusLoading(false); }
  }
  async function openHistory(id: string) {
    const token = ++historyToken.current;
    setError('');
    const running = turns.current.get(id);
    if (running) {
      choose(running.conversation);
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessages([]);
    try {
      const result = await conversation(id);
      if (alive.current && workspaceRef.current === workspace && token === historyToken.current) { choose(result.conversation); setMessages(result.messages); }
    } catch (failure) { if (alive.current && workspaceRef.current === workspace && token === historyToken.current) { activeId.current = null; setActive(null); setError(failureText(failure)); } }
    finally { if (alive.current && workspaceRef.current === workspace && token === historyToken.current) setLoading(false); }
  }
  async function loadList(restore = false) {
    const token = ++listToken.current;
    try {
      const list = await conversations(undefined, workspace); if (!alive.current || workspace !== workspaceRef.current || token !== listToken.current) return;
      const current = list.map(item => turns.current.get(item.id)?.conversation || item);
      const supplied = new Set(current.map(item => item.id));
      for (const turn of turns.current.values()) {
        if (turn.workspace === workspace && !supplied.has(turn.conversation.id)) current.push(turn.conversation);
      }
      setItems(current.sort((a, b) => b.updated_at - a.updated_at));
      if (restore) {
        let stored: string | null = null; try { stored = localStorage.getItem(lastKey); } catch { /* optional preference */ }
        const selected = current.find(item => item.id === stored) || current[0];
        if (selected) { restoreDraft(drafts.current.get(selected.id)); await openHistory(selected.id); } else setLoading(false);
      }
    } catch (failure) { if (alive.current && workspaceRef.current === workspace && token === listToken.current) { setLoading(false); setError(failureText(failure)); } }
  }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++historyToken.current; ++listToken.current; };
  }, []);

  useEffect(() => {
    saveCurrentDraft();
    ++historyToken.current;
    activeId.current = null;
    setActive(null);
    setItems([]);
    setMessages([]);
    setError('');
    setLoading(true);
    clearDraft();
    void loadList(true);
  }, [workspace]);

  useEffect(() => { if (visible) void loadStatus(); }, [visible, chosenModel.id]);
  useEffect(() => { if (stick.current) log.current?.scrollTo({ top: messages.length ? log.current.scrollHeight : 0, behavior: 'auto' }); }, [messages, busy]);
  function followLog() {
    const element = log.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
    stick.current = near;
    setAtBottom(near);
  }
  function scrollToBottom() {
    const element = log.current;
    if (!element) return;
    stick.current = true;
    setAtBottom(true);
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }

  const lastSignal = useRef(newChatSignal);
  useEffect(() => {
    if (lastSignal.current === newChatSignal || navigationLocked || !visible) return;
    lastSignal.current = newChatSignal;
    void newChat();
  }, [newChatSignal, navigationLocked, visible]);

  function clearDraft() {
    setSkills([]);
    setPlugins([]);
    setText('');
    setAttachments([]);
    setDataFile(null);
    setDocFile(null);
  }
  function snapshotDraft(): Draft { return { text, skills, plugins, attachments, dataFile, docFile }; }
  function restoreDraft(draft?: Draft) {
    setText(draft?.text || '');
    setSkills(draft?.skills || []);
    setPlugins(draft?.plugins || []);
    setAttachments(draft?.attachments || []);
    setDataFile(draft?.dataFile || null);
    setDocFile(draft?.docFile || null);
  }
  function saveCurrentDraft() {
    const id = activeId.current;
    if (id && !turns.current.has(id)) drafts.current.set(id, snapshotDraft());
  }
  function selectHistory(id: string) {
    if (navigationLocked || id === activeId.current) return;
    saveCurrentDraft();
    restoreDraft(drafts.current.get(id));
    stick.current = true;
    setAtBottom(true);
    void openHistory(id);
  }
  async function newChat() {
    if (navigationLocked || deleteLock.current) return;
    saveCurrentDraft();
    setError(''); setLoading(true);
    try { const item = await createConversation(workspace); if (alive.current) { ++historyToken.current; choose(item); updateItem(item); setMessages([]); clearDraft(); } }
    catch (failure) { if (alive.current) setError(failureText(failure)); }
    finally { if (alive.current) setLoading(false); }
  }
  async function rename() {
    if (!renameTarget || navigationLocked || turns.current.has(renameTarget.id) || deleteLock.current || !name.trim()) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      const item = await renameConversation(renameTarget.id, name);
      if (!alive.current) return;
      if (activeId.current === item.id) choose(item);
      updateItem(item);
      setRenameTarget(null);
    }
    catch (failure) { if (alive.current) setRenameError(failureText(failure)); }
    finally { if (alive.current) setRenameBusy(false); }
  }
  function requestRename(item: Conversation) {
    if (turns.current.has(item.id)) return;
    setRenameError('');
    setName(item.title);
    setRenameTarget(item);
  }
  function requestDelete(item: Conversation) {
    if (turns.current.has(item.id)) return;
    setDeleteError('');
    setDeleteTarget(item);
  }
  async function removeConversation() {
    if (!deleteTarget || navigationLocked || turns.current.has(deleteTarget.id) || deleteLock.current) return;
    const target = deleteTarget.id; deleteLock.current = true; setDeleteBusy(true); setDeleteError(''); ++listToken.current;
    try {
      await deleteConversation(target);
      drafts.current.delete(target);
      turnErrors.current.delete(target);
      void mainChatBridge()?.resetConversation(target).catch(() => {});
      if (!alive.current) return;
      const remaining = items.filter(item => item.id !== target);
      setItems(remaining);
      setDeleteTarget(null);
      if (activeId.current === target) {
        ++historyToken.current;
        activeId.current = null;
        setActive(null); setMessages([]); clearDraft();
        try { localStorage.removeItem(lastKey); } catch { /* optional preference */ }
        if (remaining[0]) { restoreDraft(drafts.current.get(remaining[0].id)); await openHistory(remaining[0].id); }
      }
    } catch (failure) { if (alive.current) setDeleteError(failureText(failure)); }
    finally { deleteLock.current = false; if (alive.current) setDeleteBusy(false); }
  }
  function addAnyFiles(files: File[]) {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (images.length) void addImages(images);
    const other = files.find(file => !file.type.startsWith('image/'));
    if (!other) return;
    if (/\.(csv|xlsx|xlsm)$/i.test(other.name)) void addDataFile(other);
    else void addDocument(other);
  }

  async function addDocument(file: File) {
    if (file.size > 10 * 1024 * 1024) { setError(`文件不能超过 10MB（当前 ${(file.size / 1048576).toFixed(1)} MB）。`); return; }
    setDocUploading(true); setError('');
    try {
      const response = await fetch('/api/assistant/files', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.error;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || '读取文件失败');
      }
      if (alive.current) setDocFile(payload.file);
    } catch (failure) { if (alive.current) setError(failureText(failure)); }
    finally { if (alive.current) setDocUploading(false); }
  }

  async function addDataFile(file: File) {
    if (!external && !allowLocalAnalysisUpload) {
      setError('请在「深度分析」页面选择 CSV 或 Excel，以确认文件的发送位置。');
      return;
    }
    if (!/\.(csv|xlsx|xlsm)$/i.test(file.name)) { setError('只支持 CSV 或 Excel（.xlsx）文件。'); return; }
    if (file.size > 5 * 1024 * 1024) { setError(`文件不能超过 5MB（当前 ${(file.size / 1048576).toFixed(1)} MB）。原始波形请先导出为日报表。`); return; }
    setDataUploading(true); setError('');
    try {
      const acpOnly = Boolean(external);
      const response = await fetch(acpOnly ? '/api/assistant/external-files' : '/api/deep-analysis/files', {
        method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-Filename': encodeURIComponent(file.name) }, body: file,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.error;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || '上传失败');
      }
      if (alive.current) setDataFile({ ...payload.file, acpOnly });
    } catch (failure) { if (alive.current) setError(failureText(failure)); }
    finally { if (alive.current) setDataUploading(false); }
  }

  function isSelected(turn: RunningTurn) {
    return alive.current && turn.workspace === workspaceRef.current && activeId.current === turn.conversation.id;
  }

  function updateTurnConversation(turn: RunningTurn, item: Conversation) {
    turn.conversation = item;
    if (!alive.current || workspaceRef.current !== turn.workspace) return;
    if (isSelected(turn)) choose(item);
    updateItem(item);
  }

  function finishTurn(turn: RunningTurn, retryDraft?: Draft) {
    const id = turn.conversation.id;
    turns.current.delete(id);
    if (turn.error) turnErrors.current.set(id, turn.error);
    if (retryDraft) drafts.current.set(id, retryDraft);
    if (isSelected(turn)) {
      setMessages(turn.messages);
      if (retryDraft) restoreDraft(retryDraft);
    }
    refreshTurns();
  }

  function closeDelegation(turn: RunningTurn) {
    const pending = turn.delegation;
    turn.delegation = undefined;
    if (pending?.running) void externalBridge?.cancelDelegation?.(turn.conversation.id, pending.id).catch(() => {});
  }

  async function handleDelegation(turn: RunningTurn, agentId: string | null) {
    const pending = turn.delegation;
    if (!pending || pending.running || pending.reporting || turn.stopping) return;
    const target = turn.conversation.id;
    pending.error = undefined;
    if (!pending.response && agentId) {
      const agent = pending.agents.find(item => item.id === agentId);
      if (!agent || !externalBridge?.runDelegation) return;
      pending.agentId = agent.id;
      pending.running = true;
      refreshTurns();
      try {
        const output = await externalBridge.runDelegation({ agentId, conversationId: target, requestId: pending.id, task: pending.task, context: pending.context });
        pending.response = output.text.trim() ? { status: 'complete', result: output.text, agent_id: agentId } : { status: 'error', agent_id: agentId };
      } catch {
        pending.response = { status: 'error', agent_id: agentId };
      } finally {
        pending.running = false;
      }
    } else if (!pending.response) {
      pending.response = { status: 'declined' };
    }
    if (turn.delegation !== pending || turn.stopping) return;
    pending.reporting = true;
    refreshTurns();
    try {
      await respondToDelegation(target, pending.id, pending.response);
    } catch (failure) {
      if (turn.delegation === pending) {
        pending.reporting = false;
        pending.error = failureText(failure);
        refreshTurns();
      }
    }
  }

  async function sendExternal(turn: RunningTurn, selection: ExternalSelection, draft: Draft, reasoningEffort?: string) {
    const bridge = mainChatBridge();
    if (!bridge) { finishTurn(turn, draft); return; }
    const id = turn.conversation.id;
    let execution: ExecutionSummary = { steps: [], plan: [] };
    const timings = new Map<string, number>();
    let serial = 0;
    const progressIds = new Map<string, string>();
    let partial = '';
    const analysisTasks = new Set<string>();
    let turnId: string | undefined;
    let assistantId: string | undefined;
    let resultModel: string | undefined;
    let usage: ReplyUsage | undefined;
    let recommendations: DshRecommendation[] | undefined;
    let endStatus: 'complete' | 'cancelled' | 'error' = 'error';
    let unsubscribe: (() => void) | undefined;
    let responseError: unknown;
    try {
      const reserved = await beginExternalTurn(id, {
        content: draft.text.trim(), agent_id: selection.agentId, agent_name: selection.agentName, model: selection.modelName || selection.modelId,
        attachments: draft.attachments, file_ids: draft.docFile ? [draft.docFile.id] : undefined,
        analysis_file_id: draft.dataFile?.id, skill_ids: draft.skills.map(skill => skill.id),
        ...(draft.plugins.length ? { plugin_ids: draft.plugins.map(plugin => plugin.id) } : {}),
      });
      turnId = reserved.turn_id;
      assistantId = reserved.assistant_message.id;
      updateTurnConversation(turn, reserved.conversation);
      turn.messages = [...turn.messages, reserved.user_message, reserved.assistant_message];
      refreshTurns();
      if (turn.stopping) { endStatus = 'cancelled'; return; }
      function updateStep(step: ExecutionStep) {
        const existing = execution.steps.findIndex(item => item.id === step.id);
        if (existing < 0 && execution.steps.length >= 40) {
          execution = { ...execution, truncated: true };
          return;
        }
        if (step.status === 'in_progress' && !timings.has(step.id)) timings.set(step.id, performance.now());
        const started = timings.get(step.id);
        const duration = started === undefined || step.status === 'pending' || step.status === 'in_progress'
          ? undefined : Math.round(performance.now() - started);
        const safe = { ...step, title: step.title.slice(0, 180), kind: step.kind.slice(0, 60), duration_ms: duration };
        const steps = execution.steps.slice();
        if (existing < 0) steps.push(safe);
        else steps[existing] = safe;
        execution = { ...execution, steps };
      }
      function publishExecution() {
        turn.execution = { assistantId: reserved.assistant_message.id, data: execution };
        refreshTurns();
      }
      unsubscribe = bridge.onUpdate(update => {
        if (update.agentId !== selection.agentId || update.conversationId !== id) return;
        if (update.acpPermission && bridge.respondPermission) {
          turn.permission = { conversationId: id, request: update.acpPermission };
          refreshTurns();
        }
        if (update.acpPermissionClosed && turn.permission?.request.requestId === update.acpPermissionClosed.requestId) {
          turn.permission = undefined;
          refreshTurns();
        }
        if (update.contextUsage) {
          turn.contextUsage = update.contextUsage;
          refreshTurns();
        }
        if (update.acpActivityTruncated) { execution = { ...execution, truncated: true }; publishExecution(); }
        if (update.acpTool) { updateStep(update.acpTool); publishExecution(); }
        if (update.acpPlan) {
          const entries = update.acpPlan.entries;
          execution = {
            ...execution, truncated: execution.truncated || entries.length > 25 || entries.some(entry => entry.content.length > 200),
            plan: entries.slice(0, 25).map(entry => ({ ...entry, content: entry.content.slice(0, 200) })),
          };
          publishExecution();
        }
        if (update.toolProgress) {
          const { callId, name, status, message, taskId } = update.toolProgress;
          let stepId = 'local-call-' + callId;
          if (!callId) {
            stepId = status === 'running' ? 'local-' + ++serial : progressIds.get(name) || 'local-' + ++serial;
            if (status === 'running') progressIds.set(name, stepId);
            else progressIds.delete(name);
          }
          const title = status === 'error' && message ? name + ' · ' + message : name;
          updateStep({ id: stepId, title, kind: 'tool', status: status === 'running' ? 'in_progress' : status === 'error' ? 'failed' : 'completed' });
          publishExecution();
          if (status === 'complete' && taskId && /^[a-f0-9]{32}$/.test(taskId)) analysisTasks.add(taskId);
          turn.toolNote = message || (status === 'running' ? name + ' 正在运行…' : status === 'error' ? name + ' 执行失败' : '');
          refreshTurns();
          return;
        }
        if (!update.text) return;
        partial = (partial + update.text).slice(0, 100000);
        turn.messages = turn.messages.map(item => item.id === assistantId ? { ...item, content: partial } : item);
        refreshTurns();
      });
      const result = await bridge.promptConversation({ agentId: selection.agentId, conversationId: id, turnId: reserved.turn_id, modelId: selection.modelId, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) });
      const proposals = result.projectProposals;
      if (proposals?.length && alive.current) {
        setFileProposals(current => ({
          ...current, [id]: [...(current[id] || []).filter(item => !proposals.some(proposal => item.id === proposal.id)), ...proposals.map(proposal => ({ ...proposal, assistant_message_id: proposal.assistant_message_id || assistantId }))],
        }));
      }
      if (result.text) partial = result.text.slice(0, 100000);
      resultModel = result.modelName || result.modelId || undefined;
      usage = result.usage;
      turn.contextUsage = result.contextUsage || turn.contextUsage;
      endStatus = turn.stopping || result.stopReason === 'cancelled' ? 'cancelled' : 'complete';
      if (endStatus === 'complete') recommendations = result.recommendations;
    } catch (failure) {
      endStatus = turn.stopping ? 'cancelled' : 'error';
      responseError = failure;
    } finally {
      unsubscribe?.();
      if (analysisTasks.size) {
        const links = [...analysisTasks].map(id => '[查看深度分析任务](/#deep-analysis?task=' + id + ')').join('\n');
        partial = partial.slice(0, 100000 - links.length - 2) + '\n\n' + links;
      }
      turn.toolNote = undefined;
      turn.permission = undefined;
      refreshTurns();
      if (turnId) {
        try {
          const saved = await finishExternalTurn(id, turnId, { content: partial, status: endStatus, model: resultModel, usage, context: turn.contextUsage, recommendations, ...(execution.steps.length || execution.plan.length || execution.truncated ? { execution } : {}) });
          updateTurnConversation(turn, saved.conversation);
          turn.messages = turn.messages.map(item => item.id === saved.message.id ? saved.message : item);
        } catch (failure) {
          turn.messages = turn.messages.map(item => item.id === assistantId ? {
            ...item, content: partial, status: endStatus,
            reply_meta: item.reply_meta && { ...item.reply_meta, execution, usage, context: turn.contextUsage, recommendations },
          } : item);
          turn.error = '无法保存 Agent 回复：' + failureText(failure);
        }
      }
      if (responseError && !turn.stopping && !turn.error) turn.error = failureText(responseError);
      finishTurn(turn, turn.error ? draft : undefined);
    }
  }
  async function send() {
    if (locked || worktreeLock.current || creatingTurn.current || (activeId.current && turns.current.has(activeId.current)) || deleteLock.current || !canChat || imageBlocked || (!text.trim() && !attachments.length)) return;
    const agent = selectedAgent;
    if (!agent && dataFile?.acpOnly) { setError('此表格已为外部 Agent 添加。请重新选择外部 Agent，或移除并重新添加表格。'); return; }
    let item = active;
    if (!item) {
      creatingTurn.current = true;
      refreshTurns();
      try {
        item = await createConversation(workspace);
        if (!alive.current || workspaceRef.current !== workspace) return;
        choose(item);
        updateItem(item);
      } catch (failure) {
        if (alive.current) setError(failureText(failure));
        return;
      } finally { creatingTurn.current = false; refreshTurns(); }
    }
    const draft = snapshotDraft();
    const turn: RunningTurn = {
      conversation: item, workspace, messages, stopping: false,
      controller: agent ? undefined : new AbortController(),
    };
    turns.current.set(item.id, turn);
    turnErrors.current.delete(item.id);
    drafts.current.delete(item.id);
    clearDraft();
    setError('');
    stick.current = true;
    setAtBottom(true);
    refreshTurns();
    if (agent) await sendExternal(turn, agent, draft, reasoningValue);
    else await sendInternal(turn, draft);
  }
  function cancelDevelopment(turn: RunningTurn) {
    const job = turn.development;
    if (!job) return;
    turn.development = undefined;
    if (turn.permission?.development) turn.permission = undefined;
    return window.vvmanProjects?.cancelDevelopment?.(turn.conversation.id, job).catch(() => {});
  }
  async function handleDevelopment(turn: RunningTurn, job: string) {
    const bridge = window.vvmanProjects;
    if (!bridge?.prepareDevelopment || !bridge.respondDevelopment || !bridge.cancelDevelopment) {
      turn.error = '请在 Somnus 桌面版运行项目工具。';
      refreshTurns();
      return;
    }
    if (turn.stopping || turn.developmentJobs?.has(job)) return;
    (turn.developmentJobs ||= new Set()).add(job);
    const id = turn.conversation.id;
    turn.development = job;
    try {
      const result = await bridge.prepareDevelopment(id, job);
      if (turn.development !== job || turn.stopping) return;
      if (result.kind === 'approval') {
        turn.permission = { conversationId: id, development: true, request: {
          requestId: job, kind: 'test', title: '允许运行项目测试？', details: result.details,
          options: [{ id: 'allow_once', kind: 'allow_once', name: '继续' }, { id: 'reject_once', kind: 'reject_once', name: '取消' }],
        } };
      } else turn.development = undefined;
    } catch (failure) {
      if (turn.development === job) {
        turn.error = failureText(failure);
        void cancelDevelopment(turn);
      }
    }
    refreshTurns();
  }
  async function sendInternal(turn: RunningTurn, draft: Draft) {
    const target = turn.conversation.id;
    const abort = turn.controller!;
    const { text: content, attachments: images, dataFile, docFile, skills } = draft;
    const dataMeta = dataFile ? { name: dataFile.name, row_count: dataFile.row_count, columns: dataFile.columns.slice(0, 60) } : null;
    let complete = false;
    let assistantId: string | undefined;
    try {
      const delegationAgents = externalBridge?.runDelegation
        ? await externalBridge.listDelegationAgents?.().catch(() => []) || []
        : [];
      if (abort.signal.aborted) return;
      await sendMessage(target, content.trim(), abort.signal, (event: ChatEvent) => {
        if (!alive.current) return;
        const data = event.data;
        if (event.type === 'start' && data.user_message && data.assistant_message) {
          if (data.conversation) updateTurnConversation(turn, data.conversation);
          assistantId = data.assistant_message.id;
          turn.messages = [...turn.messages.filter(message => message.id !== data.user_message!.id && message.id !== assistantId), data.user_message, data.assistant_message];
        } else if (event.type === 'delta' && typeof data.text === 'string') {
          turn.messages = turn.messages.map(message => message.id === assistantId ? { ...message, content: message.content + data.text } : message);
        } else if (event.type === 'project_development' && data.id) {
          void handleDevelopment(turn, data.id);
        } else if (event.type === 'delegation_request' && data.id && data.task && data.agent_id) {
          const agentId = data.agent_id;
          if (delegationAgents.some(agent => agent.id === agentId)) {
            turn.delegation = { id: data.id, task: data.task, context: data.context, agentId, agents: delegationAgents };
            turn.toolNote = undefined;
          } else {
            void respondToDelegation(target, data.id, { status: 'declined' }).catch(() => {});
          }
        } else if (event.type === 'delegation_resolved' && data.id && turn.delegation?.id === data.id) {
          closeDelegation(turn);
          if (data.agent_name && (data.status === 'complete' || data.status === 'declined' || data.status === 'error' || data.status === 'expired')) {
            const result: DelegationResult = { agent_name: data.agent_name, status: data.status, result: data.result };
            turn.messages = turn.messages.map(message => message.id === assistantId && message.reply_meta
              ? { ...message, reply_meta: { ...message.reply_meta, delegation: result } } : message);
          }
        } else if (event.type === 'mcp_approval' && data.id && data.tool_name && data.status === 'pending') {
          turn.permission = { conversationId: target, localMcp: true, request: {
            requestId: data.id, title: data.tool_name, kind: 'mcp',
            options: [{ id: 'approve', name: '仅允许本次', kind: 'allow_once' }, { id: 'reject', name: '拒绝', kind: 'reject_once' }],
          } };
        } else if (event.type === 'mcp_approval_blocked' && assistantId && data.tool_name && data.reason) {
          const replyId = assistantId;
          const notice = { tool_name: data.tool_name, reason: data.reason };
          setMcpBlocked(current => ({ ...current, [replyId]: notice }));
        } else if (event.type === 'mcp_approval_resolved' && data.id) {
          if (turn.permission?.request.requestId === data.id) turn.permission = undefined;
        } else if (event.type === 'file_proposal' && data.proposal) {
          const proposal = { ...data.proposal, assistant_message_id: data.proposal.assistant_message_id || assistantId };
          setFileProposals(current => ({ ...current, [target]: [...(current[target] || []).filter(item => item.id !== proposal.id), proposal] }));
        } else if (event.type === 'tool_call') {
          turn.toolNote = data.name === 'query_database' ? '正在查询数据库…' :
            data.name === 'list_database_schema' ? '正在读取表结构…' : undefined;
        } else if (event.type === 'tool_result') {
          turn.toolNote = typeof data.summary === 'string' && data.summary ? data.summary : undefined;
        } else if (['done', 'cancelled', 'error'].includes(event.type)) {
          turn.toolNote = undefined;
          turn.permission = undefined;
          const message = typeof data.message === 'object' ? data.message : data.assistant_message;
          if (message) turn.messages = turn.messages.some(value => value.id === message.id) ? turn.messages.map(value => value.id === message.id ? message : value) : [...turn.messages, message];
          if (data.conversation) updateTurnConversation(turn, data.conversation);
          if (event.type === 'done') complete = true;
          if (event.type === 'error') turn.error = typeof data.message === 'string' ? data.message : '模型请求失败。会话已保存，可重试。';
        }
        refreshTurns();
      }, images, dataFile?.id, docFile ? [docFile.id] : [], dataMeta, skills.map(skill => skill.id), chosenModel.id, chosenModel.effort, draft.plugins.map(plugin => plugin.id), delegationAgents);
    } catch (failure) {
      if (!abort.signal.aborted) turn.error = failureText(failure);
    } finally {
      closeDelegation(turn);
      void cancelDevelopment(turn);
      turn.messages = turn.messages.map(message => message.id === assistantId && message.status === 'streaming' ? { ...message, status: turn.stopping || abort.signal.aborted ? 'cancelled' : 'error' } : message);
      finishTurn(turn, complete || turn.stopping ? undefined : draft);
    }
  }
  async function stop() {
    const id = activeId.current;
    const turn = id ? turns.current.get(id) : undefined;
    if (!id || !turn || turn.stopping) return;
    turn.stopping = true;
    turn.error = undefined;
    refreshTurns();
    try {
      if (turn.controller) {
        await cancelConversation(id);
        closeDelegation(turn);
        void cancelDevelopment(turn);
        turn.controller.abort();
      } else {
        await mainChatBridge()?.cancelConversation(id);
      }
    } catch (failure) {
      turn.stopping = false;
      turn.error = '停止请求未完成：' + failureText(failure);
      refreshTurns();
    }
  }
  const hasConversationMessages = messages.length > 0 && !loading;
  useEffect(() => {
    const messageLog = log.current;
    const chat = messageLog?.parentElement;
    if (!messageLog || !chat || typeof ResizeObserver === 'undefined') return;
    const row = messageLog.querySelector('.assistant-column-measure');
    if (!row) return;
    const observer = new ResizeObserver(() => {
      const width = row.getBoundingClientRect().width;
      if (width > 0) chat.style.setProperty('--conversation-measured-width', width + 'px');
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
      chat.style.removeProperty('--conversation-measured-width');
    };
  }, [hasConversationMessages]);
  async function respondToAcpPermission(option: string | null) {
    const pending = permissionRequest;
    const bridge = mainChatBridge();
    if (!pending) return;
    const turn = turns.current.get(pending.conversationId);
    if (pending.development) {
      const respond = window.vvmanProjects?.respondDevelopment;
      if (!turn || turn.permission !== pending || !respond) throw new Error('此项目测试确认已结束');
      turn.permission = undefined;
      if (option === 'allow_once') turn.toolNote = '正在运行项目测试…';
      refreshTurns();
      try { await respond(pending.conversationId, pending.request.requestId, option === 'allow_once'); }
      catch (failure) {
        if (turn.development === pending.request.requestId) {
          turn.error = failureText(failure);
          turn.toolNote = undefined;
          void cancelDevelopment(turn);
        }
      } finally {
        if (turn.development === pending.request.requestId) turn.development = undefined;
        refreshTurns();
      }
      return;
    }
    if (pending.localMcp) {
      await respondToMcpApproval(pending.conversationId, pending.request.requestId, option === 'approve' ? 'approve' : 'reject');
    } else if (bridge?.respondPermission) {
      await bridge.respondPermission(pending.conversationId, pending.request.requestId, option);
    } else throw new Error('当前桌面连接无法确认操作');
    if (turn?.permission?.request.requestId === pending.request.requestId) {
      turn.permission = undefined;
      refreshTurns();
    }
  }
  const restoredIncomplete = !busy && messages.some(message => message.status === 'streaming' || message.status === 'error');
  return <><div className="assistant-page">
    {sidebar && createPortal(<RecentSessions items={items} activeId={visible ? active?.id : undefined}
      locked={navigationLocked} runningIds={turns.current} loading={loading} onOpen={id => { onOpenChat(); selectHistory(id); }}
      onRename={requestRename} onDelete={requestDelete} />, sidebar)}
    {!external && statusError && <Alert type="warning" showIcon className="assistant-error" message="暂时无法读取模型状态" description={statusError} />}
    <div className="assistant-layout">
      <aside className="assistant-history" aria-label="AI会话历史"><div className="assistant-history-head"><strong>会话历史</strong><Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => void newChat()} disabled={navigationLocked}>新建会话</Button></div><div className="assistant-history-list">{loading && !items.length ? <div className="assistant-loading"><Spin size="small" />读取历史…</div> : items.length ? items.map(item => <button type="button" className={`assistant-history-item ${active?.id === item.id ? 'active' : ''}`} key={item.id} onClick={() => selectHistory(item.id)} disabled={navigationLocked} title={item.title} aria-pressed={active?.id === item.id}><MessageOutlined /><span><strong>{item.title || '新会话'}</strong><small>{item.message_count} 条消息 · {formatDateTime(item.updated_at)}</small></span></button>) : <div className="assistant-history-empty">暂无会话</div>}</div><div className="assistant-history-foot">会话保存在本机。</div></aside>
      <section className="assistant-chat" aria-label="会话"><header className="assistant-chat-head">
        <div className="assistant-chat-heading"><h1>{active?.title || '新会话'}</h1></div>
        <Space size={4} wrap><ProjectTools key={workspace + ':' + (active?.id || 'new') + ':' + (active?.worktree?.commit || '')}
          workspace={workspace} conversationId={active?.id} worktree={active?.worktree} />
        <Button type="text" size="small" aria-label="模型连接设置" title="模型连接设置" icon={<SettingOutlined />}
        loading={statusLoading} onClick={() => setConfigOpen(true)} />
        {active && <><Button type="text" size="small" icon={<EditOutlined />} disabled={locked} onClick={() => requestRename(active)}>重命名</Button><Button type="text" danger size="small" icon={<DeleteOutlined />} disabled={locked} onClick={() => requestDelete(active)}>删除</Button></>}</Space></header>
        {visibleError && <Alert className="assistant-error" type="error" showIcon message={visibleError} action={<Button size="small" onClick={() => void loadList(true)} disabled={locked}>重新加载历史</Button>} />}
        {restoredIncomplete && <div className="assistant-incomplete">部分历史回答在完成前中断。</div>}
        <div className="assistant-message-log" ref={log} onScroll={followLog} role="log" aria-live="polite" aria-label="会话消息"><div className="assistant-column-measure" aria-hidden="true" />{loading ? <div className="skeleton-list">{[0, 1, 2].map(index => <Skeleton key={index} active title={false} paragraph={{ rows: 2, width: ['92%', '68%'] }} />)}</div> : messages.length ? messages.map(message => {
          const notice = message.reply_meta?.mcp_approval_blocked || mcpBlocked[message.id];
          const usage = message.reply_meta?.usage;
          return <article key={message.id} className={`assistant-message ${message.role}`}><div className="assistant-message-main">{message.role === 'assistant' && message.status !== 'complete' && <div className="assistant-message-label"><small>{statusText[message.status]}</small></div>}{message.role === 'assistant' && (message.reply_meta?.execution || liveExecution?.assistantId === message.id) &&
          <ExecutionDetails execution={message.reply_meta?.execution || liveExecution!.data} />}
          {notice && <Alert type="warning" showIcon message={notice.reason} description={notice.tool_name} />}
          <div className="assistant-message-content">{message.content ? (message.role === 'assistant' ? <Markdown text={message.content} /> : message.content) : (message.status === 'streaming' ? '正在思考…' : message.attachments?.length ? '' : '未返回回答内容')}{message.attachments?.length ? <div className="assistant-message-images">{message.attachments.filter(image => isLocalImage(image.data_url)).map((image, index) => <img key={index} src={image.data_url} alt={image.name || '会话图片'} loading="lazy" />)}</div> : null}</div>{message.role === 'assistant' && message.reply_meta?.delegation && <DelegationOutcome result={message.reply_meta.delegation} />}{message.role === 'assistant' && message.reply_meta && <div className="assistant-reply-metadata">
      <span>{message.reply_meta.model}</span>{typeof message.reply_meta.elapsed_ms === 'number' && <span>{(message.reply_meta.elapsed_ms / 1000).toFixed(1)} 秒</span>}
      {usage ? <span>
        输入 {tokenFormat.format(usage.input_tokens)} · 输出 {tokenFormat.format(usage.output_tokens)} tokens{usage.input_tokens > 0 && typeof usage.cached_input_tokens === 'number' ?
          ' · 缓存命中 ' + ratioFormat.format(usage.cached_input_tokens / usage.input_tokens) : ''}{usage.partial ? ' · 用量不完整' : ''}
      </span> : message.reply_meta.usage_unavailable && <span>用量未返回</span>}
      </div>}
      {message.role === 'assistant' && <DshRecommendationCards cards={message.reply_meta?.recommendations} onOpenPlugin={onOpenDshPlugin} />}
      {message.role === 'assistant' && <FileChangeCards items={proposalReplies.get(message.id) || []} onPreview={previewProposal} />}
      </div></article>;
        }) : <div className="assistant-welcome"><SomnusMark className="assistant-welcome-mark" /><h2>这个项目想做什么？</h2></div>}{busy && !messages.some(message => message.status === 'streaming') && <div className="assistant-loading"><Spin size="small" />正在连接模型…</div>}</div>
        <div className="assistant-project-actions">
          {active && <ChatWorktree key={active.id} workspace={workspace} conversationId={active.id} worktree={active.worktree}
            disabled={locked} onBusy={value => { worktreeLock.current = value; setWorktreeBusy(value); }}
            onBind={worktree => {
              if (workspaceRef.current !== workspace || activeId.current !== active.id) return;
              const item = { ...active, worktree };
              choose(item);
              updateItem(item);
            }} />}
          {!loading && legacyProposals.length > 0 && <details key={proposalConversation} className="assistant-proposal-history">
            <summary>修改记录{legacyProposals.some(item => item.status === 'pending') ? ' · 有待审修改' : ''}</summary>
            <FileChangeCards items={legacyProposals} onPreview={previewProposal} />
          </details>}
          {proposalConversation && proposalPreview?.conversationId === proposalConversation && <FileProposalReview
            key={proposalPreview.item.id} conversationId={proposalConversation} preview={proposalPreview.item}
            onClose={() => setProposalPreview(undefined)} onDecision={proposals.record} />}
        </div>
        {permissionRequest && permissionRequest.conversationId === active?.id &&
          <ActionApproval key={permissionRequest.conversationId + ':' + permissionRequest.request.requestId} request={permissionRequest.request} onRespond={respondToAcpPermission} />}
        {selectedTurn?.delegation && <DelegationReview key={selectedTurn.delegation.id} request={selectedTurn.delegation} stopping={stopping}
          onRespond={agentId => void handleDelegation(selectedTurn, agentId)} />}
        {toolNote && <div className="assistant-tool-note"><LoadingOutlined /> {toolNote}</div>}
        <div className="assistant-composer">{!atBottom && <button type="button" className="assistant-jump-bottom" onClick={scrollToBottom} aria-label="回到底部" title="回到底部"><ArrowDownOutlined /></button>}{attachments.length > 0 && <div className="assistant-image-drafts" aria-label="待发送图片">{attachments.map((image, index) => <div className="assistant-image-draft" key={index}><img src={image.data_url} alt={image.name} /><button type="button" aria-label={'移除图片 ' + image.name} disabled={locked} onClick={() => setAttachments(old => old.filter((_, current) => current !== index))}><CloseOutlined /></button><small>{image.name}</small></div>)}</div>}{imageBlocked && <div className="assistant-image-notice">发送图片时请选择支持图片的模型，或移除图片以发送文字。</div>}{dataFile && <div className="assistant-data-chip" aria-label="待分析 CSV"><FileTextOutlined /><span><strong>{dataFile.name}</strong><small>{dataFile.row_count} 行 · {dataFile.columns.length} 列 · {external ? '随消息提供给 Agent' : '可交给深度分析'}</small></span><button type="button" aria-label="移除 CSV" disabled={locked} onClick={() => setDataFile(null)}><CloseOutlined /></button></div>}{docFile && <div className="assistant-data-chip" aria-label="已读取的文档"><FileTextOutlined /><span><strong>{docFile.name}</strong><small>已读取 {docFile.chars.toLocaleString()} 字{docFile.note ? ` · ${docFile.note}` : ''} · 内容会随问题发送给模型</small></span><button type="button" aria-label="移除文档" disabled={locked} onClick={() => setDocFile(null)}><CloseOutlined /></button></div>}<input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,.csv,.xlsx,text/csv,.pdf,.docx,.txt,.md,.markdown,.json,.yaml,.yml,.log,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.go,.rs,.sql,.sh,.bat,.ps1,.ini,.toml,.conf,.html,.htm,.xml" onChange={event => { void addAnyFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /><Input.TextArea aria-label="发送消息" placeholder={canChat ? '输入消息…' : '配置模型后即可发送'} value={text} onPaste={event => { const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => Boolean(file)); if (files.length) { event.preventDefault(); void addImages(files); } }} onChange={event => setText(event.target.value)} autoSize={{ minRows: 1, maxRows: 5 }} maxLength={12000} disabled={locked} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />{window.vvmanProjects && <><SkillChips selected={skills} onChange={setSkills} disabled={locked} /><PluginChips selected={plugins} onChange={setPlugins} disabled={locked} /></>}<div className="assistant-composer-actions"><div className="assistant-composer-tools"><Button type="text" size="small" icon={<PaperClipOutlined />} disabled={locked} loading={imageLoading || dataUploading || docUploading} onClick={() => fileInput.current?.click()} aria-label="添加文件" title="添加文件" />{window.vvmanProjects && <><SkillPicker selected={skills} onChange={setSkills} disabled={locked} /><PluginPicker selected={plugins} onChange={setPlugins} disabled={locked} /></>}{onModelConfig && <span className="assistant-model-inline"><ModelSwitch modelId={chosenModel.id} effort={chosenModel.effort}
      onChange={chooseModel} external={external} agentReasoning={agentReasoning} onExternal={setExternal} onConfig={onModelConfig} disabled={locked} /></span>}<PermissionSwitch key={active?.id || 'new'} conversationId={active?.id} permission={active?.permission_mode} external={Boolean(external)}
        disabled={locked} onBusyChange={setPermissionSaving} onChange={permission => setActive(item => item?.id === active?.id && item ? { ...item, permission_mode: permission } : item)} /><ContextMeter context={activeContext} /></div>{busy ? <Button className="assistant-send-button" shape="circle" aria-label="停止生成" title="停止生成" icon={<StopOutlined />} loading={stopping} onClick={() => void stop()} /> : <Button className="assistant-send-button" type="primary" aria-label="发送" title="发送" icon={<ArrowUpOutlined />} disabled={!canChat || locked || imageBlocked || (!text.trim() && !attachments.length)} onClick={() => void send()} />}</div></div>
      </section>
    </div>
    <Modal title="搜索会话" open={searchOpen} onCancel={() => setSearchOpen(false)} footer={null} destroyOnHidden>
      <Input autoFocus aria-label="按标题搜索会话" placeholder="搜索当前项目的会话" value={searchQuery}
        onChange={event => setSearchQuery(event.target.value)} allowClear />
      {searchOpen && <div className="assistant-search-results">
        <RecentSessions items={items.filter(item => (item.title || '新会话').toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()))}
          activeId={active?.id} locked={navigationLocked} runningIds={turns.current} loading={loading}
          onOpen={id => { setSearchOpen(false); selectHistory(id); }}
          onRename={item => { setSearchOpen(false); requestRename(item); }} onDelete={item => { setSearchOpen(false); requestDelete(item); }} />
      </div>}
    </Modal>
    <Modal className="assistant-config-modal" title="模型连接" open={configOpen} onCancel={() => setConfigOpen(false)} footer={<Space><Button loading={statusLoading} icon={<ReloadOutlined />} onClick={() => void loadStatus()}>刷新连接</Button><Button onClick={() => setConfigOpen(false)}>关闭</Button></Space>} width={640}><p>{status?.message || '由服务管理员配置模型连接。'}</p><p>服务管理员通过 AI_ASSISTANT_BASE_URL（服务地址）、AI_ASSISTANT_MODEL（模型名称）和 AI_ASSISTANT_API_KEY（访问密钥）配置模型。配置后重启服务，再点击“刷新连接”。发送的问题与会话上下文会传给配置的模型服务。</p><p>图片随消息发送。支持 PNG、JPEG 和 WebP，最多 4 张，单张 5 MB，合计 10 MB。使用支持图片的模型时，服务管理员可设置 AI_ASSISTANT_VISION_ENABLED=true 开启图片输入。</p></Modal>
    </div>
    <Modal title="删除会话" open={Boolean(deleteTarget)} onCancel={() => { if (!deleteBusy) setDeleteTarget(null); }} onOk={() => void removeConversation()} confirmLoading={deleteBusy} closable={!deleteBusy} maskClosable={!deleteBusy} keyboard={!deleteBusy} cancelButtonProps={{ disabled: deleteBusy }} okButtonProps={{ danger: true, disabled: navigationLocked && !deleteBusy }} okText="确认移除" cancelText="取消"><p>将会话“{deleteTarget?.title || '当前会话'}”从会话列表移除？</p>{deleteTarget?.id === active?.id && <p className="small-note">当前会话的输入草稿将清空。</p>}{deleteError && <Alert type="error" showIcon message={deleteError} />}</Modal>
    <Modal title="重命名会话" open={Boolean(renameTarget)} onCancel={() => { if (!renameBusy) setRenameTarget(null); }} onOk={() => void rename()} confirmLoading={renameBusy} cancelButtonProps={{ disabled: renameBusy }} okButtonProps={{ disabled: !name.trim() }} okText="保存名称" cancelText="取消"><Input aria-label="会话名称" value={name} onChange={event => setName(event.target.value)} maxLength={80} onPressEnter={() => { if (!renameBusy) void rename(); }} />{renameError && <Alert type="error" showIcon message={renameError} />}</Modal>
  </>;
}
