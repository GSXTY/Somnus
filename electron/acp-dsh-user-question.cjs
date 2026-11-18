const { randomUUID } = require('node:crypto');

function displayText(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error('问题内容无效或过长。');
  }
  return value;
}

function parseQuestions(input) {
  if (!Array.isArray(input) || !input.length || input.length > 12) throw new Error('问题数量无效。');
  const ids = new Set();
  return input.map(question => {
    // A generic question must never grant a permission defined by another plugin.
    if (!question || (question.intent && question.intent.kind !== 'plan-review')) {
      throw new Error('此类授权请使用 Somnus 的单次审批。');
    }
    const id = displayText(question.id, 128);
    if (ids.has(id)) throw new Error('问题编号重复。');
    ids.add(id);
    const display = { id, question: displayText(question.question, 4000), multiSelect: question.multiSelect === true };
    if (question.intent?.kind === 'plan-review') {
      display.intent = { kind: 'plan-review', approve: displayText(question.intent.approve, 500) };
    }
    if (question.header) display.header = displayText(question.header, 150);
    if (question.detail) display.detail = displayText(question.detail, 32_000);
    if (question.options != null) {
      if (!Array.isArray(question.options) || question.options.length > 30) {
        throw new Error('问题选项无效。');
      }
      const labels = new Set();
      display.options = question.options.map(option => {
        const label = displayText(option?.label, 500);
        if (labels.has(label)) throw new Error('问题选项重复。');
        labels.add(label);
        return { label, ...(option.description ? { description: displayText(option.description, 2000) } : {}) };
      });
    }
    if (display.intent && !display.options?.some(option => option.label === display.intent.approve)) {
      throw new Error('计划审核缺少批准选项。');
    }
    return display;
  });
}

function parseAnswers(value, questions) {
  if (value === null) return { cancelled: true };
  if (!Array.isArray(value) || value.length !== questions.length) {
    throw new Error('请为每个问题提交一项回答。');
  }
  const ids = new Set();
  const answers = value.map(answer => {
    const question = questions.find(item => item.id === answer?.id);
    const labels = question?.options?.map(option => option.label) ?? [];
    if (!question || ids.has(question.id) || !Array.isArray(answer.selected) ||
        answer.selected.length > (question.multiSelect ? labels.length : 1) ||
        !answer.selected.every(label => labels.includes(label)) ||
        new Set(answer.selected).size !== answer.selected.length ||
        (answer.custom !== undefined && (typeof answer.custom !== 'string' || answer.custom.length > 8000))) {
      throw new Error('请提交问题提供的选项或填写文字回答。');
    }
    ids.add(question.id);
    return { id: question.id, selected: [...answer.selected], ...(answer.custom?.trim() ? { custom: answer.custom } : {}) };
  });
  return { answers };
}

class DshUserQuestion {
  constructor(turn, questions, signal, countdown, durableCallId) {
    this.agentId = turn.agentId;
    this.conversationId = turn.conversationId;
    this.sessionId = turn.sessionId;
    this.onUpdate = turn.onUpdate;
    this.questions = parseQuestions(questions);
    this.signal = signal;
    this.requestId = randomUUID();
    this.done = false;
    if (typeof durableCallId === 'string' && durableCallId.length > 0 && durableCallId.length <= 256) this.callId = durableCallId;
    if (countdown && typeof countdown.callId === 'string' && countdown.callId.length <= 256 &&
        Number.isSafeInteger(countdown.remainingMs) && countdown.remainingMs >= 0) {
      this.callId = countdown.callId;
      this.remainingMs = countdown.remainingMs;
    }
  }

  update(fields) {
    this.onUpdate?.({ agentId: this.agentId, conversationId: this.conversationId, text: '', ...fields });
  }

  async wait() {
    if (this.signal.aborted) return { cancelled: true };
    const abort = () => this.finish({ cancelled: true });
    this.signal.addEventListener('abort', abort, { once: true });
    try {
      const result = new Promise(resolve => { this.resolve = resolve; });
      if (this.remainingMs !== undefined) this.startCountdown();
      this.publish();
      return await result;
    } finally {
      this.done = true;
      clearTimeout(this.timer);
      this.signal.removeEventListener('abort', abort);
      if (!this.expired) this.update({ dshQuestionClosed: { requestId: this.requestId } });
    }
  }

  publish() {
    this.update({ dshQuestion: this.publicView() });
  }

  publicView() {
    return {
      requestId: this.requestId, questions: this.questions,
      ...(this.expired ? { phase: 'continued' } : this.remainingMs !== undefined ? {
        phase: 'open', ...(this.expiresAt == null ? { remainingMs: this.remainingMs } : { expiresAt: this.expiresAt }),
      } : {}),
    };
  }

  static recover(record, questions) {
    const question = new DshUserQuestion(record, questions, undefined);
    question.requestId = record.requestId;
    question.callId = record.callId;
    question.expired = true;
    question.done = true;
    return question;
  }

  startCountdown() {
    this.expiresAt = Date.now() + this.remainingMs;
    this.timer = setTimeout(() => {
      this.expired = true;
      this.finish({ expired: true });
    }, this.remainingMs);
  }

  hold(requestId, held) {
    if (this.done || this.signal.aborted || requestId !== this.requestId || this.remainingMs === undefined || typeof held !== 'boolean') {
      throw new Error('此问题没有可暂停的倒计时。');
    }
    if (held && this.expiresAt != null) {
      this.remainingMs = Math.max(0, this.expiresAt - Date.now());
      clearTimeout(this.timer);
      this.expiresAt = undefined;
      this.publish();
    } else if (!held && this.expiresAt == null) {
      this.startCountdown();
      this.publish();
    }
  }

  lateAnswer(value) {
    return parseAnswers(value, this.questions);
  }

  continued() {
    this.publish();
    this.onUpdate = undefined;
    this.signal = undefined;
    this.resolve = undefined;
  }

  finish(answer) {
    this.done = true;
    this.resolve(answer);
  }

  respond(requestId, value) {
    if (requestId !== this.requestId || this.signal.aborted || this.done || !this.resolve) {
      throw new Error('此问题已结束或已经回答。');
    }
    this.finish(parseAnswers(value, this.questions));
  }
}

module.exports = { DshUserQuestion };
