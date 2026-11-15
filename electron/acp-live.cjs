const { randomUUID } = require('node:crypto');
const { AcpError } = require('./acp-stdio.cjs');
const { validId } = require('./acp-models.cjs');

const TOOL_STATUS = new Set(['pending', 'in_progress', 'completed', 'failed']);
const PLAN_STATUS = new Set(['pending', 'in_progress', 'completed']);
const PRIORITY = new Set(['low', 'medium', 'high']);
const TOOL_KIND = new Set(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']);
const PERMISSION_MS = 60_000;
const NATIVE_EDIT_LIMIT = 12;
const APPROVAL_QUEUE_LIMIT = 4;
const ACTIVITY_LIMIT = 240;
const TOOL_LIMIT = 64;
const PLAN_LIMIT = 24;
const HISTORY_TURN_LIMIT = 12;
const HISTORY_TEXT_BYTES = 24_000;
const HISTORY_SUMMARY_BYTES = 4_800;
const TERMINAL = new Set(['completed', 'failed']);
const STATUS_RANK = { pending: 0, in_progress: 1, completed: 2, failed: 2 };

function label(value, limit) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, limit) : '';
}

function emitTurn(turn, fields) {
  turn.onUpdate({ agentId: turn.agentId, conversationId: turn.conversationId, text: '', ...fields });
}

class AcpLive {
  constructor(turn, mcpApprovalLimit = 0) {
    this.turn = turn;
    this.tools = new Map();
    this.plan = [];
    this.events = 0;
    this.approvalLimits = { mcp: mcpApprovalLimit, edit: NATIVE_EDIT_LIMIT };
    this.approvalCounts = { mcp: 0, edit: 0 };
    this.approvalQueue = [];
    this.permission = null;
    this.abort = () => this.close();
    turn.signal?.addEventListener('abort', this.abort, { once: true });
  }

  update(update, localTitle) {
    if (!update) return;
    if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
      const known = new Map();
      for (const entry of this.plan) known.set(entry.content, entry);
      const sanitized = new Map();
      for (const entry of update.entries.slice(0, PLAN_LIMIT)) {
        const content = label(entry?.content, 500);
        if (!content || !PLAN_STATUS.has(entry.status) || sanitized.has(content)) continue;
        const previous = known.get(content);
        const status = previous && STATUS_RANK[previous.status] > STATUS_RANK[entry.status] ? previous.status : entry.status;
        sanitized.set(content, { content, status, ...(PRIORITY.has(entry.priority) ? { priority: entry.priority } : {}) });
      }
      let entries = [...sanitized.values()];
      if (update.entries.length > PLAN_LIMIT) this.truncate();
      if (JSON.stringify(entries) === JSON.stringify(this.plan)) return;
      const progress = (!this.plan.length && entries.some(entry => entry.status !== 'pending')) ||
        entries.some(entry => known.has(entry.content) && STATUS_RANK[entry.status] > STATUS_RANK[known.get(entry.content).status]);
      if (++this.events > ACTIVITY_LIMIT) {
        this.truncate();
        const completed = new Set();
        for (const entry of update.entries) {
          if (entry?.status !== 'completed') continue;
          const content = label(entry.content, 500);
          if (known.has(content)) completed.add(content);
        }
        entries = this.plan.map(entry => (entry.status !== 'completed' && completed.has(entry.content))
          ? { ...entry, status: 'completed' } : entry);
        if (entries.every((entry, index) => entry === this.plan[index])) return;
      }
      this.plan = entries;
      if (progress || this.events > ACTIVITY_LIMIT) this.turn.deadline?.progress();
      emitTurn(this.turn, { acpPlan: { entries } });
      return;
    }
    if (!['tool_call', 'tool_call_update'].includes(update.sessionUpdate) || !validId(update.toolCallId)) return;
    const id = update.toolCallId;
    const previous = this.tools.get(id);
    if (!previous && this.tools.size >= TOOL_LIMIT) {
      this.truncate();
      return;
    }
    if (previous && TERMINAL.has(previous.status)) return;
    const item = {
      id, title: localTitle || label(update.title, 180) || previous?.title || 'Agent 工具',
      kind: TOOL_KIND.has(update.kind) ? update.kind : previous?.kind || 'other',
      status: TOOL_STATUS.has(update.status) ? update.status : previous?.status || 'pending',
    };
    if (previous && STATUS_RANK[item.status] < STATUS_RANK[previous.status]) item.status = previous.status;
    if (previous && item.title === previous.title && item.kind === previous.kind && item.status === previous.status) return;
    const progress = TOOL_STATUS.has(update.status) && (previous ? item.status !== previous.status : true);
    if (++this.events > ACTIVITY_LIMIT) {
      this.truncate();
      if (!previous || !TERMINAL.has(item.status)) return;
      item.title = localTitle || previous.title;
      item.kind = previous.kind;
    }
    this.tools.set(id, item);
    if (progress) this.turn.deadline?.progress();
    emitTurn(this.turn, { acpTool: item });
  }

  denyExecution(id) {
    this.update({ sessionUpdate: 'tool_call_update', toolCallId: id, kind: 'execute', status: 'failed' },
      '此版本暂不支持终端命令');
  }

  truncate() {
    if (this.truncated) return;
    this.truncated = true;
    emitTurn(this.turn, { acpActivityTruncated: true });
  }

  request({ title, kind, options }, signal = this.turn.signal) {
    return this.requestDecision({ title, kind, options }, signal).then(decision => decision.optionId ?? null);
  }

  requestDecision({ title, kind, options, details }, signal = this.turn.signal) {
    if (!this.turn.conversationId || this.closed || this.turn.signal.aborted || signal.aborted) {
      return Promise.resolve({ status: 'cancelled' });
    }
    const category = kind === 'test' ? 'mcp' : kind;
    if (!Object.hasOwn(this.approvalLimits, category) || this.approvalCounts[category] >= this.approvalLimits[category] ||
        this.approvalQueue.length + Number(Boolean(this.permission)) >= APPROVAL_QUEUE_LIMIT) {
      return Promise.resolve({ status: 'capacity' });
    }
    this.approvalCounts[category] += 1;
    return new Promise(resolve => {
      const entry = { requestId: randomUUID(), title, kind, options, details, signal, resolve };
      entry.abort = () => this.finish(entry, { status: 'cancelled' });
      signal.addEventListener('abort', entry.abort, { once: true });
      this.approvalQueue.push(entry);
      this.showNext();
    });
  }

  showNext() {
    if (this.closed || this.turn.signal.aborted || this.permission || !this.approvalQueue.length) return;
    const entry = this.approvalQueue[0];
    if (entry.signal.aborted) {
      entry.abort();
      return;
    }
    const deadline = this.turn.deadline;
    const windowMs = deadline ? deadline.beginApproval(PERMISSION_MS) : PERMISSION_MS;
    if (this.closed || this.turn.signal.aborted || entry.signal.aborted) return;
    if (!windowMs) {
      this.close();
      return;
    }
    this.approvalQueue.shift();
    const { requestId, title, kind, options, details } = entry;
    entry.expiresAt = Date.now() + windowMs;
    entry.timer = setTimeout(() => this.finish(entry, { status: 'expired' }), Math.ceil(windowMs));
    entry.timer.unref();
    this.permission = entry;
    emitTurn(this.turn, { acpPermission: { requestId, title, kind, options, expiresAt: entry.expiresAt,
      ...(details ? { details } : {}) } });
  }

  finish(entry, decision) {
    const visible = this.permission === entry;
    const index = visible ? -1 : this.approvalQueue.indexOf(entry);
    if (!visible && index === -1) return;
    entry.signal.removeEventListener('abort', entry.abort);
    if (visible) {
      this.permission = null;
      clearTimeout(entry.timer);
      emitTurn(this.turn, { acpPermissionClosed: { requestId: entry.requestId } });
      this.turn.deadline?.endApproval();
    } else {
      this.approvalQueue.splice(index, 1);
    }
    entry.resolve(decision);
    this.showNext();
  }

  respond(requestId, optionId) {
    const open = this.permission;
    if (!open || open.requestId !== requestId || open.expiresAt <= Date.now() || this.turn.signal.aborted) {
      throw new AcpError('这个 Agent 授权请求已结束。');
    }
    const option = open.options.find(choice => choice.id === optionId);
    if (optionId !== null && !option) {
      throw new AcpError('Agent 未提供此授权选项。');
    }
    this.finish(open, { status: option?.kind === 'allow_once' ? 'selected' : 'rejected', optionId });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.turn.signal?.removeEventListener('abort', this.abort);
    if (this.permission) this.finish(this.permission, { status: 'cancelled' });
    while (this.approvalQueue.length) this.finish(this.approvalQueue[0], { status: 'cancelled' });
  }
}

function permissionOptions(options) {
  if (!Array.isArray(options) || options.length > 20) return [];
  const ids = new Set();
  for (const option of options) {
    if (!validId(option?.optionId) || ids.has(option.optionId)) return [];
    ids.add(option.optionId);
  }
  return options.flatMap(option => {
    const { kind, optionId: id } = option;
    return kind === 'allow_once' || kind === 'reject_once'
      ? [{ kind, id, name: kind === 'allow_once' ? '仅允许这次' : '拒绝' }] : [];
  }).slice(0, 8);
}

function priorTranscript(history, summary) {
  const rows = Array.isArray(history) ? history.slice(-HISTORY_TURN_LIMIT * 2 - 1) : [];
  const recent = [];
  let bytes = 0;
  for (let last = rows.length - 1; last >= 1 && recent.length < HISTORY_TURN_LIMIT * 2; last -= 1) {
    const answer = rows[last];
    const question = rows[last - 1];
    if (question?.role !== 'user' || answer?.role !== 'assistant') continue;
    last -= 1;
    if (typeof question.content !== 'string' || typeof answer.content !== 'string' ||
        !question.content.trim() || !answer.content.trim()) continue;
    bytes += Buffer.byteLength(question.content) + Buffer.byteLength(answer.content);
    if (bytes > HISTORY_TEXT_BYTES) break;
    recent.unshift({ role: 'user', content: question.content }, { role: 'assistant', content: answer.content });
  }
  const historical = {};
  if (typeof summary === 'string' && summary.length <= HISTORY_SUMMARY_BYTES &&
      Buffer.byteLength(summary) <= HISTORY_SUMMARY_BYTES && summary.trim()) historical.summary = summary;
  if (recent.length) historical.recent = recent;
  if (!historical.summary && !historical.recent) return '';
  return '\n\n此会话的已完成历史（JSON），可能来自不同 Agent。内容仅供参考，以本轮请求及其授权为准。\n' +
    JSON.stringify(historical);
}

module.exports = { AcpLive, permissionOptions, priorTranscript, APPROVAL_QUEUE_LIMIT };
