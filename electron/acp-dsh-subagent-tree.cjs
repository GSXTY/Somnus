const { createHash } = require('node:crypto');

const MAX_AGENTS = 100;
const CONCURRENT_BRANCHES = 8;
const SESSION_ID = /^[a-z0-9][a-z0-9_.-]{0,191}$/i;

function stepId(id) {
  return 'dsh-child-' + createHash('sha256').update(id).digest('hex').slice(0, 24);
}

class NativeSubagentTree {
  constructor(call, sessionId, notify) {
    this.call = call;
    this.sessionId = sessionId;
    this.notify = notify;
    this.emitted = new Map();
    this.ranges = new Map();
    this.baseline = null;
    this.truncated = false;
  }

  async projections(sessionId) {
    try {
      const data = await this.call('projections', { sessionId });
      return data?.values ? data : undefined;
    } catch {
      return undefined;
    }
  }

  async capture() {
    const tree = await this.read();
    if (tree) this.baseline = new Map(tree.map(node => [node.entry.id, node.seq]));
  }

  emit(entry, parentId, timing) {
    const status = timing?.active ? 'in_progress'
      : timing?.lastTurnCompleted === true ? 'completed'
        : timing?.lastTurnCompleted === false ? 'failed'
          : entry.mode === 'external' ? 'in_progress' : 'pending';
    const id = stepId(entry.id);
    const value = { id, kind: 'subagent', status,
      title: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 150) : '子任务',
      ...(parentId !== this.sessionId ? { parent_id: stepId(parentId) } : {}),
      ...(Number.isFinite(timing?.settledMs) && status !== 'in_progress' && status !== 'pending'
        ? { duration_ms: Math.max(0, timing.settledMs) } : {}),
      ...(status === 'failed' ? { failure_reason: '子任务已结束，未正常完成。' } : {}) };
    const previous = this.emitted.get(id);
    if (!timing && previous && previous.status !== 'pending') return;
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    this.emitted.set(id, value);
    this.notify({ acpTool: value });
  }

  async refresh() {
    if (!this.baseline) return;
    const tree = await this.read();
    if (!tree) return;
    const nodes = new Map(tree.map(node => [node.entry.id, node]));
    const visible = new Set();
    for (const node of tree) {
      if (this.baseline.has(node.entry.id) &&
          !(node.seq > this.baseline.get(node.entry.id)) && !this.emitted.has(stepId(node.entry.id))) continue;
      for (let current = node; current && !visible.has(current.entry.id); current = nodes.get(current.parentId)) {
        visible.add(current.entry.id);
      }
    }
    for (const { entry, parentId, timing, seq, ownSeq } of tree) {
      if (!visible.has(entry.id)) continue;
      const id = stepId(entry.id);
      this.emit(entry, parentId, timing);
      const after = Math.max(this.baseline.get(entry.id) ?? -1, ownSeq ?? seq);
      if (Number.isSafeInteger(seq) && seq > after) this.ranges.set(id, {
        sessionId: entry.id, parentId, mode: entry.mode, after, through: seq, step: this.emitted.get(id),
      });
    }
    this.running = tree.some(({ entry, timing }) => visible.has(entry.id) && Boolean(timing?.active));
  }

  hasRunning() {
    return this.running === true;
  }

  async read() {
    const root = (await this.projections(this.sessionId))?.values;
    if (!Array.isArray(root?.subagentCatalog)) return;
    const seen = new Set([this.sessionId]);
    const queue = [];
    const addChildren = (entries, parentId) => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (typeof entry?.id !== 'string' || !SESSION_ID.test(entry.id) || seen.has(entry.id)) continue;
        if (seen.size > MAX_AGENTS) {
          if (!this.truncated) this.notify({ acpActivityTruncated: true });
          this.truncated = true;
          break;
        }
        seen.add(entry.id);
        queue.push({ entry, parentId });
      }
    };
    addChildren(root.subagentCatalog, this.sessionId);
    for (let offset = 0; offset < queue.length;) {
      const batch = queue.slice(offset, offset + CONCURRENT_BRANCHES);
      const states = await Promise.all(batch.map(({ entry }) => this.projections(entry.id)));
      batch.forEach((node, index) => {
        const state = states[index];
        node.seq = state?.asOfSeq ?? -1;
        node.timing = state?.values.subagentTiming;
        node.ownSeq = state?.values.subagent?.seq;
        addChildren(state?.values.subagentCatalog, node.entry.id);
      });
      offset += batch.length;
    }
    return queue;
  }
}

module.exports = { NativeSubagentTree };
