import { useChildAssociation } from '../runtime/useChildAssociation';
import { childAssociationLabels } from '../runtime/childAssociationModel.mjs';
import { ChildConversationPane } from '../runtime/ChildConversationPane';
import { useUiPreferences } from '../configuration/uiPreferences';
import { useEffect, useState } from 'react';
import { ApartmentOutlined, BulbOutlined, CodeOutlined, DownOutlined, EditOutlined, FileTextOutlined, SafetyOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, Drawer, Space, Spin } from 'antd';
import type { AcpPermission, AcpStage, DshAnswers, DshQuestion, DshSubagentDetail, DshSubagentEntry, DshSubagentToolDetail } from './assistantAcp';
import { Markdown } from '../shared/MarkdownView';
import type { ChatMessage, ExecutionStep, ExecutionSummary } from './assistantApi';

const stateLabels = { pending: '等待中', in_progress: '运行中', completed: '已完成', failed: '失败' };
const replyLabels = {
  streaming: '回复中',
  complete: '回复完成',
  error: '回复失败',
  cancelled: '回复已停止',
};
const stageLabels: Record<AcpStage, string> = {
  preparing: '准备会话',
  connecting: '连接 Agent',
  working: '处理任务',
  thinking: '正在思考',
  responding: '正在生成回复',
};

const stepKinds = {
  subagent: { label: '子 Agent', icon: ApartmentOutlined },
  execute: { label: '命令', icon: CodeOutlined },
  read: { label: '读取', icon: FileTextOutlined },
  edit: { label: '编辑', icon: EditOutlined },
  fetch: { label: '获取', icon: FileTextOutlined },
  search: { label: '搜索', icon: SearchOutlined },
};

function elapsedLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

function useElapsed(startedAt: number | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt === undefined ? undefined : Math.max(0, now - startedAt);
}

function operationTitle(title: string) {
  return title.replace(/^mcp__vv_man__/, '');
}

type ExecutionNode = { step: ExecutionStep; children: ExecutionNode[] };
type SubagentReader = (step: ExecutionStep) => void;

function executionTree(steps: ExecutionStep[]) {
  const nodes = new Map(steps.map(step => [step.id, { step, children: [] } as ExecutionNode]));
  const roots: ExecutionNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.step.parent_id;
    let ancestor = parentId;
    const seen = new Set([node.step.id]);
    while (ancestor && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = nodes.get(ancestor)?.step.parent_id;
    }
    const parent = !ancestor && parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function ExecutionRows({ nodes, onRead }: { nodes: ExecutionNode[]; onRead?: SubagentReader }) {
  return <ol className="assistant-execution-operations">
    {nodes.map(node => <ExecutionRow key={node.step.id} node={node} onRead={onRead} />)}
  </ol>;
}

function ExecutionRow({ node: { step, children }, onRead }: { node: ExecutionNode; onRead?: SubagentReader }) {
  const kind = Object.hasOwn(stepKinds, step.kind) ? stepKinds[step.kind as keyof typeof stepKinds] : undefined;
  const Icon = kind?.icon || ToolOutlined;
  const title = operationTitle(step.title);
  const outcome = step.status === 'completed' ? undefined : stateLabels[step.status];
  return <li>
    <details className="assistant-execution-operation" data-status={step.status}>
      <summary title={title}>
        <Icon aria-hidden="true" />
        {kind && <span className="assistant-execution-kind">{kind.label}</span>}
        <span className="assistant-execution-operation-title">{title}</span>
        {outcome && <span className="assistant-execution-outcome">{outcome}</span>}
        <DownOutlined className="assistant-execution-chevron" aria-hidden="true" />
      </summary>
      <div className="assistant-execution-operation-detail">
        <div>{title}</div>
        <small>{stateLabels[step.status]}{typeof step.duration_ms === 'number' &&
          ` · ${(step.duration_ms / 1000).toFixed(1)} 秒`}</small>
        {step.status === 'failed' && <small className="assistant-execution-reason">{step.failure_reason || '未记录具体原因'}</small>}
        {step.kind === 'subagent' && onRead && <Button type="link" size="small" onClick={() => onRead(step)}>查看子任务</Button>}
      </div>
    </details>
    {children.length > 0 && <ExecutionRows nodes={children} onRead={onRead} />}
  </li>;
}

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

export function ExecutionDetails({ execution, replyStatus, stage, startedAt, elapsedMs, nativeTurn, autoExpand = false, onExpandedChange }: {
  execution?: ExecutionSummary;
  replyStatus: ChatMessage['status'];
  stage?: AcpStage;
  startedAt?: number;
  elapsedMs?: number;
  nativeTurn?: { conversationId: string; turnId: string };
  autoExpand?: boolean;
  onExpandedChange?: (expanded:boolean)=>void;
}) {
  const [uiPreferences] = useUiPreferences();
  const [detailStep, setDetailStep] = useState<ExecutionStep>();
  const [expanded, setExpanded] = useState(() => autoExpand && replyStatus === 'streaming');
  useEffect(()=>onExpandedChange?.(expanded),[expanded]);
  const live = replyStatus === 'streaming';
  useEffect(() => { if (!live && uiPreferences.collapse === 'finished') setExpanded(false); }, [live,uiPreferences.collapse]);
  const liveElapsed = useElapsed(live ? startedAt : undefined);
  const plan = execution?.plan ?? [];
  const steps = normalizeExecutionSteps(execution?.steps ?? []);
  if (!live && !steps.length && !plan.length && !execution?.truncated) return null;
  const succeeded = steps.filter(step => step.status === 'completed').length;
  const failed = steps.filter(step => step.status === 'failed').length;
  const unknown = steps.length - succeeded - failed;
  const activeStep = live ? steps.find(step => step.status === 'in_progress') : undefined;
  const status = activeStep ? '正在执行' : live && stage ? stageLabels[stage] : replyLabels[replyStatus];
  const elapsed = live ? liveElapsed : elapsedMs;
  const currentDetail = detailStep && (steps.find(step => step.id === detailStep.id) || detailStep);
  return <><details className="assistant-execution" open={expanded || undefined}
    onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="assistant-execution-heading">
      <DownOutlined className="assistant-execution-chevron" aria-hidden="true" />
      <span className="assistant-execution-heading-main">
        {status}{activeStep && <span className="assistant-execution-heading-step"> · {operationTitle(activeStep.title)}</span>}
      </span>
      {elapsed !== undefined && <span className="assistant-execution-time" aria-live="off">{elapsedLabel(elapsed)}</span>}
      {!live && steps.length > 0 && <span className="assistant-execution-total">{steps.length} 项操作</span>}
    </summary>
    {!live && steps.length > 0 && <div className="assistant-execution-counts">
      <span>成功 {succeeded}</span>
      <span>失败 {failed}</span>
      {unknown > 0 && <span>未完成 {unknown}</span>}
    </div>}
    {plan.length > 0 && <section className="assistant-execution-plan" aria-label="计划">
      <ul>{plan.map((entry, index) => <li key={index}><BulbOutlined aria-hidden="true" />
        <span>{entry.content}</span><small>{stateLabels[entry.status]}</small></li>)}</ul>
    </section>}
    {steps.length > 0 && <ExecutionRows nodes={executionTree(uiPreferences.detail === 'compact' && live ? steps.filter(step => step.status === 'in_progress' || step.status === 'failed').slice(-5) : steps)} onRead={nativeTurn ? setDetailStep : undefined} />}
    {execution?.truncated && <small>部分活动已省略</small>}
  </details>{currentDetail && nativeTurn && <SubagentDetail key={currentDetail.id} scope={nativeTurn}
    step={currentDetail} onClose={() => setDetailStep(undefined)} />}</>;
}

function SubagentToolDetails({ scope, seq }: {
  scope: { conversationId: string; turnId: string; subagentId: string }; seq: number;
}) {
  const [pages, setPages] = useState<DshSubagentToolDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [empty, setEmpty] = useState(false);
  const read = window.somnusNativeDshChat?.subagentToolDetail;
  if (!read) return null;
  async function load(offset?: number) {
    if (loading || !read) return;
    setLoading(true);
    setError('');
    try {
      const result = await read({ ...scope, seq, offset });
      if (result) setPages(current => offset === undefined ? [result] : [...current, result]);
      else setEmpty(true);
    } catch { setError('无法读取这次工具调用的详细记录。'); }
    finally { setLoading(false); }
  }
  const cursor = pages.at(-1)?.nextOffset;
  const asText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <details className="assistant-subagent-tool-details" onToggle={event => {
    if (event.currentTarget.open && !pages.length && !empty) void load();
  }}>
    <summary>查看参数和输出</summary>
    {error && <Alert type="error" showIcon message={error} />}
    {loading && <Spin size="small" />}
    {empty && <p>此工具未提供可显示的参数或输出。</p>}
    {!!pages.length && pages.every(page => page.arguments === undefined && page.output === undefined) && !loading &&
      <p>此工具未提供可显示的参数或输出。</p>}
    {pages.map((page, index) => <div key={index}>
      {page.arguments !== undefined && <><small>输入参数</small><pre tabIndex={0}>{asText(page.arguments)}</pre></>}
      {page.output !== undefined && <><small>输出</small><pre tabIndex={0}>{asText(page.output)}</pre></>}
    </div>)}
    {cursor !== undefined && <Button size="small" loading={loading} onClick={() => void load(cursor)}>加载更多</Button>}
    {cursor === undefined && pages.at(-1)?.truncated && <p>部分内容已省略。</p>}
  </details>;
}

export function SubagentDetail({ scope, step, onClose }: {
  scope: { conversationId: string; turnId: string }; step: ExecutionStep; onClose: () => void;
}) {
  const [detail, setDetail] = useState<DshSubagentDetail | null>();
  const association=useChildAssociation(scope,step.id);
  const linked=association.link?.can_open&&association.link.conversation_id ? association.link : undefined;
  const [older, setOlder] = useState<DshSubagentEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>();
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState('');
  const running = step.status === 'in_progress' || step.status === 'pending';
  useEffect(() => {
    const read = window.somnusNativeDshChat?.subagentDetail;
    if (!read) {
      setError('当前桌面连接无法读取子任务。');
      return;
    }
    let active = true;
    let timer: number | undefined;
    async function refresh() {
      try {
        const value = await read!({ conversationId: scope.conversationId, turnId: scope.turnId, subagentId: step.id });
        if (active) { setDetail(value); setError(''); }
      } catch {
        if (active) setError('暂时无法读取子任务详情。');
      } finally {
        if (active && running) timer = window.setTimeout(() => void refresh(), 2000);
      }
    }
    void refresh();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [scope.conversationId, scope.turnId, step.id, running]);
  const beforeSeq = cursor === undefined ? detail?.nextBeforeSeq : cursor;
  async function loadOlder() {
    const read = window.somnusNativeDshChat?.subagentDetail;
    if (!read || !beforeSeq || pageLoading) return;
    setPageLoading(true);
    setError('');
    try {
      const page = await read({ ...scope, subagentId: step.id, beforeSeq });
      if (page) {
        setOlder(current => [...current, ...(page.entries || [])]);
        setCursor(page.nextBeforeSeq ?? null);
      }
    } catch { setError('无法读取更早的子任务记录。'); }
    finally { setPageLoading(false); }
  }
  const timeline = [...new Map([...older, ...(detail?.entries || [])].map(entry => [entry.seq, entry])).values()]
    .sort((first, second) => first.seq - second.seq);
  const tools = { running: '运行中', completed: '已完成', failed: '失败' };
  return <Drawer open aria-label={detail?.title || step.title} width="min(680px, calc(100vw - 32px))" title={detail?.title || step.title} onClose={onClose} className="subagent-conversation-drawer" extra={<Button aria-label="关闭" onClick={onClose}>关闭</Button>}>
    {association.phase==='loading'&&<p role="status"><Spin size="small"/> 正在验证独立子会话关联…</p>}
    {association.error&&<Alert type="warning" showIcon message={association.error} description="未使用本地缓存授权，也不会自动新建分支。" action={<Button size="small" onClick={()=>void association.refresh()}>重新验证</Button>}/>}
    {association.link&&association.link.status!=='linked'&&<Alert type={association.link.status==='none'?'info':'warning'} message={childAssociationLabels[association.link.status]} action={<Button size="small" onClick={()=>void association.refresh()}>刷新状态</Button>}/>}
    {linked ? <ChildConversationPane key={linked.conversation_id!} id={linked.conversation_id!} continuation={linked.continuation} canSend={association.phase==='ready'&&linked.can_send} canOpenMain={association.phase==='ready'&&linked.can_open} onOpenMain={()=>{window.dispatchEvent(new CustomEvent('somnus:open-conversation',{detail:{conversationId:linked.conversation_id}}));onClose();}}/> : <>
    <div className="subagent-fork-action"><p>此处查看父任务正在使用的子会话；继续发言会创建独立分支并重新授权。</p><Button disabled={!association.canCreate} loading={association.forking} onClick={()=>void association.create()}>在独立会话继续</Button></div>
    <p role="status">{stateLabels[step.status]}</p>
    {error && <Alert type="error" showIcon message={error} />}
    {detail === undefined && !error && <Spin size="small" />}
    {detail === null && <p>暂无单独保存的子任务回复。可在执行过程查看已记录的操作。</p>}
    {beforeSeq != null && <Button size="small" loading={pageLoading} onClick={() => void loadOlder()}>加载更早记录</Button>}
    {timeline.length ? <ol className="assistant-subagent-timeline" aria-label="子任务回复和工具调用">
      {timeline.map(entry => <li key={entry.seq}>{entry.type === 'message' ?
        <><small>{entry.role === 'user' ? '任务输入' : '子 Agent 回复'}</small><Markdown text={entry.text} /></> :
        <><ToolOutlined aria-hidden="true" /> <strong>{entry.name}</strong> <small>{tools[entry.status]}</small>
          {entry.details?.target && <div><code>{entry.details.target}</code></div>}
          {entry.details?.durationMs !== undefined && <small>耗时 {elapsedLabel(entry.details.durationMs)}</small>}
          {entry.details?.exitCode !== undefined && <small> · 退出码 {entry.details.exitCode}</small>}
          {entry.reason && <p>{entry.reason}</p>}
          <SubagentToolDetails scope={{ ...scope, subagentId: step.id }} seq={entry.seq} /></>}</li>)}
    </ol> : detail?.messages.map((message, index) =>
      <div className="assistant-subagent-message" key={index}><Markdown text={message.text} /></div>)}
    {detail?.messages.length === 0 && !timeline.length && <p>{running ? '子任务还未返回内容。' : '此子任务没有可显示的回复。'}</p>}
    {detail?.truncated && <small>部分内容已省略</small>}
    </>}
  </Drawer>;
}

export function ActionApproval({ request, onRespond, disabled = false }: {
  request: AcpPermission;
  disabled?: boolean;
  onRespond: (optionId: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function respond(optionId: string | null) {
    if (busy || disabled) return;
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
  const testDetails = testRequest && request.details?.kind !== 'powershell' && request.details?.kind !== 'native_tool' ? request.details : undefined;
  const nativeDetails = request.details?.kind === 'native_tool' ? request.details : undefined;
  const shellDetails = shellRequest && request.details?.kind === 'powershell' ? request.details : undefined;
  const shellScope = shellDetails?.sandboxMode === 'workspace-write' ? '仅工作区内可写' :
    shellDetails?.sandboxMode === 'danger-full-access' ? '完全访问' : undefined;
  const commandRequest = testRequest || shellRequest;
  const heading = shellRequest ? '确认运行 PowerShell' : testRequest ? '确认运行项目测试' :
    request.kind === 'mcp' ? '确认 MCP 调用' : nativeDetails ? '确认工具操作' : '确认 Agent 操作';
  return <section className="assistant-action-approval assistant-permission-card" aria-label={heading}>
    <header className="assistant-permission-heading">
      <span className="assistant-permission-symbol" aria-hidden="true">{commandRequest ? <CodeOutlined /> : <SafetyOutlined />}</span>
      <strong>{heading}</strong>
      <small>等你确认</small>
    </header>
    <p>{request.title}</p>
    {nativeDetails ? <dl className="project-test-result">
      <div><dt>工具</dt><dd><code>{nativeDetails.toolName}</code></dd></div>
      <div><dt>原因</dt><dd>{nativeDetails.reason}</dd></div>
      {nativeDetails.argumentsPreview && <div><dt>本次操作</dt><dd><pre className="assistant-command-preview" tabIndex={0}>{nativeDetails.argumentsPreview}</pre></dd></div>}
      <div><dt>授权范围</dt><dd>仅允许本次操作；不会改变会话权限。</dd></div>
    </dl> : shellRequest ? <>
      {shellDetails ? <dl className="project-test-result">
        <div><dt>命令</dt><dd><pre className="assistant-command-preview" tabIndex={0}>{shellDetails.command}</pre></dd></div>
        <div><dt>工作目录</dt><dd><code>{shellDetails.cwd}</code></dd></div>
        <div><dt>超时</dt><dd>{shellDetails.timeoutSeconds} 秒</dd></div>
        {shellScope && <div><dt>访问范围</dt><dd>{shellScope}</dd></div>}
      </dl> : <p>未收到完整命令详情。</p>}
      {!shellScope && <p>此命令以当前 Windows 用户的权限运行。</p>}
    </> : testRequest ? <>
      {testDetails ? <dl className="project-test-result">
        {testDetails.presetName && <div><dt>测试预设</dt><dd>{testDetails.presetName}</dd></div>}
        <div><dt>命令</dt><dd><code>{[testDetails.executable, ...testDetails.args].map(value => JSON.stringify(value)).join(' ')}</code></dd></div>
        <div><dt>工作目录</dt><dd><code>{testDetails.cwd}</code></dd></div>
      </dl> : <p>未收到完整测试命令和工作目录。</p>}
      <p>测试以当前 Windows 用户的权限在此目录中运行。</p>
    </> : <p>{request.kind === 'mcp' ? '批准后，这个工具会按本次请求执行。' : '操作在 Agent 的临时工作区执行。写回项目文件仍需另行审阅。'}</p>}
    <Space className="assistant-permission-actions" wrap>
      <Button disabled={busy || disabled} onClick={() => void respond(reject?.id || null)}>{commandRequest ? '取消' : '拒绝'}</Button>
      {allow && (!commandRequest || testDetails || shellDetails) && <Button type="primary" disabled={busy || disabled}
        onClick={() => void respond(allow.id)}>{commandRequest ? '继续' : '仅允许本次'}</Button>}
    </Space>
    {disabled && <p>任务状态尚未确认，确认连接后才能提交操作。</p>}
    {error && <Alert type="error" showIcon message={error} />}
  </section>;
}

export function AgentQuestions({ request, initialAnswers, onDraftChange, onHold, submittingDisabled, onRespond, recovered }: {
  request: DshQuestion;
  initialAnswers?: DshAnswers;
  onDraftChange?: (answers: DshAnswers) => void;
  onHold?: (held: boolean) => Promise<void>;
  submittingDisabled?: boolean;
  recovered?: boolean;
  onRespond: (answers: DshAnswers | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => Object.fromEntries(initialAnswers?.map(answer => [answer.id, {
    selected: answer.selected, custom: answer.custom || '',
  }]) || []));
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answers = request.questions.map(({ id }) => ({
    id, selected: draft[id]?.selected ?? [], custom: draft[id]?.custom.trim() || undefined,
  }));
  const ready = answers.some(answer => answer.selected.length || answer.custom);
  const planReview = request.questions.length === 1 && request.questions[0].intent?.kind === 'plan-review'
    ? request.questions[0] : undefined;
  const held = request.remainingMs !== undefined;
  const continued = request.phase === 'continued';
  const remaining = request.remainingMs ?? (request.expiresAt === undefined ? undefined : Math.max(0, request.expiresAt - now));
  useEffect(() => {
    if (continued || held || request.expiresAt === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [continued, held, request.expiresAt]);
  function changeAnswer(id: string, selected: string[], custom: string) {
    const next = { ...draft, [id]: { selected, custom } };
    setDraft(next);
    onDraftChange?.(request.questions.map(question => ({
      id: question.id, selected: next[question.id]?.selected ?? [], custom: next[question.id]?.custom,
    })));
  }
  async function submit(value: DshAnswers | null) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await onRespond(value); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '未能提交回答'); }
    finally { setBusy(false); }
  }
  const title = planReview ? '审阅执行计划' : 'Agent 需要你的回答';
  return <section className="assistant-action-approval assistant-agent-questions" aria-label={title}>
    <strong>{title}</strong>
    {recovered && <small role="status">{continued ? '已恢复之前未回答的提问。提交补答后会继续任务。' : '已恢复之前未回答的提问。'}</small>}
    {continued ? <p role="status">Agent 已继续处理。你仍可以补充回答。</p> :
      remaining !== undefined && <p>{held ? '等待已暂停 · ' : '将在倒计时结束后继续 · '}
        <span aria-live="off">{elapsedLabel(remaining)}</span></p>}
    {request.questions.map(({ id, question, detail, header, options, multiSelect }) => {
      const answer = draft[id] ?? { selected: [], custom: '' };
      return <fieldset key={id} disabled={busy}>
        <legend>{header ? `${header} · ${question}` : question}</legend>
        {detail && <p>{detail}</p>}
        {options?.map(({ label, description }) => <label className="assistant-question-choice" key={label}>
          <input type={multiSelect ? 'checkbox' : 'radio'} name={`${request.requestId}-${id}`}
            checked={answer.selected.includes(label)} onChange={event => {
              const selected = multiSelect
                ? event.target.checked ? [...answer.selected, label] : answer.selected.filter(item => item !== label)
                : [label];
              changeAnswer(id, selected, multiSelect ? answer.custom : '');
            }} />
          <span>{label}{description && <small>{description}</small>}</span>
        </label>)}
        <Input value={answer.custom} maxLength={2000} placeholder={options?.length ? '填写其他回答' : '输入回答'}
          aria-label={question} onChange={event => {
            const custom = event.target.value;
            changeAnswer(id, !multiSelect && custom ? [] : answer.selected, custom);
          }} />
      </fieldset>;
    })}
    <Space>
      <Button disabled={busy} onClick={() => void submit(null)}>跳过</Button>
      {onHold && remaining !== undefined && !continued && <Button disabled={busy} onClick={() => {
        setError('');
        void onHold(!held).catch(() => setError('无法调整等待时间'));
      }}>{held ? '继续倒计时' : '暂停倒计时'}</Button>}
      {planReview && !continued && <Button type="primary" loading={busy} disabled={submittingDisabled}
        onClick={() => void submit([{ id: planReview.id, selected: [planReview.intent!.approve] }])}>批准计划</Button>}
      <Button type={planReview && !continued ? 'default' : 'primary'} loading={busy} disabled={!ready || submittingDisabled} onClick={() => void submit(answers)}>
        {continued ? '补充回答' : '提交回答'}
      </Button>
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
  </section>;
}

