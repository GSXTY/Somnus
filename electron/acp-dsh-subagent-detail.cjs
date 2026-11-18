const { createHash, randomUUID } = require('node:crypto');
const { mkdir, open, realpath, rename, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');

const TURN = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const STEP = /^dsh-child-[a-f0-9]{24}$/;
const SESSION = /^[a-z0-9][a-z0-9_.-]{0,191}$/i;
const MAX_BYTES = 128 * 1024;
const MAX_TEXT = 48_000;
const MAX_PAGES = 6;
const TOOL_PAGE_SIZE = 16_000;
const TOOL_SEARCH_PAGES = 24;
const TOOL_NAME = /^[A-Za-z0-9_.:/-]{1,96}$/;
const PATH_TOOLS = new Set(['read', 'write', 'edit', 'read_file', 'write_file', 'read_project_file',
  'propose_project_file_create', 'propose_project_file_edit']);
const PROCESS_TOOLS = new Set(['pwsh', 'bash', 'shell']);

function publicText(value) {
  return value.replace(/\b(?:Bearer\s+[a-zA-Z0-9_.-]{12,}|sk-[a-zA-Z0-9_-]{12,})\b/gi, '[已隐藏凭据]')
    .replace(/(\b(?:api[_ -]?key|access[_ -]?token|password)\s*[:=]\s*["']?)[a-zA-Z0-9_.-]{10,}/gi, '$1[已隐藏凭据]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[已隐藏凭据]@');
}

function resultText(value) {
  return publicText(value).replace(
    /((?:["']?\b[\w.-]{0,100}(?:authorization|cookie|password|passwd|secret|api[_-]?key|token|private[_-]?key)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]]+)/gi,
    '$1[已隐藏凭据]',
  );
}

function toolTarget(data) {
  if (!PATH_TOOLS.has(data.name) || typeof data.arguments !== 'string' || data.arguments.length > 64_000) return undefined;
  try {
    const args = JSON.parse(data.arguments);
    const target = args?.path ?? args?.file_path;
    if (typeof target === 'string' && target.length < 180 &&
        target.split(/[\\/]/).every(part => /^[\p{L}\p{N} _.-]+$/u.test(part) && !part.startsWith('.'))) {
      const masked = publicText(target);
      if (masked === target) return target;
    }
  } catch { /* Unstructured arguments are never displayed. */ }
}

function resultDetails(call, raw, time) {
  const details = {};
  if (call && Number.isFinite(call.at) && Number.isFinite(time) && time >= call.at) {
    details.durationMs = Math.min(Math.round(time - call.at), 86_400_000);
  }
  if (PROCESS_TOOLS.has(call?.name)) {
    const exitCode = raw?.meta?.exitCode;
    if (Number.isSafeInteger(exitCode) && exitCode >= -2147483648 && exitCode <= 2147483647) details.exitCode = exitCode;
  }
  return Object.keys(details).length ? { details } : {};
}

function safeFailure(code) {
  if (typeof code !== 'string') return '工具报告失败。';
  if (/TIMEOUT|TIMED_OUT/i.test(code)) return '工具执行超时。';
  if (/CANCEL|ABORT/i.test(code)) return '工具执行已取消。';
  if (/DENIED|PERMISSION/i.test(code)) return '工具操作未获授权。';
  if (code === 'TOOL_OUTCOME_UNKNOWN') return '运行中断，工具结果未知。';
  return '工具报告失败。';
}

function checked(input) {
  return input && [input.conversationId, input.turnId].every(id => typeof id === 'string' && TURN.test(id))
    && typeof input.subagentId === 'string' && STEP.test(input.subagentId);
}

async function indexPath(home, conversationId, turnId, create) {
  if (![conversationId, turnId].every(id => typeof id === 'string' && TURN.test(id))) return null;
  const base = path.join(await realpath(home), 'somnus-subagent-details');
  if (create) await mkdir(base, { recursive: true });
  const resolved = await realpath(base);
  if (resolved.toLowerCase() !== base.toLowerCase()) throw new Error('子任务记录目录异常。');
  return path.join(resolved, conversationId + '-' + turnId + '.json');
}

async function saveRanges(home, conversationId, turnId, ranges) {
  if (!ranges.size) return;
  const file = await indexPath(home, conversationId, turnId, true);
  if (!file) return;
  const pending = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(pending, JSON.stringify(Object.fromEntries(ranges)), { flag: 'wx', mode: 0o600 });
    await rename(pending, file);
  } finally {
    await unlink(pending).catch(() => {});
  }
}

async function loadRange(home, input) {
  if (!checked(input)) return null;
  try {
    const file = await indexPath(home, input.conversationId, input.turnId, false);
    if (!file || (await realpath(file)).toLowerCase() !== file.toLowerCase()) return null;
    const reader = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await reader.read(buffer);
      if (bytesRead > MAX_BYTES) return null;
      const result = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))[input.subagentId];
      if (!SESSION.test(result?.sessionId ?? '')) return null;
      const derived = 'dsh-child-' + createHash('sha256').update(result.sessionId).digest('hex').slice(0, 24);
      return derived === input.subagentId ? result : null;
    } finally {
      await reader.close();
    }
  } catch {
    return null;
  }
}

async function readDetail(call, range, cursor) {
  if (!range || !SESSION.test(range.sessionId ?? '') || !SESSION.test(range.parentId ?? '') ||
      !['one-shot', 'continuable', 'unknown'].includes(range.mode) || !Number.isSafeInteger(range.after) ||
      !Number.isSafeInteger(range.through) || range.through <= range.after) return null;
  const { sessionId, parentId, mode, after, through, step } = range;
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor <= after || cursor > through)) return null;
  let beforeSeq = cursor;
  let truncated = false;
  let remaining = MAX_TEXT;
  let more;
  const window = [];
  const address = { kind: 'subagent', parentSessionId: parentId, childSessionId: sessionId, mode };
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await call('events', { address, throughSeq: through,
      ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages: 30 });
    const records = (page.records ?? []).filter(({ event }) => Number.isSafeInteger(event?.seq));
    window.unshift(...records.filter(({ event }) => event.seq > after && event.seq <= through &&
      (cursor === undefined || event.seq < cursor)));
    const first = records[0]?.event?.seq;
    if (!page.hasMore || !Number.isSafeInteger(first) || first <= after + 1) break;
    if (first === beforeSeq) { truncated = true; break; }
    if (index === MAX_PAGES - 1) more = first;
    beforeSeq = first;
  }
  const names = new Map();
  for (const { event } of window) {
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string' && TOOL_NAME.test(event.data.name ?? '')) {
      names.set(event.data.callId, { name: event.data.name, at: event.time, target: toolTarget(event.data) });
    }
  }
  const entries = [];
  for (const { event } of window.reverse()) {
    const { seq, data, type } = event;
    if (type === 'tool/call' && names.has(data?.callId)) {
      const { name, target } = names.get(data.callId);
      entries.unshift({ seq, type: 'tool', name, status: 'running', ...(target ? { details: { target } } : {}) });
    } else if (type === 'tool/result' && data?.message?.role === 'tool') {
      const failed = data.message.isError === true;
      const tool = names.get(data.message.toolCallId);
      entries.unshift({ seq, type: 'tool', name: tool?.name ?? '工具',
        status: failed ? 'failed' : 'completed', ...resultDetails(tool, data, event.time),
        ...(failed ? { reason: safeFailure(data.error?.code) } : {}) });
    } else if ((type === 'assistant/message' && data?.message?.role === 'assistant') ||
               (type === 'user/message' && data?.role === 'user' && data.source?.kind === 'user')) {
      const message = type === 'user/message' ? data : data.message;
      const text = message.content?.filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text).join('');
      if (!text?.trim()) continue;
      if (!remaining) {
        more = entries[0]?.seq ?? seq;
        break;
      }
      const visible = publicText(text);
      if (visible.length > remaining) truncated = true;
      entries.unshift({ seq, type: 'message', role: message.role, text: visible.slice(0, remaining) });
      remaining = Math.max(0, remaining - visible.length);
    }
  }
  const messages = entries.filter(event => event.type === 'message').map(({ role, text }) => ({ role, text }));
  return { title: step.title, status: step.status, messages, entries, truncated,
    ...(more === undefined ? {} : { nextBeforeSeq: more }) };
}

function isToolEvent(event) {
  const call = event?.type === 'tool/call' && typeof event.data?.callId === 'string' &&
    TOOL_NAME.test(event.data.name ?? '');
  const result = event?.type === 'tool/result' && event.data?.message?.role === 'tool' &&
    typeof event.data.message.toolCallId === 'string';
  return call || result;
}

async function findToolEvent(call, range, throughSeq, predicate, pages) {
  const address = { kind: 'subagent', parentSessionId: range.parentId, childSessionId: range.sessionId, mode: range.mode };
  let beforeSeq;
  for (let index = 0; index < pages; index++) {
    const page = await call('events', { address, throughSeq, maxMessages: 30,
      ...(beforeSeq === undefined ? {} : { beforeSeq }) });
    const records = (page.records ?? []).filter(({ event }) => Number.isSafeInteger(event?.seq));
    const match = records.find(({ event }) => event.seq > range.after && event.seq <= throughSeq &&
      (beforeSeq === undefined || event.seq < beforeSeq) && isToolEvent(event) && predicate(event));
    if (match) return { event: match.event };
    const first = records[0]?.event?.seq;
    if (!page.hasMore || !Number.isSafeInteger(first) || first <= range.after + 1) return {};
    if (beforeSeq !== undefined && first >= beforeSeq) break;
    beforeSeq = first;
  }
  return { truncated: true };
}

async function readToolDetail(call, range, sequence, offset = 0) {
  if (!range || !SESSION.test(range.sessionId ?? '') || !SESSION.test(range.parentId ?? '') ||
      !['one-shot', 'continuable', 'unknown'].includes(range.mode) ||
      ![sequence, offset, range.after, range.through].every(Number.isSafeInteger) ||
      sequence <= range.after || sequence > range.through || offset < 0) return null;
  const { event } = await findToolEvent(call, range, sequence, candidate => candidate.seq === sequence, 1);
  if (!event) return null;
  const selectedCall = event.type === 'tool/call';
  const callId = selectedCall ? event.data.callId : event.data.message.toolCallId;
  const adjacent = await findToolEvent(call, range, selectedCall ? range.through : sequence - 1, candidate =>
    selectedCall
      ? candidate.seq > sequence && candidate.type === 'tool/result' && candidate.data.message.toolCallId === callId
      : candidate.type === 'tool/call' && candidate.data.callId === callId,
  TOOL_SEARCH_PAGES);
  const started = selectedCall ? event : adjacent.event;
  const finished = selectedCall ? adjacent.event : event;
  const message = finished?.data?.message;
  const args = typeof started?.data.arguments === 'string' ? resultText(started.data.arguments) : undefined;
  const parts = Array.isArray(message?.content) ? message.content : [];
  const texts = parts.filter(part => part?.type === 'text' && typeof part.text === 'string');
  const output = message ? resultText(texts.map(part => part.text).join('\n')) : undefined;
  const nextOffset = offset + TOOL_PAGE_SIZE;
  return {
    name: started?.data.name ?? '工具',
    status: message ? (message.isError === true ? 'failed' : 'completed') : 'running',
    ...(args === undefined ? {} : { arguments: args.slice(offset, nextOffset) }),
    ...(output === undefined ? {} : { output: output.slice(offset, nextOffset) }),
    ...(nextOffset < Math.max(args?.length ?? 0, output?.length ?? 0) ? { nextOffset } : {}),
    ...(adjacent.truncated || texts.length !== parts.length ? { truncated: true } : {}),
  };
}

module.exports = { checked, saveRanges, loadRange, readDetail, readToolDetail };
