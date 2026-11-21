import { confirmedNativeFork } from "./nativeFork";
import { eventTime, filterLedger } from "./ledgerModel.mjs";
import { useEffect, useRef, useState } from "react";
import { StructuredRecord } from "./StructuredRecord";
import { Alert, Button, Input, Modal, Select, Spin } from "antd";
import type { ChatMessage } from "../chat/assistantApi";
import type { NativeHistoryRecord } from "../chat/assistantAcp";
export function RuntimeLedger({ conversationId, messages, onOpenConversation, }: {
    conversationId: string;
    messages: ChatMessage[];
    onOpenConversation?: (id: string) => void;
}) {
    const turns = messages.filter((message) => message.role === "assistant" &&
        message.reply_meta?.transport === "dsh-native");
    const [turnId, setTurnId] = useState(turns.at(-1)?.id), [records, setRecords] = useState<NativeHistoryRecord[]>([]), [cursor, setCursor] = useState(0), [hasMore, setHasMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [query, setQuery] = useState(""), [typeFilter, setTypeFilter] = useState<string>(), [startTime, setStartTime] = useState(""), [endTime, setEndTime] = useState(""), [page, setPage] = useState(0), [inspect, setInspect] = useState<{
        callId?: string;
        seq?: number;
        kind?: "event";
        name: string;
    }>(), [detail, setDetail] = useState(""), [offset, setOffset] = useState<number>(), [detailBusy, setDetailBusy] = useState(false);
    const bridge = window.somnusNativeDshChat, requestVersion = useRef(0), inspectVersion = useRef(0);
    useEffect(() => {
        setTurnId(turns.at(-1)?.id);
    }, [conversationId]);
    async function load(reset = false) {
        if (!bridge?.history || !turnId || (busy && !reset))
            return;
        const version = ++requestVersion.current;
        setBusy(true);
        setError("");
        try {
            const page = await bridge.history({
                conversationId,
                turnId,
                afterSeq: reset ? 0 : cursor,
                limit: 150,
            });
            if (version !== requestVersion.current)
                return;
            setRecords((previous) => [
                ...new Map([...(reset ? [] : previous), ...page.records].map((record) => [
                    record.seq,
                    record,
                ])).values(),
            ].sort((a, b) => a.seq - b.seq));
            setCursor(page.cursor);
            setHasMore(page.hasMore);
        }
        catch (failure) {
            if (version === requestVersion.current)
                setError(failure instanceof Error ? failure.message : "无法读取原始轨迹");
        }
        finally {
            if (version === requestVersion.current)
                setBusy(false);
        }
    }
    useEffect(() => {
        setRecords([]);
        setCursor(0);
        setHasMore(false);
        void load(true);
        return () => {
            requestVersion.current++;
        };
    }, [conversationId, turnId]);
    useEffect(() => {
        inspectVersion.current++;
        setDetailBusy(false);
        setInspect(undefined);
        setDetail("");
        setOffset(undefined);
    }, [conversationId, turnId]);
    async function readTool(call: {
        callId?: string;
        seq?: number;
        kind?: "event";
        name: string;
    }, more = false) {
        if (!bridge?.historyTool || !turnId || detailBusy)
            return;
        if (!more) {
            setDetail("");
            setOffset(undefined);
        }
        const version = ++inspectVersion.current;
        setInspect(call);
        setDetailBusy(true);
        setError("");
        try {
            const value = await bridge.historyTool({
                conversationId,
                turnId,
                callId: call.callId,
                seq: call.seq,
                kind: call.kind,
                offset: more ? offset : 0,
            });
            if (version !== inspectVersion.current)
                return;
            setDetail((old) => (more ? old + value.text : value.text));
            setOffset(value.nextOffset);
        }
        catch (failure) {
            if (version === inspectVersion.current)
                setError(failure instanceof Error ? failure.message : "无法读取工具记录");
        }
        finally {
            if (version === inspectVersion.current)
                setDetailBusy(false);
        }
    }
    function closeInspector() {
        inspectVersion.current++;
        setInspect(undefined);
        setDetailBusy(false);
    }
    async function fork(atSeq: number) {
        const version=requestVersion.current;
        if (!bridge?.fork || !turnId || busy)
            return;
        setBusy(true);
        setError("");
        try {
            const result = await confirmedNativeFork({ conversationId, turnId, atSeq });
            if(version===requestVersion.current)onOpenConversation?.(result.conversationId);
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : "此位置无法创建分支");
        }
        finally {
            setBusy(false);
        }
    }
    if (!bridge?.history)
        return (<p className="small-note">
        当前宿主尚未提供原始轨迹读取。会话摘要仍可查看。
      </p>);
    if (!turns.length)
        return (<p className="small-note">
        此会话没有 Somnus 原生运行记录。外接 ACP 只展示其实际提供的步骤与摘要。
      </p>);
    const visible = filterLedger(records, { query, type: typeFilter, start: startTime, end: endTime }) as NativeHistoryRecord[];
    const pageCount = Math.max(1, Math.ceil(visible.length / 100));
    const selectedPage = Math.min(page, pageCount - 1);
    return (<section className="runtime-ledger" aria-label="原始事件账本">
      <div className="runtime-ledger-toolbar">
        <Select aria-label="账本轮次" value={turnId} onChange={setTurnId} options={turns.map((message, index) => ({
            value: message.id,
            label: "第 " +
                (index + 1) +
                " 次回复 · " +
                (message.content.slice(0, 35) || "执行记录"),
        }))}/>
        <Input aria-label="搜索已载入事件" placeholder="搜索已载入事件" allowClear value={query} onChange={(event) => setQuery(event.target.value)}/>
        <Select aria-label="事件类型" allowClear placeholder="全部事件" value={typeFilter} onChange={value => { setTypeFilter(value); setPage(0); }} options={[...new Set(records.map(item => item.type))].sort().map(value => ({ value, label: value }))}/>
        <label>开始时间<input aria-label="事件开始时间" type="datetime-local" value={startTime} onChange={event => { setStartTime(event.target.value); setPage(0); }}/></label>
        <label>结束时间<input aria-label="事件结束时间" type="datetime-local" value={endTime} onChange={event => { setEndTime(event.target.value); setPage(0); }}/></label>
        <Button loading={busy} onClick={() => void load(true)}>
          刷新
        </Button>
      </div>
      <p className="small-note">
        筛选与搜索仅作用于已载入记录；可继续加载后续事件。脱敏原始事件 · 已载入 {records.length} 条
        {hasMore ? " · 还有更多记录" : ""}
        。分支使用原生日志边界，文件改动不会回滚。
      </p>
      {error && <Alert type="error" message={error}/>}
      <ol className="runtime-ledger-list">
        {visible.slice(selectedPage * 100, selectedPage * 100 + 100).map((record) => (<li key={record.seq}>
            <header>
              <code>#{record.seq}</code>
              <strong>{record.type}</strong>
              {record.role && <small>{record.role}</small>}
              {record.at && (<time>
                  {new Date(eventTime(record.at) || 0).toLocaleTimeString()}
                </time>)}
              {onOpenConversation && bridge.fork && record.canFork === true && (<Button size="small" type="text" disabled={busy} onClick={() => void fork(record.seq)}>
                  从这里分支
                </Button>)}
            </header>
            {record.text && <pre>{record.text}</pre>}
            {!record.tool && (<Button size="small" disabled={!bridge.historyTool} onClick={() => void readTool({
                    name: record.type,
                    seq: record.seq,
                    kind: "event",
                })}>
                查看事件数据
              </Button>)}
            {record.tool && (<Button size="small" disabled={!bridge.historyTool} onClick={() => void readTool(record.tool!)}>
                {record.tool.name} · {record.tool.status || "工具记录"} ·
                查看调用
              </Button>)}
          </li>))}
      </ol>
      <div className="runtime-ledger-pagination"><Button size="small" disabled={!selectedPage} onClick={() => setPage(selectedPage - 1)}>上一页</Button>
        <span>匹配 {visible.length} 条 · 第 {selectedPage + 1}/{pageCount} 页（每页最多 100 条）</span>
        <Button size="small" disabled={selectedPage + 1 >= pageCount} onClick={() => setPage(selectedPage + 1)}>下一页</Button></div>
      {busy && <Spin size="small"/>}
      {hasMore && (<Button disabled={busy} onClick={() => void load()}>
          加载后续事件
        </Button>)}
      <Modal open={Boolean(inspect)} title={inspect?.name || "工具调用"} onCancel={closeInspector} footer={<>
            <Button onClick={closeInspector}>关闭</Button>
            {offset !== undefined && (<Button loading={detailBusy} onClick={() => inspect && void readTool(inspect, true)}>
                加载后续内容
              </Button>)}
          </>}>
        <StructuredRecord text={detail}/>
        {detailBusy && <Spin size="small"/>}
      </Modal>
    </section>);
}
