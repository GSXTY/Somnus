const IDLE_MS = 120_000;
const APPROVAL_BUDGET_MS = 120_000;

class AcpDeadline {
  constructor(onTimeout, { idleMs = IDLE_MS, hardMs = 0, onIdle = () => {},
    approvalBudgetMs = APPROVAL_BUDGET_MS, clock = () => performance.now() } = {}) {
    this.clock = clock;
    this.onTimeout = onTimeout;
    this.onIdle = onIdle;
    this.idleMs = idleMs;
    this.remaining = idleMs;
    this.approvalBudget = approvalBudgetMs;
    this.lastTick = clock();
    this.hardAt = hardMs > 0 ? this.lastTick + hardMs : Infinity;
    this.warned = false;
    this.closed = false;
    this.schedule();
  }
  advance(now) {
    const protectedMs = Math.max(0, Math.min(now, this.approvalUntil || 0) - this.lastTick);
    this.remaining -= now - this.lastTick - protectedMs;
    this.approvalBudget -= protectedMs;
    this.lastTick = now;
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.closed) return;
    const now = this.clock();
    this.advance(now);
    if (now >= this.hardAt) {
      this.close(); this.onTimeout('hard'); return;
    }
    if (this.remaining <= 0 && !this.warned) {
      this.warned = true;
      this.onIdle({ code: 'idle', message: '任务暂未产生新活动，仍在等待；你可以查看轨迹或停止。' });
    }
    const pause = Math.max(0, (this.approvalUntil || 0) - now);
    const delay = Math.min(this.hardAt - now, this.warned ? Infinity : this.remaining + pause);
    if (Number.isFinite(delay)) {
      this.timer = setTimeout(() => this.schedule(), Math.max(1, Math.ceil(delay)));
      this.timer.unref();
    }
  }
  progress() {
    if (this.closed) return;
    const now = this.clock(); this.advance(now);
    if (now >= this.hardAt) { this.close(); this.onTimeout('hard'); return; }
    this.remaining = this.idleMs; this.warned = false; this.schedule();
  }
  beginApproval(windowMs) {
    this.schedule();
    if (this.closed) return 0;
    const grace = Math.max(0, Math.min(windowMs, this.hardAt - this.lastTick));
    this.approvalUntil = this.lastTick + Math.min(grace, this.approvalBudget);
    this.schedule(); return grace;
  }
  endApproval() {
    if (this.closed) return;
    this.advance(this.clock()); this.approvalUntil = undefined; this.schedule();
  }
  close() { this.closed = true; clearTimeout(this.timer); }
}
module.exports = { AcpDeadline };
