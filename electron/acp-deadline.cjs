const IDLE_MS = 180_000;
const HARD_MS = 12 * 60_000;
const APPROVAL_BUDGET_MS = 120_000;

class AcpDeadline {
  constructor(onTimeout, { idleMs = IDLE_MS, hardMs = HARD_MS,
    approvalBudgetMs = APPROVAL_BUDGET_MS, clock = () => performance.now() } = {}) {
    this.clock = clock;
    this.onTimeout = onTimeout;
    this.idleMs = idleMs;
    this.remaining = idleMs;
    this.approvalBudget = approvalBudgetMs;
    this.lastTick = clock();
    this.hardAt = this.lastTick + hardMs;
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
    if (now >= this.hardAt || this.remaining <= 0) {
      this.close();
      this.onTimeout(now >= this.hardAt ? 'hard' : 'idle');
      return;
    }
    const pause = Math.max(0, (this.approvalUntil || 0) - now);
    this.timer = setTimeout(() => this.schedule(), Math.ceil(Math.min(this.hardAt - now, this.remaining + pause)));
    this.timer.unref();
  }

  progress() {
    if (this.closed) return;
    this.schedule();
    if (this.closed) return;
    this.remaining = this.idleMs;
    this.schedule();
  }

  beginApproval(windowMs) {
    this.schedule();
    if (this.closed) return 0;
    const grace = Math.max(0, Math.min(windowMs, this.hardAt - this.lastTick));
    this.approvalUntil = this.lastTick + Math.min(grace, this.approvalBudget);
    this.schedule();
    return grace;
  }

  endApproval() {
    if (this.closed) return;
    this.advance(this.clock());
    this.approvalUntil = undefined;
    this.schedule();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }
}

module.exports = { AcpDeadline };
