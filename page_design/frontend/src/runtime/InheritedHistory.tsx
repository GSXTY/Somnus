import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "antd";
import type { InheritedHistoryPage } from "../chat/assistantAcp";
/** Inherited fragments are evidence, never live messages or permission-bearing tasks. */
export function InheritedHistory({ conversationId, available }: {
    conversationId: string;
    available: boolean;
}) {
    const [page, setPage] = useState<InheritedHistoryPage>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const generation = useRef(0);
    useEffect(() => { generation.current++; setPage(undefined); setError(""); setBusy(false); return()=>{generation.current++;};}, [conversationId]);
    async function load(after?: string) {
        const bridge = window.somnusNativeDshChat;
        if (!bridge?.inheritedHistory) {
            setError("当前宿主暂不支持分段继承历史。");
            return;
        }
        const own = ++generation.current;
        setBusy(true);
        setError("");
        try {
            const result = await bridge.inheritedHistory({ conversationId, after, limit: 50 });
            if (own === generation.current)
                setPage(result);
        }
        catch (failure) {
            if (own === generation.current)
                setError(failure instanceof Error ? failure.message : "无法加载继承历史");
        }
        finally {
            if (own === generation.current)
                setBusy(false);
        }
    }
    if (!available)
        return null;
    return <section className="inherited-history" aria-label="继承历史（只读）"><header><strong>继承历史 · 只读</strong><small>原生分支上下文；下方独立消息有自己的授权。</small></header>
 {error && <Alert type="warning" message={error}/>}
 {!page ? <Button loading={busy} onClick={() => void load()}>查看继承历史</Button> : <>
 <ol>{page.records.map(record => <li key={record.seq + ":" + record.part}><small>#{record.seq} · {record.role === 'user' ? '原始输入' : '原始回复'} · 片段 {record.part + 1}{!record.final ? '（待续）' : ''}</small><pre>{record.content}</pre></li>)}</ol>
 <div><Button disabled={busy} onClick={() => void load()}>回到首段</Button>{page.has_more && page.next_cursor && <Button loading={busy} onClick={() => void load(page.next_cursor!)}>下一段继承历史</Button>}</div>
 <small>每次只显示当前分段，历史内容不会执行模型或工具。</small></>}
 </section>;
}
