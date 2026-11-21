const { randomUUID } = require('node:crypto');
const { capabilities, route, label, STAGES } = require('./contracts.cjs');
const { TaskTrace } = require('./trace.cjs');
const { ResultOutbox } = require('./result-outbox.cjs');
const CLOSED = new Set(['runtime_task_closed', 'runtime_task_owner_conflict', 'runtime_task_mismatch', 'runtime_task_not_found']);
const interactionRoute = task => ({ ...task.route });
class RuntimeRegistry {
  constructor({ acp, native, projectClient, heartbeatMs = 5000, profileDir, safeStorage }) {
    this.adapters = new Map(); this.tasks = new Map(); this.ownerId = randomUUID(); this.client = projectClient; this.heartbeatMs = heartbeatMs; this.outbox = new ResultOutbox(profileDir, safeStorage); this.recovering = false; this.closed = false;
    if (profileDir && projectClient?.finishRuntimeTask) { this.recoveryTimer = setInterval(() => { void this.recover(); }, 5000); this.recoveryTimer.unref?.(); void this.recover(); }
    if (acp) this.adapters.set('acp', { prompt: (input, _validate, emit) => acp.promptConversation(input, emit), cancel: input => acp.cancelConversation(input.conversationId, input.taskId), permission: (input, requestId, optionId) => acp.respondPermission(input.conversationId, requestId, optionId, input.taskId) });
    if (native) this.adapters.set('dsh-native', { prompt: (input, validate, emit) => native.prompt(input, validate, emit), command: (input, validate, emit) => native.executeCommand(input, validate, emit), cancel: input => native.cancel(input.conversationId), permission: (input, requestId, optionId) => native.respondPermission(input.conversationId, requestId, optionId), question: (input, requestId, answers) => native.respondQuestion(input.conversationId, requestId, answers) });
  }
  capabilities(input) { return { ...capabilities(input), resultPersistence: this.outbox.durable() ? 'encrypted' : 'memory-only' }; }
  key(input) { return input.conversationId + '\0' + input.taskId; }
  find(input) {
    const task = this.tasks.get(this.key(input));
    if (!task || task.settled || task.route.runtime !== input.runtime || task.route.agentId !== input.agentId) throw new Error('此任务已结束或不属于当前运行时。');
    return task;
  }
  async state(task, fields = {}) {
    if (!this.client?.runtimeTaskState || task.stopped) return;
    if (fields.status) task.desiredState = fields.status;
    const sequence = ++task.sequence;
    const send = async () => {
      if (task.stopped) return;
      try {
        let result;
        for (let attempt = 0; attempt < (task.epoch ? 1 : 3); attempt++) {
          try { result = await this.client.runtimeTaskState(task.route, { agent_id: task.route.agentId, owner_id: this.ownerId, sequence, ...fields }); break; }
          catch (error) { if (CLOSED.has(error.code) || attempt === 2 || task.epoch) throw error; }
        }
        if (task.epoch && task.epoch !== result.epoch || result.task?.status === 'interrupted') throw Object.assign(new Error('本机服务已重启，此任务不能自动恢复。'), { code: 'runtime_task_closed' });
        task.epoch = result.epoch; if (typeof result.finish_receipt === 'string') task.receipt = result.finish_receipt;
      } catch (error) {
        if (error.code === 'runtime_task_cancel_requested') { task.cancelling = true; clearInterval(task.timer); if (!task.settled) await Promise.resolve(task.adapter.cancel(task.route)).catch(() => {}); throw error; }
        if (CLOSED.has(error.code)) { task.stopped = true; task.interrupted = true; clearInterval(task.timer); if (!task.settled) await Promise.resolve(task.adapter.cancel(task.route)).catch(() => {}); }
        throw error;
      }
    };
    const promise = task.pending.then(send);
    task.pending = promise.catch(() => {});
    return promise;
  }
  emit(task, event, notify) {
    if (event.conversationId && event.conversationId !== task.route.conversationId || event.turnId && event.turnId !== task.route.taskId || event.agentId && event.agentId !== task.route.agentId) return;
    task.trace.update(event);
    if (event.acpPermission) task.permission = event.acpPermission;
    if (event.acpPermissionClosed && task.permission?.requestId === event.acpPermissionClosed.requestId) task.permission = undefined;
    if (event.dshQuestion) task.question = event.dshQuestion;
    if (event.dshQuestionClosed && task.question?.requestId === event.dshQuestionClosed.requestId) task.question = undefined;
    const stage = STAGES.has(event.acpStage) ? event.acpStage : task.stage || 'working'; task.stage = stage;
    const state = event.acpDiagnostic?.code === 'disconnected' ? 'disconnected' : task.cancelling ? 'cancelling' : task.permission || task.question && task.question.phase !== 'continued' ? 'waiting_approval' : ['preparing', 'connecting'].includes(stage) ? 'connecting' : 'running';
    const title = label(event.acpTool?.title || event.toolProgress?.title || event.toolProgress?.name || event.acpDiagnostic?.message || (task.question ? '等待回答' : task.permission ? '等待审批' : ''));
    const signature = JSON.stringify([state, stage, title]);
    if (event.acpTool?.kind === 'subagent') {
      const step = event.acpTool;
      task.children.set(step.id, { id: step.id, title: label(step.title, 150), status: step.status,
        ...(step.parent_id ? { parent_id: step.parent_id } : {}), ...(Number.isSafeInteger(step.duration_ms) ? { duration_ms: step.duration_ms } : {}) });
    }
    if (signature !== task.signature || event.acpTool?.kind === 'subagent') {
      task.signature = signature; task.latest = { status: state, progress: { stage, ...(title ? { title } : {}) }, ...(task.children.size ? { children: [...task.children.values()].slice(0, 100) } : {}) };
      if (!task.flush) task.flush = setTimeout(() => { task.flush = undefined; const value = task.latest; task.latest = undefined; if (value) void this.state(task, value).catch(() => {}); }, 100);
    }
    try { notify?.(event); } catch { /* Rendering is not ownership of a running task. */ }
  }
  async run(runtime, action, input, validate, notify) {
    validate?.();
    const descriptor = route(input, runtime), key = this.key(descriptor), adapter = this.adapters.get(runtime);
    if (!adapter?.[action]) throw new Error('此运行时不支持这项操作。');
    if (this.tasks.has(key)) throw new Error('此任务已经开始，请勿重复发送。');
    const task = { route: descriptor, adapter, sequence: 0, pending: Promise.resolve(), trace: new TaskTrace(runtime), children: new Map(), stopped: false, cancelling: false };
    this.tasks.set(key, task);
    let result, failure, persistencePending = false;
    try {
      await this.state(task, { status: 'connecting', progress: { stage: 'preparing' } });
      if (this.client?.runtimeTaskState && !/^[A-Za-z0-9_-]{32,128}$/.test(task.receipt || '')) throw new Error('本机服务未确认任务执行凭据。');
      await this.state(task, { status: 'running', progress: { stage: 'preparing' } });
      task.timer = setInterval(() => { void this.state(task, { heartbeat: true, status: task.desiredState || 'connecting' }).catch(() => {}); }, this.heartbeatMs); task.timer.unref?.();
      const validateOwner = () => {
        if (this.closed || task.interrupted || this.tasks.get(key) !== task) throw new Error('此 Agent 任务已失去执行授权。');
      };
      result = await adapter[action]({ ...input, runtimeOwnerId: this.ownerId, onNativeHistory: metadata => { task.nativeHistory = metadata; } }, validateOwner, event => this.emit(task, event, notify));
    } catch (error) { failure = error; }
    task.settled = true;
    if (!result && !failure) failure = new Error('Agent 未返回可确认的结果。');
    clearInterval(task.timer);
    clearTimeout(task.flush);
    if (task.latest) await this.state(task, task.latest).catch(() => {});
    await task.pending;
    if (!task.receipt && !task.interrupted && this.client?.abandonRuntimeTask) {
      try { const record = await this.outbox.save(descriptor, { agent_id: descriptor.agentId, owner_id: this.ownerId }, 'abandon'); await this.deliver(record); } catch {}
    }
    if ((task.receipt || !this.client?.runtimeTaskState) && this.client?.finishRuntimeTask) {
      const body = { ...(task.nativeHistory ? {native_history:task.nativeHistory} : {}), agent_id: descriptor.agentId, owner_id: this.ownerId, ...task.trace.finish(result, failure, task.cancelling),
        ...(task.receipt ? { finish_receipt: task.receipt } : {}),
        ...(task.interrupted && result?.stopReason !== 'end_turn' ? { status: 'error', interrupted: true } : {}) };
      try {
        const record = await this.outbox.save(descriptor, body);
        // Persistence recovery never calls an adapter's prompt or command method.
        await this.deliver(record);
        if (result?.stopReason === 'end_turn') task.interrupted = false;
      } catch { persistencePending = true; }
    }
    task.stopped = true; this.tasks.delete(key);
    if (task.interrupted) throw new Error('本机服务已重启，任务已中断；不会自动重复执行。');
    if (failure) throw failure;
    return persistencePending && result ? { ...result, persistencePending: true } : result;
  }
  async deliver(record) {
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await (record.kind === 'abandon' ? this.client.abandonRuntimeTask(record.route, record.body) : this.client.finishRuntimeTask(record.route, record.body)); await this.outbox.remove(record.key); return; }
      catch (failure) { error = failure; if (CLOSED.has(failure.code)) break; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1))); }
    }
    throw error;
  }
  async recover() {
    if (this.recovering || this.closed || !this.client?.finishRuntimeTask) return;
    this.recovering = true;
    try { for (const record of await this.outbox.list()) { if (this.closed) break; await this.deliver(record).catch(() => {}); } }
    finally { this.recovering = false; }
  }
  async cancelTask(input) { const task = this.find(input); task.cancelling = true; await this.state(task, { status: 'cancelling' }).catch(() => {}); return task.adapter.cancel(task.route); }
  async cancel(runtime, conversationId, taskId) {
    const tasks = [...this.tasks.values()].filter(task => task.route.runtime === runtime && task.route.conversationId === conversationId && (!taskId || task.route.taskId === taskId));
    if (tasks.length) return Promise.all(tasks.map(task => this.cancelTask(task.route)));
    if (taskId) throw new Error('此任务已结束，不能取消后续任务。');
    return this.adapters.get(runtime)?.cancel({ conversationId, taskId });
  }
  interactions(input) { const task = this.find(input); return { ...(task.permission ? { permission: task.permission } : {}), ...(task.question ? { question: task.question } : {}) }; }
  respondPermission(input, requestId, optionId) { const task = this.find(input); if (task.permission?.requestId !== requestId) throw new Error('此授权请求已结束。'); const options = task.permission.options; const kind = Array.isArray(options) && options.length ? options.find(option => option.id === optionId)?.kind : optionId; if (['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(kind)) task.trace.decision(requestId, kind.startsWith('allow_') ? 'approved' : 'rejected'); return task.adapter.permission(task.route, requestId, optionId); }
  respondQuestion(input, requestId, answers) { const task = this.find(input); if (task.question?.requestId !== requestId || !task.adapter.question) throw new Error('此问题已结束。'); return task.adapter.question(task.route, requestId, answers); }
  permission(runtime, conversationId, requestId, optionId, taskId) {
    const task = [...this.tasks.values()].find(task => task.route.runtime === runtime && task.route.conversationId === conversationId && (!taskId || task.route.taskId === taskId) && task.permission?.requestId === requestId);
    if (!task) return this.adapters.get(runtime)?.permission({ conversationId, taskId }, requestId, optionId);
    return this.respondPermission(interactionRoute(task), requestId, optionId);
  }
  question(conversationId, requestId, answers) {
    const task = [...this.tasks.values()].find(task => task.route.runtime === 'dsh-native' && task.route.conversationId === conversationId && task.question?.requestId === requestId);
    if (!task) return this.adapters.get('dsh-native')?.question({ conversationId }, requestId, answers);
    return this.respondQuestion(interactionRoute(task), requestId, answers);
  }
  close() { this.closed = true; clearInterval(this.recoveryTimer); for (const task of this.tasks.values()) { task.cancelling = true; clearInterval(task.timer); clearTimeout(task.flush); void Promise.resolve(task.adapter.cancel(task.route)).catch(() => {}); } }
}
module.exports = { RuntimeRegistry };
