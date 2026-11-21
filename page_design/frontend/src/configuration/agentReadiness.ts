export type AgentReadiness = {
  id: string;
  state: 'ready' | 'required' | 'unverified' | 'error';
  checkedAt: number | null;
  models: { id: string; name: string }[];
};

export function agentReadinessLabel(value?: AgentReadiness): string {
  return value?.state === 'ready' ? '已连接' : value?.state === 'required' ? '待登录' :
    value?.state === 'error' ? '不可用' : '已保存 · 未验证';
}
