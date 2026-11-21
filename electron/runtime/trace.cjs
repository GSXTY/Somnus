const { label } = require('./contracts.cjs');
const STATUS = new Set(['pending', 'in_progress', 'completed', 'failed']);
class TaskTrace {
  constructor(runtime) { this.limit = runtime === 'acp' ? 40 : 300; this.text = ''; this.steps = new Map(); this.plan = []; this.approvals = new Map(); this.context = undefined; this.serial = 0; this.local = new Map(); this.truncated = false; this.started = new Map(); this.analysisTasks = new Set(); this.pluginCards = []; }
  update(event) {
    if (typeof event.text === 'string') this.text = (this.text + event.text).slice(0, 100000);
    if (event.contextUsage) this.context = event.contextUsage;
    if (event.acpActivityTruncated) this.truncated = true;
    const add = step => {
      if (!step || typeof step.id !== 'string' || !STATUS.has(step.status)) return;
      if (!this.steps.has(step.id) && this.steps.size >= this.limit) { this.truncated = true; return; }
      const old = this.steps.get(step.id);
      if (old && ['completed', 'failed'].includes(old.status) && ['pending', 'in_progress'].includes(step.status)) return;
      if (step.status === 'in_progress' && !this.started.has(step.id)) this.started.set(step.id, Date.now());
      const duration = Number.isSafeInteger(step.duration_ms) && step.duration_ms >= 0 && step.duration_ms <= 86400000 ? step.duration_ms
        : this.started.has(step.id) && ['completed', 'failed'].includes(step.status) ? Math.min(86400000, Math.max(0, Date.now() - this.started.get(step.id))) : undefined;
      this.steps.set(step.id, { id: label(step.id, 120), title: label(step.title, 150) || '工具操作', kind: label(step.kind, 60) || 'tool', status: step.status,
        ...(typeof step.parent_id === 'string' ? { parent_id: label(step.parent_id, 120) } : {}), ...(duration !== undefined ? { duration_ms: duration } : {}),
        ...(step.status === 'failed' && step.failure_reason ? { failure_reason: label(step.failure_reason, 180) } : {}) });
    };
    if (event.pluginCard && this.pluginCards.length < 12) this.pluginCards.push(event.pluginCard);
    if (event.acpTool) add(event.acpTool);
    if (event.toolProgress) {
      const p = event.toolProgress;
      if (p.status === 'complete' && /^[a-f0-9]{32}$/.test(p.taskId || '') && this.analysisTasks.size < 300) this.analysisTasks.add(p.taskId);
      let id = p.traceId || (p.callId && 'local-call-' + p.callId);
      if (!id) { id = p.status === 'running' ? 'local-' + ++this.serial : this.local.get(p.name) || 'local-' + ++this.serial; if (p.status === 'running') this.local.set(p.name, id); else this.local.delete(p.name); }
      add({ id, title: p.title || p.name, kind: p.kind || 'tool', status: p.status === 'running' ? 'in_progress' : p.status === 'error' ? 'failed' : 'completed', ...(p.status === 'error' ? { failure_reason: p.message } : {}) });
    }
    if (event.acpPlan?.entries) this.plan = event.acpPlan.entries.slice(0, 25).map(row => ({ content: label(row.content, 200), status: row.status, ...(row.priority ? { priority: row.priority } : {}) }));
    if (event.acpPermission) { const p = event.acpPermission; if (['mcp', 'edit', 'test', 'native_tool', 'powershell'].includes(p.kind) && this.approvals.size < 40) this.approvals.set(p.requestId, { id: p.requestId, kind: p.kind, status: 'pending', at: Date.now() / 1000 }); }
    if (event.acpPermissionClosed) this.decision(event.acpPermissionClosed.requestId, 'closed');
  }
  decision(id, status) { const row = this.approvals.get(id); if (row && row.status === 'pending') this.approvals.set(id, { ...row, status }); }
  finish(result, error, cancelled) {
    const status = result?.stopReason === 'cancelled' ? 'cancelled' : result && !error
      ? result.ok === false || result.stopReason === 'command_error' ? 'error' : 'complete' : cancelled ? 'cancelled' : error ? 'error' : 'complete';
    const execution = { steps: [...this.steps.values()], plan: this.plan, ...(this.truncated ? { truncated: true } : {}), ...(this.approvals.size ? { approvals: [...this.approvals.values()] } : {}) };
    let text = (typeof result?.text === 'string' && result.text ? result.text.slice(0, 100000) : this.text) || (error && !cancelled ? 'Agent 未完成此任务。请检查任务和连接状态。' : '');
    const links = [...this.analysisTasks].map(id => '[查看深度分析任务](/#deep-analysis?task=' + id + ')').filter(link => !text.includes(link)).join('\n');
    if (links) text = text.slice(0, 100000 - links.length - 2) + '\n\n' + links;
    return { content: text, status, ...(this.pluginCards.length ? {plugin_cards:this.pluginCards} : {}), ...(result?.modelName || result?.modelId ? { model: result.modelName || result.modelId } : {}), ...(execution.steps.length || execution.plan.length || execution.approvals?.length ? { execution } : {}), ...(result?.usage ? { usage: result.usage } : {}), ...(result?.contextUsage || this.context ? { context: result?.contextUsage || this.context } : {}), ...(status === 'complete' && result?.recommendations ? { recommendations: result.recommendations } : {}) };
  }
}
module.exports = { TaskTrace };
