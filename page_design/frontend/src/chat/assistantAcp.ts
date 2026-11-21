import type { ChatAttachment, ChatMessage, CompanyReasoningEffort, ConversationPermission, DshRecommendation, ExecutionStep, ExecutionPlanItem, FileProposal, ReasoningEffort, ReplyUsage, ContextUsage } from './assistantApi';
import type { ComposerReference } from './ComposerEditor';
export type AcpStage = 'preparing' | 'connecting' | 'working' | 'thinking' | 'responding';

export type AcpConnectionState = { conversationId: string; agentId: string; state: 'connecting' | 'ready' | 'running' | 'approval' | 'disconnected' | 'error'; updatedAt?: number; error?: string };
export type ExternalAgent = { id: string; name: string };
export type ExternalModel = { id: string; name: string; description?: string };
export type ExternalReasoning = {
  modelId: string | null;
  value: string | null;
  options: Array<{ id: string; name: string; description?: string }>;
};
export type ExternalSelection = { agentId: string; agentName: string; modelId?: string; modelName?: string };
export type ExternalResult = { text: string; pluginCards?: import('../plugins/DeclarativePlugin').PluginCard[]; persistencePending?: boolean; stopReason?: string; modelId?: string | null; modelName?: string | null; reasoningEffort?: string; reasoningName?: string; projectProposals?: FileProposal[]; usage?: ReplyUsage; contextUsage?: ContextUsage; recommendations?: DshRecommendation[] };

type TestApprovalDetails = { kind?: 'test'; presetName?: string; executable: string; args: string[]; cwd: string };
type PowerShellApprovalDetails = { kind: 'powershell'; command: string; cwd: string; timeoutSeconds: number; sandboxMode?: 'workspace-write' | 'danger-full-access' };
export type NativeToolApprovalDetails = { kind: 'native_tool'; toolName: string; reason: string; argumentsPreview?: string };
export type DevelopmentApprovalDetails = TestApprovalDetails | PowerShellApprovalDetails | NativeToolApprovalDetails;

export type AcpPermission = {
  requestId: string; title: string; kind: string; expiresAt?: number;
  details?: DevelopmentApprovalDetails;
  options: Array<{ id: string; name: string; kind: 'allow_once' | 'reject_once' }>;
};

export type DshQuestion = { requestId: string; expiresAt?: number; remainingMs?: number; phase?: 'open' | 'continued'; questions: Array<{
  id: string; question: string; detail?: string; header?: string;
  options?: Array<{ label: string; description?: string }>; multiSelect?: boolean;
  intent?: { kind: 'plan-review'; approve: string };
}> };
export type DshAnswers = Array<{ id: string; selected: string[]; custom?: string }>;
export type DshCommand = { name: string; description: string; hint?: string; executable: boolean; reason?: string };
export type RecoveredChatDraft = {
  text?: string; questionId?: string; answers?: DshAnswers;
  composerBlocks?: ComposerReference[];
  attachments?: Array<Pick<ChatAttachment, 'name' | 'data_url'> & Partial<ChatAttachment>>;
  dataFile?: { id: string; name: string; row_count: number; columns: string[]; acpOnly?: boolean };
  docFile?: { id: string; name: string; kind: string; chars: number; note?: string };
};
export type QueuedTurnRoute = {
  agent?: ExternalSelection; nativeDsh: boolean; reasoningEffort?: string;
  memberOnly?: boolean;
  modelId?: string; effort?: ReasoningEffort;
  companyOptions?: { model: string; effort?: CompanyReasoningEffort | ReasoningEffort };
};
export type DurableQueuedMessage = {
  id: string; draft: RecoveredChatDraft & { skillIds?: string[]; pluginIds?: string[] };
  route: QueuedTurnRoute; permission: ConversationPermission;
};
export type DshSubagentEntry = { seq: number; type: 'message'; role: 'user' | 'assistant'; text: string } |
  { seq: number; type: 'tool'; name: string; status: 'running' | 'completed' | 'failed'; reason?: string;
    details?: { target?: string; durationMs?: number; exitCode?: number } };
export type DshSubagentDetail = { title: string; status: string; messages: Array<{ role: string; text: string }>; truncated: boolean;
  entries?: DshSubagentEntry[]; nextBeforeSeq?: number;
};
export type DshSubagentToolDetail = {
  name: string; status: 'running' | 'completed' | 'failed'; arguments?: unknown; output?: unknown;
  nextOffset?: number; truncated?: boolean;
};
export type DshAgentMode = { id: string; name: string; description?: string; available: boolean; reason?: string; isDefault: boolean };
export type DshAgentModes = { modes: DshAgentMode[]; selectedId: string | null; locked: boolean; reason?: string; needsConfirmation?: boolean };
export type DshTaskState = {
  plan?: { active: boolean; pending: boolean };
  goal?: { objective: string; phase: 'active' | 'paused' | 'blocked' | 'complete'; roundsStarted: number; maxGoalRounds: number;
    activation?: 'armed' | 'disarmed'; blockedReason?: string };
};

type ChatUpdate = { pluginCard?: import('../plugins/DeclarativePlugin').PluginCard; acpDiagnostic?: {code:string;message:string}; agentId: string; turnId?: string; conversationId?: string; text: string; contextUsage?: ContextUsage; acpStage?: AcpStage; acpActivityTruncated?: boolean; acpTool?: ExecutionStep; acpPlan?: { entries: ExecutionPlanItem[] }; acpPermission?: AcpPermission; acpPermissionClosed?: { requestId: string }; dshQuestion?: DshQuestion; dshQuestionClosed?: {requestId: string}; dshTaskState?: DshTaskState; projectProposal?: FileProposal; toolProgress?: { callId?: string; traceId?: string; name: string; title?: string; kind?: string; status: 'running' | 'complete' | 'error'; message?: string; taskId?: string } };
export type NativeHistoryRecord = { seq: number; canFork?: boolean; at?: number; type: string; role?: string; text?: string; tool?: {callId: string; name: string; status?: string} };
export type NativeHistoryPage = { records: NativeHistoryRecord[]; cursor: number; hasMore: boolean };
export type ChildConversationAssociation = { status: 'linked'|'none'|'pending'|'deleted'|'archived'|'source_deleted'|'source_archived'|'source_scope_changed'|'target_scope_changed'|'unverified'; conversation_id?:string; continuation?:{agentId:string;providerModelId?:string};can_open:boolean;can_send:boolean };
export type InheritedHistoryPage={history:unknown;records:{seq:number;part:number;role:'user'|'assistant';content:string;final:boolean}[];next_cursor:string|null;has_more:boolean};
  type NativeDshChatBridge = {
    nativePreferences?(request:{conversationId:string}):Promise<{revision:number;provider_model_id:string|null;skill_ids:string[];continuation?:{agentId:string;providerModelId?:string}}>;
    saveNativePreferences?(request:{conversationId:string;revision:number;provider_model_id:string|null;skill_ids:string[]}):Promise<{revision:number;provider_model_id:string|null;skill_ids:string[]}>;
    inheritedHistory?(request:{conversationId:string;after?:string;limit?:number}):Promise<InheritedHistoryPage>;

  childConversation?(request:{conversationId:string;turnId:string;subagentId:string}):Promise<ChildConversationAssociation>;

  history?(request: {conversationId:string;turnId:string;afterSeq?:number;limit?:number}): Promise<NativeHistoryPage>;
  historyTool?(request:{conversationId:string;turnId:string;callId?:string;seq?:number;kind?:'event';part?:string;offset?:number}):Promise<{text:string;nextOffset?:number;truncated?:boolean}>;
  fork?(request:{conversationId:string;turnId:string;atSeq?:number;subagentId?:string;worktreePolicy?:'share-current'}):Promise<{conversationId:string;sessionId?:string;continuation?:{agentId:string;providerModelId?:string}}>;

  promptConversation(request: { conversationId: string; workspaceId?: string; turnId: string; agentId: string;
    questionReply?: { requestId: string; answers: DshAnswers };
  }): Promise<ExternalResult>;
  onUpdate(listener: (event: Omit<ChatUpdate, 'agentId'> & { agentId?: string }) => void): () => void;
  cancelConversation(conversationId: string): Promise<void>;
  steer?(request: { conversationId: string; turnId: string; steerId: string }): Promise<{ accepted: boolean; message?: ChatMessage }>;
  steerQueue?(request: { conversationId: string; turnId: string; queueIds: string[] }):
    Promise<{ accepted: boolean; messages: ChatMessage[]; acceptedQueueIds: string[] }>;
  respondPermission?(conversationId: string, requestId: string, optionId: string | null): Promise<void>;
  respondQuestion?(conversationId: string, requestId: string, answers: DshAnswers | null): Promise<void>;
  listCommands?(request: { conversationId?: string; workspaceId?: string }): Promise<{ commands: DshCommand[] }>;
  executeCommand?(request: { conversationId: string; workspaceId?: string; turnId: string; agentId: string;
    line: string }): Promise<ExternalResult & { ok: boolean; taskState?: DshTaskState }>;
  holdQuestion?(conversationId: string, requestId: string, held: boolean): Promise<void>;
  recoverQuestions?(conversationId: string): Promise<DshQuestion[]>;
  getDraft?(conversationId: string): Promise<RecoveredChatDraft | null>;
  saveDraft?(conversationId: string, draft: RecoveredChatDraft | null): Promise<void>;
  getQueue?(conversationId: string): Promise<DurableQueuedMessage[] | null>;
  saveQueue?(conversationId: string, queue: DurableQueuedMessage[]): Promise<void>;
  subagentDetail?(request: { conversationId: string; turnId: string; subagentId: string; beforeSeq?: number }): Promise<DshSubagentDetail | null>;
  subagentToolDetail?(request: { conversationId: string; turnId: string; subagentId: string; seq: number; offset?: number }):
    Promise<DshSubagentToolDetail | null>;
  taskState?(request: { conversationId: string; workspaceId?: string }): Promise<DshTaskState>;
  listAgentModes?(request: { conversationId?: string; workspaceId?: string }): Promise<DshAgentModes>;
  selectAgentMode?(request: { conversationId: string; workspaceId?: string; modeId: string }): Promise<DshAgentModes>;
};

declare global {
  interface Window { somnusNativeDshChat?: NativeDshChatBridge }
}

type MainChatBridge = {
  agentReadiness?(): Promise<import('../configuration/agentReadiness').AgentReadiness[]>;
  connectionStates?(request: { conversationId: string }): Promise<AcpConnectionState[]>;
  warmConversation?(request: { conversationId: string; agentIds: string[] }): Promise<AcpConnectionState[]>;
  releaseConversationAgent?(request: { conversationId: string; agentId: string }): Promise<void>;
  list(): Promise<ExternalAgent[]>;
  listDelegationAgents?(): Promise<ExternalAgent[]>;
  runDelegation?(request: { agentId: string; conversationId: string; requestId: string; task: string; context?: string }): Promise<{ text: string; agentName: string }>;
  cancelDelegation?(conversationId: string, requestId: string): Promise<void>;
  companyRuntime?(modelId?: string): Promise<{ agentId: string } | null>;
  discoverModels(id: string, modelId?: string): Promise<{ agentId: string; modelId: string | null; models: ExternalModel[]; reasoning?: ExternalReasoning }>;
  promptConversation(request: { agentId: string; conversationId: string; turnId: string; modelId?: string; reasoningEffort?: string; groupMember?: boolean }): Promise<ExternalResult>;
  cancelConversation(conversationId: string, turnId?: string): Promise<void>;
  resetConversation(conversationId: string): Promise<void>;
  respondPermission?(conversationId: string, requestId: string, optionId: string | null, turnId?: string): Promise<void>;
  onUpdate(listener: (event: ChatUpdate) => void): () => void;
};

export function mainChatBridge(): MainChatBridge | undefined {
  const bridge = (window as Window & { vvmanAcp?: Partial<MainChatBridge> }).vvmanAcp;
  return bridge?.discoverModels && bridge.promptConversation && bridge.cancelConversation && bridge.resetConversation ? bridge as MainChatBridge : undefined;
}

