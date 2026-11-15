import { useState } from 'react';
import { Alert, Button, Select, Space } from 'antd';
import type { DelegationAgent, DelegationResponse, DelegationResult } from './assistantApi';

export type PendingDelegation = {
  id: string;
  agentId: string;
  task: string;
  context?: string;
  agents: DelegationAgent[];
  running?: boolean;
  reporting?: boolean;
  response?: DelegationResponse;
  error?: string;
};

export function DelegationReview({ request, stopping, onRespond }: {
  request: PendingDelegation;
  stopping: boolean;
  onRespond: (agentId: string | null) => void;
}) {
  const [agentId, setAgentId] = useState(request.agentId);
  const active = request.running || request.reporting;
  const name = request.agents.find(agent => agent.id === (active ? request.agentId : agentId))?.name;
  return <section className="assistant-action-approval assistant-delegation" aria-label="子任务委派">
    <strong>{active ? '子任务进行中' : '确认委派子任务'}</strong>
    {active ? <p role="status">{request.reporting ? '正在提交委派状态…' : (name || '外接 Agent') + ' 正在处理…'}</p> : request.response ?
      <Button disabled={stopping} onClick={() => onRespond(null)}>重试提交</Button> : <>
      <p>确认后会将下方文字发送给所选 Agent。</p>
      <Select aria-label="接收子任务的 Agent" value={agentId} onChange={setAgentId} disabled={stopping}
        options={request.agents.map(agent => ({ value: agent.id, label: agent.name }))} />
      <div className="assistant-delegation-preview">
        <strong>任务</strong><pre>{request.task}</pre>
        {request.context && <><strong>附带数据</strong><pre>{request.context}</pre></>}
      </div>
      <Space wrap>
        <Button disabled={stopping} onClick={() => onRespond(null)}>拒绝委派</Button>
        <Button type="primary" disabled={stopping || !name} onClick={() => onRespond(agentId)}>确认委派</Button>
      </Space>
    </>}
    {request.error && <Alert type="error" showIcon message={request.error} />}
  </section>;
}

const resultLabels: Record<DelegationResult['status'], string> = {
  complete: '已完成', declined: '已拒绝', error: '执行失败', expired: '已超时',
};

export function DelegationOutcome({ result }: { result: DelegationResult }) {
  const label = '子任务 · ' + result.agent_name + ' · ' + resultLabels[result.status];
  return result.result ? <details className="assistant-execution assistant-delegation-result">
    <summary>{label}</summary>
    <pre>{result.result}</pre>
  </details> : <div className="assistant-reply-metadata">{label}</div>;
}
