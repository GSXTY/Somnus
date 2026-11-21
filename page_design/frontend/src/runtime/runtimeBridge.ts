import type { AcpPermission, DshAnswers, DshQuestion } from '../chat/assistantAcp';
import type { RuntimeTask } from './runtimeTasks';
export type RuntimeTaskRoute = { conversationId: string; taskId: string; agentId: string; runtime: string };
export type RuntimeCapabilityDescriptor = { runtime: string; identity: string; capabilities: Record<string, string> };
export type RuntimeInteractions = { permission?: AcpPermission; question?: DshQuestion };
declare global { interface Window { somnusRuntime?: {
 diagnostics?():Promise<unknown>;
 uiPreferences?():Promise<import('../configuration/uiPreferences').UiPreferences|null>;
 saveUiPreferences?(value:import('../configuration/uiPreferences').UiPreferences):Promise<import('../configuration/uiPreferences').UiPreferences>;
 setAppearance?(value: {theme:'light'|'dark'|'system'}): Promise<import('./useAppearance').Appearance>;
 onAppearance?(listener:(value:import('./useAppearance').Appearance)=>void):()=>void;
 settings?(): Promise<import('./RuntimeSettings').RuntimeSettingsValue>;
 setSettings?(value: import('./RuntimeSettings').RuntimeSettingsValue): Promise<import('./RuntimeSettings').RuntimeSettingsValue>;
 capabilities(input: { runtime: string; agentId?: string }): Promise<RuntimeCapabilityDescriptor>;
 cancelTask(route: RuntimeTaskRoute): Promise<unknown>;
 interactions(route: RuntimeTaskRoute): Promise<RuntimeInteractions>;
 respondPermission(route: RuntimeTaskRoute, requestId: string, optionId: string | null): Promise<void>;
 respondQuestion(route: RuntimeTaskRoute, requestId: string, answers: DshAnswers | null): Promise<void>;
} } }
export const taskRoute = (task: RuntimeTask): RuntimeTaskRoute => ({ conversationId: task.conversation_id, taskId: task.id, agentId: task.agent_id, runtime: task.runtime });
