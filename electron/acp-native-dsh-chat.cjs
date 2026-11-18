const { createHash, randomUUID } = require('node:crypto');
const { mkdir, realpath } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');
const { AGENT_ID } = require('./acp-company.cjs');
const { DIFF_TOOL } = require('./acp-project-workflow.cjs');
const { AcpProjectTurn, projectFileTools } = require('./acp-project.cjs');
const { projectToolHost, SHELL_APPROVAL, USER_QUESTION, STEER_CLAIM, STEER_COMMAND } = require('./acp-dsh-project-tools.cjs');
const { NativeSubagentTree } = require('./acp-dsh-subagent-tree.cjs');
const subagentDetail = require('./acp-dsh-subagent-detail.cjs');
const { DshUserQuestion } = require('./acp-dsh-user-question.cjs');
const { rememberQuestion, forgetQuestion, savedQuestions } = require('./acp-dsh-recovery.cjs');
const { toolCatalog } = require('./acp-mcp.cjs');
const { DEFAULT_EXECUTION_SETTINGS } = require('./acp-execution-settings.cjs');
const { nativeEffort } = require('./acp-dsh-web-model.cjs');
const { listCommandRows, exactCommand, cleanText, belongsTo, taskState } = require('./acp-dsh-commands.cjs');
const { TEAM_COMMAND, TEAM_CLAIM } = require('./acp-dsh-teamwork.cjs');

const ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const CATALOG_SESSION = 'somnus-command-catalog';
const PRESETS = new Map([
  ['read_only', 'read-only'],
  ['workspace_write', 'read-only'],
  ['full', 'danger-full-access'],
]);
const PROVIDER = 'vvman-company';
const DATA_TOOLS = new Set(['create_deep_analysis', 'create_deep_analysis_from_query', 'get_deep_analysis_task']);
const ACTIVITY_LIMIT = 100;
const USAGE_FIELDS = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const ZERO_USAGE = Object.fromEntries(USAGE_FIELDS.map(key => [key, 0]));
const count = value => Number.isSafeInteger(value) && value >= 0;
const ACTIVITY_KINDS = new Map([
  ['pwsh', 'execute'], ['bash', 'execute'], ['read', 'read'], ['read_project_file', 'read'],
  ['glob', 'search'], ['grep', 'search'], ['write', 'edit'], ['edit', 'edit'],
  ['propose_project_file_create', 'edit'], ['propose_project_file_edit', 'edit'], ['subagent', 'tool'],
]);

function publicAssistantMessages(records) {
  const messages = [];
  for (const record of records ?? []) {
    const event = record.event;
    if (event?.type !== 'assistant/message' || event.data?.message?.role !== 'assistant') continue;
    const message = event.data.message;
    const text = message.content?.filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text).join('');
    if (text?.trim()) messages.push({ seq: event.seq, text });
  }
  return messages.sort((left, right) => left.seq - right.seq);
}

function turnUsage(baseline, current) {
  if (!baseline || !current || !USAGE_FIELDS.every(key => count(current[key]))) return undefined;
  const totals = USAGE_FIELDS.map(key => current[key] - baseline[key]);
  if (!totals.every(count) || !totals.some(Boolean)) return undefined;
  const [input, output, read, written] = totals;
  const allInput = input + read + written;
  if (!count(allInput)) return undefined;
  return { input_tokens: allInput, output_tokens: output, cached_input_tokens: read };
}

function nativeActivity(records, turn, cursor, update) {
  for (const { event } of records ?? []) {
    if (!event || event.seq <= cursor || turn.activitySeen.has(event.seq)) continue;
    turn.activitySeen.add(event.seq);
    const data = event.data;
    if (event.type === 'tool/call' && typeof data?.callId === 'string' && typeof data.name === 'string') {
      if (data.name === 'call_somnus_tool') continue;
      if (turn.activityCount >= ACTIVITY_LIMIT) {
        if (turn.activityCount++ === ACTIVITY_LIMIT) update({ acpActivityTruncated: true });
        continue;
      }
      turn.activityCount++;
      const title = data.name.slice(0, 80);
      const kind = ACTIVITY_KINDS.get(data.name) || 'tool';
      turn.activityCalls.set(data.callId, { title, kind, at: event.time });
      update({ acpTool: { id: 'dsh-' + data.callId, title, kind, status: 'in_progress' } });
    } else if (event.type === 'tool/result') {
      const message = data?.message;
      const call = turn.activityCalls.get(message?.toolCallId);
      if (!call) continue;
      turn.activityCalls.delete(message.toolCallId);
      const failed = message.isError === true;
      update({ acpTool: { id: 'dsh-' + message.toolCallId, title: call.title, kind: call.kind,
        status: failed ? 'failed' : 'completed',
        duration_ms: Math.max(0, event.time - call.at),
        ...(failed ? { failure_reason: typeof data.error?.reason === 'string'
          ? data.error.reason.slice(0, 180) : 'DSH 工具未返回可显示的失败原因。' } : {}),
      } });
    }
  }
}

async function activityPage(call, sessionId, afterSeq, update) {
  const address = { kind: 'session', sessionId };
  const latest = await call('events', { address, maxMessages: 8 });
  let page = latest;
  const window = [...(page.records ?? [])];
  for (let count = 1; count < 3; count++) {
    const beforeSeq = page.records?.[0]?.event?.seq;
    if (!page.hasMore || !Number.isInteger(beforeSeq) || beforeSeq <= afterSeq + 1) break;
    page = await call('events', { address, beforeSeq, throughSeq: latest.cursor, maxMessages: 8 });
    window.unshift(...(page.records ?? []));
  }
  if (page.hasMore && page.records?.[0]?.event?.seq > afterSeq + 1) update({ acpActivityTruncated: true });
  return { ...latest, records: window };
}

class NativeDshChat {
  constructor(market, projectClient, workflow) {
    this.market = market;
    this.projectClient = projectClient;
    this.workflow = workflow;
    this.running = new Map();
    this.sessions = new Map();
    this.commandRuns = new Map();
    this.continuedQuestions = new Map();
    market.openNativeProjectTools = () => projectToolHost((input, signal) => this.projectTool(input, signal));
  }

  sessionIdentity(conversationId, target) {
    const root = createHash('sha256').update(target.rootKey + '\0' + target.root.toLowerCase()).digest('hex').slice(0, 12);
    return 'somnus-' + conversationId + '-' + root;
  }

  async ensureCommandSession(server, sessionId, cwd) {
    const call = (method, request) => this.rpc(server, 'session/' + method, { request });
    try {
      return await call('state', { sessionId });
    } catch (error) {
      if (error.code !== 'session/not-found') throw error;
      const result = await call('create', { sessionId, cwd });
      if (result?.sessionId !== sessionId) throw new Error('DSH 未能打开命令会话。');
      return null;
    }
  }

  async commandRows(server, sessionId) {
    const profile = await this.market.webProfile();
    const results = await this.rpc(server, 'commands/list', { agentId: sessionId });
    const candidates = profile?.bundles.filter(bundle => !bundle.startsWith('@deepseek-ai/') &&
      Array.isArray(results) && results.some(item => belongsTo(item?.definitionId, bundle))) ?? [];
    const visible = Array.isArray(results) ? results.filter(item => ![STEER_COMMAND, TEAM_COMMAND].includes(item?.name)) : results;
    if (!candidates.length) return listCommandRows(visible, []);
    const inventory = await this.rpc(server, 'pluginInventory/list', {}).catch(() => null);
    const trusted = await Promise.all(candidates.map(async bundle => {
      const loaded = inventory?.entries?.some(entry => entry.enabled && entry.fiberPhase === 'active' &&
        belongsTo(entry.moduleName, bundle));
      return loaded && await this.market.community.installed(profile, bundle) ? bundle : null;
    }));
    return listCommandRows(visible, trusted.filter(Boolean));
  }

  async listCommands(input, validateSender) {
    const conversationId = input?.conversationId;
    if (conversationId != null && (typeof conversationId !== 'string' || !ID.test(conversationId))) return { commands: [] };
    const turn = this.running.get(conversationId);
    if (turn?.server && turn.sessionId) {
      return { commands: await this.commandRows(turn.server, turn.sessionId) };
    }
    const server = await this.market.settings(validateSender);
    if (conversationId) {
      const workspaceId = input.workspaceId && input.workspaceId !== 'default' ? input.workspaceId : undefined;
      const target = await this.scope({ workspace_id: workspaceId }, input, AbortSignal.timeout(5000)).catch(() => null);
      if (target) {
        const sessionId = this.sessionIdentity(conversationId, target);
        const state = await this.rpc(server, 'session/state', { request: { sessionId } }).catch(error => {
          if (error.code !== 'session/not-found') throw error;
          return null;
        });
        validateSender();
        if (state) return { commands: await this.commandRows(server, sessionId) };
      }
    }
    const home = await realpath(this.market.home);
    const cwd = path.join(home, 'somnus-command-catalog');
    await mkdir(cwd, { recursive: true });
    if ((await realpath(cwd)).toLowerCase() !== cwd.toLowerCase()) throw new Error('DSH 命令目录位置异常。');
    validateSender();
    await this.ensureCommandSession(server, CATALOG_SESSION, cwd);
    return { commands: await this.commandRows(server, CATALOG_SESSION) };
  }

  async readTaskState(server, sessionId, projection) {
    projection ??= await this.rpc(server, 'session/projections', { request: { sessionId } });
    const liveGoal = projection?.values?.goal?.goal
      ? await this.rpc(server, 'goals/get', { agentId: sessionId }).catch(() => null) : null;
    return taskState(projection?.values, liveGoal);
  }

  async taskState(input, validateSender) {
    const { conversationId, workspaceId } = input ?? {};
    if (typeof conversationId !== 'string' || !ID.test(conversationId)) return {};
    const turn = this.running.get(conversationId);
    if (turn?.server && turn.sessionId) return this.readTaskState(turn.server, turn.sessionId);
    const target = await this.scope({ workspace_id: workspaceId === 'default' ? undefined : workspaceId },
      input, AbortSignal.timeout(5000)).catch(() => null);
    if (!target) return {};
    const server = await this.market.settings(validateSender);
    validateSender();
    const sessionId = this.sessionIdentity(conversationId, target);
    return this.readTaskState(server, sessionId).catch(error => {
      if (error.code === 'session/not-found') return {};
      throw error;
    });
  }

  async executeCommand(input, validateSender, update = () => {}) {
    const { conversationId, turnId, agentId, line } = input ?? {};
    if (agentId !== AGENT_ID || typeof conversationId !== 'string' || !ID.test(conversationId) ||
        typeof turnId !== 'string' || !ID.test(turnId)) throw new Error('无效的 DSH 命令会话。');
    const name = exactCommand(line);
    const args = line.slice(name.length + 1).trim().toLowerCase();
    if (name === 'plan' && args !== '' && args !== 'off') {
      return { ok: false, text: '请先用 /plan 开启计划模式，再在下一条消息描述任务。' };
    }
    if (name === 'goal' && !['', 'pause', 'clear'].includes(args)) {
      const result = await this.prompt(input, validateSender, update, line);
      return { ...result, ok: result.stopReason !== 'cancelled' && result.stopReason !== 'command_error' };
    }
    if (this.running.has(conversationId) || this.commandRuns.has(conversationId)) throw new Error('此聊天仍在运行。');
    const controller = new AbortController();
    this.commandRuns.set(conversationId, controller);
    let server;
    try {
      const prepared = await this.projectClient.prepare({ conversationId, turnId, agentId }, controller.signal);
      const reservedLine = prepared.text?.split('\n\n', 1)[0]?.trim();
      if (reservedLine !== line.trim()) throw new Error('命令与此轮已提交的消息不一致。');
      server = await this.market.settings(validateSender, true);
      if (prepared.company_revision !== server.modelRevision) throw new Error('DSH 模型配置变更，请重新发送。');
      const target = await this.scope(prepared, input, controller.signal);
      const sessionId = this.sessionIdentity(conversationId, target);
      const state = await this.ensureCommandSession(server, sessionId, target.root);
      if (state?.running || state?.queue?.length || state?.pendingInput?.length) throw new Error('原 DSH 会话仍在运行或等待处理。');
      const catalog = await this.commandRows(server, sessionId);
      const command = catalog.find(entry => entry.name === name);
      if (!command?.executable) return { ok: false, text: command?.reason ?? '当前 DSH 会话中没有此命令。' };
      const preset = PRESETS.get(prepared.permission_mode);
      if (!preset) throw new Error('当前聊天的文件权限无法映射到 DSH。');
      const permission = await this.rpc(server, 'commands/execute', {
        agentId: sessionId, line: '/permission ' + preset, submittedAttachments: [],
      });
      if (permission?.result?.kind !== 'success' || permission.result.text !== 'preset ' + preset) {
        throw new Error('托管 DSH 未确认当前聊天的文件访问模式。');
      }
      validateSender();
      controller.signal.throwIfAborted();
      const execution = await this.market.account.request(server, 'commands/execute', {
        agentId: sessionId, line, submittedAttachments: [],
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
      if (!['success', 'error'].includes(execution?.result?.kind)) return { ok: false, text: 'DSH 未完成此命令。' };
      const ok = execution.result.kind === 'success';
      return { ok, text: cleanText(execution.result.text, 16_000) || (ok ? '命令已执行。' : '命令未完成。'),
        ...(['goal', 'plan'].includes(name) ? { taskState: await this.readTaskState(server, sessionId) } : {}) };
    } finally {
      this.market.releaseChatSettings(server);
      this.commandRuns.delete(conversationId);
    }
  }

  async subagentDetail(input, validateSender, tool = false) {
    if (!subagentDetail.checked(input)) return null;
    const { conversationId, turnId, subagentId } = input;
    const read = (call, range) => tool
      ? subagentDetail.readToolDetail(call, range, input.seq, input.offset)
      : subagentDetail.readDetail(call, range, input.beforeSeq);
    const turn = this.running.get(conversationId);
    if (turn?.turnId === turnId) {
      validateSender();
      return read(turn.call, turn.tree?.ranges.get(subagentId));
    }
    if (!await this.projectClient.hasNativeSubagent(conversationId, turnId, subagentId)) return null;
    const range = await subagentDetail.loadRange(this.market.home, input);
    if (!range) return null;
    const server = await this.market.settings(validateSender);
    validateSender();
    return read((method, request) => this.rpc(server, 'session/' + method, { request }), range);
  }

  async projectTool(input, signal) {
    const turn = this.sessions.get(input.sessionId);
    if (input.name === TEAM_CLAIM) {
      if (!turn?.teamworkRequest || turn.teamworkRequest.id !== input.requestId || turn.signal.aborted) {
        throw new Error('会话团队协作设置尚未授权。');
      }
      const { enabled } = turn.teamworkRequest;
      delete turn.teamworkRequest;
      return { enabled };
    }
    if (!turn?.submitted || (turn.turnId !== input.requestId && !turn.questionSources.has(input.requestId) &&
        !turn.steerSources.has(input.requestId) &&
        (!turn.goalId || input.requestId !== 'goal:' + turn.goalId)) || !turn.project ||
        !input.args || Array.isArray(input.args) || typeof input.args !== 'object') {
      throw new Error('此项目操作不在当前 Somnus 聊天的授权范围内。');
    }
    const active = AbortSignal.any([turn.signal, signal]);
    active.throwIfAborted();
    if (input.name === STEER_CLAIM) {
      const pending = turn.pendingSteer;
      if (!pending?.content || pending.claimed || pending.id !== input.args.steerId) {
        throw new Error('没有待送入当前任务的消息。');
      }
      pending.claimed = true;
      turn.steerSources.add(pending.id);
      return { content: pending.content, afterSeq: turn.cursor };
    }
    if (input.name === SHELL_APPROVAL) return this.shellApproval(turn, input.args, active);
    if (input.name === USER_QUESTION) return this.userQuestion(turn, input.args, active);
    if (input.name === 'call_somnus_tool') return this.extensionTool(turn, input.args, active);
    if (!turn.projectTools.has(input.name)) throw new Error('此项目操作不在当前 Somnus 聊天的授权范围内。');
    return turn.project.mcpFile(input.name, input.args, active);
  }

  async setTeamwork(conversationId, enabled, validateSender) {
    if (typeof conversationId !== 'string' || !ID.test(conversationId) || typeof enabled !== 'boolean') {
      throw new Error('无效的会话团队协作设置。');
    }
    const state = await this.market.teamwork(conversationId);
    validateSender();
    if (!state.available) return state;
    if (this.running.has(conversationId) || this.commandRuns.has(conversationId)) {
      throw new Error('请等当前会话运行结束后再切换团队协作。');
    }
    this.market.executionSettings.setTeamwork(conversationId, enabled);
    return { available: true, enabled };
  }

  async configureTeamwork(turn) {
    const enabled = this.market.executionSettings?.teamwork?.(turn.conversationId) === true;
    if (!turn.server.teamwork) {
      if (enabled) throw new Error('当前运行时无法启用团队协作。');
      return;
    }
    const id = randomUUID();
    turn.teamworkRequest = { id, enabled };
    try {
      const command = await this.rpc(turn.server, 'commands/execute', {
        agentId: turn.sessionId, line: '/' + TEAM_COMMAND + ' ' + id, submittedAttachments: [],
      });
      if (command?.result?.kind !== 'success' || command.result.text !== (enabled ? 'enabled' : 'disabled')) {
        throw new Error('未能应用当前会话的团队协作设置。');
      }
    } finally { delete turn.teamworkRequest; }
  }

  steerScope(conversationId, turnId) {
    const turn = this.running.get(conversationId);
    if (turn?.turnId !== turnId || !turn.submitted || !turn.project || turn.signal.aborted) return null;
    return turn.steerScope ?? null;
  }

  async steer(input, validateSender) {
    const { conversationId, turnId, steerId } = input ?? {};
    if (![conversationId, turnId].every(id => typeof id === 'string' && ID.test(id)) ||
        typeof steerId !== 'string' || !/^[a-f0-9]{32}$/.test(steerId)) {
      throw new Error('无效的追加消息。');
    }
    const turn = this.running.get(conversationId);
    if (turn?.turnId !== turnId || !turn.submitted || !turn.project || turn.pendingSteer || turn.signal.aborted) {
      return { accepted: false };
    }
    const pending = { id: steerId };
    turn.pendingSteer = pending;
    pending.done = (async () => {
      let accepted = false;
      let prepared = false;
      try {
        const { content } = await this.projectClient.prepareSteer(turn, steerId, turn.signal);
        prepared = true;
        if (typeof content !== 'string' || !content.trim() || content.length > 16_000) throw new Error('追加消息无效。');
        pending.content = content;
        validateSender();
        turn.signal.throwIfAborted();
        const response = await this.rpc(turn.server, 'commands/execute', {
          agentId: turn.sessionId, line: '/' + STEER_COMMAND + ' ' + steerId, submittedAttachments: [],
        });
        accepted = pending.claimed === true && response?.result?.kind === 'success' && response.result.text === 'accepted';
      } finally {
        if (!accepted) turn.steerSources.delete(steerId);
        if (prepared) {
          let receipt;
          try {
            receipt = await this.projectClient.finishSteer(turn, steerId, accepted);
          } catch (error) {
            if (!accepted) throw error;
            // The local request may have committed before its response reached this process.
            const message = await this.projectClient.steerMessage(conversationId, steerId);
            receipt = message ? { message } : await this.projectClient.finishSteer(turn, steerId, true);
          }
          pending.receipt = { accepted, ...(receipt?.message ? { message: receipt.message } : {}) };
        }
      }
      return pending.receipt;
    })();
    try {
      return await pending.done;
    } finally {
      if (turn.pendingSteer === pending) delete turn.pendingSteer;
    }
  }

  userQuestion(turn, args, signal) {
    if (turn.questionCount >= 30) throw new Error('本轮 DSH 提问数量已达上限。');
    turn.questionCount++;
    const question = new DshUserQuestion(turn, args.questions, signal, args.countdown, args.durableCallId);
    return this.queueInteraction(turn, async () => {
      turn.pendingQuestion = question;
      try {
        if (question.callId) await rememberQuestion(this.market.home, {
          conversationId: turn.conversationId, turnId: turn.turnId, sessionId: turn.sessionId,
          requestId: question.requestId, callId: question.callId,
        }).catch(() => {});
        const result = await question.wait();
        if (result.expired) turn.expiredQuestions.set(question.callId, question);
        if (question.callId && !result.expired && !signal.aborted) {
          await forgetQuestion(this.market.home, turn.conversationId, question.requestId).catch(() => {});
        }
        return result;
      } finally {
        delete turn.pendingQuestion;
      }
    });
  }

  async respondQuestion(conversationId, requestId, answers) {
    const turn = this.running.get(conversationId);
    if (turn?.pendingQuestion?.requestId === requestId) return turn.pendingQuestion.respond(requestId, answers);
    const question = this.continuedQuestion(conversationId, requestId);
    if (answers === null) {
      await forgetQuestion(this.market.home, conversationId, requestId);
      this.continuedQuestions.delete(requestId);
      turn?.onUpdate({ agentId: turn.agentId, conversationId, text: '', dshQuestionClosed: { requestId } });
      return;
    }
    if (!turn || turn.sessionId !== question.sessionId) throw new Error('请从该问题提交补答以继续聊天。');
    return this.sendLateAnswer(turn, question, answers);
  }

  holdQuestion(conversationId, requestId, held) {
    const question = this.running.get(conversationId)?.pendingQuestion;
    if (!question) throw new Error('此问题没有可暂停的倒计时。');
    question.hold(requestId, held);
  }

  continuedQuestion(conversationId, requestId) {
    const question = this.continuedQuestions.get(requestId);
    if (!question || question.conversationId !== conversationId) throw new Error('此 DSH 问题已结束或不可用。');
    return question;
  }

  async recoverQuestions(conversationId, validateSender) {
    if (typeof conversationId !== 'string' || !ID.test(conversationId)) return [];
    const turn = this.running.get(conversationId);
    const current = () => [
      ...(turn?.pendingQuestion ? [turn.pendingQuestion] : []),
      ...[...this.continuedQuestions.values()].filter(item => item.conversationId === conversationId),
    ].map(item => item.publicView());
    if (turn) return current();
    const records = await savedQuestions(this.market.home, conversationId);
    if (!records.length) return current();
    const turns = await this.projectClient.nativeTurnIds(conversationId);
    const approved = records.filter(item => turns.has(item.turnId));
    if (!approved.length || this.running.has(conversationId)) return current();
    let server;
    try {
      server = await this.market.settings(validateSender, true);
      const call = (method, request) => this.rpc(server, 'session/' + method, { request });
      const activeBySession = new Map();
      for (const record of approved) {
        if (this.running.has(conversationId)) break;
        if (!activeBySession.has(record.sessionId)) {
          const request = { sessionId: record.sessionId };
          let result = await call('projections', request).catch(() => null);
          if (result?.values?.userQuestions?.active?.some(item => item.state === 'open')) {
            const state = await call('state', request);
            if (!state?.running && !this.running.has(conversationId)) {
              await call('selectModel', { ...request, provider: PROVIDER, model: server.companyModel });
              result = await call('projections', request);
            }
          }
          activeBySession.set(record.sessionId, result?.values?.userQuestions?.active);
        }
        const items = activeBySession.get(record.sessionId);
        const native = items?.find(item => item.callId === record.callId);
        if (native?.state === 'continued') {
          try {
            const question = DshUserQuestion.recover({ ...record, agentId: AGENT_ID }, native.questions);
            this.keepContinued(question);
          } catch { /* Unsupported question types are unavailable for late answers. */ }
        } else if (Array.isArray(items) && !native) {
          await forgetQuestion(this.market.home, conversationId, record.requestId).catch(() => {});
          this.continuedQuestions.delete(record.requestId);
        }
      }
      validateSender();
      return current();
    } finally {
      this.market.releaseChatSettings(server);
    }
  }

  keepContinued(question) {
    if (this.continuedQuestions.has(question.requestId)) return;
    if (this.continuedQuestions.size >= 100) this.continuedQuestions.delete(this.continuedQuestions.keys().next().value);
    this.continuedQuestions.set(question.requestId, question);
  }

  async sendLateAnswer(turn, question, answers) {
    if (turn.sessionId !== question.sessionId || question.submitting) throw new Error('此 DSH 问题正在处理或工作区已变更。');
    const answer = question.lateAnswer(answers);
    if (answer.cancelled) throw new Error('请提供有效的补答内容。');
    question.submitting = true;
    const source = 'late-question:' + question.callId;
    turn.questionSources.add(source);
    try {
      const accepted = await this.rpc(turn.server, 'userQuestions/answer', {
        agentId: turn.sessionId, callId: question.callId, answer,
      });
      if (accepted !== true) {
        turn.questionSources.delete(source);
        this.continuedQuestions.delete(question.requestId);
        throw new Error('原问题已结束，DSH 无法接收补答。');
      }
      await forgetQuestion(this.market.home, turn.conversationId, question.requestId).catch(() => {});
      this.continuedQuestions.delete(question.requestId);
      turn.onUpdate({ agentId: turn.agentId, conversationId: turn.conversationId, text: '',
        dshQuestionClosed: { requestId: question.requestId } });
      return { accepted };
    } finally {
      question.submitting = false;
    }
  }

  async updateContinuedQuestions(turn) {
    if (!turn.expiredQuestions.size) return;
    const result = await turn.call('projections', { sessionId: turn.sessionId });
    for (const entry of result?.values?.userQuestions?.active ?? []) {
      if (entry.state !== 'continued') continue;
      const question = turn.expiredQuestions.get(entry.callId);
      if (!question) continue;
      turn.expiredQuestions.delete(entry.callId);
      this.keepContinued(question);
      question.continued();
    }
  }

  async shellApproval(turn, args, signal) {
    const { callId, command, cwd, timeoutMs, mode, justification } = args;
    const rejected = { outcome: 'rejected' };
    if (typeof callId !== 'string' || !callId || callId.length > 256 || turn.shellCalls.has(callId) ||
        typeof command !== 'string' || !command.trim() || command.length > 32_768 || command.includes('\0') ||
        typeof cwd !== 'string' || !/^[a-z]:[\\/]/i.test(cwd) || cwd.length > 2048 || /[\x00-\x1f]/.test(cwd) ||
        !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
        !['workspace-write', 'danger-full-access'].includes(mode) ||
        typeof justification !== 'string' || !justification.trim() || justification.length > 2000 ||
        turn.shellCalls.size >= 40) return rejected;
    turn.shellCalls.add(callId);
    const allowed = await this.requestPermission(turn, justification, 'powershell', signal, {
      kind: 'powershell', command, cwd, timeoutSeconds: Math.ceil(timeoutMs / 1000), sandboxMode: mode,
    });
    return { outcome: allowed && !signal.aborted ? 'allowed-once' : 'rejected' };
  }

  async extensionTool(turn, request, signal) {
    const selected = turn.extensions.get(request.name);
    const args = request.arguments;
    if (!selected || !args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('此工具或参数未获准用于当前 Somnus 请求。');
    }
    const limits = (this.market.executionSettings?.get() ?? DEFAULT_EXECUTION_SETTINGS).loop;
    if (turn.toolCalls >= limits.maxCalls || turn.activeTools >= limits.maxConcurrent) {
      throw new Error('本轮 Somnus 工具调用已达到次数或并发上限。');
    }
    turn.toolCalls++;
    turn.activeTools++;
    const callId = 'native-extension-' + turn.toolCalls;
    const progress = (status, message, taskId) => turn.onUpdate({
      agentId: turn.agentId, conversationId: turn.conversationId, text: '',
      toolProgress: { name: selected.name, callId, status, ...(message ? { message } : {}), ...(taskId ? { taskId } : {}) },
    });
    try {
      let confirmed = false;
      if (selected.requires_confirmation) {
        confirmed = await this.requestPermission(turn, '允许调用 ' + selected.name + '？', 'mcp', signal);
        if (!confirmed) throw new Error('本次 MCP 工具调用未获批准。');
      }
      signal.throwIfAborted();
      progress('running');
      const result = await this.projectClient.tool(turn, {
        name: selected.name, arguments: args, ...(confirmed ? { confirmed: true } : {}),
      }, signal);
      signal.throwIfAborted();
      if (result.isError) throw new Error(result.failure_reason || 'Somnus 工具未完成。');
      const text = (result.content ?? []).slice(0, 24).filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text).join('\n');
      if (Buffer.byteLength(text) > 512 * 1024) throw new Error('Somnus 工具结果过大，请缩小查询范围。');
      let taskId;
      if (DATA_TOOLS.has(selected.name)) {
        try { taskId = JSON.parse(text).task_id; } catch { /* status may be plain text */ }
      }
      progress('complete', undefined, taskId);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      if (!signal.aborted) progress('error', error.message.slice(0, 180));
      throw error;
    } finally {
      turn.activeTools--;
    }
  }

  requestPermission(turn, title, kind, signal, details) {
    return this.queueInteraction(turn, () => this.showPermission(turn, title, kind, signal, details));
  }

  queueInteraction(turn, show) {
    const decision = turn.interactionQueue.then(show);
    turn.interactionQueue = decision.catch(() => {});
    return decision;
  }

  async showPermission(turn, title, kind, signal, details) {
    if (signal.aborted) return false;
    const requestId = randomUUID();
    const expiresAt = Date.now() + 120_000;
    const update = fields => turn.onUpdate({ agentId: turn.agentId, conversationId: turn.conversationId, text: '', ...fields });
    let close;
    let timer;
    try {
      const decision = new Promise(resolve => {
        close = () => resolve(false);
        turn.pendingPermission = { requestId, resolve, expiresAt };
        timer = setTimeout(close, expiresAt - Date.now());
        signal.addEventListener('abort', close, { once: true });
      });
      update({ acpPermission: { requestId, title, kind, expiresAt, ...(details ? { details } : {}),
        options: [{ id: 'allow_once', name: '仅允许这次', kind: 'allow_once' },
          { id: 'reject_once', name: '拒绝', kind: 'reject_once' }] } });
      return await decision;
    } finally {
      clearTimeout(timer);
      if (close) signal.removeEventListener('abort', close);
      delete turn.pendingPermission;
      update({ acpPermissionClosed: { requestId } });
    }
  }

  respondPermission(conversationId, requestId, optionId) {
    const turn = this.running.get(conversationId);
    const pending = turn?.pendingPermission;
    if (!pending || pending.requestId !== requestId || pending.expiresAt <= Date.now() || turn.signal.aborted ||
        (optionId != null && !['allow_once', 'reject_once'].includes(optionId))) {
      throw new Error('此授权请求已结束或不可用。');
    }
    pending.resolve(optionId === 'allow_once');
    delete turn.pendingPermission;
  }

  async scope(prepared, input, signal) {
    if (input.workspaceId && input.workspaceId !== (prepared.workspace_id || 'default')) {
      throw new Error('此聊天的项目已变更，请重新选择项目。');
    }
    if (prepared.workspace_id) {
      const source = prepared.project_sources?.[0]?.source;
      return this.workflow.target(prepared.workspace_id, DIFF_TOOL, { source }, signal, input.conversationId);
    }
    const home = await realpath(this.market.home);
    const parent = path.join(home, 'somnus-conversations');
    const directory = path.join(parent, input.conversationId);
    await mkdir(directory, { recursive: true });
    const root = await realpath(directory);
    if (root.toLowerCase() !== directory.toLowerCase()) throw new Error('DSH 聊天目录位置异常。');
    return { root, rootKey: 'local' };
  }

  rpc(server, method, args) {
    return this.market.account.request(server, method, args, AbortSignal.timeout(8_000));
  }

  async prompt(input, validateSender, update, goalLine = null) {
    if (!input || input.agentId !== AGENT_ID || !ID.test(input.conversationId ?? '') || !ID.test(input.turnId ?? '')) {
      throw new Error('无效的 DSH 聊天请求。');
    }
    const { conversationId, turnId, agentId } = input;
    if (this.running.has(conversationId) || this.commandRuns.has(conversationId)) throw new Error('此聊天仍在运行。');
    const turn = { conversationId, turnId, agentId, controller: new AbortController(), text: '', submitted: false,
      toolCalls: 0, activeTools: 0, onUpdate: update, activityCount: 0, activitySeen: new Set(),
      activityCalls: new Map(), shellCalls: new Set(), questionCount: 0, interactionQueue: Promise.resolve(),
      questionSources: new Set(), expiredQuestions: new Map(), steerSources: new Set() };
    this.running.set(conversationId, turn);
    const signal = turn.controller.signal;
    turn.signal = signal;
    const notify = (fields) => update({ conversationId, agentId, text: '', ...fields });
    let usage;
    let contextUsage;
    const metering = partial => ({
      ...(usage ? { usage: partial ? { ...usage, partial: true } : usage } : {}),
      ...(contextUsage ? { contextUsage } : {}),
    });
    try {
      notify({ acpStage: 'preparing' });
      const prepared = await this.projectClient.prepare({ conversationId, turnId, agentId }, signal);
      if (goalLine && (prepared.text?.split('\n\n', 1)[0]?.trim() !== goalLine.trim() ||
          prepared.images?.length || input.questionReply)) {
        throw new Error('目标命令与此轮消息不一致。');
      }
      turn.extensions = new Map(toolCatalog(prepared.tools?.filter(tool =>
        typeof tool?.name === 'string' && (tool.name.startsWith('mcp__') || DATA_TOOLS.has(tool.name)))
      ).map(tool => [tool.name, tool]));
      const preset = PRESETS.get(prepared.permission_mode);
      if (!preset) throw new Error('当前聊天的文件访问模式无法在 DSH 中应用。');
      notify({ acpStage: 'connecting' });
      const server = await this.market.settings(validateSender, true);
      turn.server = server;
      if (!server.companyModel) throw new Error('托管 DSH 的公司模型未就绪。');
      if ((prepared.company_revision || server.modelRevision) && prepared.company_revision !== server.modelRevision) {
        throw new Error('DSH 模型配置刚刚变更，请重新发送消息。');
      }
      const target = await this.scope(prepared, input, signal);
      const sessionId = this.sessionIdentity(conversationId, target);
      if (prepared.permission_mode === 'workspace_write' && prepared.workspace_id && !server.projectTools) {
        throw new Error('托管 DSH 的项目写入确认工具未就绪。');
      }
      if (turn.extensions.size && !server.projectTools) throw new Error('托管 DSH 的本轮工具未就绪。');
      const call = (method, request) => this.rpc(server, 'session/' + method, { request });
      turn.call = call;
      turn.sessionId = sessionId;
      if (server.projectTools) {
        turn.project = new AcpProjectTurn(this.projectClient, turn, prepared);
        turn.projectTools = new Set(projectFileTools(prepared).map(tool => tool.name));
        this.sessions.set(sessionId, turn);
      }
      let state;
      try {
        state = await call('state', { sessionId });
      } catch (error) {
        if (error.code !== 'session/not-found') throw error;
        const created = await call('create', { sessionId, cwd: target.root });
        if (created?.sessionId !== sessionId) throw new Error('托管 DSH 未返回预期的聊天。');
      }
      if (state?.running || state?.queue?.length || state?.pendingInput?.length) {
        throw new Error('原有 DSH 请求仍在运行或等待处理。');
      }
      await this.configureTeamwork(turn);
      const permission = await this.rpc(server, 'commands/execute', {
        agentId: sessionId, line: '/permission ' + preset, submittedAttachments: [],
      });
      if (permission?.result?.kind !== 'success' || permission.result.text !== 'preset ' + preset) {
        throw new Error('托管 DSH 未确认当前聊天的文件访问模式。');
      }
      const model = prepared.company_model ?? server.companyModel;
      const configured = server.companyModels.find(item => item.id === model);
      const effort = prepared.company_reasoning_effort == null
        ? configured?.defaultReasoningEffort : nativeEffort(prepared.company_reasoning_effort);
      if (!configured || (prepared.company_reasoning_effort != null &&
          (!effort || !Object.hasOwn(configured.reasoningEfforts ?? {}, effort)))) {
        throw new Error('本轮选择的公司模型或思考强度不可用。');
      }
      const selection = await call('selectModel', { sessionId, provider: PROVIDER, model,
        ...(effort ? { reasoningEffort: effort } : {}) });
      if (selection?.selected?.provider !== PROVIDER || selection.selected.model !== model ||
          (effort && selection.selected.reasoningEffort !== effort)) {
        throw new Error('托管 DSH 未确认当前聊天的公司模型。');
      }
      turn.steerScope = { agentId, permission: prepared.permission_mode, model };
      const { cursor } = await call('state', { sessionId });
      turn.cursor = cursor;
      const previousGoal = await this.rpc(server, 'goals/get', { agentId: sessionId }).catch(() => null);
      if (previousGoal?.phase === 'active' && previousGoal.activation === 'armed') {
        throw new Error('此聊天已有目标在继续运行。请先暂停该目标。');
      }
      const tree = new NativeSubagentTree(call, sessionId, notify);
      turn.tree = tree;
      await tree.capture();
      const beforeUsage = await call('projections', { sessionId }).catch(() => null);
      const baseline = beforeUsage?.values ? beforeUsage.values.tokenUsage ?? ZERO_USAGE : null;
      let lastTaskState = '';
      const publishTaskState = async () => {
        const projection = await call('projections', { sessionId }).catch(() => null);
        if (!projection) return null;
        const fresh = turnUsage(baseline, projection.values?.tokenUsage);
        if (fresh) {
          usage = fresh;
          const { pressureTokens, contextWindow } = projection.values?.contextPressure ?? {};
          if (!contextUsage || contextUsage.used_tokens !== pressureTokens || contextUsage.max_tokens !== contextWindow) {
            if (count(pressureTokens) && count(contextWindow) && contextWindow > 0) {
              contextUsage = { used_tokens: pressureTokens, max_tokens: contextWindow };
              notify({ contextUsage });
            }
          }
        }
        const current = await this.readTaskState(server, sessionId, projection).catch(() => null);
        const serialized = JSON.stringify(current);
        if (current && serialized !== lastTaskState) notify({ dshTaskState: current });
        lastTaskState = serialized;
        return current;
      };
      validateSender();
      signal.throwIfAborted();
      const projectInstructions = turn.projectTools?.has('propose_project_file_edit')
        ? '\n\nSomnus 项目文件请使用 read_project_file 读取原文及版本。需要更新文件时调用 propose_project_file_edit；新建文件请使用 propose_project_file_create。候选交由用户在 Somnus 查看准确差异并应用，操作返回 pending 表示文件尚未写入。'
        : '';
      const extensionInstructions = turn.extensions.size
        ? '\n\n本轮 Somnus 工具。使用 call_somnus_tool，按以下清单传 name 和 arguments：\n' +
          [...turn.extensions.values()].map(tool => JSON.stringify(tool)).join('\n').slice(0, 100_000)
        : '\n\n本轮没有可通过 call_somnus_tool 调用的个人插件或分析工具。';
      const questionInstructions = '\n\n如需用户选择而且仍有独立工作可做，ask_user_question 可传 timeout:120，倒计时结束后继续，用户可以补答。必须先得到答案才能继续的问题保持阻塞等待。';
      const text = prepared.text + projectInstructions + extensionInstructions + questionInstructions;
      const images = (prepared.images ?? []).map(image => ({
        type: 'image', mediaType: image.mimeType, data: image.data,
      }));
      turn.submitted = true;
      let goalCommand;
      if (goalLine) {
        const catalog = await this.commandRows(server, sessionId);
        if (!catalog.some(command => command.name === 'goal' && command.executable)) {
          throw new Error('当前聊天中没有可用的目标命令。');
        }
        turn.goalSession = true;
        goalCommand = await this.rpc(server, 'commands/execute', {
          agentId: sessionId, line: goalLine, submittedAttachments: [],
        });
        if (goalCommand?.result?.kind !== 'success') {
          turn.goalSession = false;
          return { text: cleanText(goalCommand?.result?.text, 16000) || '目标命令未完成。',
            stopReason: 'command_error', modelName: model, taskState: await publishTaskState() };
        }
        const goal = await this.rpc(server, 'goals/get', { agentId: sessionId });
        if (typeof goal?.id !== 'string') throw new Error('无法确认本轮目标。');
        turn.goalId = goal.id;
      }
      const receipt = goalLine ? { accepted: true } : input.questionReply
        ? await this.sendLateAnswer(turn, this.continuedQuestion(conversationId, input.questionReply.requestId), input.questionReply.answers)
        : await call('prompt', { sessionId, requestId: turnId, mode: 'queue',
        content: [{ type: 'text', text }, ...images] }).catch(error => {
        if (error.code !== 'session/attachment-invalid') throw error;
        throw new Error('DSH 无法打开本轮图片。请重新添加有效图片，并确认公司模型支持图片输入。');
      });
      if (receipt?.accepted !== true) throw new Error('无法确认 DSH 是否已接收本条消息。');
      const deadline = Date.now() + 12 * 60_000;
      let activityCursor = cursor;
      notify({ acpStage: 'thinking' });
      await publishTaskState();
      while (Date.now() < deadline && !signal.aborted) {
        const result = await call('wait', { sessionId, timeoutMs: 1_000, afterSeq: cursor, maxMessages: 100 });
        if (signal.aborted) break;
        if (result.output?.truncated) throw new Error('本轮 DSH 回复超出读取范围。');
        const output = publicAssistantMessages(result.output?.records).map(message => message.text).join('\n\n');
        if (output.length > turn.text.length && output.startsWith(turn.text)) {
          const delta = output.slice(turn.text.length);
          turn.text = output;
          notify({ text: delta, acpStage: 'responding' });
        }
        let page;
        if (result.state?.cursor > activityCursor || result.reason === 'idle') {
          page = await activityPage(call, sessionId, activityCursor, notify);
          nativeActivity(page.records, turn, cursor, notify);
          activityCursor = page.cursor;
          await publishTaskState();
          if (!turn.goalId && !goalLine) {
            const goal = await this.rpc(server, 'goals/get', { agentId: sessionId }).catch(() => null);
            if (goal?.phase === 'active' && goal.activation === 'armed' && typeof goal.id === 'string' &&
                (goal.id !== previousGoal?.id || goal.revision !== previousGoal?.revision)) {
              turn.goalId = goal.id;
              turn.goalSession = true;
            }
          }
        }
        await tree.refresh();
        await this.updateContinuedQuestions(turn);
        if (result.reason === 'input-required') {
          if (turn.pendingPermission || turn.pendingQuestion) continue;
          throw new Error('DSH 请求确认或补充信息，请调整当前聊天的授权后再试。');
        }
        if (result.reason === 'idle') {
          if (turn.goalId) {
            const goal = await this.rpc(server, 'goals/get', { agentId: sessionId });
            if (goal?.id !== turn.goalId) throw new Error('本轮目标已变更。');
            if (goal.phase === 'active' && goal.activation === 'armed') {
              await delay(250, undefined, { signal });
              continue;
            }
            return { text: turn.text || cleanText(goalCommand?.result?.text, 16000) || '目标状态已更新。',
              stopReason: 'end_turn', modelName: model, taskState: await publishTaskState(),
              ...metering(false),
              ...(turn.project?.proposals.length ? { projectProposals: turn.project.proposals } : {}) };
          }
          const end = page.records?.findLast(record => record.event?.type === 'turn/end' && record.event.seq > cursor);
          if (!end || end.event.data?.reason?.kind !== 'completed' || !turn.text) {
            throw new Error('DSH 已结束本轮，但没有完成可显示的回复。');
          }
          return { text: turn.text, stopReason: 'end_turn', modelName: model,
            ...metering(false),
            ...(turn.project?.proposals.length ? { projectProposals: turn.project.proposals } : {}) };
        }
      }
      if (!signal.aborted) throw new Error('等待 DSH 完成本轮超时。');
      await this.pauseTrackedGoal(turn).catch(() => {});
      return { text: turn.text, stopReason: 'cancelled', modelName: model, ...metering(true) };
    } catch (error) {
      await this.pauseTrackedGoal(turn).catch(() => {});
      if (turn.submitted) await turn.call('cancel', { sessionId: turn.sessionId }).catch(() => {});
      if (signal.aborted) return { text: turn.text, stopReason: 'cancelled', ...metering(true) };
      throw error;
    } finally {
      if (turn.tree) {
        await turn.pendingSteer?.done.catch(() => {});
        await subagentDetail.saveRanges(this.market.home, conversationId, turnId, turn.tree.ranges).catch(() => {});
      }
      this.running.delete(conversationId);
      if (turn.sessionId && this.sessions.get(turn.sessionId) === turn) this.sessions.delete(turn.sessionId);
      this.market.releaseChatSettings(turn.server);
    }
  }

  async cancel(conversationId) {
    this.commandRuns.get(conversationId)?.abort();
    const turn = this.running.get(conversationId);
    if (!turn) return;
    turn.controller.abort();
    await this.pauseTrackedGoal(turn).catch(() => {});
    if (turn.submitted) await turn.call('cancel', { sessionId: turn.sessionId }).catch(() => {});
  }

  async pauseTrackedGoal(turn) {
    if (!turn.goalSession) return;
    const goal = await this.rpc(turn.server, 'goals/get', { agentId: turn.sessionId });
    if (goal?.phase !== 'active' || (turn.goalId && turn.goalId !== goal.id)) return;
    await this.rpc(turn.server, 'goals/pause', {
      agentId: turn.sessionId, ref: { id: goal.id, revision: goal.revision },
    });
  }
}

module.exports = { NativeDshChat, publicAssistantMessages };
