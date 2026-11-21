import { readAssistantEvents } from './assistantProtocol.mjs';

export type AssistantStatus = { configured: boolean; connection_status: 'not_configured' | 'unverified' | 'verified'; last_success_at: number | null; model: string | null; provider: string; provider_id?: string; database_connected: false; capabilities: { chat: boolean; vision?: boolean; sql_execution: false; event_detection: false }; message: string };
export type ConversationPermission = 'read_only' | 'workspace_write' | 'workspace_direct' | 'full';
export type ConversationWorktree = { source: string; branch: string; label: string; commit: string; created_at: number };
export type ConversationAgent = { id?: string; name: string; model?: string; transport?: string };
export type NativePreferences={revision:number;provider_model_id:string|null;skill_ids:string[]};
export type Conversation = { native_preferences?:NativePreferences; inherited_history?: {conversation_id:string;reservation_id:string;fragment_count:number;byte_count:number;created_at:number;content_sha256:string}|null; id: string; title: string; created_at: number; updated_at: number; message_count: number; permission_mode?: ConversationPermission; agent_mode?: string | null; worktree?: ConversationWorktree | null; workspace_id?: string; pinned?: boolean; archived?: boolean; last_agent?: ConversationAgent | null; running?: boolean; agent_members?: string[] };
export type ConversationOrganization = { pinned?: boolean; archived?: boolean };
export type ChatAttachment = { name: string; data_url: string; mime: string; size: number; width: number; height: number };
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type CompanyReasoningEffort = 'none' | 'low' | 'high' | 'max';
export type CompanyModel = { model: string; vision: boolean; reasoning_efforts: CompanyReasoningEffort[]; default_reasoning_effort?: CompanyReasoningEffort };
export type ProviderApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'bedrock-converse-stream';
export type ProviderRetry = {
  mode: 'normal' | 'always'; maxRetries?: number; retryableCodes?: string[];
  backoff?: { initialDelayMs?: number; maxDelayMs?: number; jitterRatio?: number };
};
export type ProviderConnection = { api?: ProviderApi; auth_env?: string; region?: string; retry_policy?: ProviderRetry | null };
export type ModelCapabilities = { context_window?: number | null; max_output_tokens?: number | null; supports_developer_role?: boolean | null; supports_long_cache_retention?: boolean | null; cache_retention?: 'none' | 'short' | 'long' | null };
export type Provider = { id: string; group_id?: string; name: string; model: string; base_url: string; builtin?: boolean; api_key_masked?: string;
  configured?: boolean; requires_api_key?: boolean; vision_enabled?: boolean; reasoning_efforts?: ReasoningEffort[]; auth_env_present?: boolean; has_api_key?: boolean; } & ProviderConnection & ModelCapabilities;
export type ExecutionStep = { id: string; title: string; kind: string; status: 'pending' | 'in_progress' | 'completed' | 'failed'; duration_ms?: number; failure_reason?: string; parent_id?: string };
export type ExecutionPlanItem = { content: string; status: 'pending' | 'in_progress' | 'completed' };
export type ExecutionApproval = {
  id: string; kind: 'mcp' | 'edit' | 'test'; status: 'approved' | 'rejected' | 'closed' | 'pending'; at: number;
};
export type ExecutionSummary = { steps: ExecutionStep[]; plan: ExecutionPlanItem[]; truncated?: boolean; approvals?: ExecutionApproval[] };
export type McpApprovalBlocked = { tool_name: string; reason: string };
export type ReplyUsage = { input_tokens: number; output_tokens: number; cached_input_tokens?: number; partial?: boolean };
export type ConversationTraceEvent = {
  id: string; kind: 'tool' | 'approval' | 'file' | 'usage'; title: string; status: string;
  turn_id?: string; at?: number; duration_ms?: number; usage?: ReplyUsage;
};
export type ConversationTrace = { events: ConversationTraceEvent[]; truncated?: boolean };
export type ContextUsage = { used_tokens: number; max_tokens: number };
export type DshRecommendation = { id: string; kind: 'plugin' | 'page'; title: string; description: string; pluginId?: string };
type ReplyMeta = { plugin_cards?: import('../plugins/DeclarativePlugin').PluginCard[]; recommendations?: DshRecommendation[]; provider_id: string; provider_name: string; model: string; transport?: string; reasoning_effort?: ReasoningEffort; elapsed_ms?: number; usage?: ReplyUsage; context?: ContextUsage; usage_unavailable?: true; execution?: ExecutionSummary; mcp_approval_blocked?: McpApprovalBlocked; delegation?: DelegationResult };
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; status: 'complete' | 'streaming' | 'error' | 'cancelled'; attachments?: ChatAttachment[]; created_at: number; reply_meta?: ReplyMeta };
export type McpApproval = { id: string; tool_name: string; arguments_preview?: string; status: 'pending' | 'approved' | 'rejected' | 'expired' };
export type DelegationAgent = { id: string; name: string };
export type DelegationSettings = { enabled: boolean; max_calls: number; agent_ids: string[]; dsh_max_depth: number; dsh_max_active: number };
export type DelegationResult = { agent_name: string; status: 'complete' | 'declined' | 'error' | 'expired'; result?: string };
export type DelegationResponse = { status: 'complete' | 'declined' | 'error'; result?: string; agent_id?: string };
export type ChatEvent = { type: string; data: { conversation_id?: string; user_message?: ChatMessage; assistant_message?: ChatMessage; message?: ChatMessage | string; conversation?: Conversation; text?: string; code?: string; name?: string; arguments?: string; summary?: string; ok?: boolean; failure_reason?: string; proposal?: FileProposal; id?: string; tool_name?: string; reason?: string; arguments_preview?: string; status?: McpApproval['status'] | DelegationResult['status']; task?: string; context?: string; agent_id?: string; agent_name?: string; result?: string } };
const root = '/api/assistant';
export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) { super(message); this.code = code; this.status = status; }
}
async function request(path: string, options?: RequestInit) {
  const response = await fetch(root + path, { cache: 'no-store', ...options });
  if (!response.ok) {
    let detail = '', code: string | undefined;
    try { const data = await response.json(); detail = typeof data.error === 'string' ? data.error : data.error?.message || ''; code = typeof data.error === 'object' ? data.error?.code : undefined; } catch { /* retain HTTP error */ }
    throw new ApiError(detail || `对话服务返回 ${response.status}`, code, response.status);
  }
  return response;
}
const jsonPost = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
export async function delegationSettings(signal?: AbortSignal): Promise<DelegationSettings> {
  return (await request('/delegation-settings', { signal })).json();
}
export async function saveDelegationSettings(settings: DelegationSettings): Promise<DelegationSettings> {
  return (await request('/delegation-settings', { ...jsonPost(settings), method: 'PATCH' })).json();
}
type CheckpointAgent = { id: string; name: string };
type CheckpointConfiguration = {
  model: { id: string; name: string; model: string };
  plugins: { id: string; name: string; enabled: boolean; ready: boolean }[];
};
export type ConfigurationCheckpoint = CheckpointConfiguration & { id: string; created_at: number; agent: CheckpointAgent | null };
export type ConfigurationCheckpointList = { current: CheckpointConfiguration; revision: string; checkpoints: ConfigurationCheckpoint[] };
export async function listConfigurationCheckpoints(signal?: AbortSignal): Promise<ConfigurationCheckpointList> {
  return (await (await request('/configuration-checkpoints', { signal })).json());
}
export async function saveConfigurationCheckpoint(revision: string): Promise<ConfigurationCheckpoint> {
  return (await (await request('/configuration-checkpoints', jsonPost({ revision }))).json());
}
export async function restoreConfigurationCheckpoint(id: string): Promise<{ agent: CheckpointAgent | null }> {
  return (await (await request('/configuration-checkpoints/' + encodeURIComponent(id) + '/restore', jsonPost({}))).json());
}
export async function assistantStatus(signal?: AbortSignal, modelId?: string): Promise<AssistantStatus> {
  const data = await (await request('/status' + (modelId ? '?model_id=' + encodeURIComponent(modelId) : ''), { signal })).json();
  if (typeof data.configured !== 'boolean' || typeof data.capabilities?.chat !== 'boolean' || data.database_connected !== false) throw new Error('模型连接状态格式不正确');
  return data;
}
export type ProjectMemoryMode = 'default' | 'project';
export type ProjectSourceFolder = { root_path: string; folder_grant?: string };
export type Workspace = {
  id: string; name: string; conversation_count: number;
  source_folders?: string[]; memory_mode?: ProjectMemoryMode; instructions?: string;
  root_path?: string | null; archived?: boolean; pinned?: boolean;
};
type WorkspaceUpdate = Partial<Pick<Workspace, 'name' | 'root_path' | 'archived' | 'pinned' | 'memory_mode' | 'instructions'>> & { folder_grant?: string; source_folders?: ProjectSourceFolder[] };
export type FileProposal = {
  id: string; path: string; assistant_message_id?: string; source_folder?: string; old_content: string | null; new_content: string;
  operation?: 'create' | 'edit';
  status: 'pending' | 'applied' | 'rejected'; created_at: number;
};
export async function workspaces(signal?: AbortSignal): Promise<Workspace[]> {
  const data = await (await request('/workspaces', { signal })).json();
  if (!Array.isArray(data.workspaces)) throw new Error('项目列表格式不正确');
  return data.workspaces;
}
export async function createWorkspace(name: string, settings: Omit<WorkspaceUpdate, 'name'> = {}): Promise<Workspace> {
  const data = await (await request('/workspaces', jsonPost({ name, ...settings }))).json();
  if (!data.workspace?.id) throw new Error('创建项目失败');
  return data.workspace;
}
export async function updateWorkspace(id: string, changes: WorkspaceUpdate): Promise<Workspace> {
  const data = await (await request('/workspaces/' + encodeURIComponent(id), { ...jsonPost(changes), method: 'PATCH' })).json();
  if (data.workspace?.id !== id) throw new Error('项目更新未确认');
  return data.workspace;
}
export async function removeWorkspace(id: string) {
  await request('/workspaces/' + encodeURIComponent(id), { method: 'DELETE' });
}
export async function listFileProposals(cid: string): Promise<FileProposal[]> {
  const data = await (await request('/conversations/' + encodeURIComponent(cid) + '/file-proposals')).json();
  return data.proposals;
}
export async function decideFileProposal(cid: string, pid: string, decision: 'approve' | 'reject'): Promise<FileProposal> {
  const path = '/conversations/' + encodeURIComponent(cid) + '/file-proposals/' + encodeURIComponent(pid) + '/' + decision;
  const data = await (await request(path, jsonPost({}))).json();
  return data.proposal;
}
export async function conversations(signal?: AbortSignal, workspace?: string): Promise<Conversation[]> {
  const suffix = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
  const data = await (await request('/conversations' + suffix, { signal })).json();
  if (!Array.isArray(data.conversations)) throw new Error('会话列表格式不正确');
  return data.conversations;
}
export async function sessionIndex(signal?: AbortSignal): Promise<{ conversations: Conversation[]; truncated: boolean }> {
  const data = await (await request('/session-index', { signal })).json();
  if (!Array.isArray(data.conversations)) throw new Error('无法读取会话管理列表');
  return { conversations: data.conversations, truncated: data.truncated === true };
}
export async function organizeConversation(id: string, organization: ConversationOrganization): Promise<Conversation> {
  const data = await (await request(`/conversations/${encodeURIComponent(id)}/organize`, jsonPost(organization))).json();
  if (data.conversation?.id !== id) throw new Error('会话状态未确认');
  return data.conversation;
}
export async function changeConversationAgent(id: string, agentId: string, added: boolean): Promise<string[]> {
  const path = '/conversations/' + encodeURIComponent(id) + '/agent-members';
  const data = await (await request(path, jsonPost({ agent_id: agentId, added }))).json();
  if (!Array.isArray(data.agent_members) || !data.agent_members.every((member: unknown) => typeof member === 'string')) {
    throw new Error('服务未确认会话成员更新');
  }
  return data.agent_members;
}
export async function createConversation(workspace?: string, permission?: ConversationPermission): Promise<Conversation> {
  const result = (await (await request('/conversations', jsonPost({
    ...(workspace ? { workspace } : {}), ...(permission ? { permission_mode: permission } : {}),
  }))).json()).conversation;
  if (permission && result?.permission_mode !== permission) throw new Error('服务未确认新会话的文件权限');
  return result;
}
export async function branchConversation(id: string, messageId: string): Promise<Conversation> {
  const result = await request('/conversations/' + encodeURIComponent(id) + '/branch', jsonPost({ message_id: messageId }));
  return (await result.json()).conversation;
}
export async function conversation(id: string, signal?: AbortSignal): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
  const data = await (await request('/conversations/' + encodeURIComponent(id), { signal })).json();
  if (data.conversation?.id !== id || !Array.isArray(data.messages)) throw new Error('会话历史不匹配');
  return data;
}
export async function conversationTrace(id: string, signal?: AbortSignal): Promise<ConversationTrace> {
  const data = await (await request('/conversations/' + encodeURIComponent(id) + '/trace', { signal })).json();
  if (!Array.isArray(data.events)) throw new Error('无法读取执行记录');
  const events = data.events.map(({ id, kind, title, status, turn_id, at, duration_ms, usage }: ConversationTraceEvent) => ({
    id, kind, title, status, turn_id, at, duration_ms, usage: usage && {
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      cached_input_tokens: usage.cached_input_tokens, partial: usage.partial,
    },
  }));
  return { events, truncated: data.truncated === true };
}
export async function saveConversationPermission(id: string, mode: ConversationPermission): Promise<ConversationPermission> {
  const result = await (await request('/conversations/' + encodeURIComponent(id) + '/permission', jsonPost({ mode }))).json();
  if (result.id !== id || result.permission_mode !== mode) throw new Error('服务未确认权限更新');
  return result.permission_mode;
}
export async function renameConversation(id: string, title: string): Promise<Conversation> {
  if (!title.trim()) throw new Error('请输入会话名称');
  if (title.trim().length > 80) throw new Error('会话名称最多80字');
  return (await (await request(`/conversations/${encodeURIComponent(id)}/rename`, jsonPost({ title: title.trim() }))).json()).conversation;
}
export async function deleteConversation(id: string) {
  const result = await (await request(`/conversations/${encodeURIComponent(id)}/delete`, jsonPost({}))).json();
  if (result.deleted !== true || result.conversation_id !== id) throw new Error('删除结果未确认，会话内容保持不变');
  return result;
}
export async function cancelConversation(id: string) {
  return (await request(`/conversations/${encodeURIComponent(id)}/cancel`, jsonPost({}))).json();
}
export async function respondToDelegation(id: string, requestId: string, response: DelegationResponse) {
  await request(`/conversations/${encodeURIComponent(id)}/delegations/${encodeURIComponent(requestId)}`, jsonPost(response));
}
export async function sendMessage(id: string, content: string, signal: AbortSignal, onEvent: (event: ChatEvent) => void, attachments: ChatAttachment[] = [], analysisFileId?: string | null, fileIds: string[] = [], analysisFileMeta?: { name: string; row_count: number; columns: string[] } | null, skillIds: string[] = [], modelId?: string, effort?: ReasoningEffort, pluginIds: string[] = [], delegationAgents: DelegationAgent[] = [], queueId?: string) {
  if (!content.trim() && !attachments.length) throw new Error('请输入问题或添加图片后再发送');
  const response = await request(`/conversations/${encodeURIComponent(id)}/messages`, { ...jsonPost({ content: content.trim(), ...(attachments.length ? { attachments: attachments.map(({ name, data_url }) => ({ name, data_url })) } : {}), ...(analysisFileId ? { analysis_file_id: analysisFileId } : {}), ...(fileIds.length ? { file_ids: fileIds } : {}), ...(modelId ? { model_id: modelId } : {}), ...(effort ? { reasoning_effort: effort } : {}), ...(skillIds.length ? { skill_ids: skillIds } : {}), ...(pluginIds.length ? { plugin_ids: pluginIds } : {}), ...(analysisFileMeta ? { analysis_file_meta: analysisFileMeta } : {}), ...(delegationAgents.length ? { delegation_agents: delegationAgents } : {}), ...(queueId ? { queue_id: queueId } : {}) }), signal });
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('对话服务未返回流式回答');
  await readAssistantEvents(response, onEvent);
}

export type Skill = { id: string; name: string; description: string; enabled: boolean; builtin?: boolean; reference_count: number; ignored_count?: number };

export async function listSkills(signal?: AbortSignal): Promise<Skill[]> {
  const data = await (await request('/skills', { signal })).json();
  if (!Array.isArray(data.skills)) throw new Error('无法读取 Skills');
  return data.skills;
}
export async function importSkill(file: File): Promise<Skill> {
  const response = await request('/skills/import', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file,
  });
  return (await response.json()).skill;
}
export async function setSkillEnabled(id: string, enabled: boolean): Promise<Skill> {
  return (await (await request('/skills/' + encodeURIComponent(id), { ...jsonPost({ enabled }), method: 'PATCH' })).json()).skill;
}
export async function removeSkill(id: string) {
  await request('/skills/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function listProviders(signal?: AbortSignal): Promise<{ active: string; providers: Provider[]; company_models?: CompanyModel[] }> {
  const data = await (await request('/models', { signal })).json();
  if (!Array.isArray(data.providers)) throw new Error('无法读取模型');
  return data;
}

export type PluginManifest = { name: string; description?: string; version?: string; skill_ids?: string[]; mcp_ids?: string[] };
export type PluginContract = { schema_version: number; format: string; legacy: boolean; capabilities: string[]; minimum_somnus_version: string | null; compatibility: 'compatible' | 'requires-adapter' | 'unverified' | 'incompatible'; reason?: string };
export type InstalledPlugin = Required<PluginManifest> & {
  contract?: PluginContract;
  id: string; enabled: boolean; missing_skills: string[]; missing_mcp: string[]; inactive_skills: string[]; inactive_mcp: string[];
};
export type PluginPreflight = {
  ok: boolean;
  checks: { id: string; status: 'pass' | 'warn' | 'fail'; message: string }[];
  manifest?: PluginManifest;
  references?: { skills: Record<string, 'new' | 'reused' | 'disabled' | 'conflict'>;
    mcp_ids: Record<string, 'missing' | 'enabled' | 'disabled'> };
};
export type PluginCandidate = { id: string; sha256: string; manifest: PluginManifest; report: PluginPreflight; created_at: number };
export type PortablePluginPackage = { format: unknown };
export function isPortablePluginPackage(input: unknown): input is PortablePluginPackage {
  return typeof input === 'object' && input !== null && 'format' in input;
}

export async function preflightPortablePlugin(input: PortablePluginPackage): Promise<PluginPreflight> {
  return (await (await request('/plugins/portable/preflight', jsonPost(input))).json()).report;
}
export async function importPortablePlugin(input: PortablePluginPackage): Promise<InstalledPlugin> {
  return (await (await request('/plugins/portable/import', jsonPost(input))).json()).plugin;
}
export async function exportPortablePlugin(manifest: PluginManifest): Promise<{ package: PortablePluginPackage; sha256: string }> {
  return (await (await request('/plugins/portable/export', jsonPost(manifest))).json());
}

export async function pluginDevelopmentTemplate(signal?: AbortSignal): Promise<PluginManifest> {
  const data = await (await request('/plugins/development/template', { signal })).json();
  return data.manifest;
}
export async function preflightPlugin(manifest: unknown): Promise<PluginPreflight> {
  const data = await (await request('/plugins/development/preflight', jsonPost(manifest))).json();
  return data.report;
}
export async function listPluginCandidates(signal?: AbortSignal): Promise<PluginCandidate[]> {
  const data = await (await request('/plugins/development/candidates', { signal })).json();
  return data.candidates;
}
export async function createPluginCandidate(manifest: PluginManifest): Promise<PluginCandidate> {
  const data = await (await request('/plugins/development/candidates', jsonPost(manifest))).json();
  return data.candidate;
}

export async function listInstalledPlugins(signal?: AbortSignal): Promise<InstalledPlugin[]> {
  const data = await (await request('/plugins', { signal })).json();
  if (!Array.isArray(data.plugins)) throw new Error('无法读取插件列表');
  return data.plugins;
}
export async function importPlugin(manifest: PluginManifest): Promise<InstalledPlugin> {
  return (await (await request('/plugins/import', jsonPost(manifest))).json()).plugin;
}
export async function setPluginEnabled(id: string, enabled: boolean): Promise<InstalledPlugin> {
  return (await (await request('/plugins/' + encodeURIComponent(id), { ...jsonPost({ enabled }), method: 'PATCH' })).json()).plugin;
}
export async function removePlugin(id: string) {
  await request('/plugins/' + encodeURIComponent(id), { method: 'DELETE' });
}

export type DefaultPlugin = InstalledPlugin & { source_id: string; published_at: number; builtin?: boolean };
export async function listDefaultPlugins(signal?: AbortSignal): Promise<{ plugins: DefaultPlugin[]; owner_configured: boolean }> {
  const data = await (await request('/plugins/defaults', { signal })).json();
  if (!Array.isArray(data.plugins)) throw new Error('无法读取默认插件');
  return data;
}
export async function publishDefaultPlugin(id: string): Promise<DefaultPlugin> {
  return (await (await request('/plugins/defaults', jsonPost({ plugin_id: id }))).json()).plugin;
}
export async function removeDefaultPlugin(id: string) {
  await request('/plugins/defaults/' + encodeURIComponent(id), { method: 'DELETE' });
}

export type ProviderConnectionTest = { ok: boolean; code: string; message: string; elapsed_ms: number; status?: number };
type ModelFields = Pick<Provider, 'model' | 'vision_enabled' | 'reasoning_efforts'> & ModelCapabilities;
type SupplierFields = Pick<Provider, 'name' | 'base_url'> & ProviderConnection & { api_key?: string };

export async function saveModel(fields: ModelFields & (Partial<SupplierFields> & { group_id?: string }), id?: string): Promise<Provider> {
  const path = id ? '/models/' + encodeURIComponent(id) : '/models';
  return (await (await request(path, { ...jsonPost(fields), method: id ? 'PATCH' : 'POST' })).json()).provider;
}
type DiscoveryConnection = SupplierFields | { group_id: string };
export async function discoverProviderModels(fields: DiscoveryConnection, signal: AbortSignal): Promise<string[]> {
  return (await (await request('/model-providers/discover', { ...jsonPost(fields), signal })).json()).models;
}
export async function addDiscoveredModels(fields: DiscoveryConnection & { models: string[] }): Promise<Provider[]> {
  return (await (await request('/model-providers/models', jsonPost(fields))).json()).providers;
}
export async function saveModelSupplier(id: string, fields: SupplierFields) {
  await request('/model-providers/' + encodeURIComponent(id), { ...jsonPost(fields), method: 'PATCH' });
}
export async function setDefaultModel(id: string) {
  await request('/models/active', jsonPost({ id }));
}
export async function removeModel(id: string) {
  await request('/models/' + encodeURIComponent(id), { method: 'DELETE' });
}
export async function testModelConnection(id: string): Promise<ProviderConnectionTest> {
  return (await (await request('/models/' + encodeURIComponent(id) + '/test', jsonPost({}))).json());
}
export async function saveCompanyProvider(apiKey: string) {
  await request('/company-provider', { ...jsonPost({ api_key: apiKey }), method: 'PATCH' });
}
export async function removeCompanyProviderKey() {
  await request('/company-provider', { method: 'DELETE' });
}

export async function beginExternalTurn(id: string, input: {
  content: string; agent_id: string; agent_name: string; model?: string;
  attachments?: ChatAttachment[]; file_ids?: string[]; analysis_file_id?: string; skill_ids?: string[]; plugin_ids?: string[];
  company_model?: string; reasoning_effort?: CompanyReasoningEffort | ReasoningEffort; provider_model_id?: string;
  queue_id?: string;
  member_only?: boolean;
  group_parallel?: boolean;
}, signal?: AbortSignal): Promise<{
  turn_id: string; user_message: ChatMessage; assistant_message: ChatMessage; conversation: Conversation;
}> {
  return (await (await request('/conversations/' + encodeURIComponent(id) + '/external-turns', { ...jsonPost(input), signal })).json());
}
export async function finishExternalTurn(id: string, turn: string, input: { content: string; status: 'complete' | 'cancelled' | 'error'; model?: string; usage?: ReplyUsage; context?: ContextUsage; execution?: ExecutionSummary; recommendations?: DshRecommendation[] }): Promise<{ message: ChatMessage; conversation: Conversation }> {
  const path = '/conversations/' + encodeURIComponent(id) + '/external-turns/' + encodeURIComponent(turn) + '/finish';
  return (await (await request(path, jsonPost(input))).json());
}

export async function reserveExternalSteer(id: string, turn: string, content: string): Promise<{ steer_id: string }> {
  const path = '/conversations/' + encodeURIComponent(id) + '/external-turns/' + encodeURIComponent(turn) + '/steers';
  return (await (await request(path, jsonPost({ content }))).json());
}

export async function respondToMcpApproval(cid: string, id: string, choice: 'approve' | 'reject'): Promise<void> {
  const path = '/conversations/' + encodeURIComponent(cid) + '/mcp-approvals/' + encodeURIComponent(id) + '/' + choice;
  await request(path, jsonPost({}));
}
