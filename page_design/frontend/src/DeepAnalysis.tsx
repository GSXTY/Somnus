import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Empty, Image, Input, Space, Spin, Tag } from 'antd';
import { BarChartOutlined, CheckCircleOutlined, DownloadOutlined, FileTextOutlined, ReloadOutlined, StopOutlined, UploadOutlined } from '@ant-design/icons';
import { activeTaskStates, cancelAnalysisTask, createAnalysisTask, deepStatus, getAnalysisTask, imageArtifact, listAnalysisTasks, safeArtifactUrl, taskLabels, uploadAnalysisFile } from './deepAnalysisApi.mjs';
import type { DataConnection } from './DataConnection';
import { Markdown } from './MarkdownView';
import { formatDateTime } from './format.mjs';
import { describeError } from './errors.mjs';
import './deep-analysis.css';
import './deep-analysis-report.css';

type AnalysisStatus = { configured: boolean; model?: string | null; execution_ready: boolean; execution_reason?: string; docker_available?: boolean; image_ready?: boolean; limits?: Record<string, number>; provider?: string; official_deepanalyze?: boolean };
type DataFile = { id: string; name: string; size: number; sha256: string; row_count: number; columns: string[] };
type Artifact = { id: string; name: string; mime: string; size: number; url: string };
type Task = { id: string; status: keyof typeof taskLabels; question: string; file_id: string; created_at: number | string; updated_at: number | string; error?: string | null; answer?: string; steps?: Array<{ index: number; type: 'code' | 'execute' | 'system'; status: string; content: string }>; artifacts?: Artifact[] };
const preference = 'ya70-deep-analysis-last-task';
const errorText = (value: unknown) => describeError(value, '操作失败，请稍后重试');
const displayTime = (value: number | string) => formatDateTime(value);

export function DeepAnalysis({ dataConnection = { mode: 'local', url: null } }: { dataConnection?: DataConnection } = {}) {
  const [status, setStatus] = useState<AnalysisStatus | null>(null), [checking, setChecking] = useState(true);
  const [file, setFile] = useState<DataFile | null>(null), [question, setQuestion] = useState('');
  const [task, setTask] = useState<Task | null>(null), [recentTasks, setRecentTasks] = useState<Array<{ id: string; status: string; question: string; updated_at: number; artifact_count: number }>>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pollError, setPollError] = useState('');
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), controller = useRef<AbortController>(), operation = useRef(false);
  const remote = dataConnection.mode === 'remote';
  const knownConnection = dataConnection.mode === 'local' || remote;
  const canExecute = status?.configured && status.execution_ready;
  const uploadBlocked = !knownConnection || (remote && (checking || !canExecute));
  const running = Boolean(task && activeTaskStates.has(task.status));
  async function refresh() {
    setChecking(true);
    try { const next = await deepStatus(); if (alive.current) setStatus(next); }
    catch (failure) { if (alive.current) { setStatus(null); setError(errorText(failure)); } }
    finally { if (alive.current) setChecking(false); }
  }
  function commitTask(next: Task) { setTask(next); try { localStorage.setItem(preference, next.id); } catch { /* preference optional */ } }
  const loadRecent = async () => {
    try {
      const items = await listAnalysisTasks();
      if (alive.current) setRecentTasks(items);
    } catch { /* list is optional */ }
  };

  useEffect(() => {
    alive.current = true; void refresh(); void loadRecent();
    const abort = new AbortController();
    const linkedTask = typeof window.location?.hash === 'string' ? /^#deep-analysis\?task=([a-f0-9]{32})$/.exec(window.location.hash)?.[1] : undefined;
    let id: string | null = linkedTask || null;
    if (!id) { try { id = localStorage.getItem(preference); } catch { /* optional */ } }
    if (id) void getAnalysisTask(id, abort.signal).then((next: Task) => { if (alive.current) setTask(next); }).catch(failure => { if (linkedTask && alive.current && !abort.signal.aborted) setError('无法打开此深度分析任务：' + errorText(failure)); });
    return () => { alive.current = false; abort.abort(); controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!task || !activeTaskStates.has(task.status)) return;
    const id = task.id, abort = new AbortController(); let timer: number | undefined;
    const poll = async () => {
      try { const next = await getAnalysisTask(id, abort.signal); if (!abort.signal.aborted && alive.current) { setTask(next); setPollError(''); if (activeTaskStates.has(next.status)) timer = window.setTimeout(poll, 1500); } }
      catch (failure) { if (!abort.signal.aborted && alive.current) { setPollError(errorText(failure)); timer = window.setTimeout(poll, 4000); } }
    };
    timer = window.setTimeout(poll, 1000);
    return () => { abort.abort(); window.clearTimeout(timer); };
  }, [task?.id, task?.status]);
  async function upload(selected: File | undefined) {
    if (!selected || operation.current || running || uploadBlocked) return;
    const maximum = status?.limits?.max_file_bytes || 5 * 1024 * 1024;
    if (selected.size > maximum) { setError(`CSV超过大小限制（${Math.round(maximum / 1024 / 1024)}MB）`); return; }
    operation.current = true; setBusy(true); setError(''); const abort = new AbortController(); controller.current = abort;
    try { const result = await uploadAnalysisFile(selected, abort.signal); if (alive.current) { setFile(result); setTask(null); try { localStorage.removeItem(preference); } catch { /* optional preference */ } } }
    catch (failure) { if (alive.current && !abort.signal.aborted) setError(errorText(failure)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function start() {
    if (!file || !question.trim() || operation.current || running || uploadBlocked) return;
    operation.current = true; setBusy(true); setError(''); setPollError(''); const abort = new AbortController(); controller.current = abort;
    try { const next = await createAnalysisTask(file.id, question, abort.signal); if (alive.current) commitTask(next); }
    catch (failure) { if (alive.current && !abort.signal.aborted) setError(errorText(failure)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function cancel() {
    if (!task || !running || operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { const next = await cancelAnalysisTask(task.id); if (alive.current) commitTask(next); }
    catch (failure) { if (alive.current) setError(errorText(failure)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="deep-analysis-page">
    <div className="deep-heading"><div><div className="breadcrumb">工作台 / 深度分析</div><h1>深度分析 <Tag>{remote ? '远程主机' : '试用'}</Tag></h1><p>独立分析模型 · 选择表格、提出问题，查看执行记录与结果。</p></div><Button icon={<ReloadOutlined spin={checking} />} disabled={checking} onClick={() => void refresh()}>检查运行条件</Button></div>
    {remote && <Alert className="deep-intro" type="info" showIcon
      message="所选文件会上传到远程分析主机"
      description={<span>选择文件后立即上传至 {dataConnection.url || '配置的远程网关'}。创建任务后，分析问题和所需信息会发送至模型服务。</span>} />}
    {!knownConnection && dataConnection.mode !== 'loading' && <Alert className="deep-condition" type="warning" showIcon
      message="无法确认文件传输位置" description="请在设置中检查数据连接。" />}
    <div className="deep-runtime" aria-label="深度分析运行条件"><div><span>{remote ? '远程分析模型' : '分析模型'}</span><strong>{checking ? '检查中…' : status ? status.model || '尚未配置' : '状态未知'}</strong><Tag color={status?.configured ? 'success' : 'default'}>{status?.configured ? '配置齐备' : '未配置'}</Tag></div><div><span>Docker</span><strong>{checking ? '检查中…' : status?.docker_available === true ? '可用' : status?.docker_available === false ? '未就绪' : '待检查'}</strong></div><div><span>执行镜像</span><strong>{checking ? '检查中…' : status?.image_ready === true ? '已准备' : status?.image_ready === false ? '未准备' : '待检查'}</strong></div><div><span>分析执行</span><strong>{canExecute ? '可以发起' : '尚未就绪'}</strong></div></div>
    {!checking && status && !canExecute && <Alert className="deep-condition" type="warning" showIcon message="分析环境未就绪" description={status.execution_reason || (remote ? '请联系网关管理员检查分析模型、Docker 和执行镜像。' : !status.configured ? '请先配置分析模型。' : '请启动 Docker 并准备执行镜像。')} />}
    {error && <Alert className="deep-error" type="error" showIcon message={error} closable onClose={() => setError('')} />}
    <div className="deep-columns"><Card className="deep-input-card" title={<Space><FileTextOutlined />分析数据</Space>}><div className="deep-file-box"><input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /><Button icon={<UploadOutlined />} loading={busy && !running} disabled={busy || running || uploadBlocked} onClick={() => input.current?.click()}>{remote ? '选择并上传 CSV / Excel' : '选择 CSV / Excel'}</Button><a href="/api/deep-analysis/sample.csv" download="sample-ya70-daily.csv"><DownloadOutlined /> 下载样例 CSV</a><p>只分析你明确选择的文件。</p></div>{file ? <div className="deep-file-summary"><strong><CheckCircleOutlined /> {file.name}</strong><span>{file.row_count.toLocaleString()} 行 · {file.columns.length} 列 · {(file.size / 1024).toFixed(1)} KB</span><details><summary>查看字段与文件指纹</summary><p>{file.columns.join('、')}</p><code>{file.sha256}</code></details></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择数据" />}{recentTasks.length ? <div className="deep-recent"><div className="deep-recent-head">最近任务 <small>点击查看</small></div>{recentTasks.map(item => <button type="button" key={item.id} className={`deep-recent-item ${task?.id === item.id ? "active" : ""}`} onClick={async () => { try { const next = await getAnalysisTask(item.id); if (alive.current) setTask(next); } catch (failure) { setError(errorText(failure)); } }}><span className={`deep-recent-dot ${item.status}`} /><span className="deep-recent-text"><strong>{item.question || "未命名任务"}</strong><small>{taskLabels[item.status as keyof typeof taskLabels] || item.status} · {item.artifact_count ? `${item.artifact_count} 个产物` : "无产物"}</small></span></button>)}</div> : null}<label className="deep-question-label" htmlFor="deep-question">分析问题</label><Input.TextArea id="deep-question" aria-label="深度分析问题" value={question} onChange={event => setQuestion(event.target.value)} placeholder={'例如：按月统计治疗时长和 AHI 趋势，生成图表，并注明数据范围与限制。\n\n也可以只写一句「分析一下」，我会先做整体探索。'} rows={5} maxLength={6000} disabled={busy || running} /><p className="deep-input-note">{remote ? '发起后，分析问题会发送至远程主机。' : '分析代码由本机 Docker 执行。问题、文件元信息与执行输出会发送给配置的模型服务。'} 样例使用脱敏后的导出结构。</p><Button block type="primary" icon={<BarChartOutlined />} disabled={!file || !question.trim() || busy || running || checking || !status || uploadBlocked} onClick={() => void start()}>{canExecute ? '开始深度分析' : '创建试用任务（检查条件）'}</Button></Card>
    <Card className="deep-result-card" title="任务与分析结果" extra={running && <Button size="small" icon={<StopOutlined />} loading={busy} onClick={() => void cancel()}>取消任务</Button>}>
      {!task ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="创建任务后，在这里查看运行阶段、图表和报告。" /> : <><div className="deep-task-header"><Tag color={task.status === 'complete' ? 'success' : task.status === 'failed' || task.status === 'blocked' ? 'warning' : 'default'}>{taskLabels[task.status]}</Tag>{running && <Spin size="small" />}<small>{displayTime(task.updated_at)}</small></div><p className="deep-task-question">{task.question}</p><code className="deep-task-id">任务 {task.id}</code>{task.error && <Alert type={task.status === 'blocked' ? 'warning' : 'error'} showIcon className="deep-error" message={task.error} />}{pollError && <Alert className="deep-error" type="warning" message={`进度读取失败：${pollError}。正在重试，不代表任务已停止。`} />}{task.steps?.length ? <details className="deep-steps-block"><summary>执行记录 · {task.steps.length} 步（点击展开）</summary><div className="deep-steps">{task.steps.map((step, index) => <details key={index}><summary>{index + 1}. {{ code: '分析代码', execute: '执行输出', system: '任务状态' }[step.type] || '执行步骤'} {step.status && <small>· {step.status}</small>}</summary><pre>{step.content}</pre></details>)}</div></details> : null}{task.answer && <div className="deep-answer"><Markdown text={task.answer} /></div>}{task.artifacts?.length ? <div className="deep-artifacts"><h3>图表与报告 <small>点击图片看原图</small></h3>{task.artifacts.map(item => { const url = safeArtifactUrl(item.url); if (!url) return null; return <figure className="deep-artifact" key={item.id}>{imageArtifact(item) ? <Image className="deep-artifact-preview" src={url} alt={item.name} preview={{ mask: '点击预览' }} style={{ width: '100%', maxHeight: 190, objectFit: 'contain' }} /> : <FileTextOutlined className="deep-artifact-icon" />}<figcaption><span title={item.name}>{item.name}</span><small>{(item.size / 1024).toFixed(1)} KB</small></figcaption><a className="deep-artifact-download" href={url} download={item.name}><DownloadOutlined /> 下载</a></figure>; })}</div> : null}{task.status === 'complete' && !task.answer && !task.artifacts?.length && <Alert type="warning" message="任务已结束，但没有可展示的结果，请检查执行记录。" />}</>}
    </Card></div>
    <Collapse className="deep-config" items={[{ key: 'config', label: '分析模型与执行环境配置', children: remote ? <p>远程分析模型和执行环境由网关管理员配置。</p> : <div><p>通过 DEEP_ANALYSIS_BASE_URL、DEEP_ANALYSIS_MODEL 和 DEEP_ANALYSIS_API_KEY 配置分析模型。</p><p>分析代码在 Docker 执行镜像中运行。参数见 deep_analysis/README.md，配置后重启 Somnus。</p></div> }]} />
  </div>;
}
