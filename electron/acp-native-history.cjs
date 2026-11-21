const { realpath } = require('node:fs/promises');
const path = require('node:path');
const { archiveChildHistory } = require('./runtime/history-archive.cjs');
const detail = require('./acp-dsh-subagent-detail.cjs');
const ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/;
function redact(text, maximum = 16000) {
    return String(text).replace(/\bBearer\s+[A-Za-z0-9_.-]+/gi, '[已隐藏凭据]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏凭据]').replace(/((?:authorization|cookie|password|secret|api[_-]?key|token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]]+)/gi, '$1[已隐藏凭据]').slice(0, maximum);
}
function publicData(value, depth = 0, budget = {
    remaining: 512000, truncated: false
}) {
    if (depth > 10)
        return '[深度已限制]';
    if (typeof value === 'string') {
        const take = Math.max(0, budget.remaining);
        if (value.length > take)
            budget.truncated = true;
        const result = redact(value.slice(0, take), take);
        budget.remaining -= result.length;
        return result;
    }
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (value === null || typeof value === 'boolean')
        return value;
    if (Array.isArray(value))
        return value.slice(0, 200).map(item => publicData(item, depth + 1, budget));
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => [key, /^(?:authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|api_key|apiKey|headers|env|environment|credential|credentials|private_key)$/i.test(key) ? '[已隐藏敏感字段]' : publicData(item, depth + 1, budget)]));
    return null;
}
function safe(record) {
    const event = record?.event;
    if (!event || !Number.isSafeInteger(event.seq))
        return null;
    const data = event.data || {};
    const row = {
        seq: event.seq, type: event.type, at: event.time ?? record.time
    };
    if (event.type === 'assistant/message' || event.type === 'user/message') {
        const message = event.type === 'user/message' ? data : data.message;
        row.role = message?.role || event.type.split('/')[0];
        row.text = redact((message?.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n'));
    }
    if (event.type === 'tool/call')
        row.tool = {
            callId: String(data.callId || '').slice(0, 160), name: String(data.name || '').slice(0, 160), status: 'running'
        };
    if (event.type === 'tool/result')
        row.tool = {
            callId: String(data.message?.toolCallId || '').slice(0, 160), status: data.message?.isError ? 'failed' : 'completed'
        };
    return row;
}
class NativeHistory {
    constructor(chat) {
        this.chat = chat;
    }
    async inheritedHistory(input,validate) {
        if(!ID.test(input?.conversationId||'') || (input.after!==undefined && (typeof input.after!=='string'||input.after.length>2048)) || (input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100))) throw Error('无效的继承历史分页。');
        validate(); const result=await this.chat.projectClient.inheritedHistory(input.conversationId,input.after,input.limit);validate();return result;
    }
    async nativePreferences(input,validate,save=false) {
        if(!ID.test(input?.conversationId||''))throw Error('无效会话。');
        validate();
        const result=save?await this.chat.projectClient.saveNativePreferences(input.conversationId,{revision:input.revision,provider_model_id:input.provider_model_id,skill_ids:input.skill_ids}):await this.chat.projectClient.nativePreferences(input.conversationId);
        validate();
        if(!save){const mapping=await this.chat.projectClient.nativeSession(input.conversationId);validate();return{...result,continuation:mapping?.continuation||null};}
        return result;
    }
    async childConversation(input, validate) {
        if (!ID.test(input?.conversationId || '') || !ID.test(input?.turnId || '') || !/^dsh-child-[a-f0-9]{24}$/.test(input?.subagentId || '')) throw Error('请选择原任务中的子会话。');
        validate();
        const result = await this.chat.projectClient.childConversation(input.conversationId,input.turnId,input.subagentId);
        validate();
        return result;
    }
    async context(input, validate) {
        if (!ID.test(input?.conversationId || '') || !ID.test(input?.turnId || ''))
            throw Error('无效的会话记录。');
        validate();
        const auth = await this.chat.projectClient.authorizeNativeHistory(input.conversationId, {
            turn_id: input.turnId
        });
        validate();
        if (!Number.isSafeInteger(auth.start_seq) || !Number.isSafeInteger(auth.last_seq))
            throw Error('此旧回复没有完整原生轨迹绑定，请使用消息分支。');
        let range;
        const live = this.chat.running.get(input.conversationId);
        if (input.subagentId) {
            if (live?.turnId === input.turnId)
                range = live.tree?.ranges.get(input.subagentId);
            else if (await this.chat.projectClient.hasNativeSubagent(input.conversationId, input.turnId, input.subagentId))
                range = await detail.loadRange(this.chat.market.home, input);
            if (!range)
                throw Error('此子会话不属于所选任务。');
        }
        const sessionId = range?.sessionId || auth.runtime_session_id;
        if (!SESSION.test(sessionId || ''))
            throw Error('此历史会话尚未绑定原生记录。');
        const server = live?.turnId === input.turnId ? live.server : await this.chat.market.settings(validate);
        validate();
        const listed = await this.chat.rpc(server, 'session/list', {
            _request: {}
        });
        const root = listed.items?.find(row => row.sessionId === (range?.parentId || sessionId))?.cwd;
        let roots = auth.project_roots || [];
        if (!roots.length) {
            const origin = auth.local_origin_cid || input.conversationId;
            if (!ID.test(origin))
                throw Error('本地会话归属无效。');
            roots = [{
                    path: path.join(this.chat.market.home, 'somnus-conversations', origin)
                }];
        }
        if (!root)
            throw Error('此会话缺少可验证的项目目录。');
        const actual = (await realpath(root)).toLowerCase();
        let matched = false;
        for (const item of roots)
            if ((await realpath(item.path)).toLowerCase() === actual)
                matched = true;
        if (!matched)
            throw Error('原生会话目录与当前项目不一致。');
        return {
            auth, range, sessionId, root, server, call: (method, request) => this.chat.rpc(server, 'session/' + method, {
                request
            })
        };
    }
    async ledger(input, validate) {
        const c = await this.context(input, validate);
        const before = input.beforeSeq;
        if (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
            throw Error('轨迹游标无效。');
        const limit = input.limit ?? 40;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            throw Error('轨迹分页大小无效。');
        const upper = c.range?.through ?? c.auth.last_seq;
        const page = await c.call('events', {
            address: c.range ? {
                kind: 'subagent', parentSessionId: c.range.parentId, childSessionId: c.sessionId, mode: c.range.mode
            } : {
                kind: 'session', sessionId: c.sessionId
            }, maxMessages: limit, ...(before === undefined ? {} : {
                beforeSeq: before
            }), ...(Number.isSafeInteger(upper) ? {
                throughSeq: upper
            } : {})
        });
        validate();
        const lower = c.range?.after ?? c.auth.start_seq ?? -1;
        const records = (page.records || []).filter(r => r.event?.seq > lower).map(safe).filter(Boolean);
        return {
            records: records.map(row => ({
                ...row, canFork: c.auth.task_status === 'completed' && row.seq === c.auth.assistant_event_seq && row.type === 'assistant/message'
            })), cursor: records[0]?.seq ?? null, hasMore: Boolean(page.hasMore && records.length && records[0].seq > lower + 1), scope: 'turn', readOnly: true
        };
    }
    async inspect(input, validate) {
        const c = await this.context(input, validate);
        const seq = input.seq;
        if (!Number.isSafeInteger(seq) || seq < 0)
            throw Error('工具游标无效。');
        const range = c.range || {
            sessionId: c.sessionId, parentId: c.sessionId, mode: 'unknown', root: true, after: c.auth.start_seq ?? -1, through: c.auth.last_seq
        };
        if (!Number.isSafeInteger(range.through) || seq <= range.after || seq > range.through)
            throw Error('工具记录超出所选任务。');
        if (input.kind === 'event') {
            const address = c.range ? {
                kind: 'subagent', parentSessionId: c.range.parentId, childSessionId: c.sessionId, mode: c.range.mode
            } : {
                kind: 'session', sessionId: c.sessionId
            };
            const page = await c.call('events', {
                address, throughSeq: seq, beforeSeq: seq + 1, maxMessages: 1
            });
            const event = page.records?.find(row => row.event?.seq === seq)?.event;
            if (!event)
                throw Error('原生事件不存在。');
            const budget = {
                remaining: 512000, truncated: false
            };
            const text = JSON.stringify(publicData(event.data, 0, budget), null, 2), offset = input.offset ?? 0;
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
                throw Error('事件分页位置无效。');
            const end = offset + 16000;
            validate();
            return {
                text: text.slice(offset, end), ...(end < text.length ? {
                    nextOffset: end
                } : {}), truncated: budget.truncated
            };
        }
        const result = await detail.readToolDetail(c.call, range, seq, input.offset);
        validate();
        return result && {
            ...result, text: [result.arguments ? '[参数]\n' + result.arguments : '', result.output ? '[结果]\n' + result.output : ''].filter(Boolean).join('\n\n')
        };
    }
    async fork(input, validate) {
        const c = await this.context(input, validate);
        const seq = input.atSeq ?? c.auth.assistant_event_seq;
        if (c.auth.task_status !== 'completed')
            throw Error('任务尚未完整结束，不能创建可继续的原生分支。');
        if (!c.range && seq !== c.auth.assistant_event_seq)
            throw Error('请选择该轮最后完整回答；中间工具调用不能作为可继续分支。');
        if (!Number.isSafeInteger(seq) || seq < 0)
            throw Error('请选择要分支的原生回答。');
        const page = await c.call('events', {
            address: c.range ? {
                kind: 'subagent', parentSessionId: c.range.parentId, childSessionId: c.sessionId, mode: c.range.mode
            } : {
                kind: 'session', sessionId: c.sessionId
            }, beforeSeq: seq + 1, throughSeq: seq, maxMessages: 1
        });
        const selected = page.records?.find(r => r.event?.seq === seq);
        if (selected?.event.type !== 'assistant/message' || seq <= (c.range?.after ?? c.auth.start_seq ?? -1) || seq > (c.range?.through ?? c.auth.last_seq ?? -1))
            throw Error('选中的回答不属于此任务。');
        const completed = await c.call('events', {
            address: c.range ? {
                kind: 'subagent', parentSessionId: c.range.parentId, childSessionId: c.sessionId, mode: c.range.mode
            } : {
                kind: 'session', sessionId: c.sessionId
            }, throughSeq: c.range?.through ?? c.auth.last_seq, maxMessages: 100
        });
        if (!completed.records?.some(row => row.event?.seq > seq && row.event.type === 'turn/end' && row.event.data?.reason?.kind === 'completed') || completed.records.some(row => row.event?.seq > seq && row.event.type === 'tool/call'))
            throw Error('所选回答没有可验证的完整结束边界。');
        validate();
        const reserved = await this.chat.projectClient.reserveNativeFork(input.conversationId, {
            turn_id: input.turnId, at_seq: seq, ...(input.worktreePolicy==='share-current'&&c.auth.worktree_shared_allowed===true?{worktree_policy:'share-current'}:{}), ...(input.subagentId ? {
                child_session_id: c.sessionId
            } : {})
        });
        if (reserved.existing) {
            const mapping = await this.chat.projectClient.nativeSession(reserved.conversation_id,c.auth.agent_id);
            validate();
            return {conversationId:reserved.conversation_id,sessionId:mapping.runtime_session_id,continuation:reserved.continuation || mapping.continuation,existing:true};
        }
        try {
            validate();
            const result = await c.call('fork', {
                sessionId: c.sessionId, atSeq: seq
            });
            if (!SESSION.test(result?.sessionId || ''))
                throw Error('DSH 未返回有效分支。');
            const listed = await this.chat.rpc(c.server, 'session/list', {
                _request: {}
            });
            const forkRoot = listed.items?.find(row => row.sessionId === result.sessionId)?.cwd;
            if (!forkRoot || (await realpath(forkRoot)).toLowerCase() !== (await realpath(c.root)).toLowerCase())
                throw Error('分支项目目录校验失败。');
            if (c.range) await archiveChildHistory({
                call:c.call, range:c.range, sessionId:c.sessionId, atSeq:seq,
                reservationId:reserved.reservation_id, client:this.chat.projectClient, validate,
                redact:text=>redact(text,Infinity)
            });
            const committed = await this.chat.projectClient.commitNativeFork(reserved.reservation_id, {
                session_id: result.sessionId, source_session_id: c.sessionId, at_seq: seq, ...(c.range ? { history_archive:true } : {})
            });
            const conversationId = committed.conversation_id || committed.conversation?.id || reserved.conversation_id;
            const mapping = await this.chat.projectClient.nativeSession(conversationId, c.auth.agent_id);
            return {
                conversationId, sessionId: result.sessionId, continuation: mapping.continuation
            };
        }
        catch (error) {
            await this.chat.projectClient.abortNativeFork(reserved.reservation_id).catch(() => {
            });
            throw error;
        }
    }
}
module.exports = {
    NativeHistory, redact, safe, publicData
};
