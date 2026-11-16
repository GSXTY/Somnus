import { useState } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import type { AcpPermission } from './assistantAcp';
import type { ChatMessage, ExecutionStep, ExecutionSummary } from './assistantApi';

const stateLabels = { pending: '等待中', in_progress: '运行中', completed: '已完成', failed: '失败' };
const replyLabels = {
  streaming: { label: '回复中', color: 'processing' },
  complete: { label: '回复完成', color: 'success' },
  error: { label: '回复失败', color: 'error' },
  cancelled: { label: '回复已停止', color: 'default' },
};

function legacyLocalStep(step: ExecutionStep) {
  if (step.kind !== 'tool' || !/^local-call-call-\d+$/.test(step.id)) return step;
  const [name, ...reason] = step.title.split(' · ');
  return step.status === 'failed' && reason.length > 0
    ? { ...step, title: name, failure_reason: step.failure_reason || reason.join(' · ') } : step;
}

export function normalizeExecutionSteps(steps: ExecutionStep[]): ExecutionStep[] {
  const visible: ExecutionStep[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const next = steps[index + 1];
    // Historical entries lack a shared call ID. Only merge adjacent DSH and
    // bridge records when their terminal state, name and elapsed time agree.
    if (step.kind === 'other' && /^call_/.test(step.id) && next?.kind === 'tool' &&
        /^local-call-call-\d+$/.test(next.id) && (step.status === 'completed' || step.status === 'failed') &&
        step.status === next.status && typeof step.duration_ms === 'number' &&
        typeof next.duration_ms === 'number' && Math.abs(step.duration_ms - next.duration_ms) <= 100) {
      const local = legacyLocalStep(next);
      if (step.title === 'mcp__vv_man__' + local.title) {
        visible.push({ ...local, failure_reason: local.failure_reason || step.failure_reason });
        index++;
        continue;
      }
    }
    visible.push(legacyLocalStep(step));
  }
  return visible;
}

export function ExecutionDetails({ execution, replyStatus }: { execution: ExecutionSummary; replyStatus: ChatMessage['status'] }) {
  if (!execution.steps.length && !execution.plan.length && !execution.truncated) return null;
  const steps = normalizeExecutionSteps(execution.steps);
  const succeeded = steps.filter(step => step.status === 'completed').length;
  const failed = steps.filter(step => step.status === 'failed').length;
  const unknown = steps.length - succeeded - failed;
  const reply = replyLabels[replyStatus];
  return <details className="assistant-execution assistant-task-card">
    <summary><span>执行过程{steps.length ? ' · ' + steps.length + ' 项操作' : ''}
      {execution.truncated ? ' · 部分活动已省略' : ''}</span>
      <Tag color={reply.color}>{reply.label}</Tag>
    </summary>
    {steps.length > 0 && <div className="assistant-execution-counts">
      <span>成功 {succeeded}</span>
      <span>失败 {failed}</span>
      {unknown > 0 && <span>未完成 {unknown}</span>}
    </div>}
    {execution.plan.length > 0 && <section aria-label="计划">
      <strong>计划</strong>
      <ul>{execution.plan.map((entry, index) => <li key={index}>{entry.content} <Tag>{stateLabels[entry.status]}</Tag></li>)}</ul>
    </section>}
    {steps.length > 0 && <ol>{steps.map(step => <li key={step.id}>
      <span>{step.title}</span> <Tag color={step.status === 'failed' ? 'error' : undefined}>{stateLabels[step.status]}</Tag>
      {typeof step.duration_ms === 'number' && <small>{(step.duration_ms / 1000).toFixed(1)} 秒</small>}
      {step.status === 'failed' && <small className="assistant-execution-reason">
        {step.failure_reason || '未记录具体原因'}
      </small>}
    </li>)}</ol>}
  </details>;
}

export function ActionApproval({ request, onRespond }: {
  request: AcpPermission;
  onRespond: (optionId: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function respond(optionId: string | null) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await onRespond(optionId); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '未能提交授权'); }
    finally { setBusy(false); }
  }
  const allow = request.options.find(option => option.kind === 'allow_once');
  const reject = request.options.find(option => option.kind === 'reject_once');
  const testRequest = request.kind === 'test';
  const shellRequest = request.kind === 'powershell';
  const testDetails = testRequest && request.details?.kind !== 'powershell' ? request.details : undefined;
  const shellDetails = shellRequest && request.details?.kind === 'powershell' ? request.details : undefined;
  const commandRequest = testRequest || shellRequest;
  const heading = shellRequest ? '确认运行 PowerShell' : testRequest ? '确认运行项目测试' :
    request.kind === 'mcp' ? '确认 MCP 调用' : '确认 Agent 操作';
  return <section className="assistant-action-approval" aria-label={heading}>
    <strong>{heading}</strong>
    <p>{request.title}</p>
    {shellRequest ? <>
      {shellDetails ? <dl className="project-test-result">
        <div><dt>命令</dt><dd><pre className="assistant-command-preview" tabIndex={0}>{shellDetails.command}</pre></dd></div>
        <div><dt>工作目录</dt><dd><code>{shellDetails.cwd}</code></dd></div>
        <div><dt>超时</dt><dd>{shellDetails.timeoutSeconds} 秒</dd></div>
      </dl> : <p>未收到完整命令详情。</p>}
      <p>此命令以当前 Windows 用户的权限运行。</p>
    </> : testRequest ? <>
      {testDetails ? <dl className="project-test-result">
        {testDetails.presetName && <div><dt>测试预设</dt><dd>{testDetails.presetName}</dd></div>}
        <div><dt>命令</dt><dd><code>{[testDetails.executable, ...testDetails.args].map(value => JSON.stringify(value)).join(' ')}</code></dd></div>
        <div><dt>工作目录</dt><dd><code>{testDetails.cwd}</code></dd></div>
      </dl> : <p>未收到完整测试命令和工作目录。</p>}
      <p>测试以当前 Windows 用户的权限在此目录中运行。</p>
    </> : <p>{request.kind === 'mcp' ? '批准后，这个工具会按本次请求执行。' : '操作在 Agent 的临时工作区执行。写回项目文件仍需另行审阅。'}</p>}
    <Space>
      <Button disabled={busy} onClick={() => void respond(reject?.id || null)}>{commandRequest ? '取消' : '拒绝'}</Button>
      {allow && (!commandRequest || testDetails || shellDetails) && <Button type="primary" disabled={busy}
        onClick={() => void respond(allow.id)}>{commandRequest ? '继续' : '仅允许本次'}</Button>}
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
  </section>;
}
