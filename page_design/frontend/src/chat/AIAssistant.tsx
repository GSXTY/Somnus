import { confirmedNativeFork } from "../runtime/nativeFork";
import { InheritedHistory } from "../runtime/InheritedHistory";
import { EditMessageBranch } from "./EditMessageBranch";
import { composerEnterAction, composerShortcutLabels } from './composerShortcuts.mjs';
import { DeclarativePluginCards } from '../plugins/DeclarativePlugin';
import type { PluginCard } from '../plugins/DeclarativePlugin';
import { useUiPreferences } from '../configuration/uiPreferences';
import { SomnusMark } from '../app/SomnusMark';
import { copyText } from '../shared/clipboard';
import { DocumentPicker } from '../documents/DocumentLibrary';
import { documentBridge, readDocumentFile } from '../documents/documentLibraryBridge';
import { DshRecommendationCards } from '../plugins/DshRecommendationCards';
import { ActionApproval, AgentQuestions, ExecutionDetails } from './ExecutionDetails';
import { DelegationOutcome, DelegationReview } from './DelegationReview';
import type { PendingDelegation } from './DelegationReview';
import type { AcpPermission, AcpStage, DshAnswers, DshCommand, DshQuestion, DshTaskState } from './assistantAcp';
import type { ContextUsage, DshRecommendation, ExecutionApproval, ExecutionStep, ExecutionSummary, McpApprovalBlocked, ReplyUsage } from './assistantApi';
import { mainChatBridge } from './assistantAcp';
import type { DurableQueuedMessage, ExternalAgent, ExternalReasoning, ExternalResult, ExternalSelection, QueuedTurnRoute as TurnRoute } from './assistantAcp';
import { AgentAvatar, ConversationAgents, ConversationRecipient } from './ConversationAgents';
import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { ComposerEditor } from './ComposerEditor';
import type { ComposerEditorRef, ComposerReference } from './ComposerEditor';
import { ModelSwitch } from './ModelSwitch';
import { ComposerExtensions } from './ComposerExtensions';
import { ComposerTeamwork } from './ComposerTeamwork';
import { ComposerCommands, composerCommandListId, composerCommandRowId } from './ComposerCommands';
import { ChatTaskControls } from './ChatTaskControls';
import type { ComposerCommand } from './ComposerCommands';
import type { ReasoningEffort } from './assistantApi';
import { PluginChips } from './PluginPicker';
import type { InstalledPlugin } from './assistantApi';
import { SkillChips } from './SkillPicker';
import type { Skill } from './assistantApi';
import { PermissionSwitch } from './PermissionSwitch';
import { AgentWorkMode } from '../configuration/AgentWorkMode';
import { ChatWorktree } from '../analysis/ProjectTools';
import { ChatProjectContext } from './ChatProjectContext';
import { useRuntimeTasks, runtimeConversation } from '../runtime/runtimeTasks';
import { taskIsActive, taskLabel, taskMessageStatus } from '../runtime/runtimeTaskModel.mjs';
import { ChatWorkspacePanel } from './ChatWorkspacePanel';
import { ConversationTrajectory } from './ConversationTrace';
import { ConversationReplyRating, ConversationTurnRail } from './ConversationSessionChrome';
import { associateFileProposals, FileChangeCards, FileProposalReview, useFileProposals } from './FileProposalReview';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SidebarSessionList as RecentSessions } from './SidebarSessionList';
import { SessionFinder } from './SessionFinder';
import { Alert, Badge, Button, Dropdown, Input, Modal, Skeleton, Space, Spin, Tag, Tooltip } from 'antd';
import { AimOutlined, BranchesOutlined, BulbOutlined, CodeOutlined, CopyOutlined, DatabaseOutlined, DownloadOutlined, EllipsisOutlined, FolderOpenOutlined, SendOutlined, ShareAltOutlined, DownOutlined, ArrowDownOutlined, FileTextOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, CloseOutlined, LayoutOutlined, MessageOutlined, PlusOutlined, ReloadOutlined, ArrowUpOutlined, BellOutlined, EditOutlined, AppstoreOutlined } from '@ant-design/icons';
import { assistantStatus, beginExternalTurn, branchConversation, changeConversationAgent, finishExternalTurn, cancelConversation, conversation, conversationTrace, conversations, createConversation, deleteConversation, listProviders, organizeConversation, renameConversation, reserveExternalSteer, respondToDelegation, respondToMcpApproval, saveConversationPermission, sendMessage } from './assistantApi';
import { linkedConversation, reportConversationFinished, watchAnalysisTask } from '../app/taskAttention';
import type { DelegationResult } from './assistantApi';
import type { AssistantStatus, ChatEvent, ChatMessage, ChatAttachment, CompanyModel, CompanyReasoningEffort, Conversation, ConversationAgent, ConversationOrganization, ConversationPermission, FileProposal } from './assistantApi';

import { isLocalImage, prepareImages } from './assistantImages.mjs';
import { Markdown } from '../shared/MarkdownView';
import { formatDateTime } from '../shared/format.mjs';
import { describeError } from '../shared/errors.mjs';
import { addonInstallIntent } from '../plugins/chatAddonInstall';
import type { AddonInstall, AddonSettings, AddonStage } from '../plugins/chatAddonInstall';

const ADDON_INSTALLER_ID = '33aa3fc7-482f-496a-adf1-e241ca7307a7';
const COMPANY_PROVIDER_ID = 'deepseek';
const companyEffortLabels: Record<CompanyReasoningEffort, string> = { none: '关闭', low: '低', high: '高', max: '最高' };
const COMPANY_NATIVE_AGENT = 'fbbce833-544a-42a1-8579-cba2a817383e';
const addonStages: Record<AddonStage, string> = {
  discovering: '查找安装来源',
  installing: '安装到实际使用的配置',
  verifying: '验证安装结果',
};

type WorkspaceApp = 'explorer' | 'vscode' | 'git-bash' | 'terminal';
const workspaceApps = [
  { key: 'explorer', label: '文件资源管理器（默认）' },
  { key: 'vscode', label: 'VS Code' },
  { key: 'git-bash', label: 'Git Bash' },
] as const;

export function addressedMembers(text: string, agents: ExternalAgent[]) {
  // Quoted examples and pasted history are not instructions to a member.
  const routingText = text.replace(/```[\s\S]*?```|`[^`]*`|[“「][^”」]*[”」]|"[^"]*"|^>.*$/gm, value => ' '.repeat(value.length));
  const matches: { agent: ExternalAgent; start: number; end: number }[] = [];
  for (const agent of agents) {
    const aliases = /codex/i.test(agent.name) ? ['codex'] : /deepseek|dsh|harness/i.test(agent.name)
      ? ['deepseek', 'deep seek', 'dsh'] : [agent.name];
    let hit: { start: number; end: number } | undefined;
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp('(^|[\\s@，,。；;：:！!？?让请由给])(' + escaped + ')(?![a-z0-9_-])', 'ig');
      const found = pattern.exec(routingText);
      if (found) {
        const start = found.index + found[1].length;
        if (!hit || start < hit.start) hit = { start, end: start + found[2].length };
      }
    }
    if (hit) matches.push({ agent, ...hit });
  }
  // Duplicate profile aliases require an explicit recipient selection.
  return matches.sort((a, b) => a.start - b.start);
}

async function downloadSessionLog(id: string) {
  const [history, trace] = await Promise.all([
    conversation(id),
    conversationTrace(id).catch(() => undefined),
  ]);
  const log = {
    conversation: history.conversation,
    messages: history.messages.map(({ id, role, content, status, created_at, reply_meta }) => ({
      id, role, content, status, created_at, execution: reply_meta?.execution,
      model: reply_meta?.model, elapsed_ms: reply_meta?.elapsed_ms,
    })),
    trace,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }));
  const download = document.createElement('a');
  download.href = url;
  download.download = 'somnus-session-' + id + '.json';
  download.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const tokenFormat = new Intl.NumberFormat('zh-CN');
const compactTokenFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const ratioFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

function conversationUsage(messages: ChatMessage[]) {
  let input = 0, output = 0, cached = 0, cacheInputs = 0;
  let counted = false, incomplete = false;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const usage = message.reply_meta?.usage;
    if (!usage) {
      incomplete ||= message.status === 'complete' || Boolean(message.reply_meta?.usage_unavailable);
      continue;
    }
    counted = true;
    input += usage.input_tokens;
    output += usage.output_tokens;
    incomplete ||= Boolean(usage.partial);
    if (typeof usage.cached_input_tokens === 'number') {
      cached += usage.cached_input_tokens;
      cacheInputs += usage.input_tokens;
    }
  }
  if (!counted && !incomplete) return;
  const cacheRatio = cacheInputs > 0 ? ratioFormat.format(cached / cacheInputs) : undefined;
  const summary = counted ? compactTokenFormat.format(input + output) + ' tok' : '用量未返回';
  const details = counted ? [
    '共 ' + tokenFormat.format(input + output) + ' tokens',
    '输入 ' + tokenFormat.format(input) + ' · 输出 ' + tokenFormat.format(output),
    ...(cacheRatio ? ['缓存命中 ' + cacheRatio + '（按已报告缓存的输入 token 计算）'] : []),
    ...(incomplete ? ['部分回复的用量未完整返回'] : []),
  ] : [summary];
  return { summary, details };
}

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
const conversationDropType = 'application/x-somnus-conversation';

const failureText = (error: unknown) => describeError(error, '请求失败，请稍后重试').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');

type Draft = {
  text: string; skills: Skill[]; plugins: InstalledPlugin[]; attachments: ChatAttachment[];
  composerBlocks?: ComposerReference[];
  dataFile: { id: string; name: string; row_count: number; columns: string[]; acpOnly?: boolean } | null;
  docFile: { id: string; name: string; kind: string; chars: number; note?: string } | null;
};
function composerPrompt(draft: Draft): string {
  const excerpts = (draft.composerBlocks || []).filter(block => block.kind !== 'file' && block.text)
    .map(block => ({ kind: block.kind, label: block.label, text: block.text }));
  if (!excerpts.length) return !draft.text.trim() && (draft.docFile || draft.dataFile) ? '请查看附加的文件。' : draft.text;
  return [draft.text, '以下是用户选中的参考内容，仅用作背景材料：', JSON.stringify(excerpts)].filter(Boolean).join('\n\n');
}
type QueuedMessage = { id: string; draft: Draft; route: TurnRoute; permission: ConversationPermission };
type PendingApproval = { conversationId: string; request: AcpPermission; localMcp?: boolean; development?: boolean };
type PendingQuestion = { request: DshQuestion; agent: ExternalSelection; workspace: string; title: string; answers?: DshAnswers; answering?: boolean; recovered?: boolean };
type QuestionReply = { requestId: string; answers: DshAnswers };
type RunningTurn = {
  groupMember?: true; userMessageId?: string; assistantMessageId?: string;  conversation: Conversation; workspace: string; messages: ChatMessage[];
  runningAgent?: ConversationAgent;
  startedAt: number;
  controller?: AbortController; stopping: boolean; error?: string; toolNote?: string;
  stage?: AcpStage;
  nativeDsh?: boolean;
  externalTurnId?: string;
  steerPending?: boolean;
  steerResponse?: Promise<void>;
  queuedMessage?: QueuedMessage;
  committed?: boolean;
  installingAddon?: boolean;
  draftEdited?: boolean;
  contextUsage?: ContextUsage; permission?: PendingApproval; development?: string; developmentJobs?: Set<string>; execution?: { assistantId: string; data: ExecutionSummary };
  delegation?: PendingDelegation;
  traceApprovals?: Map<string, ExecutionApproval>;
  approvalResponse?: Promise<void>;
};

function recordAcpDecision(turn: RunningTurn, id: string, status: ExecutionApproval['status']) {
  const event = turn.traceApprovals?.get(id);
  if (event) { event.status = status; event.at = Date.now() / 1000; }
}

type Props = {
  windowsDesktop?: boolean;
  allowLocalAnalysisUpload?: boolean;
  onModelConfig?: () => void;
  workspace: string;
  visible: boolean;
  sidebar: HTMLElement | null;
  newChatSignal: number;
  onLockedChange: (locked: boolean) => void;
  onOpenChat: (workspace?: string) => void;
  attentionTarget?: HTMLDivElement | null;
  onOpenDshPlugin?: (id: string) => void;
  onOpenAddonSettings?: (settings: AddonSettings, name: string) => void;
  onOpenExtensionConfig?: (view: 'skills' | 'plugin-config' | 'mcp') => void;
  expandRunningActivity?: boolean;
  workspaceLinks?: boolean;
  busySendMode?: 'queue' | 'steer';
};

export function AIAssistant({ workspace, visible, sidebar, attentionTarget, newChatSignal, onLockedChange, onOpenChat, onModelConfig, onOpenDshPlugin, onOpenAddonSettings, onOpenExtensionConfig, allowLocalAnalysisUpload = true, windowsDesktop = false, expandRunningActivity = false, workspaceLinks = false, busySendMode = 'queue' }: Props) {
  const [chosenModel, setChosenModel] = useState<{ id?: string; effort?: ReasoningEffort }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('vvman.chat-model') || '{}') || {};
      return windowsDesktop && saved.id === COMPANY_PROVIDER_ID ? {} : saved;
    } catch { return {}; }
  });
  function chooseModel(id?: string, effort?: ReasoningEffort) {
    setChosenModel({ id, effort });
    try { localStorage.setItem('vvman.chat-model', JSON.stringify({ id, effort })); } catch { /* optional preference */ }
  }
  const [pickerExternal, setPickerExternal] = useState<ExternalSelection>();
  const [memberSelection, setMemberSelection] = useState<{ conversationId: string; workspace: string; agent: ExternalSelection }>();
  const [memberDirectory, setMemberDirectory] = useState<ExternalAgent[]>([]);
  const [savingMember, setSavingMember] = useState(false);
  const membershipLock = useRef(false);
  const directoryRevision = useRef(0);
  const externalBridge = mainChatBridge();
  const [reasoning, setReasoning] = useState<{ key: string; settings?: ExternalReasoning }>();
  const [reasoningChoices, setReasoningChoices] = useState<Record<string, string>>({});
  const [companyRuntime, setCompanyRuntime] = useState<{ model?: string; agentId: string }>();
  const [companyCatalog, setCompanyCatalog] = useState<CompanyModel[]>([]);
  const [companyModel, setCompanyModel] = useState<string>();
  const [companyEfforts, setCompanyEfforts] = useState<Partial<Record<string, CompanyReasoningEffort>>>({});
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [dismissedCommandText, setDismissedCommandText] = useState<string>();
  const [commandIndex, setCommandIndex] = useState(0);
  const [modelPickerRequest, setModelPickerRequest] = useState(0);
  const [permissionPickerRequest, setPermissionPickerRequest] = useState(0);
  const [nativeCommands, setNativeCommands] = useState<{ id: string; entries: DshCommand[] }>();
  const [commandLoading, setCommandLoading] = useState(false);
  const [taskStates, setTaskStates] = useState<Record<string, DshTaskState>>({});
  const [goalRequest, setGoalRequest] = useState(0);
  const composerInput = useRef<ComposerEditorRef>(null);
  const compositionEnd = useRef(0);
  const composerEscape = useRef<{ turn: RunningTurn; time: number }>();
  const [composerDragging, setComposerDragging] = useState(false);
  const commandMenu = useRef<HTMLDivElement>(null);
  const turns = useRef(new Map<string, RunningTurn>());
  const groups = useRef(new Map<string, { messages: ChatMessage[]; turns: Map<string, RunningTurn> }>());
  const groupErrors = useRef(new Map<string, string>());
  const hasActiveTurn = (id: string) => turns.current.has(id) || groups.current.has(id);
  const queues = useRef(new Map<string, QueuedMessage[]>());
  const queueStarting = useRef(new Set<string>());
  const knownQueues = useRef(new Set<string>());
  const restoredQueues = useRef(new Set<string>());
  const uncertainQueues = useRef(new Set<string>());
  const queueWrites = useRef(new Map<string, Promise<void>>());
  const questions = useRef(new Map<string, PendingQuestion>());
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
  const [unconfirmedModeChat, setUnconfirmedModeChat] = useState<string>();
  const members = active?.agent_members || [];
  const runtimeSnapshot = useRuntimeTasks();
  useEffect(()=>{ const open=(event:Event)=>{const id=(event as CustomEvent).detail?.conversationId;if(typeof id==='string')void conversation(id).then(value=>{onOpenChat(value.conversation.workspace_id||workspace);void selectHistory(id);}).catch(failure=>setError(failureText(failure)));};window.addEventListener('somnus:open-conversation',open);return()=>window.removeEventListener('somnus:open-conversation',open);},[workspace]);
  const [uiPreferences] = useUiPreferences();
  const shortcuts=composerShortcutLabels(uiPreferences.sendKey);
  const [livePluginCards,setLivePluginCards] = useState<Record<string,PluginCard[]>>({});
  const [replyProcessExpanded,setReplyProcessExpanded]=useState<Record<string,boolean>>({});
  const [runtimeNotices,setRuntimeNotices] = useState<Record<string,string>>({});
  const [pendingResultIds, setPendingResultIds] = useState<Set<string>>(() => new Set());
  const [text, setText] = useState('');
  const explicitMemberTarget = active && memberSelection?.conversationId === active.id && memberSelection.workspace === workspace
    ? memberSelection.agent : undefined;
  const addressed = addressedMembers(text, memberDirectory.filter(agent => members.includes(agent.id)));
  const addressedTarget = addressed.length === 1 ? addressed[0].agent : undefined;
  const memberTarget = explicitMemberTarget || (addressedTarget ? { agentId: addressedTarget.id, agentName: addressedTarget.name } : undefined);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchPreview, setDispatchPreview] = useState<{ text: string; conversationId?: string; agents: { agent: ExternalAgent; task: string }[] }>();
  const memberReady = !memberTarget || members.includes(memberTarget.agentId) &&
    memberDirectory.some(agent => agent.id === memberTarget.agentId);
  const external = memberTarget || pickerExternal;
  function setExternal(value?: ExternalSelection) {
    setMemberSelection(undefined);
    setPickerExternal(value);
  }
  const [draftTeamwork, setDraftTeamwork] = useState<Record<string, boolean>>({});
  const [teamworkRevision, setTeamworkRevision] = useState(0);
  const teamworkChanges = useRef(new Set<string>());
  const pendingTeamwork = useRef(new Set<string>());
  const [pendingPermissions, setPendingPermissions] = useState<Record<string, ConversationPermission>>({});
  const permissionKey = active?.id || 'new:' + workspace;
  const nextPermission = pendingPermissions[permissionKey] || (!active ? uiPreferences.defaultPermission : undefined);
  const [history, setMessages] = useState<ChatMessage[]>([]);
  const [composerBlocks, setComposerBlocks] = useState<ComposerReference[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notificationConversation, setNotificationConversation] = useState(linkedConversation);
  const [attentionChat, setAttentionChat] = useState<{ id: string; workspace: string }>();
  const selectedTurn = active ? turns.current.get(active.id) : undefined;
  const pendingQueue = active ? queues.current.get(active.id) || [] : [];
  const queueUncertain = Boolean(active && uncertainQueues.current.has(active.id));
  const startingQueuedMessage = Boolean(active && queueStarting.current.has(active.id));
  const question = active ? questions.current.get(active.id) : undefined;
  const group = active ? groups.current.get(active.id) : undefined;
  const groupTurns = group ? [...group.turns.values()] : [];
  const messages = group ? groupMessages(group) : selectedTurn?.messages || history;
  const activeTurns = new Map(turns.current);
  for (const [id, running] of groups.current) {
    const lane = [...running.turns.values()].find(turn => turn.permission) || running.turns.values().next().value;
    if (lane) activeTurns.set(id, lane);
  }
  const unifiedRuntime = runtimeSnapshot.availability !== 'legacy';
  const runtimeVerified = runtimeSnapshot.availability === 'ready';
  const runtimeTasks = runtimeSnapshot.tasks.filter(task => task.conversation_id === active?.id);
  const runtimeByMessage = new Map(runtimeTasks.filter(task => !task.parent_task_id).map(task => [task.message_id, task]));
  const runtimeActiveIds = new Map(runtimeSnapshot.tasks.filter(task => !task.parent_task_id && taskIsActive(task, runtimeVerified)).map(task => [task.conversation_id, task]));
  const displayRunningIds = unifiedRuntime ? runtimeActiveIds : activeTurns;
  const activeRuntimeSummary = active ? runtimeConversation(runtimeSnapshot, active.id) : undefined;
  const runtimeMembers = new Map(runtimeTasks.filter(task => !task.parent_task_id && members.includes(task.agent_id) && (taskIsActive(task, runtimeVerified) || task.status === 'disconnected')).map(task => [task.agent_id, taskLabel(task, runtimeVerified)]));
  const busy = Boolean(selectedTurn || group);
  const syncedRuntimeHistory = useRef(new Map<string, string>());
  useEffect(() => {
    if (!active || busy || runtimeSnapshot.availability !== 'ready') return;
    const completed = runtimeTasks.filter(task => !task.parent_task_id && ['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status));
    if (!completed.length) return;
    const revision = completed.map(task => task.id + ':' + task.revision).sort().join(',');
    if (syncedRuntimeHistory.current.get(active.id) === revision) return;
    syncedRuntimeHistory.current.set(active.id, revision);
    const controller = new AbortController();
    void conversation(active.id, controller.signal).then(result => {
      if (!controller.signal.aborted && !hasActiveTurn(active.id)) {
        setMessages(result.messages);
        setActive(current => current?.id === active.id ? { ...current, ...result.conversation } : current);
      }
    }).catch(() => { syncedRuntimeHistory.current.delete(active.id); });
    return () => controller.abort();
  }, [active?.id, busy, runtimeSnapshot.epoch, runtimeSnapshot.cursor, runtimeSnapshot.availability]);

  const stopping = Boolean(selectedTurn?.stopping);
  const [error, setError] = useState(''), [statusError, setStatusError] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]), [imageLoading, setImageLoading] = useState(false);
  const [dataFile, setDataFile] = useState<{ id: string; name: string; row_count: number; columns: string[]; acpOnly?: boolean } | null>(null);
  const [dataUploading, setDataUploading] = useState(false);
  const [docFile, setDocFile] = useState<{ id: string; name: string; kind: string; chars: number; note?: string } | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [attachmentLibraryOpen, setAttachmentLibraryOpen] = useState(false);
  const attachmentReferenceText = useRef<string>();
  const [libraryLoading, setLibraryLoading] = useState(false);
  const libraryLock = useRef(false);
  useEffect(() => { setAttachmentLibraryOpen(false); }, [visible, workspace]);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null), [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), imageLock = useRef(false), deleteLock = useRef(false), listToken = useRef(0);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null), [name, setName] = useState(''), [renameError, setRenameError] = useState(''), [renameBusy, setRenameBusy] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [projectContextOpen, setProjectContextOpen] = useState(false);
  const [workspacePanelChat, setWorkspacePanelChat] = useState<string>();
  const [workspaceWebRequest, setWorkspaceWebRequest] = useState<{ conversationId: string; url: string; sequence: number }>();
  const workspaceWebSequence = useRef(0);
  const [workspaceActionError, setWorkspaceActionError] = useState<{ conversationId: string; message: string }>();
  async function openWorkspaceApp(target: WorkspaceApp) {
    if (!active || !window.vvmanProjects) return;
    setWorkspaceActionError(undefined);
    if (active.worktree && window.vvmanProjects.openWorktree) {
      await window.vvmanProjects.openWorktree(active.id, target);
    } else {
      await window.vvmanProjects.openDirectory(workspace, 0, target);
    }
  }
  async function runWorkspaceAction(action: () => Promise<void>) {
    if (!active) return;
    setWorkspaceActionError(undefined);
    try { await action(); }
    catch (failure) { setWorkspaceActionError({ conversationId: active.id, message: describeError(failure) }); }
  }
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
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
  const [trajectoryFor, setTrajectoryFor] = useState<string>();
  const trajectoryOpen = Boolean(active && active.id === trajectoryFor && !loading);
  const stick = useRef(true);
  const matchingCompanyRuntime = Boolean(companyRuntime && companyRuntime.model === chosenModel.id);
  const companyRequested = !external && !statusLoading && (windowsDesktop || matchingCompanyRuntime);
  const selectedCompanyModel = companyRequested && !windowsDesktop
    ? companyCatalog.find(item => item.model === companyModel) || companyCatalog.find(item => item.model === status?.model)
    : undefined;
  const selectedCompanyEffort = selectedCompanyModel && companyEfforts[selectedCompanyModel.model];
  const companyAgent = companyRequested && matchingCompanyRuntime && companyRuntime && window.somnusNativeDshChat
    ? { agentId: companyRuntime.agentId, agentName: windowsDesktop ? status?.provider || 'DSH runtime' : '默认 Agent',
      modelName: selectedCompanyModel?.model || status?.model || undefined,
      ...(windowsDesktop && chosenModel.id ? { modelId: chosenModel.id } : {}) }
    : undefined;
  const selectedNativeOptions = companyAgent && windowsDesktop && status?.model
    ? { model: status.model, effort: chosenModel.effort }
    : selectedCompanyModel ? { model: selectedCompanyModel.model, effort: selectedCompanyEffort } : undefined;
  const canChat = memberReady && Boolean(!explicitMemberTarget && addressed.length > 1 ? externalBridge : external ? externalBridge
    : !statusLoading && status?.configured && status.capabilities.chat && (!companyRequested || companyAgent));
  const addon = !memberTarget && window.somnusAddonInstaller && !attachments.length && !dataFile && !docFile && !skills.length && !plugins.length
    ? addonInstallIntent(text) : undefined;
  const canSendChat = (canChat || Boolean(addon)) && (Boolean(external) || !unconfirmedModeChat || active?.id !== unconfirmedModeChat);
  const assistantVisible = useRef(visible);
  assistantVisible.current = visible;
  const selectedAgent = external || companyAgent;
  const reasoningAgentId = selectedAgent?.agentId;
  const lastReply = messages.slice().reverse().find(message => message.role === 'assistant')?.reply_meta;
  const lastReplyMatches = reasoningAgentId ? lastReply?.provider_id === reasoningAgentId &&
    (!external?.modelName || lastReply.model === external.modelName) : !statusLoading &&
    (chosenModel.id ? lastReply?.provider_id === chosenModel.id : lastReply?.model === status?.model);
  const savedContext = lastReplyMatches ? lastReply?.context : undefined;
  const activeContext = selectedTurn ? selectedTurn.contextUsage : savedContext;
  const tokenUsage = !loading && conversationUsage(messages);
  const reasoningModelId = external?.modelId;
  const reasoningKey = external && reasoningAgentId && JSON.stringify([reasoningAgentId, reasoningModelId]);
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
  const agentReasoning = selectedCompanyModel && selectedCompanyModel.reasoning_efforts.length ? {
    settings: {
      modelId: selectedCompanyModel.model,
      value: selectedCompanyModel.default_reasoning_effort ?? '',
      options: [{ id: '', name: '默认' }, ...selectedCompanyModel.reasoning_efforts.map(id => ({ id, name: companyEffortLabels[id] }))],
    },
    value: selectedCompanyEffort || '',
    onChange: (value: string) => setCompanyEfforts(previous => ({
      ...previous, [selectedCompanyModel.model]: selectedCompanyModel.reasoning_efforts.find(effort => effort === value),
    })),
  } : reasoningKey ? {
    settings: reasoningSettings,
    value: reasoningValue,
    onChange: (value: string) => setReasoningChoices(previous => ({ ...previous, [reasoningKey]: value })),
  } : undefined;
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const modeSwitchLock = useRef(false);
  const [copiedReply, setCopiedReply] = useState<string>();
  const [sharedReply, setSharedReply] = useState<string>();
  const [sameSessionEdit, setSameSessionEdit] = useState('unknown');
  useEffect(() => { let alive = true; void window.somnusRuntime?.capabilities({ runtime: 'dsh-native' }).then(value => { if (alive) setSameSessionEdit(value.capabilities.sameSessionEdit || 'unknown'); }).catch(() => {}); return () => { alive = false; }; }, []);
  const [editingMessage,setEditingMessage]=useState<{id:string;content:string;checkpoint?:string}>();
  const [clipboardError, setClipboardError] = useState<{ id: string; text: string }>();
  const [branchingReply, setBranchingReply] = useState<string>();
  const branchLock = useRef(false);
  const worktreeLock = useRef(false);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeOpenFor, setWorktreeOpenFor] = useState<string>();
  const navigationLocked = worktreeBusy || permissionSaving || modeSaving || creatingTurn.current || Boolean(branchingReply) || loading || deleteBusy || renameBusy || imageLoading || dataUploading || docUploading || libraryLoading;
  const locked = navigationLocked || busy || startingQueuedMessage;
  useEffect(()=>{const insert=(event:Event)=>{const value=(event as CustomEvent).detail?.text;if(typeof value==='string'&&value.length<=8000&&!navigationLocked)editDraft((text.trim()?text+'\n':'')+value);};window.addEventListener('somnus:insert-draft',insert);return()=>window.removeEventListener('somnus:insert-draft',insert);},[text,navigationLocked]);
  const canStartMember = Boolean(memberTarget && memberReady && !selectedTurn && !group?.turns.has(memberTarget.agentId)
    && !navigationLocked && !startingQueuedMessage && !active?.archived);
  const hasDraft = Boolean(text.trim() || composerBlocks.length || attachments.length || dataFile || docFile);
  const currentTaskState = active ? taskStates[active.id] : undefined;
  const steerAvailable = Boolean(!memberTarget && selectedTurn?.nativeDsh && selectedTurn.externalTurnId && window.somnusNativeDshChat?.steer &&
    !attachments.length && !dataFile && !docFile && !skills.length && !plugins.length && !addon && !/^\s*\//.test(text));
  const preferredBusyMode = busySendMode === 'steer' && steerAvailable ? 'steer' : 'queue';
  const canSendBusyDraft = Boolean(selectedTurn) && !queueUncertain && !navigationLocked && !stopping && !selectedTurn?.installingAddon && !selectedTurn?.steerPending &&
    hasDraft && !addon && !/^\s*\//.test(text);
  const busySendLabel = preferredBusyMode === 'steer' ? '追加指导' : '排队';
  const canRecallQueue = !navigationLocked && !startingQueuedMessage && !text && !composerBlocks.length && !attachments.length && !dataFile && !docFile && !skills.length && !plugins.length;
  const canSteerQueue = canRecallQueue && Boolean(selectedTurn?.nativeDsh && selectedTurn.externalTurnId && window.somnusNativeDshChat?.steerQueue &&
    !selectedTurn.stopping && !selectedTurn.steerPending && !selectedTurn.installingAddon && !selectedTurn.permission && !question &&
    pendingQueue.length && pendingQueue.every(({ draft, route }) => route.nativeDsh && !route.memberOnly &&
      draft.text.trim() && !/^\s*\//.test(draft.text) &&
      !draft.attachments.length && !draft.dataFile && !draft.docFile && !draft.skills.length && !draft.plugins.length));
  const nativeTasks = Boolean(companyAgent && window.somnusNativeDshChat?.taskState && window.somnusNativeDshChat?.executeCommand);
  const planLabel = currentTaskState?.plan?.active ? '退出计划模式' : '计划模式';
  const goalLabel = currentTaskState?.goal ? '编辑目标' : '设定目标';
  const planActionAvailable = !locked && !currentTaskState?.plan?.pending;
  const hasDocumentLibrary = Boolean(documentBridge());
  const collaborationAvailable = Boolean(companyAgent && window.somnusDesktop?.teamwork && window.somnusDesktop?.setTeamwork);
  const extensionsAvailable = Boolean(window.vvmanProjects) || collaborationAvailable;
  const slashName = composerBlocks.length ? undefined : /^\s*\/([a-z0-9_-]*)(?:[ \t]*$)/i.exec(text)?.[1]?.toLowerCase();
  const commandMenuOpen = visible && !navigationLocked && !showExtensions && !plusMenuOpen && slashName !== undefined && dismissedCommandText !== text;
  const referenceQuery = /(?:^|\s)@([^\n@]*)$/.exec(text)?.[1];
  const referenceConversations = referenceQuery === undefined ? [] : items.filter(item => item.id !== active?.id && item.message_count > 0 &&
    item.title.toLowerCase().includes(referenceQuery.trim().toLowerCase())).slice(0, 8);
  const referenceCount = referenceConversations.length + Number(hasDocumentLibrary);
  const activeReferenceIndex = Math.min(referenceIndex, Math.max(0, referenceCount - 1));
  const referenceMenuOpen = visible && referenceQuery !== undefined && referenceCount > 0 && !referenceLoading && !navigationLocked && !showExtensions &&
    !commandMenuOpen && !plusMenuOpen && !attachmentLibraryOpen && dismissedCommandText !== text;
  useEffect(() => {
    if (!commandMenuOpen && !referenceMenuOpen) return;
    function closeFromOutside(event: Event) {
      const target = event.target;
      if (!(target instanceof Node) || commandMenu.current?.contains(target) || composerInput.current?.root()?.contains(target)) return;
      setDismissedCommandText(text);
    }
    document.addEventListener('pointerdown', closeFromOutside, true);
    document.addEventListener('focusin', closeFromOutside, true);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true);
      document.removeEventListener('focusin', closeFromOutside, true);
    };
  }, [commandMenuOpen, referenceMenuOpen, text]);
  useEffect(() => {
    if (!visible || navigationLocked) { setShowExtensions(false); setPlusMenuOpen(false); }
  }, [visible, navigationLocked]);
  const commandScope = workspace + ':' + (active?.id || '');
  const availableNativeCommands = companyAgent && nativeCommands?.id === commandScope ? nativeCommands.entries : [];
  const localCommands: ComposerCommand[] = [
    { name: 'file', description: '添加文件和图片', executable: true },
    { name: 'new', description: '新建会话', executable: true },
    ...(onModelConfig ? [{ name: 'model', description: '选择模型或 Agent', executable: true }] : []),
    { name: 'permission', description: '选择文件权限', executable: true },
    ...(nativeTasks ? [
      { name: 'plan', description: planLabel, executable: planActionAvailable },
      { name: 'goal', description: goalLabel, executable: !locked },
    ] : []),
    ...(active && window.vvmanProjects ? [{ name: 'workspace', description: '打开会话工作区', executable: true }] : []),
    ...(onOpenExtensionConfig ? [
      { name: 'skills', description: '管理 Skills', executable: true },
      { name: 'plugins', description: '管理插件', executable: true },
      { name: 'mcp', description: '管理 MCP', executable: true },
    ] : []),
  ];
  const allCommands = [...localCommands, ...availableNativeCommands.filter(command =>
    !localCommands.some(item => item.name === command.name)).map(command => ({
      ...command, native: true, executable: command.executable && !busy,
      reason: busy && command.executable ? '当前任务完成后可运行' : command.reason,
    }))];
  const filteredCommands = allCommands.filter(command =>
    !slashName || command.name.toLowerCase().includes(slashName));
  const selectedCommandIndex = Math.min(commandIndex, Math.max(0, filteredCommands.length - 1));
  useEffect(() => onLockedChange(navigationLocked), [navigationLocked, onLockedChange]);
  const needsCommands = plusMenuOpen || commandMenuOpen || /^\s*\/[a-z]/i.test(text);
  useEffect(() => {
    const list = window.somnusNativeDshChat?.listCommands;
    if (!visible || !companyAgent || !list || !needsCommands) {
      setCommandLoading(false);
      return;
    }
    let current = true;
    setCommandLoading(true);
    void list({ conversationId: active?.id, workspaceId: /^ws_[a-f0-9]{12}$/.test(workspace) ? workspace : undefined }).then(result => {
      if (current) setNativeCommands({ id: commandScope, entries: result.commands });
    }).catch(() => {
      if (current) setNativeCommands({ id: commandScope, entries: [] });
    }).finally(() => { if (current) setCommandLoading(false); });
    return () => { current = false; };
  }, [visible, Boolean(companyAgent), commandScope, needsCommands]);
  const imageBlocked = !external && attachments.length > 0 && !(selectedCompanyModel?.vision ?? status?.capabilities.vision);
  const showBusySend = canSendBusyDraft && canChat && !imageBlocked && (!dataFile?.acpOnly || Boolean(selectedAgent));
  async function addImages(files: File[]) {
    if (navigationLocked || imageLock.current || !files.length) return;
    markDraftEdited();
    imageLock.current = true; setImageLoading(true); setError('');
    try { const next = await prepareImages(files, attachments); if (alive.current) editDraftMedia({ attachments: next }); }
    catch (failure) { if (alive.current) setError(failureText(failure)); }
    finally { imageLock.current = false; if (alive.current) setImageLoading(false); }
  }
  function choose(item: Conversation) {
    activeId.current = item.id; setActive(item);
    try { localStorage.setItem(lastKey, item.id); } catch { /* history remains on server */ }
  }
  function sortSessions(a: Conversation, b: Conversation) { return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updated_at - a.updated_at; }
  function updateItem(item: Conversation) { setItems(old => [item, ...old.filter(value => value.id !== item.id)].sort(sortSessions)); }
  async function refreshMemberDirectory() {
    if (!externalBridge?.list) return;
    const revision = ++directoryRevision.current;
    try {
      const available = await externalBridge.list();
      if (alive.current && revision === directoryRevision.current) setMemberDirectory(available);
    } catch {
      if (alive.current && revision === directoryRevision.current) setMemberDirectory([]);
    }
  }
  useEffect(() => {
    if (visible) void refreshMemberDirectory();
  }, [visible, workspace, active?.id, externalBridge]);

  function targetMember(agent?: ExternalAgent) {
    setMemberSelection(agent && active ? { conversationId: active.id, workspace,
      agent: { agentId: agent.id, agentName: agent.name } } : undefined);
  }
  async function changeMembership(agentId: string, added: boolean, preferred?: Conversation | null) {
    if (navigationLocked || membershipLock.current || !externalBridge || (preferred === undefined ? active : preferred)?.archived) return null;
    if (added && !memberDirectory.some(agent => agent.id === agentId)) return null;
    if (!added && (group?.turns.has(agentId) || selectedTurn?.runningAgent?.id === agentId || pendingQueue.some(item => item.route.agent?.agentId === agentId))) return null;
    membershipLock.current = true;
    setSavingMember(true);
    const workspaceAtStart = workspace;
    let item: Conversation | null = preferred === undefined ? active : preferred;
    try {
      if (!item) {
        if (!added) return null;
        const savedDraft = snapshotDraft();
        item = await createConversation(workspaceAtStart, nextPermission);
        if (!alive.current || workspaceRef.current !== workspaceAtStart || activeId.current) return null;
        if (hasDraft) {
          drafts.current.set(item.id, savedDraft);
          drafts.current.delete('workspace:' + workspaceAtStart);
          persistDraft(item.id, savedDraft.text);
          persistDraft('workspace:' + workspaceAtStart, '');
        }
        if (nextPermission) clearPendingPermission(permissionKey);
        if (draftTeamwork[workspaceAtStart]) transferDraftTeamwork(item.id);
        choose(item);
        updateItem(item);
      }
      const nextMembers = await changeConversationAgent(item.id, agentId, added);
      if (!added) void externalBridge.releaseConversationAgent?.({ conversationId: item.id, agentId }).catch(() => {});
      if (!alive.current || workspaceRef.current !== workspaceAtStart) return item;
      const running = turns.current.get(item.id);
      if (running) running.conversation = { ...running.conversation, agent_members: nextMembers };
      for (const lane of groups.current.get(item.id)?.turns.values() || []) {
        lane.conversation = { ...lane.conversation, agent_members: nextMembers };
      }
      setItems(old => old.map(row => row.id === item!.id ? { ...row, agent_members: nextMembers } : row));
      setActive(old => old?.id === item!.id ? { ...old, agent_members: nextMembers } : old);
      if (!added) setMemberSelection(old => old?.conversationId === item!.id && old.agent.agentId === agentId ? undefined : old);
      return item;
    } catch (failure) {
      if (alive.current && workspaceRef.current === workspaceAtStart &&
          (!item || activeId.current === item.id)) setError(failureText(failure));
      return item;
    } finally {
      membershipLock.current = false;
      if (alive.current) setSavingMember(false);
    }
  }
  const statusRequest = useRef(0);
  async function loadStatus() {
    const request = ++statusRequest.current;
    setStatusLoading(true); setStatusError('');
    setCompanyRuntime(undefined);
    try {
      const [next, runtime] = await Promise.all([
        assistantStatus(undefined, chosenModel.id),
        !windowsDesktop || chosenModel.id
          ? externalBridge?.companyRuntime?.(chosenModel.id).catch(() => null) : null,
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
    const running = turns.current.get(id) || groups.current.get(id)?.turns.values().next().value;
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
      const running = [...turns.current.values(), ...[...groups.current.values()].flatMap(group => [...group.turns.values()])];
      const current = list.map(item => running.find(turn => turn.conversation.id === item.id)?.conversation || item);
      const supplied = new Set(current.map(item => item.id));
      for (const turn of running) {
        if (turn.workspace === workspace && !supplied.has(turn.conversation.id)) {
          current.push(turn.conversation);
          supplied.add(turn.conversation.id);
        }
      }
      setItems(current.sort(sortSessions));
      if (restore) {
        let stored: string | null = null; try { stored = localStorage.getItem(lastKey); } catch { /* optional preference */ }
        const requested = attentionChat?.workspace === workspace ? attentionChat.id : undefined;
        const selected = current.find(item => item.id === requested) || current.find(item => item.id === stored) || current[0];
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
  useEffect(() => {
    const state = window.somnusNativeDshChat?.taskState;
    if (!visible || !companyAgent || !active || !state || busy) return;
    let current = true;
    const id = active.id;
    void state({ conversationId: id, workspaceId: /^ws_[a-f0-9]{12}$/.test(workspace) ? workspace : undefined }).then(result => {
      if (current) setTaskStates(previous => ({ ...previous, [id]: result }));
    }).catch(() => {});
    return () => { current = false; };
  }, [visible, Boolean(companyAgent), active?.id, workspace, busy]);
  useEffect(() => {
    if (!visible || windowsDesktop || !window.somnusNativeDshChat || !listProviders) return;
    const controller = new AbortController();
    void listProviders(controller.signal).then(result => {
      if (!controller.signal.aborted) setCompanyCatalog(result.company_models || []);
    }).catch(() => {});
    return () => controller.abort();
  }, [visible, windowsDesktop]);
  useEffect(() => { if (stick.current) log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'auto' }); },
    [messages, busy, liveExecution, permissionRequest, selectedTurn?.delegation, question?.request, toolNote]);
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
    setComposerBlocks([]);
    setAttachments([]);
    setDataFile(null);
    setDocFile(null);
  }
  function snapshotDraft(): Draft { return { text, composerBlocks, skills, plugins, attachments, dataFile, docFile }; }
  function snapshotRoute(): TurnRoute {
    return {
      agent: selectedAgent, nativeDsh: Boolean(companyAgent), reasoningEffort: reasoningValue,
      ...(memberTarget ? { memberOnly: true } : {}),
      modelId: chosenModel.id, effort: chosenModel.effort,
      companyOptions: selectedNativeOptions,
    };
  }
  function setQueuedMessages(id: string, items: QueuedMessage[]) {
    knownQueues.current.add(id);
    if (items.length) queues.current.set(id, items);
    else {
      queues.current.delete(id);
      restoredQueues.current.delete(id);
    }
    const save = window.somnusNativeDshChat?.saveQueue;
    if (!save) return;
    const payload: DurableQueuedMessage[] = items.map(({ draft, ...rest }) => ({
      ...rest,
      draft: {
        text: draft.text,
        ...(draft.composerBlocks?.length ? { composerBlocks: draft.composerBlocks } : {}),
        ...(draft.attachments.length ? { attachments: draft.attachments } : {}),
        ...(draft.docFile ? { docFile: draft.docFile } : {}),
        ...(draft.dataFile ? { dataFile: draft.dataFile } : {}),
        ...(draft.skills.length ? { skillIds: draft.skills.map(skill => skill.id) } : {}),
        ...(draft.plugins.length ? { pluginIds: draft.plugins.map(plugin => plugin.id) } : {}),
      },
    }));
    const pending = (queueWrites.current.get(id) || Promise.resolve()).catch(() => {}).then(() => save(id, payload));
    queueWrites.current.set(id, pending);
    void pending.catch(() => {
      const problem = '这批排队消息暂未保存到本机。请在退出前处理。';
      if (activeId.current === id) setError(problem);
      else turnErrors.current.set(id, problem);
      refreshTurns();
    }).finally(() => { if (queueWrites.current.get(id) === pending) queueWrites.current.delete(id); });
  }
  function queueDraft() {
    const id = activeId.current;
    const turn = id ? turns.current.get(id) : undefined;
    if (!id || !turn || uncertainQueues.current.has(id) || navigationLocked || savingMember || turn.stopping || turn.installingAddon || turn.steerPending) return;
    if (window.somnusNativeDshChat?.getQueue && !knownQueues.current.has(id)) {
      setError('正在恢复本机排队消息，请稍后再试。');
      return;
    }
    if (!canChat || imageBlocked || addon || /^\s*\//.test(text) || !hasDraft ||
      !selectedAgent && dataFile?.acpOnly) {
      setError('当前草稿不能排队。请检查模型能力、附件或命令。');
      return;
    }
    if (composerPrompt(snapshotDraft()).length > 12000) { setError('正文和引用共计最多 12000 字符。请缩短草稿或移除引用。'); return; }
    const queue = queues.current.get(id) || [];
    if (queue.length >= 8) { setError('此会话最多可排队 8 条消息。'); return; }
    setQueuedMessages(id, [...queue, {
      id: crypto.randomUUID().replaceAll('-', ''), draft: snapshotDraft(), route: snapshotRoute(),
      permission: nextPermission || turn.conversation.permission_mode || 'read_only',
    }]);
    turn.draftEdited = true;
    drafts.current.delete(id);
    persistDraft(id, '');
    clearDraft();
    setError('');
    refreshTurns();
  }
  async function steerCurrentTurn() {
    const id = activeId.current;
    const turn = id ? turns.current.get(id) : undefined;
    const bridge = window.somnusNativeDshChat;
    if (memberTarget || !id || !turn?.nativeDsh || !turn.externalTurnId || !bridge?.steer || turn.stopping || turn.installingAddon ||
      turn.steerPending || navigationLocked) {
      setError('当前回合无法追加指导。可以将草稿排队，等回复结束后发送。');
      return;
    }
    if (!hasDraft || attachments.length || dataFile || docFile || skills.length || plugins.length || addon || /^\s*\//.test(text)) {
      setError('追加指导仅接受普通文字。附件和扩展可随排队消息发送。');
      return;
    }
    const original = text;
    const originalBlocks = composerBlocks;
    const content = composerPrompt(snapshotDraft()).trim();
    if (content.length > 12000) { setError('正文和引用共计最多 12000 字符。请缩短草稿或移除引用。'); return; }
    const turnId = turn.externalTurnId;
    turn.steerPending = true;
    refreshTurns();
    const response = (async () => {
      try {
        const { steer_id } = await reserveExternalSteer(id, turnId, content);
        const result = await bridge.steer!({ conversationId: id, turnId, steerId: steer_id });
        if (!result.accepted || !result.message) throw new Error('Agent 已结束当前操作，指导未发送。');
        const accepted = result.message;
        if (!turn.messages.some(message => message.id === accepted.id)) turn.messages = [...turn.messages, accepted];
        const saved = drafts.current.get(id);
        if (saved?.text === original && (saved.composerBlocks === originalBlocks || !saved.composerBlocks?.length && !originalBlocks.length)) {
          drafts.current.set(id, { ...saved, text: '', composerBlocks: [] });
          persistDraft(id, '');
          if (isSelected(turn)) { setText(current => current === original ? '' : current); setComposerBlocks([]); }
        }
        if (isSelected(turn)) setError('');
      } catch (failure) {
        if (isSelected(turn)) setError(failureText(failure));
        else turnErrors.current.set(id, failureText(failure));
      } finally {
        turn.steerPending = false;
        refreshTurns();
      }
    })();
    turn.steerResponse = response;
    await response;
  }
  function steerQueuedMessages() {
    const id = activeId.current;
    const turn = id ? turns.current.get(id) : undefined;
    const sendQueue = window.somnusNativeDshChat?.steerQueue;
    if (!canSteerQueue || !id || turn !== selectedTurn || !turn?.externalTurnId || !sendQueue || turn.steerPending) return;
    const queueIds = (queues.current.get(id) || []).map(item => item.id);
    const turnId = turn.externalTurnId;
    turn.steerPending = true;
    refreshTurns();
    turn.steerResponse = (async () => {
      try {
        await queueWrites.current.get(id);
        if (turn.stopping || turns.current.get(id) !== turn) return;
        const result = await sendQueue({ conversationId: id, turnId, queueIds });
        if (!result.accepted) {
          if (isSelected(turn)) setError('Agent 已结束当前操作，排队消息仍可继续发送。');
          return;
        }
        const accepted = new Set(result.acceptedQueueIds);
        if (accepted.size !== queueIds.length || queueIds.some(id => !accepted.has(id))) throw Error('整队追加结果无法确认。请重试。');
        const known = new Set(turn.messages.map(message => message.id));
        turn.messages = [...turn.messages, ...result.messages.filter(message => !known.has(message.id))];
        uncertainQueues.current.delete(id);
        setQueuedMessages(id, (queues.current.get(id) || []).filter(item => !accepted.has(item.id)));
        if (isSelected(turn)) setError('');
      } catch (failure) {
        uncertainQueues.current.add(id);
        restoredQueues.current.add(id);
        if (isSelected(turn)) setError(failureText(failure));
        else turnErrors.current.set(id, failureText(failure));
      } finally {
        turn.steerPending = false;
        refreshTurns();
      }
    })();
  }
  function removeQueuedMessage(id: string, messageId: string) {
    if (queueStarting.current.has(id) || uncertainQueues.current.has(id) || turns.current.get(id)?.steerPending) return;
    const remaining = (queues.current.get(id) || []).filter(message => message.id !== messageId);
    setQueuedMessages(id, remaining);
    refreshTurns();
  }
  function recallQueuedDraft(messageId?: string) {
    const id = activeId.current;
    if (!id || !canRecallQueue || queueStarting.current.has(id) || uncertainQueues.current.has(id) || turns.current.get(id)?.steerPending) return false;
    const queue = queues.current.get(id) || [];
    const item = messageId ? queue.find(message => message.id === messageId) : queue.at(-1);
    if (!item) return false;
    markDraftEdited();
    drafts.current.set(id, item.draft);
    restoreDraft(item.draft);
    if (item.route.memberOnly && item.route.agent) {
      setMemberSelection({ conversationId: id, workspace, agent: item.route.agent });
    } else setMemberSelection(undefined);
    persistDraft(id, item.draft.text);
    removeQueuedMessage(id, item.id);
    composerInput.current?.focus();
    return true;
  }
  function draftKey() { return activeId.current || 'workspace:' + workspace; }
  function editDraftMedia(changes: Partial<Pick<Draft, 'attachments' | 'docFile' | 'dataFile'>>) {
    const id = draftKey();
    const current = drafts.current.get(id) || snapshotDraft();
    let blocks = current.composerBlocks || [];
    for (const key of ['docFile', 'dataFile'] as const) {
      if (!(key in changes)) continue;
      blocks = blocks.filter(block => block.fileId !== current[key]?.id);
      const file = changes[key];
      if (file) blocks = [...blocks, { id: crypto.randomUUID(), kind: 'file', label: file.name,
        fileId: file.id, offset: composerInput.current?.offset() ?? current.text.length }];
    }
    blocks = blocks.sort((left, right) => left.offset - right.offset);
    const draft = { ...current, ...changes, composerBlocks: blocks };
    drafts.current.set(id, draft);
    setComposerBlocks(blocks);
    if ('attachments' in changes) setAttachments(changes.attachments || []);
    if ('docFile' in changes) setDocFile(changes.docFile || null);
    if ('dataFile' in changes) setDataFile(changes.dataFile || null);
    persistDraft(id, draft.text);
  }
  function persistDraft(id: string, composerText = drafts.current.get(id)?.text || '') {
    const bridge = window.somnusNativeDshChat;
    if (!bridge?.saveDraft) return;
    const pending = questions.current.get(id);
    const stored = drafts.current.get(id);
    const hasAnswers = pending?.answers?.some(answer => answer.selected.length || answer.custom);
    const draft = {
      ...(composerText ? { text: composerText } : {}),
      ...(stored?.composerBlocks?.length ? { composerBlocks: stored.composerBlocks } : {}),
      ...(hasAnswers ? { questionId: pending?.request.requestId, answers: pending?.answers } : {}),
      ...(stored?.attachments.length ? { attachments: stored.attachments } : {}),
      ...(stored?.docFile ? { docFile: stored.docFile } : {}),
      ...(stored?.dataFile ? { dataFile: stored.dataFile } : {}),
    };
    void bridge.saveDraft(id, Object.keys(draft).length ? draft : null).catch(() => {});
  }
  function restoreDraft(draft?: Draft) {
    setText(draft?.text || '');
    setComposerBlocks(draft?.composerBlocks || []);
    setSkills(draft?.skills || []);
    setPlugins(draft?.plugins || []);
    setAttachments(draft?.attachments || []);
    setDataFile(draft?.dataFile || null);
    setDocFile(draft?.docFile || null);
  }
  function saveCurrentDraft() {
    const id = activeId.current;
    if (id) drafts.current.set(id, snapshotDraft());
  }
  function editDraft(value: string, blocks = composerBlocks) {
    if (value !== text) {
      setShowExtensions(false);
      setDismissedCommandText(undefined);
      setCommandIndex(0);
      setReferenceIndex(0);
    }
    const id = draftKey();
    markDraftEdited();
    const removed = composerBlocks.filter(block => block.fileId && !blocks.some(next => next.id === block.id));
    const nextDoc = removed.some(block => block.fileId === docFile?.id) ? null : docFile;
    const nextData = removed.some(block => block.fileId === dataFile?.id) ? null : dataFile;
    drafts.current.set(id, { ...snapshotDraft(), text: value, composerBlocks: blocks, docFile: nextDoc, dataFile: nextData });
    persistDraft(id, value);
    setText(value);
    setComposerBlocks(blocks);
    if (nextDoc !== docFile) setDocFile(nextDoc);
    if (nextData !== dataFile) setDataFile(nextData);
  }
  function addReference(kind: 'quote' | 'conversation', label: string, excerpt: string, trigger?: string, target = draftKey()) {
    const current = drafts.current.get(target) || snapshotDraft();
    const blocks = current.composerBlocks || [];
    if (blocks.filter(block => block.kind !== 'file').length >= 4) { setError('每条消息最多添加四个会话或文字引用。'); return; }
    const draft = trigger !== undefined && current.text === trigger ? current.text.replace(/@[^\n@]*$/, '') : current.text;
    const offset = trigger !== undefined ? draft.length : composerInput.current?.offset() ?? draft.length;
    const id = crypto.randomUUID();
    composerInput.current?.after(id);
    editDraft(draft, [...blocks, { id, kind, label: label.slice(0, 160), offset, text: excerpt.slice(0, 1800) }]
      .sort((left, right) => left.offset - right.offset));
    composerInput.current?.focus();
  }
  async function addConversationReference(id: string, trigger?: string) {
    if (navigationLocked || referenceLoading || id === active?.id || !items.some(item => item.id === id)) return;
    const target = draftKey();
    setReferenceLoading(true);
    dismissCommands();
    try {
      const selected = await conversation(id);
      if (!alive.current || draftKey() !== target || workspaceRef.current !== workspace) return;
      const excerpt = selected.messages.filter(message => message.status === 'complete' && message.content.trim())
        .slice(-6).map(message => (message.role === 'user' ? '用户：' : '助手：') + message.content.trim().slice(0, 280)).join('\n');
      if (!excerpt) throw Error('该会话暂无已完成的文字消息可供引用。');
      addReference('conversation', selected.conversation.title, excerpt, trigger, target);
    } catch (failure) {
      if (draftKey() === target && workspaceRef.current === workspace) setError(failureText(failure));
    } finally { if (alive.current) setReferenceLoading(false); }
  }
  function quoteReply(message: ChatMessage, source: HTMLElement) {
    const selection = source.ownerDocument.getSelection();
    const article = source.closest('.assistant-message');
    const excerpt = selection?.anchorNode && selection.focusNode && article?.contains(selection.anchorNode) &&
      article.contains(selection.focusNode) ? selection.toString().trim() : '';
    addReference('quote', '引用回复', excerpt || message.content.trim());
  }
  function dismissCommands() {
    setDismissedCommandText(text);
  }
  function changeExtensionMenu(open: boolean) {
    if (open) dismissCommands();
    setShowExtensions(open);
  }
  function openAttachmentReference() {
    attachmentReferenceText.current = text;
    dismissCommands();
    setAttachmentLibraryOpen(true);
  }
  function handleComposerKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || Date.now() < compositionEnd.current) return;
    if (event.key !== 'Escape') composerEscape.current = undefined;
    if (event.key === 'Escape') {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      if (commandMenuOpen || referenceMenuOpen || plusMenuOpen || showExtensions) {
        event.preventDefault();
        event.stopPropagation();
        composerEscape.current = undefined;
        dismissCommands();
        setPlusMenuOpen(false);
        setShowExtensions(false);
      } else if (selectedTurn && !stopping && !selectedTurn.installingAddon && !question && !selectedTurn.permission && !selectedTurn.delegation) {
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        const previous = composerEscape.current;
        composerEscape.current = previous?.turn === selectedTurn && now - previous.time <= 500 ? undefined : { turn: selectedTurn, time: now };
        if (!composerEscape.current) void stop();
      }
      return;
    }
    if (event.altKey || event.getModifierState?.('AltGraph') || event.ctrlKey && event.metaKey) return;
    if (referenceMenuOpen && !event.shiftKey && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setReferenceIndex((activeReferenceIndex + step + referenceCount) % referenceCount);
      return;
    }
    if (referenceMenuOpen && !event.shiftKey && !event.repeat && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      const item = referenceConversations[activeReferenceIndex - Number(hasDocumentLibrary)];
      if (item) void addConversationReference(item.id, text);
      else if (hasDocumentLibrary) openAttachmentReference();
      return;
    }
    if (commandMenuOpen && event.key === 'Tab') {
      const picked = !event.shiftKey ? filteredCommands[selectedCommandIndex] : undefined;
      if (picked?.executable) {
        event.preventDefault();
        chooseComposerCommand(picked);
      } else dismissCommands();
      return;
    }
    if (commandMenuOpen && filteredCommands.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setCommandIndex((selectedCommandIndex + delta + filteredCommands.length) % filteredCommands.length);
      return;
    }
    if (event.key === 'ArrowUp' && !commandMenuOpen && !event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey && recallQueuedDraft()) {
      event.preventDefault();
      return;
    }
    const enterAction=composerEnterAction({key:event.key,shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey,sendKey:uiPreferences.sendKey,busy:busy&&!canStartMember,steerAvailable:steerAvailable&&hasDraft,canSteerQueue});
    if (enterAction==='none'||enterAction==='newline') return;
    event.preventDefault();
    if (event.repeat) return;
    if (enterAction==='steer-queue') { steerQueuedMessages(); return; }
    const picked = commandMenuOpen ? filteredCommands[selectedCommandIndex] : undefined;
    if (picked) {
      if (picked.executable) chooseComposerCommand(picked);
      else setError(picked.reason || '此命令目前不可执行。');
    } else if (busy && !canStartMember) sendBusyDraft(enterAction==='alternate');
    else void sendSelected();
  }
  function sendBusyDraft(alternate = false) {
    if (!canSendBusyDraft) return;
    const action = alternate && steerAvailable ? preferredBusyMode === 'queue' ? 'steer' : 'queue' : preferredBusyMode;
    if (action === 'steer') void steerCurrentTurn();
    else queueDraft();
  }
  function chooseComposerCommand(command: ComposerCommand) {
    if (navigationLocked || !command.executable) return;
    dismissCommands();
    if (command.native) {
      if (command.hint && (!text.trim() || slashName !== undefined)) {
        editDraft('/' + command.name + ' ');
        setDismissedCommandText('/' + command.name + ' ');
      } else if (command.hint) setError('请先发送或清空草稿，再输入此命令的参数。');
      else void send('/' + command.name);
      return;
    }
    if (slashName !== undefined) editDraft('');
    switch (command.name) {
      case 'file': fileInput.current?.click(); break;
      case 'new': void newChat(); break;
      case 'model': setModelPickerRequest(value => value + 1); break;
      case 'permission': setPermissionPickerRequest(value => value + 1); break;
      case 'plan':
        if (nativeTasks && planActionAvailable) void send(currentTaskState?.plan?.active ? '/plan off' : '/plan');
        break;
      case 'goal':
        if (nativeTasks && !locked) setGoalRequest(value => value + 1);
        break;
      case 'workspace': if (active) setWorkspacePanelChat(active.id); break;
      case 'skills': onOpenExtensionConfig?.('skills'); break;
      case 'plugins': onOpenExtensionConfig?.('plugin-config'); break;
      case 'mcp': onOpenExtensionConfig?.('mcp'); break;
    }
  }
  function clearPendingPermission(key: string) {
    setPendingPermissions(current => {
      const remaining = { ...current };
      delete remaining[key];
      return remaining;
    });
  }
  useEffect(() => {
    const item = active;
    const bridge = window.somnusNativeDshChat;
    if (loading || !bridge?.recoverQuestions && !bridge?.getDraft) return;
    let current = true;
    const id = item?.id || 'workspace:' + workspace;
    void Promise.all([
      bridge?.getDraft?.(id).catch(() => null),
      item && bridge?.recoverQuestions?.(id).catch(() => []),
    ]).then(([stored, pending]) => {
      if (!current || draftKey() !== id || workspaceRef.current !== workspace) return;
      if (stored && !drafts.current.has(id) && !hasActiveTurn(id)) {
        const attachments = (stored.attachments || []).filter((image): image is ChatAttachment =>
          isLocalImage(image.data_url) && typeof image.mime === 'string' && Number.isInteger(image.size) &&
          Number.isInteger(image.width) && Number.isInteger(image.height));
        const draft = { text: stored.text || '', composerBlocks: stored.composerBlocks || [], skills: [], plugins: [], attachments,
          dataFile: stored.dataFile || null, docFile: stored.docFile || null };
        drafts.current.set(id, draft);
        restoreDraft(draft);
      }
      const recovered = pending?.find(question => question.phase !== 'continued') || pending?.[0];
      if (item && recovered && !questions.current.has(id)) {
        questions.current.set(id, { request: recovered, agent: { agentId: COMPANY_NATIVE_AGENT, agentName: '默认 Agent' },
          workspace, title: item.title, recovered: true, answers: stored?.questionId === recovered.requestId ? stored.answers : undefined });
        refreshTurns();
      }
    });
    return () => { current = false; };
  }, [active?.id, workspace, loading]);
  useEffect(() => {
    const id = active?.id;
    const read = window.somnusNativeDshChat?.getQueue;
    if (!id || loading || !read || knownQueues.current.has(id)) return;
    let current = true;
    void read(id).then(items => {
      if (!current || knownQueues.current.has(id)) return;
      knownQueues.current.add(id);
      if (!items?.length) return;
      queues.current.set(id, items.map(item => ({
        ...item,
        draft: {
          text: item.draft.text || '',
          composerBlocks: item.draft.composerBlocks || [],
          attachments: (item.draft.attachments || []).filter((image): image is ChatAttachment =>
            isLocalImage(image.data_url) && typeof image.mime === 'string' && Number.isInteger(image.size) &&
            Number.isInteger(image.width) && Number.isInteger(image.height)),
          dataFile: item.draft.dataFile || null,
          docFile: item.draft.docFile || null,
          skills: (item.draft.skillIds || []).map(id => ({ id, name: id, description: '', enabled: true, reference_count: 0 })),
          plugins: (item.draft.pluginIds || []).map(id => ({ id, name: id, description: '', version: '', enabled: true,
            skill_ids: [], mcp_ids: [], missing_skills: [], missing_mcp: [], inactive_skills: [], inactive_mcp: [] })),
        },
      })));
      restoredQueues.current.add(id);
      refreshTurns();
    }).catch(() => {
      if (current) setError('暂时无法恢复本机排队消息。');
    });
    return () => { current = false; };
  }, [active?.id, loading, workspace]);
  function markDraftEdited() {
    const id = activeId.current;
    const turn = id ? turns.current.get(id) : undefined;
    if (turn) turn.draftEdited = true;
    if (id) for (const lane of groups.current.get(id)?.turns.values() || []) lane.draftEdited = true;
  }
  function changeDraftSkills(next: Skill[]) {
    markDraftEdited();
    setSkills(next);
  }
  function changeDraftPlugins(next: InstalledPlugin[]) {
    markDraftEdited();
    setPlugins(next);
  }
  function selectHistory(id: string) {
    if (navigationLocked || id === activeId.current) return;
    setTrajectoryFor(undefined);
    setPlusMenuOpen(false);
    setShowExtensions(false);
    setDismissedCommandText(undefined);
    saveCurrentDraft();
    restoreDraft(drafts.current.get(id));
    stick.current = true;
    setAtBottom(true);
    void openHistory(id);
  }
  useEffect(() => {
    const sync = () => setNotificationConversation(linkedConversation());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    if (!visible || navigationLocked || !notificationConversation) return;
    if (linkedConversation() === notificationConversation) {
      selectHistory(notificationConversation);
      window.history.replaceState(window.history.state, '', '#assistant');
    }
    setNotificationConversation(undefined);
  }, [visible, navigationLocked, notificationConversation]);
  useEffect(() => {
    if (!visible || navigationLocked || !attentionChat || attentionChat.workspace !== workspace) return;
    selectHistory(attentionChat.id);
    setAttentionChat(undefined);
  }, [visible, navigationLocked, attentionChat, workspace]);
  async function newChat() {
    if (navigationLocked || deleteLock.current) return;
    saveCurrentDraft();
    setError(''); setLoading(true);
    try {
      const permission = active ? undefined : nextPermission;
      const item = await createConversation(workspace, permission);
      if (alive.current) {
        if (!active && draftTeamwork[workspace]) transferDraftTeamwork(item.id);
        if (permission) clearPendingPermission(permissionKey);
        ++historyToken.current; choose(item); updateItem(item); setMessages([]); clearDraft();
        await applyPendingTeamwork(item.id);
      }
    }
    catch (failure) { if (alive.current) setError(failureText(failure)); }
    finally { if (alive.current) setLoading(false); }
  }
  async function selectWorkMode(modeId: string, fresh: boolean) {
    const bridge = window.somnusNativeDshChat;
    if (!bridge?.selectAgentMode || navigationLocked || busy || pendingQueue.length || modeSwitchLock.current || active?.archived) {
      throw new Error('请等待当前操作完成后再选择工作模式。');
    }
    modeSwitchLock.current = true;
    setModeSaving(true);
    const draft = snapshotDraft();
    const previous = active;
    let created: Conversation | undefined;
    try {
      saveCurrentDraft();
      const item = fresh || !previous
        ? (created = await createConversation(workspace, nextPermission || previous?.permission_mode)) : previous;
      if (created && alive.current) updateItem(created);
      const result = await bridge.selectAgentMode({ conversationId: item.id, workspaceId: workspace, modeId });
      const saved = await conversation(item.id);
      if (alive.current) {
        choose(saved.conversation); updateItem(saved.conversation);
        setUnconfirmedModeChat(undefined);
        setError('');
        if (created) {
          ++historyToken.current;
          setMessages(saved.messages);
          drafts.current.set(item.id, draft);
          restoreDraft(draft);
          if (nextPermission) clearPendingPermission(permissionKey);
        }
      }
      return result;
    } catch (failure) {
      if (created && alive.current) {
        choose(created); updateItem(created); setMessages([]);
        drafts.current.set(created.id, draft); restoreDraft(draft);
        setUnconfirmedModeChat(created.id);
        setError('空白会话已创建，但工作模式尚未确认。请重新选择模式后发送。' + failureText(failure));
      }
      throw failure;
    } finally {
      modeSwitchLock.current = false;
      if (alive.current) setModeSaving(false);
    }
  }
  function transferDraftTeamwork(id: string) {
    pendingTeamwork.current.add(id);
    setDraftTeamwork(previous => ({ ...previous, [workspace]: false }));
  }
  async function applyPendingTeamwork(id: string) {
    if (!pendingTeamwork.current.has(id)) return;
    const saved = await window.somnusDesktop?.setTeamwork?.(id, true);
    if (!saved?.available || !saved.enabled) throw new Error('无法为此会话开启 Teamwork，请重试。');
    pendingTeamwork.current.delete(id);
    if (alive.current) setTeamworkRevision(value => value + 1);
  }
  async function copyReply(message: ChatMessage) {
    setClipboardError(undefined);
    setCopiedReply(undefined);
    try {
      await copyText(message.content);
      if (alive.current) setCopiedReply(message.id);
    } catch {
      if (alive.current) setClipboardError({ id: message.id, text: '无法复制回答，请选中文字手动复制。' });
    }
  }
  async function shareReply(message: ChatMessage) {
    if (!active) return;
    setClipboardError(undefined);
    setSharedReply(undefined);
    try {
      const link = new URL(window.location.pathname, window.location.origin);
      link.hash = 'assistant?conversation=' + encodeURIComponent(active.id);
      await copyText(link.href);
      if (alive.current) setSharedReply(message.id);
    } catch {
      if (alive.current) setClipboardError({ id: message.id, text: '无法复制会话链接。' });
    }
  }
  async function createEditedBranch(content:string) {
    if(!active||!editingMessage||branchLock.current)throw Error('当前会话暂不可创建分支。');
    const source=active.id;branchLock.current=true;
    try{
      let next:Conversation;
      if(editingMessage.checkpoint){
        const bridge=window.somnusNativeDshChat;
        if(!bridge?.fork)throw Error('当前宿主不支持原生检查点分支。');
        const forked=await confirmedNativeFork({conversationId:source,turnId:editingMessage.checkpoint});
        next=(await conversation(forked.conversationId)).conversation;
      }else next=await createConversation(workspace,'read_only');
      if(!alive.current||activeId.current!==source)return;
      saveCurrentDraft();updateItem(next);restoreDraft();await openHistory(next.id);
      setText(content);persistDraft(next.id,content);stick.current=true;
    }finally{branchLock.current=false;}
  }
  async function branchFromReply(messageId: string, copyMessagesOnly=false) {
    if (!active || locked || branchLock.current || deleteLock.current) return;
    const source = active.id;
    branchLock.current = true;
    setBranchingReply(messageId);
    setError('');
    try {
      const original = messages.find(message=>message.id===messageId);
      const nativeFork = !copyMessagesOnly && original?.reply_meta?.transport==='dsh-native' && window.somnusNativeDshChat?.fork;
      let branch: Conversation;
      if(!copyMessagesOnly && original?.reply_meta?.transport==='dsh-native'&&!nativeFork)throw Error('当前宿主尚未提供原生会话分支。可在更多分支方式中选择「复制消息分支」。');
      if(nativeFork){ const result=await confirmedNativeFork({conversationId:source,turnId:messageId}); branch=(await conversation(result.conversationId)).conversation; }
      else branch=await branchConversation(source, messageId);
      if (!alive.current || workspaceRef.current !== workspace) return;
      updateItem(branch);
      if (activeId.current === source) {
        saveCurrentDraft();
        restoreDraft();
        stick.current = true;
        setAtBottom(true);
        await openHistory(branch.id);
      }
    } catch (failure) {
      if (alive.current && activeId.current === source) setError(failureText(failure));
    } finally {
      branchLock.current = false;
      if (alive.current) setBranchingReply(undefined);
    }
  }
  async function rename() {
    if (!renameTarget || navigationLocked || hasActiveTurn(renameTarget.id) || deleteLock.current || !name.trim()) return;
    setRenameBusy(true);
    setRenameError('');
    try {
      const item = await renameConversation(renameTarget.id, name);
      if (!alive.current) return;
      if (activeId.current === item.id) choose(item);
      if (!renameTarget.workspace_id || renameTarget.workspace_id === workspaceRef.current) updateItem(item);
      setRenameTarget(null);
    }
    catch (failure) { if (alive.current) setRenameError(failureText(failure)); }
    finally { if (alive.current) setRenameBusy(false); }
  }
  function requestRename(item: Conversation) {
    if (hasActiveTurn(item.id)) return;
    setRenameError('');
    setName(item.title);
    setRenameTarget(item);
  }
  function requestDelete(item: Conversation) {
    if (hasActiveTurn(item.id) || queueStarting.current.has(item.id)) return;
    setDeleteError('');
    setDeleteTarget(item);
  }
  async function organizeSession(item: Conversation, changes: ConversationOrganization) {
    if (changes.archived && (hasActiveTurn(item.id) || queueStarting.current.has(item.id) || queues.current.get(item.id)?.length)) {
      throw new Error('会话仍有正在运行或排队的消息。请处理后再归档。');
    }
    const next = await organizeConversation(item.id, changes);
    if (!alive.current || item.workspace_id !== workspaceRef.current) return next;
    if (next.archived) {
      setItems(old => old.filter(value => value.id !== item.id));
      if (activeId.current === item.id) {
        saveCurrentDraft();
        ++historyToken.current;
        activeId.current = null;
        setActive(null);
        setMessages([]);
        restoreDraft(drafts.current.get('workspace:' + workspace));
        try { localStorage.removeItem(lastKey); } catch { /* optional preference */ }
      }
    } else {
      updateItem(next);
      if (activeId.current === item.id) choose(next);
    }
    return next;
  }
  async function removeConversation() {
    if (!deleteTarget || navigationLocked || hasActiveTurn(deleteTarget.id) || queueStarting.current.has(deleteTarget.id) || deleteLock.current) return;
    const target = deleteTarget.id; deleteLock.current = true; setDeleteBusy(true); setDeleteError(''); ++listToken.current;
    try {
      await deleteConversation(target);
      drafts.current.delete(target);
      queues.current.delete(target);
      clearPendingPermission(target);
      questions.current.delete(target);
      persistDraft(target, '');
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
    const others = files.filter(file => !file.type.startsWith('image/'));
    const tables = others.filter(file => /\.(csv|xlsx|xlsm)$/i.test(file.name));
    const documents = others.filter(file => !tables.includes(file));
    if (tables.length > 1 || documents.length > 1) {
      setError('每条消息可添加一份表格和一份文档。请分别选择要附加的文件。');
      return;
    }
    if (images.length) void addImages(images);
    if (tables[0]) void addDataFile(tables[0]);
    if (documents[0]) void addDocument(documents[0]);
  }

  function pasteComposerFiles(event: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file' && !item.webkitGetAsEntry?.()?.isDirectory)
      .map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    if (!event.clipboardData.getData?.('text/plain')) event.preventDefault();
    if (!navigationLocked) addAnyFiles(files);
  }

  function acceptsComposerDrop(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).some(type => type === 'Files' || type === conversationDropType);
  }

  function dragConversationReference(event: DragEvent<HTMLButtonElement>, id: string) {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(conversationDropType, id);
  }

  function dropComposerFiles(event: DragEvent<HTMLElement>) {
    if (!acceptsComposerDrop(event)) return;
    event.preventDefault();
    setComposerDragging(false);
    if (navigationLocked) return;
    if (Array.from(event.dataTransfer.types).includes(conversationDropType)) {
      void addConversationReference(event.dataTransfer.getData(conversationDropType));
      return;
    }
    const files = Array.from(event.dataTransfer.items).filter(item => item.kind === 'file' && !item.webkitGetAsEntry?.()?.isDirectory)
      .map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (files.length) addAnyFiles(files);
    else if (!event.dataTransfer.items.length) addAnyFiles(Array.from(event.dataTransfer.files));
  }

  function keepComposerFocus(event: MouseEvent<HTMLElement>) {
    if (event.button === 0) event.preventDefault();
  }

  async function addLibraryFile(path: string) {
    if (navigationLocked || libraryLock.current) return;
    const conversationId = activeId.current;
    libraryLock.current = true;
    setLibraryLoading(true);
    setError('');
    try {
      const result = await readDocumentFile('private', path);
      if (!alive.current || activeId.current !== conversationId || workspaceRef.current !== workspace) return;
      if (!Number.isSafeInteger(result.size) || result.size < 0 || result.size > 10 * 1024 * 1024) {
        throw new Error('文件不能超过 10 MB。');
      }
      const bytes = atob(result.dataBase64);
      if (bytes.length !== result.size) throw new Error('文件内容读取不完整。');
      const buffer = new Uint8Array(bytes.length);
      for (let index = 0; index < bytes.length; index++) buffer[index] = bytes.charCodeAt(index);
      addAnyFiles([new File([buffer], result.name, { type: result.mimeType })]);
    } catch (failure) { if (alive.current && activeId.current === conversationId && workspaceRef.current === workspace) setError(failureText(failure)); }
    finally {
      libraryLock.current = false;
      if (alive.current) setLibraryLoading(false);
    }
  }

  async function addDocument(file: File) {
    if (file.size > 10 * 1024 * 1024) { setError(`文件不能超过 10MB（当前 ${(file.size / 1048576).toFixed(1)} MB）。`); return; }
    markDraftEdited();
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
      if (alive.current) editDraftMedia({ docFile: payload.file });
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
    markDraftEdited();
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
      if (alive.current) editDraftMedia({ dataFile: { ...payload.file, acpOnly } });
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

  function groupMessages(channel: { messages: ChatMessage[]; turns: Map<string, RunningTurn> }) {
    return [...channel.messages, ...[...channel.turns.values()].flatMap(turn => turn.messages)]
      .sort((a, b) => a.created_at - b.created_at);
  }

  function finishTurn(turn: RunningTurn, retryDraft?: Draft, continueQueue = false) {
    const id = turn.conversation.id;
    if (turn.groupMember) {
      const running = groups.current.get(id);
      if (!running || !turn.runningAgent || running.turns.get(turn.runningAgent.id || '') !== turn) return;
      running.messages.push(...turn.messages);
      running.turns.delete(turn.runningAgent.id || '');
      const snapshot = groupMessages(running);
      if (!running.turns.size) groups.current.delete(id);
      if (turn.error) {
        if (turn.assistantMessageId) {
          groupErrors.current.set(turn.assistantMessageId, turn.error);
          if (groupErrors.current.size > 40) groupErrors.current.delete(groupErrors.current.keys().next().value!);
        } else {
          turnErrors.current.set(id, turn.runningAgent.name + '：' + turn.error);
          if (retryDraft && !turn.draftEdited) {
            drafts.current.set(id, retryDraft);
            persistDraft(id, retryDraft.text);
            if (isSelected(turn)) restoreDraft(retryDraft);
          }
        }
      }
      if (isSelected(turn)) setMessages(snapshot);
      refreshTurns();
      return;
    }
    turns.current.delete(id);
    if (continueQueue && !turn.stopping && !turn.error) acknowledgeQueuedMessage(turn);
    if (turn.error) turnErrors.current.set(id, turn.error);
    const restore = !turn.draftEdited && retryDraft;
    if (restore) drafts.current.set(id, restore);
    if (restore) persistDraft(id, restore.text);
    if (isSelected(turn)) {
      setMessages(turn.messages);
      if (restore) restoreDraft(restore);
    }
    refreshTurns();
    if (continueQueue && !turn.stopping && !turn.error && !restoredQueues.current.has(id)) {
      void startNextQueuedMessage(turn.conversation, turn.workspace, turn.messages);
    }
  }

  async function startNextQueuedMessage(item: Conversation, turnWorkspace: string, previousMessages: ChatMessage[]) {
    const id = item.id;
    let next = queues.current.get(id)?.[0];
    if (!alive.current || !next || turns.current.has(id) || queueStarting.current.has(id)) return;
    queueStarting.current.add(id);
    refreshTurns();
    let turn: RunningTurn | undefined;
    try {
      await queueWrites.current.get(id);
      if (uncertainQueues.current.has(id)) {
        const getQueue = window.somnusNativeDshChat?.getQueue;
        if (!getQueue) throw Error('无法确认队列状态，请关闭并重新打开会话后重试。');
        const stored = new Set((await getQueue(id) || []).map(message => message.id));
        const remaining = (queues.current.get(id) || []).filter(message => stored.has(message.id));
        if (remaining.length) queues.current.set(id, remaining);
        else queues.current.delete(id);
        uncertainQueues.current.delete(id);
        next = remaining[0];
        if (!next) return;
      }
      restoredQueues.current.delete(id);
      const conversation = next.permission === (item.permission_mode || 'read_only') ? item
        : { ...item, permission_mode: await saveConversationPermission(id, next.permission) };
      if (!alive.current || queues.current.get(id)?.[0] !== next) return;
      const route = next.route;
      turn = {
        conversation, workspace: turnWorkspace, messages: previousMessages, stopping: false, startedAt: Date.now(),
        runningAgent: route.agent && { id: route.agent.agentId, name: route.nativeDsh ? 'Somnus' : route.agent.agentName, model: route.agent.modelName || route.agent.modelId, transport: route.nativeDsh ? 'dsh-native' : 'acp' },
        controller: route.agent ? undefined : new AbortController(), nativeDsh: route.nativeDsh,
        draftEdited: true, queuedMessage: next,
      };
      turns.current.set(id, turn);
      turnErrors.current.delete(id);
      updateTurnConversation(turn, conversation);
      if (isSelected(turn)) setError('');
    } catch (failure) {
      if (alive.current) turnErrors.current.set(id, failureText(failure));
    } finally {
      queueStarting.current.delete(id);
      refreshTurns();
    }
    if (!turn) return;
    const route = next.route;
    if (route.agent) await sendExternal(turn, route.agent, next.draft, route.reasoningEffort, undefined, route.companyOptions);
    else await sendInternal(turn, next.draft, route);
  }
  function acknowledgeQueuedMessage(turn: RunningTurn) {
    const queued = turn.queuedMessage;
    if (!queued || turn.committed) return;
    turn.committed = true;
    removeQueuedMessage(turn.conversation.id, queued.id);
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

  async function sendExternal(turn: RunningTurn, selection: ExternalSelection, draft: Draft, reasoningEffort?: string,
    questionReply?: QuestionReply, companyOptions?: { model: string; effort?: CompanyReasoningEffort | ReasoningEffort }, nativeCommand?: string, memberOnly = false) {
    const bridge = mainChatBridge();
    const nativeDsh = turn.nativeDsh ? window.somnusNativeDshChat : undefined;
    if (turn.nativeDsh ? !nativeDsh : !bridge) {
      turn.error = '当前 Agent 的运行环境未就绪。';
      finishTurn(turn, draft);
      return;
    }
    const transport = nativeDsh || bridge!;
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
    let persistencePending = false;
    let unsubscribe: (() => void) | undefined;
    let responseError: unknown;
    function publishProposals(proposals: FileProposal[]) {
      if (!proposals.length || !alive.current) return;
      setFileProposals(current => ({
        ...current,
        [id]: [...(current[id] || []).filter(item => !proposals.some(proposal => proposal.id === item.id)),
          ...proposals.map(proposal => ({ ...proposal, assistant_message_id: proposal.assistant_message_id || assistantId }))],
      }));
    }
    try {
      const reserved = await beginExternalTurn(id, {
        content: composerPrompt(draft).trim(), agent_id: selection.agentId, agent_name: selection.agentName, model: selection.modelName || selection.modelId,
        ...(memberOnly || turn.queuedMessage?.route.memberOnly ? { member_only: true } : {}),
        ...(turn.groupMember ? { group_parallel: true } : {}),
        ...(turn.queuedMessage ? { queue_id: turn.queuedMessage.id } : {}),
        ...(turn.nativeDsh && windowsDesktop && selection.modelId ? { provider_model_id: selection.modelId } : {}),
        ...(companyOptions ? { ...(!windowsDesktop ? { company_model: companyOptions.model } : {}), reasoning_effort: companyOptions.effort } : {}),
        attachments: draft.attachments, file_ids: draft.docFile ? [draft.docFile.id] : undefined,
        analysis_file_id: draft.dataFile?.id, skill_ids: draft.skills.map(skill => skill.id),
        ...(draft.plugins.length ? { plugin_ids: draft.plugins.map(plugin => plugin.id) } : {}),
      });
      turnId = reserved.turn_id;
      acknowledgeQueuedMessage(turn);
      turn.externalTurnId = turnId;
      assistantId = reserved.assistant_message.id;
      turn.assistantMessageId = assistantId;
      turn.userMessageId = reserved.user_message.id;
      updateTurnConversation(turn, reserved.conversation);
      turn.messages = [...turn.messages, reserved.user_message, reserved.assistant_message];
      refreshTurns();
      if (turn.stopping) { endStatus = 'cancelled'; return; }
      function updateStep(step: ExecutionStep) {
        const existing = execution.steps.findIndex(item => item.id === step.id);
        if (existing < 0 && execution.steps.length >= (nativeDsh ? 300 : 40)) {
          execution = { ...execution, truncated: true };
          return;
        }
        if (step.status === 'in_progress' && !timings.has(step.id)) timings.set(step.id, performance.now());
        const started = timings.get(step.id);
        const duration = started === undefined || step.status === 'pending' || step.status === 'in_progress'
          ? undefined : Math.round(performance.now() - started);
        const parentId = step.parent_id || execution.steps[existing]?.parent_id;
        const safe = { ...step, title: step.title.slice(0, 180), kind: step.kind.slice(0, 60), duration_ms: step.duration_ms ?? duration,
          ...(parentId ? { parent_id: parentId } : {}),
          failure_reason: step.status === 'failed' ? step.failure_reason?.trim().slice(0, 240) : undefined };
        const steps = execution.steps.slice();
        if (existing < 0) steps.push(safe);
        else steps[existing] = safe;
        execution = { ...execution, steps };
      }
      function publishExecution() {
        turn.execution = { assistantId: reserved.assistant_message.id, data: execution };
        refreshTurns();
      }
      unsubscribe = transport.onUpdate(update => {
        if ((!nativeDsh && update.agentId !== selection.agentId) || update.conversationId !== id ||
          (turn.groupMember && update.turnId !== turnId)) return;
        if (update.acpStage) {
          turn.stage = update.acpStage;
          refreshTurns();
        }
        if (update.projectProposal) publishProposals([update.projectProposal]);
        if (nativeDsh && update.dshTaskState) {
          const next = update.dshTaskState;
          setTaskStates(previous => ({ ...previous, [id]: next }));
        }
        if (update.acpPermission && transport.respondPermission) {
          turn.permission = { conversationId: id, request: update.acpPermission };
          const { requestId, kind } = update.acpPermission;
          if (kind === 'mcp' || kind === 'edit' || kind === 'test') {
            const approvals = turn.traceApprovals ??= new Map();
            if (approvals.size < 40 && !approvals.has(requestId)) {
              approvals.set(requestId, { id: requestId, kind, status: 'pending', at: Date.now() / 1000 });
            }
          }
          refreshTurns();
        }
        if (update.acpPermissionClosed && turn.traceApprovals?.get(update.acpPermissionClosed.requestId)?.status === 'pending') {
          recordAcpDecision(turn, update.acpPermissionClosed.requestId, 'closed');
        }
        if (update.acpPermissionClosed && turn.permission?.request.requestId === update.acpPermissionClosed.requestId) {
          turn.permission = undefined;
          refreshTurns();
        }
        if (nativeDsh?.respondQuestion && update.dshQuestion) {
          const pending = questions.current.get(id);
          const sameQuestion = pending?.request.requestId === update.dshQuestion.requestId;
          questions.current.set(id, { ...(sameQuestion ? pending : undefined), request: update.dshQuestion, agent: selection,
            workspace: turn.workspace, title: turn.conversation.title });
          refreshTurns();
        }
        if (update.dshQuestionClosed && questions.current.get(id)?.request.requestId === update.dshQuestionClosed.requestId) {
          questions.current.delete(id);
          persistDraft(id);
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
          const { callId, traceId, name, title, kind, status, message, taskId } = update.toolProgress;
          let stepId = traceId || 'local-call-' + callId;
          if (!traceId && !callId) {
            stepId = status === 'running' ? 'local-' + ++serial : progressIds.get(name) || 'local-' + ++serial;
            if (status === 'running') progressIds.set(name, stepId);
            else progressIds.delete(name);
          }
          updateStep({ id: stepId, title: title || name, kind: kind || 'tool', status: status === 'running' ? 'in_progress' : status === 'error' ? 'failed' : 'completed',
            failure_reason: status === 'error' ? message : undefined });
          publishExecution();
          if (status === 'complete' && taskId && /^[a-f0-9]{32}$/.test(taskId)) {
            analysisTasks.add(taskId);
            watchAnalysisTask(taskId);
          }
          turn.toolNote = message || (status === 'running' ? name + ' 正在运行…' : status === 'error' ? name + ' 执行失败' : '');
          refreshTurns();
          return;
        }
        if(update.pluginCard && assistantId) setLivePluginCards(previous=>({...previous,[assistantId!]:[...(previous[assistantId!]||[]),update.pluginCard!].slice(-20)}));
        if(update.acpDiagnostic && assistantId) setRuntimeNotices(previous=>{const next={...previous};if(['reconnected','active'].includes(update.acpDiagnostic!.code))delete next[assistantId!];else next[assistantId!]=update.acpDiagnostic!.message;return next;});
        if (!update.text) return;
        partial = (partial + update.text).slice(0, 100000);
        turn.messages = turn.messages.map(item => item.id === assistantId ? { ...item, content: partial } : item);
        refreshTurns();
      });
      const workspaceId = /^ws_[a-f0-9]{12}$/.test(turn.workspace) ? turn.workspace : undefined;
      const route = { agentId: selection.agentId, conversationId: id, turnId: reserved.turn_id, workspaceId };
      let commandResult: (ExternalResult & { ok: boolean; taskState?: DshTaskState }) | undefined;
      if (nativeCommand) {
        if (!nativeDsh?.executeCommand) throw new Error('当前桌面连接无法执行原生命令。');
        commandResult = await nativeDsh.executeCommand({ ...route, line: nativeCommand });
        const next = commandResult.taskState;
        if (next) setTaskStates(previous => ({ ...previous, [id]: next }));
      }
      const result: ExternalResult = commandResult || (nativeDsh
        ? await nativeDsh.promptConversation({ agentId: selection.agentId, conversationId: id, turnId: reserved.turn_id,
          ...(questionReply ? { questionReply } : {}),
          workspaceId })
        : await bridge!.promptConversation({ agentId: selection.agentId, conversationId: id, turnId: reserved.turn_id,
          modelId: selection.modelId, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          ...(turn.groupMember ? { groupMember: true } : {}) }));
      persistencePending = result.persistencePending === true;
      if (persistencePending && turnId) setPendingResultIds(previous => new Set(previous).add(turnId!));
      if (result.projectProposals) publishProposals(result.projectProposals);
      if (result.text) partial = result.text.slice(0, 100000);
      resultModel = result.modelName || result.modelId || undefined;
      usage = result.usage;
      turn.contextUsage = result.contextUsage || turn.contextUsage;
      endStatus = turn.stopping || result.stopReason === 'cancelled' ? 'cancelled' : commandResult?.ok === false ? 'error' : 'complete';
      if (endStatus === 'complete') recommendations = result.recommendations;
    } catch (failure) {
      if (turn.queuedMessage && (failure as { code?: string })?.code === 'queue_already_submitted') {
        acknowledgeQueuedMessage(turn);
        endStatus = 'complete';
      } else {
        endStatus = turn.stopping ? 'cancelled' : 'error';
        responseError = failure;
      }
    } finally {
      unsubscribe?.();
      turn.externalTurnId = undefined;
      if (analysisTasks.size) {
        const links = [...analysisTasks].map(id => '[查看深度分析任务](/#deep-analysis?task=' + id + ')').join('\n');
        partial = partial.slice(0, 100000 - links.length - 2) + '\n\n' + links;
      }
      turn.toolNote = undefined;
      turn.permission = undefined;
      const pendingQuestion = questions.current.get(id);
      if (!turn.groupMember && pendingQuestion && pendingQuestion.request.phase !== 'continued') {
        questions.current.delete(id);
        persistDraft(id);
      }
      refreshTurns();
      if (turnId) {
        try {
          await turn.steerResponse;
          await turn.approvalResponse?.catch(() => {});
          if (turn.traceApprovals?.size) {
            const approvals = [...turn.traceApprovals.values()];
            execution = { ...execution, approvals };
          }
          const saved = await finishExternalTurn(id, turnId, { content: partial, status: endStatus, model: resultModel, usage, context: turn.contextUsage, recommendations, ...(execution.steps.length || execution.plan.length || execution.truncated || execution.approvals?.length ? { execution } : {}) });
          updateTurnConversation(turn, saved.conversation);
          turn.messages = turn.messages.map(item => item.id === saved.message.id ? (persistencePending && saved.message.status === 'streaming' ? { ...saved.message, content: partial } : saved.message) : item);
          if (!turn.stopping && (saved.message.status === 'complete' || saved.message.status === 'error')) {
            reportConversationFinished(id, saved.message.id, saved.message.status);
          }
        } catch (failure) {
          turn.messages = turn.messages.map(item => item.id === assistantId ? {
            ...item, content: partial, status: persistencePending ? 'streaming' : endStatus,
            reply_meta: item.reply_meta && { ...item.reply_meta, execution, usage, context: turn.contextUsage, recommendations },
          } : item);
          if (persistencePending && turnId) setPendingResultIds(previous => new Set(previous).add(turnId!));
          else turn.error = '无法保存 Agent 回复：' + failureText(failure);
        }
      }
      if (responseError && !turn.stopping && !turn.error) turn.error = failureText(responseError);
      finishTurn(turn, turn.error && !questionReply ? draft : undefined, endStatus === 'complete');
    }
  }
  async function sendSelected() {
    const value = text.trim();
    const dispatchMembers = addressedMembers(value, memberDirectory.filter(agent => members.includes(agent.id)));
    if (!explicitMemberTarget && addressed.length > 1) {
      setDispatchOpen(true);
      setDispatchPreview({ text: value, conversationId: active?.id, agents: dispatchMembers.map((entry, index) => ({
        agent: entry.agent,
        task: value.slice(entry.end, dispatchMembers[index + 1]?.start ?? value.length).replace(/^[\s，,：:]+|[\s，,；;]+$/g, '')
          || '请按原始要求处理分配给你的任务。',
      })) });
      return;
    }
    if (members.length && !memberTarget && !pickerExternal && !/^somnus(?:[\s，,：:]|$)/i.test(value)) {
      setError('请选择任务接收者，或在消息开头写 Codex、DSH、DeepSeek 或 Somnus。');
      return;
    }
    const name = /^\/([a-z0-9_-]+)(?:\s|$)/i.exec(value)?.[1].toLowerCase();
    const nativeWithArgs = name && value.length > name.length + 1
      ? availableNativeCommands.find(item => item.name.toLowerCase() === name) : undefined;
    const command = nativeWithArgs ? { ...nativeWithArgs, native: true } :
      name ? allCommands.find(item => item.name.toLowerCase() === name) : undefined;
    if (command?.native) {
      if (!command.executable) { setError(command.reason || '此命令目前不可执行。'); return; }
      await send(value);
    } else if (command && value === '/' + name) chooseComposerCommand(command);
    else if (!commandLoading || !name) await send();
  }
  async function installAddon(turn: RunningTurn, draft: Draft, request: AddonInstall) {
    const bridge = window.somnusAddonInstaller;
    if (!bridge) { finishTurn(turn, draft); return; }
    const id = turn.conversation.id;
    let turnId: string | undefined;
    let unsubscribe: (() => void) | undefined;
    const steps: ExecutionStep[] = [];
    let stage: AddonStage | undefined;
    let stageStarted = Date.now();
    let opened: { settings: AddonSettings; name: string } | undefined;
    function publish() {
      if (turnId) turn.execution = { assistantId: turnId, data: { steps: [...steps], plan: [] } };
      refreshTurns();
    }
    function closeStage(status: 'completed' | 'failed', failure?: string) {
      if (!stage) return;
      const index = steps.length - 1;
      steps[index] = { ...steps[index], status, duration_ms: Date.now() - stageStarted, failure_reason: failure?.slice(0, 240) };
    }
    function progress(next: AddonStage) {
      if (!(next in addonStages) || next === stage) return;
      closeStage('completed');
      stage = next;
      stageStarted = Date.now();
      steps.push({ id: 'addon-' + steps.length, kind: 'tool', title: addonStages[next], status: 'in_progress' });
      publish();
    }
    let content = '';
    let status: 'complete' | 'error' = 'error';
    try {
      const reserved = await beginExternalTurn(id, {
        content: request.request, agent_id: ADDON_INSTALLER_ID, agent_name: 'Somnus 安装器', model: '本机安装',
      });
      turnId = reserved.turn_id;
      updateTurnConversation(turn, reserved.conversation);
      turn.messages = [...turn.messages, reserved.user_message, reserved.assistant_message];
      turn.stage = 'working';
      progress('discovering');
      unsubscribe = bridge.onProgress?.(progress);
      const result = await bridge.install(request.kind === 'workspace-skill'
        ? { ...request, workspaceId: turn.workspace, conversationId: id } : request);
      const name = result.name || request.reference;
      const profile = result.profile === 'web' ? '桌面配置' : result.profile === 'acp' ? 'ACP 配置'
        : result.profile === 'mcp' ? '当前用户的 MCP 配置' : '当前用户的 Skill 目录';
      const version = result.version ? ' ' + result.version : '';
      closeStage(result.verified ? 'completed' : 'failed', result.verified ? undefined : '安装后的可用性尚未确认。');
      content = name + version + (result.alreadyInstalled ? ' 已在' : ' 已安装到') + profile + '。';
      content += result.verified ? '\n\n安装验证已通过。' : '\n\n未能确认安装后的可用性。';
      if (result.message) content += '\n\n' + result.message.slice(0, 600);
      status = 'complete';
      if (result.settings) opened = { settings: result.settings, name: result.pluginId || name };
    } catch (failure) {
      const reason = failureText(failure);
      closeStage('failed', reason);
      content = '安装未完成。\n\n' + reason;
      if (!turnId) turn.error = reason;
    } finally {
      unsubscribe?.();
      if (turnId) {
        try {
          const saved = await finishExternalTurn(id, turnId, { content, status, execution: { steps, plan: [] } });
          updateTurnConversation(turn, saved.conversation);
          turn.messages = turn.messages.map(message => message.id === saved.message.id ? saved.message : message);
        } catch (failure) {
          turn.messages = turn.messages.map(message => message.id === turnId ? { ...message, content, status } : message);
          turn.error = '无法保存安装结果：' + failureText(failure);
        }
      }
      const selected = isSelected(turn);
      finishTurn(turn, turnId ? undefined : draft);
      if (selected && assistantVisible.current && opened && !turn.error) onOpenAddonSettings?.(opened.settings, opened.name);
    }
  }
  async function send(nativeCommand?: string) {
    const groupMember = Boolean(memberTarget && !nativeCommand);
    const currentLane = memberTarget && activeId.current ? groups.current.get(activeId.current) : undefined;
    if (savingMember || (groupMember ? !canStartMember || Boolean(currentLane?.turns.has(memberTarget!.agentId)) : locked) ||
      worktreeLock.current || creatingTurn.current || deleteLock.current ||
      (!nativeCommand && (!canSendChat || imageBlocked || !hasDraft))) return;
    if (!nativeCommand && composerPrompt(snapshotDraft()).length > 12000) { setError('正文和引用共计最多 12000 字符。请缩短草稿或移除引用。'); return; }
    if (active && teamworkChanges.current.has(active.id)) {
      setError('正在保存此会话的 Teamwork 设置，请稍后再发送。');
      return;
    }
    if (active && (queues.current.get(active.id)?.length || 0) > 0) {
      setError('请先继续或移除待发送的排队消息。');
      return;
    }
    if (active && window.somnusNativeDshChat?.getQueue && !knownQueues.current.has(active.id)) {
      setError('正在恢复本机排队消息，请稍后再试。');
      return;
    }
    if (nativeCommand && (!companyAgent || !window.somnusNativeDshChat?.executeCommand || composerBlocks.length || attachments.length || dataFile || docFile || skills.length || plugins.length)) {
      setError('原生命令需要默认 Agent，且命令不随附文件或扩展。');
      return;
    }
    const activeAddon = nativeCommand ? undefined : addon;
    if (activeAddon && [...turns.current.values()].some(turn => turn.installingAddon)) {
      setError('已有插件或 Skill 正在安装。');
      return;
    }
    const agent = selectedAgent;
    if (!agent && dataFile?.acpOnly) { setError('此表格已为外部 Agent 添加。请重新选择外部 Agent，或移除并重新添加表格。'); return; }
    let item = active;
    if (group && nextPermission && item && item.permission_mode !== nextPermission) {
      setError('等群聊任务完成后再切换会话权限。');
      return;
    }
    if (!item || nextPermission && item.permission_mode !== nextPermission || pendingTeamwork.current.has(item.id)) {
      creatingTurn.current = true;
      refreshTurns();
      try {
        if (!item) {
          item = await createConversation(workspace, nextPermission);
          if (companyAgent && draftTeamwork[workspace]) transferDraftTeamwork(item.id);
        } else if (nextPermission && item.permission_mode !== nextPermission) {
          item = { ...item, permission_mode: await saveConversationPermission(item.id, nextPermission) };
        }
        if (!alive.current || workspaceRef.current !== workspace) return;
        choose(item);
        updateItem(item);
        await applyPendingTeamwork(item.id);
      } catch (failure) {
        if (alive.current) setError(failureText(failure));
        return;
      } finally { creatingTurn.current = false; refreshTurns(); }
    }
    if (nextPermission) clearPendingPermission(permissionKey);
    const preserveDraft = Boolean(nativeCommand && text.trim() && slashName === undefined && text.trim() !== nativeCommand);
    const draft = { ...snapshotDraft(), text: nativeCommand || text };
    const turn: RunningTurn = {
      conversation: item, workspace, messages: groupMember ? [] : messages, stopping: false, startedAt: Date.now(),
      ...(groupMember ? { groupMember: true as const } : {}),
      runningAgent: agent ? { id: agent.agentId, name: companyAgent ? 'Somnus' : agent.agentName, transport: companyAgent ? 'dsh-native' : 'acp', model: agent.modelName || ('modelId' in agent ? agent.modelId : undefined) }
        : status?.provider ? { id: status.provider_id, name: status.provider, model: status.model ?? undefined } : undefined,
      controller: agent || activeAddon ? undefined : new AbortController(), installingAddon: Boolean(activeAddon),
      nativeDsh: Boolean(companyAgent && !activeAddon), draftEdited: preserveDraft,
    };
    if (groupMember && memberTarget) {
      const channel = currentLane || { messages: [...messages], turns: new Map<string, RunningTurn>() };
      channel.turns.set(memberTarget.agentId, turn);
      groups.current.set(item.id, channel);
    } else turns.current.set(item.id, turn);
    turnErrors.current.delete(item.id);
    if (!preserveDraft) {
      drafts.current.delete(item.id);
      if (!active) {
        const newKey = 'workspace:' + workspace;
        drafts.current.delete(newKey);
        persistDraft(newKey, '');
      }
      persistDraft(item.id, '');
      clearDraft();
    }
    setError('');
    stick.current = true;
    setAtBottom(true);
    refreshTurns();
    if (activeAddon) await installAddon(turn, draft, activeAddon);
    else if (agent) await sendExternal(turn, agent, draft, reasoningValue, undefined,
      selectedNativeOptions, nativeCommand, Boolean(memberTarget));
    else await sendInternal(turn, draft, snapshotRoute());
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
        const shell = result.details.kind === 'powershell';
        turn.permission = { conversationId: id, development: true, request: {
          requestId: job, kind: shell ? 'powershell' : 'test',
          title: shell ? '允许运行 PowerShell？' : '允许运行项目测试？', details: result.details,
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
  async function sendInternal(turn: RunningTurn, draft: Draft, route: TurnRoute) {
    const target = turn.conversation.id;
    const abort = turn.controller!;
    const { attachments: images, dataFile, docFile, skills } = draft;
    const content = composerPrompt(draft);
    const dataMeta = dataFile ? { name: dataFile.name, row_count: dataFile.row_count, columns: dataFile.columns.slice(0, 60) } : null;
    let complete = false;
    let assistantId: string | undefined;
    const steps: ExecutionStep[] = [];
    function updateInternalExecution() {
      if (assistantId) turn.execution = { assistantId, data: { steps: [...steps], plan: [] } };
    }
    try {
      const delegationAgents = externalBridge?.runDelegation
        ? await externalBridge.listDelegationAgents?.().catch(() => []) || []
        : [];
      if (abort.signal.aborted) return;
      await sendMessage(target, content.trim(), abort.signal, (event: ChatEvent) => {
        if (!alive.current) return;
        const data = event.data;
        if (event.type === 'start' && data.user_message && data.assistant_message) {
          acknowledgeQueuedMessage(turn);
          if (data.conversation) updateTurnConversation(turn, data.conversation);
          assistantId = data.assistant_message.id;
          turn.assistantMessageId = assistantId;
          turn.userMessageId = data.user_message.id;
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
          if (data.name && steps.length < 40) {
            steps.push({ id: 'internal-' + steps.length, title: data.name, kind: 'tool', status: 'in_progress' });
            updateInternalExecution();
          }
          turn.toolNote = data.name === 'query_database' ? '正在查询数据库…' :
            data.name === 'list_database_schema' ? '正在读取表结构…' : undefined;
        } else if (event.type === 'tool_result') {
          const step = [...steps].reverse().find(item => item.title === data.name && item.status === 'in_progress');
          if (step) {
            step.status = data.ok ? 'completed' : 'failed';
            step.failure_reason = !data.ok ? data.failure_reason?.trim().slice(0, 240) : undefined;
            updateInternalExecution();
          }
          turn.toolNote = typeof data.summary === 'string' && data.summary ? data.summary : undefined;
        } else if (['done', 'cancelled', 'error'].includes(event.type)) {
          turn.toolNote = undefined;
          turn.permission = undefined;
          const message = typeof data.message === 'object' ? data.message : data.assistant_message;
          if (message) {
            const saved = message.reply_meta && !message.reply_meta.execution && turn.execution?.assistantId === message.id
              ? { ...message, reply_meta: { ...message.reply_meta, execution: turn.execution.data } } : message;
            turn.messages = turn.messages.some(value => value.id === saved.id) ? turn.messages.map(value => value.id === saved.id ? saved : value) : [...turn.messages, saved];
            if (!turn.stopping && (saved.status === 'complete' || saved.status === 'error')) {
              reportConversationFinished(target, saved.id, saved.status);
            }
          }
          if (data.conversation) updateTurnConversation(turn, data.conversation);
          if (event.type === 'done') complete = true;
          if (event.type === 'error') turn.error = typeof data.message === 'string' ? data.message : '模型请求失败。会话已保存，可重试。';
        }
        refreshTurns();
      }, images, dataFile?.id, docFile ? [docFile.id] : [], dataMeta, skills.map(skill => skill.id), route.modelId, route.effort, draft.plugins.map(plugin => plugin.id), delegationAgents, turn.queuedMessage?.id);
    } catch (failure) {
      if (turn.queuedMessage && (failure as { code?: string })?.code === 'queue_already_submitted') {
        acknowledgeQueuedMessage(turn);
        complete = true;
      } else if (!abort.signal.aborted) turn.error = failureText(failure);
    } finally {
      closeDelegation(turn);
      void cancelDevelopment(turn);
      turn.messages = turn.messages.map(message => message.id === assistantId && message.status === 'streaming' ? { ...message, status: turn.stopping || abort.signal.aborted ? 'cancelled' : 'error' } : message);
      finishTurn(turn, complete || turn.stopping ? undefined : draft, complete);
    }
  }
  async function stop(selected?: RunningTurn) {
    const id = activeId.current;
    const turn = selected || (id ? turns.current.get(id) : undefined);
    if (!id || !turn || turn.stopping || turn.installingAddon) return;
    turn.stopping = true;
    turn.error = undefined;
    refreshTurns();
    try {
      if (turn.controller) {
        await cancelConversation(id);
        closeDelegation(turn);
        void cancelDevelopment(turn);
        turn.controller.abort();
      } else if (turn.nativeDsh) {
        await window.somnusNativeDshChat?.cancelConversation(id);
      } else {
        if (turn.groupMember) {
          if (turn.externalTurnId) await mainChatBridge()?.cancelConversation(id, turn.externalTurnId);
        } else await mainChatBridge()?.cancelConversation(id);
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
    const chat = messageLog?.closest<HTMLElement>('.assistant-chat');
    if (!messageLog || !chat || typeof ResizeObserver === 'undefined') return;
    const row = messageLog.querySelector('.assistant-column-measure');
    if (!row) return;
    let measuredWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect.width || 0);
      if (width <= 0 || width === measuredWidth) return;
      measuredWidth = width;
      chat.style.setProperty('--conversation-measured-width', width + 'px');
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
      chat.style.removeProperty('--conversation-measured-width');
    };
  }, [hasConversationMessages]);
  async function respondToAcpPermission(option: string | null, selected?: RunningTurn) {
    const pending = selected?.permission || permissionRequest;
    if (!pending) return;
    const turn = selected || turns.current.get(pending.conversationId);
    const bridge = turn?.nativeDsh ? window.somnusNativeDshChat : mainChatBridge();
    if (pending.development) {
      const respond = window.vvmanProjects?.respondDevelopment;
      if (!turn || turn.permission !== pending || !respond) throw new Error('本次运行确认已结束');
      turn.permission = undefined;
      if (option === 'allow_once') turn.toolNote = pending.request.kind === 'powershell' ? '正在运行 PowerShell…' : '正在运行项目测试…';
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
      const response = (turn?.groupMember
        ? mainChatBridge()!.respondPermission!(pending.conversationId, pending.request.requestId, option, turn.externalTurnId)
        : bridge.respondPermission(pending.conversationId, pending.request.requestId, option)).then(() => {
        const selection = pending.request.options.find(item => item.id === option);
        if (turn) recordAcpDecision(turn, pending.request.requestId, selection?.kind === 'allow_once' ? 'approved' :
          selection?.kind === 'reject_once' ? 'rejected' : 'closed');
      });
      if (turn) turn.approvalResponse = response;
      await response;
    } else throw new Error('当前桌面连接无法确认操作');
    if (turn?.permission?.request.requestId === pending.request.requestId) {
      turn.permission = undefined;
      refreshTurns();
    }
  }
  async function answerAgent(item: Conversation, pending: PendingQuestion, answers: DshAnswers | null) {
    const bridge = window.somnusNativeDshChat;
    const id = item.id;
    const requestId = pending.request.requestId;
    const current = questions.current.get(id);
    if (current?.request.requestId !== requestId || !bridge?.respondQuestion) {
      throw new Error('本次提问已关闭。');
    }
    if (current.answering) return;
    current.answering = true;
    refreshTurns();
    try {
      const running = turns.current.get(id);
      if (running || !answers || current.request.phase !== 'continued') {
        await bridge.respondQuestion(id, requestId, answers);
      } else {
        if (locked || activeId.current !== id || current.request.phase !== 'continued') throw new Error('当前无法提交补充回答。');
        if (windowsDesktop && !current.agent.modelId) throw new Error('无法确定这条历史问题使用的 Provider。请在聊天中继续说明你的回答。');
        const summary = current.request.questions.flatMap(part => {
          const answer = answers.find(candidate => candidate.id === part.id);
          const content = [...(answer?.selected || []), answer?.custom].filter(Boolean).join('、');
          return content ? [part.question + ' — ' + content] : [];
        }).join('\n');
        const turn: RunningTurn = { conversation: item, workspace, messages, stopping: false, startedAt: Date.now(), nativeDsh: true };
        turns.current.set(id, turn);
        turnErrors.current.delete(id);
        refreshTurns();
        await sendExternal(turn, current.agent, { text: ('补充回答任务问题\n' + summary).slice(0, 12000), attachments: [],
          dataFile: null, docFile: null, skills: [], plugins: [] }, undefined, { requestId, answers });
        if (turn.error) throw new Error(turn.error);
      }
      if (questions.current.get(id)?.request.requestId === requestId) {
        questions.current.delete(id);
        persistDraft(id);
      }
    } finally {
      const latest = questions.current.get(id);
      if (latest?.request.requestId === requestId) latest.answering = false;
      refreshTurns();
    }
  }
  const composerPlaceholder = canSteerQueue ? shortcuts.steerQueue+' 追加全部排队消息' :
    !memberReady ? '目标 Agent 暂不可用，请重新选择' : !canSendChat ? '配置模型后即可发送' :
    memberTarget && group?.turns.has(memberTarget.agentId) ? memberTarget.agentName + ' 正在处理，请选择其他成员' :
    group && !memberTarget ? '选择一个群聊成员接收任务' :
    memberTarget ? '发送给 ' + memberTarget.agentName :
    currentTaskState?.plan?.active ? '描述接下来要执行的计划' :
      '发消息或执行任务，/ 调用命令，@ 引用文件或会话';
  const attachmentButton = <Button className="assistant-attach-button" type="text" size="small" icon={<PlusOutlined />} disabled={navigationLocked}
    loading={imageLoading || dataUploading || docUploading || libraryLoading}
    aria-label="添加文件" title="添加文件或运行命令" aria-haspopup="menu" aria-expanded={plusMenuOpen}
    onMouseDown={keepComposerFocus} />;
  const runningReply = selectedTurn && messages.find(message => message.role === 'assistant' && message.status === 'streaming');
  const lastTool = liveExecution?.data.steps[liveExecution.data.steps.length - 1];
  const questionCard = active && question && <AgentQuestions key={question.request.requestId}
    request={question.request} recovered={question.recovered} initialAnswers={question.answers} onDraftChange={answers => {
      const pending = questions.current.get(active.id);
      if (pending?.request.requestId === question.request.requestId) {
        pending.answers = answers;
        persistDraft(active.id, text);
      }
    }} onHold={window.somnusNativeDshChat?.holdQuestion ? held =>
      window.somnusNativeDshChat!.holdQuestion!(active.id, question.request.requestId, held) : undefined}
    submittingDisabled={question.answering || !selectedTurn && locked} onRespond={answerAgent.bind(null, active, question)} />;
  const liveTaskCards = <>
    {questionCard}
    {permissionRequest && permissionRequest.conversationId === active?.id &&
      <ActionApproval key={permissionRequest.conversationId + ':' + permissionRequest.request.requestId} request={permissionRequest.request} disabled={unifiedRuntime && (!runtimeVerified || !runtimeByMessage.get(selectedTurn?.assistantMessageId || selectedTurn?.execution?.assistantId || '') || runtimeByMessage.get(selectedTurn?.assistantMessageId || selectedTurn?.execution?.assistantId || '')?.status !== 'waiting_approval')} onRespond={respondToAcpPermission} />}
    {selectedTurn?.delegation && <DelegationReview key={selectedTurn.delegation.id} request={selectedTurn.delegation} stopping={stopping}
      onRespond={agentId => void handleDelegation(selectedTurn, agentId)} />}
    {toolNote && <div className="assistant-tool-note" role="status">
      {lastTool?.status === 'failed' ? <CloseCircleOutlined /> :
        lastTool?.status === 'completed' ? <CheckCircleOutlined /> : <LoadingOutlined />} {toolNote}
    </div>}
  </>;

  const renderEntries = messages.map(message => ({ kind: 'message' as const, message }));

  const attentionItems = new Map<string, { id: string; workspace: string; title: string; label: string }>();
  for (const [id, turn] of activeTurns) {
    if (turn.permission || turn.delegation) attentionItems.set(id, {
      id, workspace: turn.workspace, title: turn.conversation.title, label: '等待确认',
    });
  }
  for (const [id, pending] of questions.current) {
    if (pending.request.phase !== 'continued' && !attentionItems.has(id)) attentionItems.set(id, {
      id, workspace: pending.workspace, title: pending.title, label: '等待回答',
    });
  }
  return <><div className="assistant-page">
    {attentionTarget && attentionItems.size > 0 && createPortal(<Dropdown trigger={['click']} menu={{
      items: [...attentionItems.values()].map(({ id, title, label }) => ({ key: id, label: label + ' · ' + (title || '新会话') })),
      onClick: ({ key }) => {
        const target = attentionItems.get(key);
        if (!target) return;
        if (visible && target.workspace === workspace && target.id === activeId.current) {
          const reveal = () => log.current?.querySelector('.assistant-action-approval')?.scrollIntoView({ block: 'nearest' });
          if (trajectoryOpen) {
            setTrajectoryFor(undefined);
            window.requestAnimationFrame(reveal);
          } else reveal();
          return;
        }
        setAttentionChat({ id: target.id, workspace: target.workspace });
        onOpenChat(target.workspace);
      },
    }}><Button type="text" title="查看待处理的会话提醒" aria-label={`${attentionItems.size} 个会话待处理`}
      icon={<Badge count={attentionItems.size} size="small"><BellOutlined /></Badge>} /></Dropdown>, attentionTarget)}
    {sidebar && createPortal(<RecentSessions workspace={workspace} onOrganize={organizeSession} onOpenWorkspace={(project, id) => { if (project === workspace) { onOpenChat(project); selectHistory(id); } else { setAttentionChat({ id, workspace: project }); onOpenChat(project); } }} items={items} activeId={visible ? active?.id : undefined}
      locked={navigationLocked} runningIds={displayRunningIds} runtimeSnapshot={runtimeSnapshot} loading={loading} onOpen={id => { onOpenChat(workspace); selectHistory(id); }}
      onReferenceDrag={visible ? dragConversationReference : undefined} onRename={requestRename} onDelete={requestDelete} />, sidebar)}
    {companyRequested && status?.configured && !companyAgent && <Alert type="warning" showIcon className="assistant-error" message={windowsDesktop ? '此模型的 DSH 运行环境未就绪。请检查 Provider 配置。' : '默认模型的原生运行环境未就绪。请检查 Agent 配置，或选择其他模型。'} />}
    {companyRequested && status && !status.configured && <Alert type="warning" showIcon className="assistant-error"
      message={windowsDesktop ? '请配置 Provider，并在模型菜单中选择模型。' : '默认模型尚未填写 DeepSeek API Key。'}
      action={<Button size="small" onClick={onModelConfig}>{windowsDesktop ? '配置 Provider' : '配置 API Key'}</Button>} />}
    {!external && statusError && <Alert type="warning" showIcon className="assistant-error" message="暂时无法读取模型状态" description={statusError} />}
    <div className="assistant-layout">
      <aside className="assistant-history" aria-label="AI会话历史"><div className="assistant-history-head"><strong>会话历史</strong><Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => void newChat()} disabled={navigationLocked}>新建会话</Button></div><div className="assistant-history-list">{loading && !items.length ? <div className="assistant-loading"><Spin size="small" />读取历史…</div> : items.length ? items.map(item => <button type="button" className={`assistant-history-item ${active?.id === item.id ? 'active' : ''}`} key={item.id} onClick={() => selectHistory(item.id)} disabled={navigationLocked} title={item.title} aria-pressed={active?.id === item.id}><MessageOutlined /><span><strong>{item.title || '新会话'}</strong><small>{item.message_count} 条消息 · {formatDateTime(item.updated_at)}</small></span></button>) : <div className="assistant-history-empty">暂无会话</div>}</div><div className="assistant-history-foot">会话保存在本机。</div></aside>
      <section className="assistant-chat assistant-session" aria-label="会话"><header className="assistant-chat-head assistant-chat-head-compact">
        <div className="assistant-session-title-row"><div className="assistant-chat-heading"><h1><Dropdown trigger={['click']} menu={{
          items: [
            ...(active ? [{ key: 'rename', label: '重命名', disabled: locked }] : []),
            { key: 'project', label: '项目与文件权限' },
            ...(active && workspace !== 'default' && (active.worktree || window.vvmanProjects?.createWorktree)
              ? [{ key: 'worktree', label: active.worktree ? '会话工作树' : '创建会话工作树', disabled: !active.worktree && locked }]
              : []),
            { key: 'model', label: '模型连接设置' },
            ...(active ? [{ key: 'delete', label: '删除会话', disabled: locked, danger: true }] : []),
          ],
          onClick: ({ key }) => {
            if (key === 'rename' && active) requestRename(active);
            if (key === 'delete' && active) requestDelete(active);
            if (key === 'project') setProjectContextOpen(true);
            if (key === 'worktree' && active) setWorktreeOpenFor(active.id);
            if (key === 'model') setConfigOpen(true);
          },
        }}>
          <button type="button" className="assistant-chat-title-button" aria-label={'会话菜单 · ' + (active?.title || '新会话')}>
            <span>{active?.title || '新会话'}</span><DownOutlined aria-hidden="true" />
          </button>
        </Dropdown></h1>
          {active && <span className="assistant-session-mode" title="当前项目环境，与 Agent 工作模式独立">
            <AppstoreOutlined aria-hidden="true" /><span>{active.worktree ? '会话工作树' : '项目工作区'}</span>
          </span>}
        </div>
        {active && !loading && <Space className="assistant-chat-head-actions" size={4}>
          <Dropdown trigger={['click']} menu={{
            items: [
              ...(window.vvmanProjects ? [{ key: 'workspace-app', icon: <FolderOpenOutlined />, label: '打开工作区',
                disabled: workspace === 'default' && !active.worktree, children: [...workspaceApps] }] : []),
              { key: 'project', label: '查看项目上下文' },
              { key: 'feedback', icon: <SendOutlined />, label: '反馈' },
            ],
            onClick: ({ key }) => {
              if (workspaceApps.some(app => app.key === key)) void runWorkspaceAction(() => openWorkspaceApp(key as WorkspaceApp));
              if (key === 'project') setProjectContextOpen(true);
              if (key === 'feedback') window.open('https://github.com/GSXTY/Somnus/issues', '_blank', 'noopener,noreferrer');
            },
          }}><Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="会话操作" /></Dropdown>
          {window.vvmanProjects && <Button type="text" size="small" icon={<LayoutOutlined />} aria-label="工作区" title="工作区"
            aria-expanded={workspacePanelChat === active.id} onClick={() => { setWorkspacePanelChat(value => value === active.id ? undefined : active.id); }} />}
        </Space>}
        </div>
        {active && <div className="assistant-session-views">
          <div className="assistant-session-tabs" role="tablist" aria-label="会话视图" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? false : event.key === 'End' || !trajectoryOpen;
            setTrajectoryFor(next ? active.id : undefined);
            event.currentTarget.querySelector<HTMLButtonElement>(next ? '#assistant-tab-trajectory' : '#assistant-tab-chat')?.focus();
          }}>
            <button type="button" role="tab" id="assistant-tab-chat" aria-controls="assistant-panel-chat"
              aria-selected={!trajectoryOpen} tabIndex={trajectoryOpen ? -1 : 0} onClick={() => setTrajectoryFor(undefined)}>聊天</button>
            <button type="button" role="tab" id="assistant-tab-trajectory" aria-controls="assistant-panel-trajectory"
              aria-selected={trajectoryOpen} tabIndex={trajectoryOpen ? 0 : -1} onClick={() => setTrajectoryFor(active.id)}>轨迹</button>
          </div>
          <Dropdown trigger={['click']} menu={{ items: [{ key: 'download', icon: <DownloadOutlined />, label: '下载会话日志' }],
            onClick: () => void runWorkspaceAction(() => downloadSessionLog(active.id)) }}>
            <Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="更多会话视图操作" />
          </Dropdown>
        </div>}
        {externalBridge && <ConversationAgents members={members} available={memberDirectory}
          active={unifiedRuntime ? runtimeMembers : new Map([...groupTurns, ...(selectedTurn ? [selectedTurn] : [])].flatMap(turn => {
            const id = turn.runningAgent?.id;
            return id ? [[id, turn.stopping ? '正在停止' : turn.permission || question && turn === selectedTurn ? '待确认' : '处理中']] : [];
          }))}
          parallelCount={unifiedRuntime ? activeRuntimeSummary?.active_count || 0 : groupTurns.length}
          queued={new Set(pendingQueue.flatMap(entry => entry.route.agent ? [entry.route.agent.agentId] : []))}
          locked={navigationLocked || Boolean(active?.archived)} saving={savingMember}
          onMembership={changeMembership} />}
      </header>
        {runtimeSnapshot.availability === 'offline' && <Alert className="assistant-error" type="warning" showIcon message="任务状态连接中断，正在显示最后记录。不会自动重发任务。" />}
        {workspaceActionError && workspaceActionError.conversationId === active?.id && <Alert
          className="assistant-error" type="error" showIcon message={workspaceActionError.message}
          closable onClose={() => setWorkspaceActionError(undefined)} />}
        {visibleError && <Alert className="assistant-error" type="error" showIcon message={visibleError} action={<Button size="small" onClick={() => void loadList(true)} disabled={locked}>重新加载历史</Button>} />}
        {active && trajectoryOpen && <div id="assistant-panel-trajectory" role="tabpanel" aria-labelledby="assistant-tab-trajectory"
          className="assistant-trajectory-panel">
          <ConversationTrajectory key={active.id} conversationId={active.id} messages={messages} onOpenConversation={id => void selectHistory(id)} running={busy}
            onReadChat={() => setTrajectoryFor(undefined)} />
        </div>}
        <div className="assistant-session-body" hidden={trajectoryOpen} id={active ? 'assistant-panel-chat' : undefined}
          role={active ? 'tabpanel' : undefined} aria-labelledby={active ? 'assistant-tab-chat' : undefined}>
        <div className="assistant-transcript-frame">
        <div className="assistant-message-log" ref={log} onScroll={followLog} role="log" aria-live="polite" aria-label="会话消息"><div className="assistant-column-measure" aria-hidden="true" />{active&&<InheritedHistory key={active.id} conversationId={active.id} available={Boolean(active.inherited_history)}/>} {loading ? <div className="skeleton-list">{[0, 1, 2].map(index => <Skeleton key={index} active title={false} paragraph={{ rows: 2, width: ['92%', '68%'] }} />)}</div> : renderEntries.length ? renderEntries.map(entry => {
          const message = entry.message;
          const groupLane = groupTurns.find(turn => turn.assistantMessageId === message.id);
          const notice = message.reply_meta?.mcp_approval_blocked || mcpBlocked[message.id];
          const messageTurn = groupLane || (runningReply?.id === message.id ? selectedTurn : undefined);
          const runtimeTask = runtimeByMessage.get(message.id);
          const isRunningReply = Boolean(messageTurn);
          const execution = groupLane?.execution?.data || (liveExecution?.assistantId === message.id ? liveExecution.data : message.reply_meta?.execution);
          const messageStatus = unifiedRuntime && runtimeTask ? taskMessageStatus(runtimeTask, runtimeVerified) : !isRunningReply && message.status === 'streaming' ? 'error' : message.status;
          const replyAgent = message.role === 'assistant'
            ? (message.reply_meta?.transport === 'acp' || messageTurn?.groupMember || members.includes(message.reply_meta?.provider_id || '') ? message.reply_meta?.provider_name || messageTurn?.runningAgent?.name : 'Somnus')
            : undefined;
          const targetName = message.role === 'user'
            ? (message.reply_meta?.transport === 'dsh-native' ? 'Somnus' : message.reply_meta?.provider_name || groupTurns.find(turn => turn.userMessageId === message.id)?.runningAgent?.name)
            : undefined;
          const groupError = groupLane?.error || groupErrors.current.get(message.id);
          return <article key={message.id} data-message-id={message.id} data-turn-anchor={message.role === 'user' ? message.id : undefined} className={`assistant-message ${message.role}`}><div className="assistant-message-main">
          {targetName && <div className="group-message-target">发给 {targetName}</div>}
          {replyAgent && <div className="group-reply-header">
            <AgentAvatar name={replyAgent} /><strong className="assistant-reply-agent">{replyAgent}</strong>
            {groupLane && <Button type="text" size="small" loading={groupLane.stopping} onClick={() => void stop(groupLane)}>停止 {replyAgent}</Button>}
          </div>}
          {message.role === 'assistant' && pendingResultIds.has(message.id) && (!runtimeTask || ['queued', 'connecting', 'running', 'waiting_approval', 'cancelling', 'disconnected', 'interrupted'].includes(runtimeTask.status)) && <small className="runtime-reply-state">结果待同步 · 请勿重复提交</small>}
          {message.role === 'assistant' && (runtimeTask ? ['queued','connecting','running','waiting_approval','cancelling','disconnected'].includes(runtimeTask.status) : isRunningReply) && (runtimeNotices[message.id] || runtimeTask?.progress?.title) && <Alert className="assistant-runtime-notice" type="info" message={runtimeNotices[message.id] || runtimeTask?.progress?.title} />}
          {message.role === 'assistant' && unifiedRuntime && runtimeTask && <small className="runtime-reply-state" data-state={runtimeTask.status}>{taskLabel(runtimeTask, runtimeVerified)}{runtimeTask.received_late ? ' · 结果延迟同步' : ''}</small>}
          {message.role === 'assistant' && messageStatus !== 'complete' && !isRunningReply && <div className="assistant-message-label"><small>{statusText[messageStatus]}</small></div>}{message.role === 'assistant' && (!unifiedRuntime || runtimeTask || message.status !== 'streaming') &&
          <ExecutionDetails execution={execution} replyStatus={messageStatus} autoExpand={expandRunningActivity} onExpandedChange={expanded=>setReplyProcessExpanded(previous=>previous[message.id]===expanded?previous:{...previous,[message.id]:expanded})}
            startedAt={messageTurn?.startedAt} elapsedMs={message.reply_meta?.elapsed_ms}
            nativeTurn={active && window.somnusNativeDshChat?.subagentDetail &&
              (message.reply_meta?.transport === 'dsh-native' || isRunningReply && selectedTurn?.nativeDsh)
              ? { conversationId: active.id, turnId: message.id } : undefined}
            stage={unifiedRuntime && runtimeTask && !taskIsActive(runtimeTask, runtimeVerified) ? undefined : messageTurn ? messageTurn.stage || (message.content ? 'responding' : 'working') : undefined} />}
          {isRunningReply && !groupLane && liveTaskCards}
          {groupLane?.permission && <ActionApproval key={groupLane.permission.request.requestId}
            request={groupLane.permission.request} onRespond={option => respondToAcpPermission(option, groupLane)} />}
          {groupLane?.toolNote && <div className="assistant-tool-note" role="status">{groupLane.toolNote}</div>}
          {groupError && <Alert className="group-stage-error" type="error" showIcon message={groupError} />}
          {notice && <Alert type="warning" showIcon message={notice.reason} description={notice.tool_name} />}
          <div className="assistant-message-content" data-reply-preview={message.role === 'assistant' && uiPreferences.collapsedReply === 'preview' && !replyProcessExpanded[message.id] && Boolean(execution?.steps.length || execution?.plan.length) && messageStatus !== 'streaming' || undefined}>{message.role === 'assistant' && uiPreferences.collapsedReply === 'preview' && !replyProcessExpanded[message.id] && Boolean(execution?.steps.length || execution?.plan.length) && messageStatus !== 'streaming' && <button className="reply-preview-toggle" type="button" onClick={event => { const element=event.currentTarget.parentElement!; element.dataset.replyExpanded=element.dataset.replyExpanded === 'true' ? 'false' : 'true'; }}>展开 / 收起回复</button>}{message.content ? (message.role === 'assistant' ? <Markdown text={message.content} onOpenExternalLink={workspaceLinks && window.somnusWorkspaceWeb && active ? url => {
            setWorkspaceWebRequest({ conversationId: active.id, url, sequence: ++workspaceWebSequence.current });
            setWorkspacePanelChat(active.id);
          } : undefined} /> : message.content) : (isRunningReply || message.attachments?.length ? '' : '未返回回答内容')}{message.attachments?.length ? <div className="assistant-message-images">{message.attachments.filter(image => isLocalImage(image.data_url)).map((image, index) => <img key={index} src={image.data_url} alt={image.name || '会话图片'} loading="lazy" />)}</div> : null}</div>{message.role === 'assistant' && message.reply_meta?.delegation && <DelegationOutcome result={message.reply_meta.delegation} />}{message.role === 'assistant' && messageStatus !== 'complete' && message.reply_meta && <div className="assistant-reply-metadata">
      <span>{message.reply_meta.model}</span>{typeof message.reply_meta.elapsed_ms === 'number' && <span>{(message.reply_meta.elapsed_ms / 1000).toFixed(1)} 秒</span>}
      </div>}
      {message.role === 'assistant' && <DeclarativePluginCards cards={message.reply_meta?.plugin_cards || livePluginCards[message.id]} onOpen={page=>{window.dispatchEvent(new CustomEvent('somnus:open-owned-page',{detail:{pluginId:page.pluginId,pageId:page.id}}));}} />}
      {message.role === 'assistant' && <DshRecommendationCards cards={message.reply_meta?.recommendations} onOpenPlugin={onOpenDshPlugin} />}
      {message.role === 'assistant' && <FileChangeCards conversationId={proposalConversation} items={proposalReplies.get(message.id) || []} onPreview={previewProposal} />}
      {active && message.role === 'assistant' && messageStatus === 'complete' && <div className="assistant-reply-actions">
        {message.content && <Button type="text" size="small" aria-label="复制回答" title="复制回答"
          icon={copiedReply === message.id ? <CheckCircleOutlined /> : <CopyOutlined />} onClick={() => void copyReply(message)} />}
        <ConversationReplyRating key={message.id} conversationId={active.id} messageId={message.id} />
        <Button type="text" size="small" aria-label="分享会话" title="复制本机会话链接"
          icon={sharedReply === message.id ? <CheckCircleOutlined /> : <ShareAltOutlined />} onClick={() => void shareReply(message)} />
        {message.content && <Button type="text" size="small" aria-label="引用回答" title="引用选中文字或这条回答"
          icon={<MessageOutlined />} disabled={navigationLocked} onMouseDown={keepComposerFocus}
          onClick={event => quoteReply(message, event.currentTarget)} />}
        <Button type="text" size="small" icon={<BranchesOutlined />} loading={branchingReply === message.id}
          aria-label="从此处新建分支" title="从此处新建分支" disabled={locked}
          onClick={() => void branchFromReply(message.id)} />{message.reply_meta?.transport==='dsh-native' && <Dropdown trigger={['click']} menu={{items:[{key:'copy',label:'复制消息分支（不含原生执行状态）'}],onClick:({key})=>{if(key==='copy')void branchFromReply(message.id,true);}}}><Button type="text" size="small" aria-label="更多分支方式" title="更多分支方式" disabled={locked} icon={<DownOutlined/>}/></Dropdown>}
        {message.reply_meta?.usage && <Tooltip title={<>
          {message.reply_meta.model && <div>{message.reply_meta.model}</div>}
          <div>输入 {tokenFormat.format(message.reply_meta.usage.input_tokens)} · 输出 {tokenFormat.format(message.reply_meta.usage.output_tokens)}</div>
          {typeof message.reply_meta.usage.cached_input_tokens === 'number' && <div>缓存 {tokenFormat.format(message.reply_meta.usage.cached_input_tokens)}</div>}
          {typeof message.reply_meta.elapsed_ms === 'number' && <div>{(message.reply_meta.elapsed_ms / 1000).toFixed(1)} 秒</div>}
          {message.reply_meta.usage.partial && <div>部分用量记录</div>}
        </>} trigger={['hover', 'focus']}>
          <button type="button" className="assistant-reply-usage" aria-label="查看这条回复的 Token 用量">
            <DatabaseOutlined aria-hidden="true" />
            {compactTokenFormat.format(message.reply_meta.usage.input_tokens + message.reply_meta.usage.output_tokens)}
          </button>
        </Tooltip>}
        <time className="assistant-reply-time" title={formatDateTime(message.created_at, { seconds: true })}>
          {formatDateTime(message.created_at, { seconds: true }).slice(-8)}
        </time>
        {sharedReply === message.id && <small role="status">已复制会话链接</small>}
        {copiedReply === message.id && <small role="status">已复制</small>}
        {clipboardError?.id === message.id && <small role="status">{clipboardError.text}</small>}
      </div>}
      {message.role==='user'&&<div className="assistant-user-actions">
        <Tooltip title={sameSessionEdit === 'unsupported' ? '当前 DSH 运行时不支持原位编辑并重新发送。可创建分支草稿，原会话保持不变。' : '此运行时尚未提供已验证的原位编辑接口。可使用分支草稿。'}><span><Button type="text" size="small" aria-label="原位编辑并重新发送暂不可用" disabled icon={<EditOutlined/>}/></span></Tooltip>
        <Tooltip title="编辑文字并创建分支草稿"><Button type="text" size="small" aria-label="编辑输入并分支" disabled={locked} icon={<BranchesOutlined/>} onClick={()=>{
        const index=messages.findIndex(item=>item.id===message.id);
        const nearest=[...messages.slice(0,index)].reverse().find(item=>item.role==='assistant');
        const previous=nearest?.status==='complete'&&nearest.reply_meta?.transport==='dsh-native'?nearest:undefined;
        setEditingMessage({id:message.id,content:message.content,checkpoint:previous?.id});
      }} /></Tooltip></div>}
      </div></article>;
        }) : <div className="assistant-welcome"><SomnusMark className="assistant-welcome-mark" /><h2>这个项目想做什么？</h2></div>}
        {selectedTurn && !runningReply && <div className="assistant-live-tasks">{liveTaskCards}<div className="assistant-loading"><Spin size="small" />正在连接模型…</div></div>}
        {groupTurns.some(turn => !turn.assistantMessageId) && <div className="group-awaiting-turns">
          {groupTurns.filter(turn => !turn.assistantMessageId).map(turn => <div className="group-reply-header" key={turn.runningAgent?.id}>
            <AgentAvatar name={turn.runningAgent?.name || ''} /><span role="status">正在连接 {turn.runningAgent?.name}…</span>
            <Button type="text" size="small" loading={turn.stopping} onClick={() => void stop(turn)}>取消</Button>
          </div>)}
        </div>}
        {!busy && questionCard && <div className="assistant-live-tasks">{questionCard}</div>}
        </div>
        {!loading && !trajectoryOpen && <ConversationTurnRail messages={messages} log={log}
          onNavigate={() => { stick.current = false; }} />}
        </div>
        <div className="assistant-project-actions">
          {active && worktreeOpenFor === active.id && <ChatWorktree key={active.id} workspace={workspace} conversationId={active.id} worktree={active.worktree}
            open onOpenChange={open => setWorktreeOpenFor(open ? active.id : undefined)}
            disabled={locked} onBusy={value => { worktreeLock.current = value; setWorktreeBusy(value); }}
            onBind={worktree => {
              if (workspaceRef.current !== workspace || activeId.current !== active.id) return;
              const item = { ...active, worktree };
              choose(item);
              updateItem(item);
            }} />}
          {!loading && legacyProposals.length > 0 && <details key={proposalConversation} className="assistant-proposal-history">
            <summary>修改记录{legacyProposals.some(item => item.status === 'pending') ? ' · 有待审修改' : ''}</summary>
            <FileChangeCards conversationId={proposalConversation} items={legacyProposals} onPreview={previewProposal} />
          </details>}
          {proposalConversation && proposalPreview?.conversationId === proposalConversation && <FileProposalReview
            key={proposalPreview.item.id} conversationId={proposalConversation} preview={proposalPreview.item}
            onClose={() => setProposalPreview(undefined)} onDecision={proposals.record} />}
        </div>
        {active && pendingQueue.length > 0 && <section className="assistant-busy-queue" aria-label="排队消息">
          <header><strong>排队消息 · {pendingQueue.length}</strong>
            {!busy && <Button type="link" size="small" loading={startingQueuedMessage} disabled={navigationLocked}
              onClick={() => void startNextQueuedMessage(active, workspace, messages)}>继续发送</Button>}
          </header>
          {restoredQueues.current.has(active.id) && <small>已恢复，等待你继续发送。</small>}
          <ol>{pendingQueue.map(message => <li key={message.id}>
            <span title={message.draft.text}>{message.route.agent && <strong>{message.route.agent.agentName} · </strong>}
              {message.draft.text.trim() || message.draft.composerBlocks?.[0]?.label || '附件消息'}</span>
            <Button type="text" size="small" icon={<EditOutlined />} disabled={!canRecallQueue || queueUncertain || selectedTurn?.steerPending}
              aria-label="将排队消息带回输入框" title="带回输入框（↑ 取回最后一条）" onClick={() => recallQueuedDraft(message.id)} />
            <Button type="text" size="small" icon={<CloseOutlined />} disabled={startingQueuedMessage || queueUncertain || selectedTurn?.steerPending}
              aria-label="移除此排队消息" title="移除此排队消息" onClick={() => removeQueuedMessage(active.id, message.id)} />
          </li>)}</ol>
        </section>}
        {nativeTasks &&
          <ChatTaskControls key={active?.id || 'new:' + workspace} state={currentTaskState} goalRequest={goalRequest}
            disabled={locked} onCommand={line => void send(line)} onPauseActive={busy && !stopping ? () => void stop() : undefined} />}
        <div className="assistant-input-stack">
          <div className="assistant-composer" data-composer-card data-composer-hero={active ? undefined : true}
            data-dragging={composerDragging || undefined}
            onDragOver={event => {
              if (!acceptsComposerDrop(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = navigationLocked ? 'none' : 'copy';
              if (!navigationLocked) setComposerDragging(true);
            }}
            onDragLeave={event => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setComposerDragging(false);
            }}
            onDrop={dropComposerFiles}>
            {commandMenuOpen && <ComposerCommands menuRef={commandMenu} commands={filteredCommands} selected={selectedCommandIndex}
              loading={commandLoading} onChoose={chooseComposerCommand} onPoint={setCommandIndex} />}
            {referenceMenuOpen && <div className="composer-command-menu" ref={commandMenu}>
              <div id={composerCommandListId} role="listbox" aria-label="引用文件或会话">
                {hasDocumentLibrary && <button id={composerCommandRowId(0)} type="button" role="option" tabIndex={-1} aria-selected={activeReferenceIndex === 0}
                  onMouseDown={keepComposerFocus} onClick={openAttachmentReference}>
                  <FolderOpenOutlined aria-hidden="true" /><span><strong>从个人文档引用文件</strong></span>
                </button>}
                {referenceConversations.map((item, index) => {
                  const row = index + Number(hasDocumentLibrary);
                  return <button key={item.id} id={composerCommandRowId(row)} type="button" role="option" tabIndex={-1}
                    aria-selected={activeReferenceIndex === row} onMouseEnter={() => setReferenceIndex(row)}
                    onMouseDown={keepComposerFocus} onClick={() => void addConversationReference(item.id, text)}>
                    <MessageOutlined aria-hidden="true" /><span><strong>{item.title}</strong><small>引用当前项目的会话</small></span>
                  </button>;
                })}
              </div>
            </div>}
            {!atBottom && <button type="button" className="assistant-jump-bottom" onClick={scrollToBottom} aria-label="回到底部" title="回到底部"><ArrowDownOutlined /></button>}
            {attachments.length > 0 && <div className="assistant-image-drafts" aria-label="待发送图片">
              {attachments.map((image, index) => <div className="assistant-image-draft" key={index}>
                <img src={image.data_url} alt={image.name} />
                <button type="button" aria-label={'移除图片 ' + image.name} disabled={navigationLocked}
                  onClick={() => { markDraftEdited(); editDraftMedia({ attachments: attachments.filter((_, current) => current !== index) }); }}><CloseOutlined /></button>
                <small>{image.name}</small>
              </div>)}
            </div>}
            {imageBlocked && <div className="assistant-image-notice">当前模型不支持识别图片。图片已保留在草稿中，切换到支持图片的模型，或移除图片后发送文字。</div>}
            {(dataFile && !composerBlocks.some(block => block.fileId === dataFile.id) || docFile && !composerBlocks.some(block => block.fileId === docFile.id)) && <div className="assistant-composer-files">
              {dataFile && !composerBlocks.some(block => block.fileId === dataFile.id) && <div className="assistant-data-chip" aria-label="待分析 CSV">
                <FileTextOutlined /><span><strong>{dataFile.name}</strong><small>{dataFile.row_count} 行 · {dataFile.columns.length} 列 · {external ? '随消息提供给 Agent' : '可交给深度分析'}</small></span>
                <button type="button" aria-label="移除 CSV" disabled={navigationLocked}
                  onClick={() => { markDraftEdited(); editDraftMedia({ dataFile: null }); }}><CloseOutlined /></button>
              </div>}
              {docFile && !composerBlocks.some(block => block.fileId === docFile.id) && <div className="assistant-data-chip" aria-label="已读取的文档">
                <FileTextOutlined /><span><strong>{docFile.name}</strong><small>已读取 {docFile.chars.toLocaleString()} 字{docFile.note ? ` · ${docFile.note}` : ''} · 内容会随问题发送给模型</small></span>
                <button type="button" aria-label="移除文档" disabled={navigationLocked}
                  onClick={() => { markDraftEdited(); editDraftMedia({ docFile: null }); }}><CloseOutlined /></button>
              </div>}
            </div>}
            <input ref={fileInput} type="file" multiple hidden disabled={navigationLocked}
              accept="image/png,image/jpeg,image/webp,.csv,.xlsx,.xlsm,text/csv,.pdf,.docx,.txt,.md,.markdown,.json,.yaml,.yml,.log,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.go,.rs,.sql,.sh,.bat,.ps1,.ini,.toml,.conf,.html,.htm,.xml"
              onChange={event => { addAnyFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
            <ComposerEditor ref={composerInput} ariaLabel="发送消息" placeholder={composerPlaceholder} value={text} references={composerBlocks}
              onPaste={pasteComposerFiles} onCompositionEnd={() => { compositionEnd.current = Date.now() + 10; }}
              onBlur={() => { composerEscape.current = undefined; }}
              onChange={editDraft} disabled={navigationLocked} onKeyDown={handleComposerKey}
              controls={commandMenuOpen || referenceMenuOpen ? composerCommandListId : undefined}
              activeDescendant={referenceMenuOpen ? composerCommandRowId(activeReferenceIndex) :
                commandMenuOpen && filteredCommands.length ? composerCommandRowId(selectedCommandIndex) : undefined} />
            {window.vvmanProjects && <div className="assistant-composer-picks">
              <SkillChips selected={skills} onChange={changeDraftSkills} disabled={navigationLocked} />
              <PluginChips selected={plugins} onChange={changeDraftPlugins} disabled={navigationLocked} />
            </div>}
            <div className="assistant-composer-actions">
              <div className="assistant-composer-tools">
                <Dropdown placement="topLeft" trigger={['click']} disabled={navigationLocked} open={plusMenuOpen}
                  onOpenChange={open => { if (open) setShowExtensions(false); setPlusMenuOpen(open); }} menu={{
                  items: [
                    { key: 'computer', label: '添加文件和图片', icon: <FileTextOutlined /> },
                    ...(hasDocumentLibrary ? [{ key: 'library', label: '从个人文档选择', icon: <FolderOpenOutlined /> }] : []),
                    { type: 'divider' },
                    ...(extensionsAvailable ? [{ key: 'settings:extensions', label: window.vvmanProjects ? '扩展与协作' : '会话协作',
                      icon: <AppstoreOutlined /> }] : []),
                    ...(nativeTasks ? [{ key: 'plan', label: planLabel, icon: <BulbOutlined />, disabled: !planActionAvailable }] : []),
                    ...allCommands.filter(command => command.name !== 'file' && (!nativeTasks || command.name !== 'plan'))
                      .map(command => ({
                        key: command.name, label: command.native ? '/' + command.name : command.description,
                        icon: command.name === 'plan' ? <BulbOutlined /> : command.name === 'goal' ? <AimOutlined /> : <CodeOutlined />,
                        title: command.reason || command.description, disabled: !command.executable,
                      })),
                    ...(commandLoading ? [{ key: 'loading', label: '正在读取会话命令…', disabled: true }] : []),
                  ],
                  onClick: ({ key }) => {
                    setPlusMenuOpen(false);
                    if (key === 'computer') fileInput.current?.click();
                    else if (key === 'library') { attachmentReferenceText.current = undefined; setAttachmentLibraryOpen(true); }
                    else if (key === 'settings:extensions') changeExtensionMenu(true);
                    else if (key === 'plan' && nativeTasks) {
                      if (planActionAvailable) void send(currentTaskState?.plan?.active ? '/plan off' : '/plan');
                    } else {
                      const action = allCommands.find(item => item.name === key);
                      if (action) chooseComposerCommand(action);
                    }
                  },
                }}>{attachmentButton}</Dropdown>
                <PermissionSwitch key={permissionKey} conversationId={active?.id} permission={nextPermission || active?.permission_mode}
                  external={Boolean(external)} allowFullAccess={windowsDesktop} openRequest={permissionPickerRequest}
                  disabled={navigationLocked || Boolean(group)} defer={busy || Boolean(nextPermission)} onBusyChange={setPermissionSaving} onChange={permission => {
                    if (!active || busy || nextPermission) setPendingPermissions(current => ({ ...current, [permissionKey]: permission }));
                    else {
                      clearPendingPermission(permissionKey);
                      const updated = { ...active, permission_mode: permission };
                      choose(updated);
                      updateItem(updated);
                    }
                  }} />
              </div>
              <div className="assistant-composer-tools assistant-composer-model">
                {windowsDesktop && !external && window.somnusNativeDshChat?.listAgentModes && window.somnusNativeDshChat?.selectAgentMode &&
                  <AgentWorkMode conversationId={active?.id} workspaceId={workspace} selectedId={active?.agent_mode}
                    visible={visible} disabled={navigationLocked || Boolean(active?.archived) || pendingQueue.length > 0}
                    running={busy} unconfirmed={unconfirmedModeChat === active?.id && Boolean(active)} revision={messages.length} onSelect={selectWorkMode} onConfirmationRequired={() => { if (active) setUnconfirmedModeChat(active.id); }} />}
                {members.length > 0 && <ConversationRecipient members={members} available={memberDirectory}
                  targetId={memberTarget?.agentId} locked={navigationLocked || savingMember} onTarget={targetMember} />}
                {!memberTarget && onModelConfig && <span className="assistant-model-inline" title={busy ? '模型选择用于下一条消息' : undefined}>
                  <ModelSwitch providerOnly={windowsDesktop} modelId={chosenModel.id} effort={chosenModel.effort} onChange={chooseModel}
                    external={external} agentReasoning={agentReasoning} companyModel={selectedCompanyModel?.model || companyModel}
                    companyCatalog={companyCatalog} onCompanyModel={setCompanyModel} hideReasoning={!windowsDesktop && companyRequested && !selectedCompanyModel}
                    onExternal={setExternal} onConfig={onModelConfig} disabled={navigationLocked} openRequest={modelPickerRequest} />
                </span>}
                {selectedTurn && <Button className={'assistant-send-button' + (showBusySend || canSteerQueue ? ' assistant-secondary-stop' : '')}
                  shape="circle" aria-label={selectedTurn?.installingAddon ? '正在安装' : '停止生成'}
                  title={selectedTurn?.installingAddon ? '正在安装' : '停止生成（连按两次 Esc）'}
                  icon={<span className="assistant-stop-icon" aria-hidden="true" />}
                  loading={stopping || selectedTurn?.installingAddon} onMouseDown={keepComposerFocus} onClick={() => void stop()} />}
                {showBusySend && <Button className="assistant-send-button assistant-busy-send" type="primary" shape="circle"
                  aria-label={memberTarget ? '排队发送给 ' + memberTarget.agentName : busySendLabel}
                  title={(memberTarget ? '排队发送给 '+memberTarget.agentName : busySendLabel)+'（'+shortcuts.send+'；支持时 '+shortcuts.alternate+' 切换本次操作）'} icon={<ArrowUpOutlined />}
                  onMouseDown={keepComposerFocus} onClick={() => sendBusyDraft()} />}
                {canSteerQueue && <Button className="assistant-send-button assistant-busy-send" type="primary" shape="circle"
                  aria-label="追加全部排队消息" title={'追加全部排队消息（'+shortcuts.steerQueue+'）'} icon={<ArrowUpOutlined />}
                  onMouseDown={keepComposerFocus} onClick={steerQueuedMessages} />}
                {(!busy || group && memberTarget) && <Button className="assistant-send-button" type="primary" shape="circle"
                  aria-label={memberTarget ? '发送给 ' + memberTarget.agentName : '发送'} title={(memberTarget ? '发送给 '+memberTarget.agentName : '发送')+'（'+shortcuts.send+'）'}
                  icon={<ArrowUpOutlined />}
                  disabled={savingMember || (memberTarget ? !canStartMember : locked) || pendingQueue.length > 0 || !canSendChat || imageBlocked || !hasDraft}
                  onMouseDown={keepComposerFocus} onClick={() => void sendSelected()} />}
              </div>
            </div>
            {composerDragging && <div className="assistant-composer-drop" aria-hidden="true">将文件或会话拖到这里添加</div>}
          </div>
          {(active || tokenUsage || activeContext) && <div className="assistant-composer-dock" data-composer-dock>
            {tokenUsage && <Tooltip title={<>{tokenUsage.details.map(detail => <div key={detail}>{detail}</div>)}</>} trigger={['hover', 'focus']}>
              <button type="button" className="assistant-token-usage" aria-label={'会话用量，' + tokenUsage.details.join(', ')}>
                <DatabaseOutlined aria-hidden="true" /> {tokenUsage.summary}
              </button>
            </Tooltip>}
            <ContextMeter context={activeContext} />
          </div>}
        </div>
        {extensionsAvailable && <ComposerExtensions open={visible && !navigationLocked && showExtensions} onOpenChange={changeExtensionMenu}
          skills={skills} plugins={plugins} onSkills={changeDraftSkills} onPlugins={changeDraftPlugins}
          showCatalog={Boolean(window.vvmanProjects)} onConfigure={onOpenExtensionConfig}>
          {collaborationAvailable && <ComposerTeamwork key={(active?.id || 'teamwork:' + workspace) + ':' + teamworkRevision}
            conversationId={active?.id} draftEnabled={Boolean(draftTeamwork[workspace])} visible={visible && showExtensions}
            disabled={locked || pendingQueue.length > 0}
            onDraftChange={enabled => setDraftTeamwork(previous => ({ ...previous, [workspace]: enabled }))}
            onChanging={changing => {
              if (!active) return;
              if (changing) teamworkChanges.current.add(active.id);
              else teamworkChanges.current.delete(active.id);
            }} onError={failure => setError(failureText(failure))} />}
        </ComposerExtensions>}
        </div>
      </section>
      {visible && active && !loading && workspacePanelChat === active.id && <ChatWorkspacePanel key={active.id}
        conversationId={active.id} workspace={workspace} worktree={active.worktree}
        webRequest={workspaceWebRequest?.conversationId === active.id ? workspaceWebRequest : undefined}
        proposals={proposals.items} onDecision={proposals.record} onClose={() => setWorkspacePanelChat(undefined)} />}
    </div>
    <EditMessageBranch message={editingMessage} onClose={()=>setEditingMessage(undefined)} onCreate={createEditedBranch}/>
    <DocumentPicker open={visible && attachmentLibraryOpen} kind="file" title="从个人文档添加附件"
      onClose={() => { attachmentReferenceText.current = undefined; setAttachmentLibraryOpen(false); }} onPick={(scope, entry) => {
        setAttachmentLibraryOpen(false);
        const referenceText = attachmentReferenceText.current;
        attachmentReferenceText.current = undefined;
        if (scope === 'private' && entry.kind === 'file') {
          if (referenceText === text) editDraft(text.replace(/@[^\n@]*$/, ''));
          void addLibraryFile(entry.path);
        }
      }} />
    {dispatchPreview && dispatchPreview.conversationId === active?.id && !dispatchOpen && <div className="group-dispatch-resume"><Button type="text" onClick={() => setDispatchOpen(true)}>继续派发分工任务</Button></div>}
    <Modal title="确认任务分工" open={visible && dispatchOpen && Boolean(dispatchPreview) && dispatchPreview?.conversationId === active?.id} onCancel={() => setDispatchOpen(false)} footer={null}>
      {dispatchPreview && <>
        <p>按以下顺序派发。先完成上一项，再填入下一项，后续成员可以读取同会话里已完成的回复。</p>
        <blockquote>{dispatchPreview.text}</blockquote>
        {dispatchPreview.agents.map(({ agent, task }, index) => <section key={agent.id} style={{ margin: '16px 0' }}>
          <strong>{index + 1}. {agent.name}</strong><p>{task}</p>
          <Button onClick={() => {
            targetMember(agent);
            editDraft((index ? '请先阅读本会话上一项已完成的回复，再执行你的任务。\n' : '') + task);
            setDispatchOpen(false);
          }}>填入 {agent.name} 的任务</Button>
        </section>)}
      </>}
    </Modal>
    <Modal title="项目与文件权限" open={visible && projectContextOpen} onCancel={() => setProjectContextOpen(false)}
      footer={<Button onClick={() => setProjectContextOpen(false)}>关闭</Button>}>
      {projectContextOpen && <ChatProjectContext workspace={workspace} conversation={loading ? null : active} visible={visible} />}
    </Modal>
    <Modal title="会话管理" open={searchOpen} onCancel={() => setSearchOpen(false)} footer={null} destroyOnHidden width={760}>
      {searchOpen && <SessionFinder runtimeSnapshot={runtimeSnapshot} workspace={workspace} currentItems={items} activeId={active?.id}
        activeTurns={activeTurns} attention={attentionItems} locked={navigationLocked}
        onOpen={(project, id) => {
          setSearchOpen(false);
          if (project === workspace) { onOpenChat(project); selectHistory(id); }
          else { setAttentionChat({ id, workspace: project }); onOpenChat(project); }
        }}
        onOrganize={organizeSession} onRename={item => { setSearchOpen(false); requestRename(item); }}
        onDelete={item => { setSearchOpen(false); requestDelete(item); }} />}
    </Modal>
    <Modal className="assistant-config-modal" title="模型连接" open={configOpen} onCancel={() => setConfigOpen(false)} footer={<Space><Button loading={statusLoading} icon={<ReloadOutlined />} onClick={() => void loadStatus()}>刷新连接</Button><Button onClick={() => setConfigOpen(false)}>关闭</Button></Space>} width={640}><p>{status?.message || '由服务管理员配置模型连接。'}</p><p>服务管理员通过 AI_ASSISTANT_BASE_URL（服务地址）、AI_ASSISTANT_MODEL（模型名称）和 AI_ASSISTANT_API_KEY（访问密钥）配置模型。配置后重启服务，再点击“刷新连接”。发送的问题与会话上下文会传给配置的模型服务。</p><p>图片随消息发送。支持 PNG、JPEG 和 WebP，最多 4 张，单张 5 MB，合计 10 MB。使用支持图片的模型时，服务管理员可设置 AI_ASSISTANT_VISION_ENABLED=true 开启图片输入。</p></Modal>
    </div>
    <Modal title="删除会话" open={Boolean(deleteTarget)} onCancel={() => { if (!deleteBusy) setDeleteTarget(null); }} onOk={() => void removeConversation()} confirmLoading={deleteBusy} closable={!deleteBusy} maskClosable={!deleteBusy} keyboard={!deleteBusy} cancelButtonProps={{ disabled: deleteBusy }} okButtonProps={{ danger: true, disabled: navigationLocked && !deleteBusy }} okText="确认移除" cancelText="取消"><p>将会话“{deleteTarget?.title || '当前会话'}”从会话列表移除？</p>{deleteTarget?.id === active?.id && <p className="small-note">当前会话的输入草稿将清空。</p>}{deleteError && <Alert type="error" showIcon message={deleteError} />}</Modal>
    <Modal title="重命名会话" open={Boolean(renameTarget)} onCancel={() => { if (!renameBusy) setRenameTarget(null); }} onOk={() => void rename()} confirmLoading={renameBusy} cancelButtonProps={{ disabled: renameBusy }} okButtonProps={{ disabled: !name.trim() }} okText="保存名称" cancelText="取消"><Input aria-label="会话名称" value={name} onChange={event => setName(event.target.value)} maxLength={80} onPressEnter={() => { if (!renameBusy) void rename(); }} />{renameError && <Alert type="error" showIcon message={renameError} />}</Modal>
  </>;
}

