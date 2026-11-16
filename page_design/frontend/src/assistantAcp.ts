import type { DshRecommendation, ExecutionStep, ExecutionPlanItem, FileProposal, ReplyUsage, ContextUsage } from './assistantApi';

export type ExternalAgent = { id: string; name: string };
export type ExternalModel = { id: string; name: string; description?: string };
export type ExternalReasoning = {
  modelId: string | null;
  value: string | null;
  options: Array<{ id: string; name: string; description?: string }>;
};
export type ExternalSelection = { agentId: string; agentName: string; modelId?: string; modelName?: string };
export type ExternalResult = { text: string; stopReason?: string; modelId?: string | null; modelName?: string | null; reasoningEffort?: string; reasoningName?: string; projectProposals?: FileProposal[]; usage?: ReplyUsage; contextUsage?: ContextUsage; recommendations?: DshRecommendation[] };

type TestApprovalDetails = { kind?: 'test'; presetName?: string; executable: string; args: string[]; cwd: string };
type PowerShellApprovalDetails = { kind: 'powershell'; command: string; cwd: string; timeoutSeconds: number };
export type DevelopmentApprovalDetails = TestApprovalDetails | PowerShellApprovalDetails;

export type AcpPermission = {
  requestId: string; title: string; kind: string; expiresAt?: number;
  details?: DevelopmentApprovalDetails;
  options: Array<{ id: string; name: string; kind: 'allow_once' | 'reject_once' }>;
};

type MainChatBridge = {
  list(): Promise<ExternalAgent[]>;
  listDelegationAgents?(): Promise<ExternalAgent[]>;
  runDelegation?(request: { agentId: string; conversationId: string; requestId: string; task: string; context?: string }): Promise<{ text: string; agentName: string }>;
  cancelDelegation?(conversationId: string, requestId: string): Promise<void>;
  companyRuntime?(modelId?: string): Promise<{ agentId: string } | null>;
  discoverModels(id: string, modelId?: string): Promise<{ agentId: string; modelId: string | null; models: ExternalModel[]; reasoning?: ExternalReasoning }>;
  promptConversation(request: { agentId: string; conversationId: string; turnId: string; modelId?: string; reasoningEffort?: string }): Promise<ExternalResult>;
  cancelConversation(conversationId: string): Promise<void>;
  resetConversation(conversationId: string): Promise<void>;
  respondPermission?(conversationId: string, requestId: string, optionId: string | null): Promise<void>;
  onUpdate(listener: (event: { agentId: string; conversationId?: string; text: string; contextUsage?: ContextUsage; acpActivityTruncated?: boolean; acpTool?: ExecutionStep; acpPlan?: { entries: ExecutionPlanItem[] }; acpPermission?: AcpPermission; acpPermissionClosed?: { requestId: string }; toolProgress?: { callId?: string; traceId?: string; name: string; status: 'running' | 'complete' | 'error'; message?: string; taskId?: string } }) => void): () => void;
};

export function mainChatBridge(): MainChatBridge | undefined {
  const bridge = (window as Window & { vvmanAcp?: Partial<MainChatBridge> }).vvmanAcp;
  return bridge?.discoverModels && bridge.promptConversation && bridge.cancelConversation && bridge.resetConversation ? bridge as MainChatBridge : undefined;
}
