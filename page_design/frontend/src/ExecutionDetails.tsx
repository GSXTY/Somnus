import { useState } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import type { AcpPermission } from './assistantAcp';
import type { ExecutionSummary } from './assistantApi';

const stateLabels = { pending: '等待中', in_progress: '运行中', completed: '已完成', failed: '失败' };

export function ExecutionDetails({ execution }: { execution: ExecutionSummary }) {
  if (!execution.steps.length && !execution.plan.length && !execution.truncated) return null;
  return <details className="assistant-execution">
    <summary>执行过程{execution.steps.length ? ' · ' + execution.steps.length + ' 项操作' : ''}{execution.truncated ? ' · 部分活动已省略' : ''}</summary>
    {execution.plan.length > 0 && <section aria-label="计划">
      <strong>计划</strong>
      <ul>{execution.plan.map((entry, index) => <li key={index}>{entry.content} <Tag>{stateLabels[entry.status]}</Tag></li>)}</ul>
    </section>}
    {execution.steps.length > 0 && <ol>{execution.steps.map(step => <li key={step.id}>
      <span>{step.title}</span> <Tag color={step.status === 'failed' ? 'error' : undefined}>{stateLabels[step.status]}</Tag>
      {typeof step.duration_ms === 'number' && <small>{(step.duration_ms / 1000).toFixed(1)} 秒</small>}
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
  const testDetails = testRequest ? request.details : undefined;
  return <section className="assistant-action-approval" aria-label={testRequest ? '确认运行项目测试' : '待确认的操作'}>
    <strong>{testRequest ? '确认运行项目测试' : request.kind === 'mcp' ? '确认 MCP 调用' : '确认 Agent 操作'}</strong>
    <p>{request.title}</p>
    {testRequest ? <>
      {testDetails ? <dl className="project-test-result">
        {testDetails.presetName && <div><dt>测试预设</dt><dd>{testDetails.presetName}</dd></div>}
        <div><dt>命令</dt><dd><code>{[testDetails.executable, ...testDetails.args].map(value => JSON.stringify(value)).join(' ')}</code></dd></div>
        <div><dt>工作目录</dt><dd><code>{testDetails.cwd}</code></dd></div>
      </dl> : <p>未收到完整测试命令和工作目录。</p>}
      <p>测试以当前 Windows 用户的权限在此目录中运行。</p>
    </> : <p>{request.kind === 'mcp' ? '批准后，这个工具会按本次请求执行。' : '操作在 Agent 的临时工作区执行。写回项目文件仍需另行审阅。'}</p>}
    <Space>
      <Button disabled={busy} onClick={() => void respond(reject?.id || null)}>{testRequest ? '取消' : '拒绝'}</Button>
      {allow && (!testRequest || testDetails) && <Button type="primary" disabled={busy} onClick={() => void respond(allow.id)}>{testRequest ? '继续' : '仅允许本次'}</Button>}
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
  </section>;
}

