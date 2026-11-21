import { useEffect, useRef, useState } from "react";
import { Alert, Button, Select } from "antd";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./workspaceTerminal.css";
export type TerminalSession = {
    id: string;
    shellId: string;
    label: string;
    state: "running" | "exited" | "scope-changed" | "disconnected";
    exitCode?: number;
    output: string;
    offsetStart: number;
    offsetEnd: number;
};
type TerminalBridge = {
    shells?: () => Promise<{
        id: string;
        label: string;
    }[]>;
    list?: (projectId: string, sourceIndex: number, cid: string) => Promise<TerminalSession[]>;
    snapshot?: (id: string, cid: string) => Promise<TerminalSession>;
    start: (projectId: string, sourceIndex: number, cid: string, cols: number, rows: number, shellId?: string) => Promise<string>;
    write: (id: string, data: string, cid?: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number, cid?: string) => Promise<void>;
    stop: (id: string, cid?: string) => Promise<void>;
    onData: (listener: (id: string, data: string, offsetEnd?: number) => void) => () => void;
    onExit: (listener: (id: string, code: number) => void) => () => void;
};
declare global {
    interface Window {
        somnusWorkspaceTerminal?: TerminalBridge;
    }
}
function TerminalSurface({ session, cid, visible, onState }: {
    session: TerminalSession;
    cid: string;
    visible: boolean;
    onState: () => void;
}) {
    const mount = useRef<HTMLDivElement>(null), refit = useRef<() => void>(),terminalRef=useRef<Terminal>();
    const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const bridge = window.somnusWorkspaceTerminal, element = mount.current;
        if (!bridge || !element)
            return;
        let alive = true, loaded = false, failed = false, offset = 0, earlySize = 0,frame=0;
        const early: {
            data: string;
            end?: number;
        }[] = [];
        const terminal = new Terminal({ cursorBlink: true, scrollback: 3000, convertEol: false, fontFamily: 'Consolas, "Courier New", monospace', fontSize: 13, theme: { background: '#141918', foreground: '#eef1ef' } });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(element);terminalRef.current=terminal;
        const fail = (value: unknown) => { if (alive)
            setError(value instanceof Error ? value.message : "终端连接失败"); };
        const append = (data: string, end?: number) => {
            if (end !== undefined) {
                if (end <= offset)
                    return;
                const start = end - data.length;
                if (start > offset)
                    terminal.writeln("\r\n[部分输出已不在缓存中]\r\n");
                terminal.write(data.slice(Math.max(0, offset - start)));
                offset = end;
            }
            else
                terminal.write(data);
        };
        const removeData = bridge.onData((id, data, end) => { if (id !== session.id || !alive)
            return; if (!loaded && !failed) {
            early.push({ data, end });
            earlySize += data.length;
            while (earlySize > 1048576 && early.length) {
                earlySize -= early.shift()!.data.length;
            }
        }
        else if (!failed)
            append(data, end); });
        const removeExit = bridge.onExit((id, code) => { if (id === session.id && alive) {
            terminal.writeln("\r\n[终端已退出，退出码 " + code + "]");
            onState();
        } });
        void (bridge.snapshot ? bridge.snapshot(session.id, cid) : Promise.resolve(session)).then(snapshot => {
            if (!alive)
                return;
            terminal.write(snapshot.output || "");
            offset = snapshot.offsetEnd || 0;
            loaded = true;
            early.forEach(item => append(item.data, item.end));
            early.length = 0;
            if (snapshot.state !== "running")
                terminal.writeln("\r\n[" + (snapshot.state === "scope-changed" ? "工作区已变更，此终端已停止" : snapshot.state === "disconnected" ? "连接中断，暂不可输入" : "终端已退出") + "]");
        }).catch(failure => { failed = true; early.length = 0; fail(failure); });
        const input = terminal.onData(data => { if (session.state === "running")
            void bridge.write(session.id, data, cid).catch(fail); });
        const size = terminal.onResize(({ cols, rows }) => { if (session.state === "running")
            void bridge.resize(session.id, cols, rows, cid).catch(fail); });
        const fitNow=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(alive&&element.clientWidth&&element.clientHeight)fit.fit();});};
        refit.current = fitNow;
        const observer = new ResizeObserver(fitNow);
        observer.observe(element);
        fitNow();
        return () => { alive = false; removeData(); removeExit(); observer.disconnect(); input.dispose(); size.dispose(); cancelAnimationFrame(frame);terminal.dispose();terminalRef.current=undefined; refit.current = undefined; };
    }, [session.id, cid, session.state, attempt]);
    useEffect(() => { if (visible){refit.current?.();terminalRef.current?.focus();} }, [visible]);
    return <div hidden={!visible} className="workspace-terminal-surface">{error && <Alert type="error" message={error} action={<Button size="small" onClick={() => { setError(""); setAttempt(value => value + 1); }}>重新连接输出</Button>}/>}<div className="workspace-embedded-terminal-screen" ref={mount}/></div>;
}
export function WorkspaceTerminal({ workspace, conversationId, visible }: {
    workspace: string;
    conversationId: string;
    visible: boolean;
}) {
    const bridge = window.somnusWorkspaceTerminal;
    const [sessions, setSessions] = useState<TerminalSession[]>([]), [selected, setSelected] = useState(""), [shells, setShells] = useState([{ id: "powershell", label: "Windows PowerShell" }]), [shell, setShell] = useState("powershell"), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const version = useRef(0), activeScope = useRef('');
    const [sourcesReady,setSourcesReady]=useState(false);
    const [sources, setSources] = useState<{
        value: number;
        label: string;
    }[]>([]), [sourceIndex, setSourceIndex] = useState(0);
    const scopeKey = workspace + ':' + conversationId + ':' + sourceIndex;
    activeScope.current = scopeKey;
    useEffect(() => { let alive = true; setSourcesReady(false);void fetch('/api/assistant/conversations/' + encodeURIComponent(conversationId) + '/workspace-files').then(async (response) => { if (!response.ok)
        throw Error('无法读取项目目录'); return response.json(); }).then(data => { if (!alive)
        return; const options = (data.folders || []).filter((item: {
        source: string;
    }) => /^source_[1-9][0-9]*$/.test(item.source)).map((item: {
        source: string;
        label: string;
    }) => ({ value: Number(item.source.slice(7)) - 1, label: item.label })); setSources(options);setSourcesReady(options.length>0); const current = options.find((item: {
        value: number;
    }) => 'source_' + (item.value + 1) === data.source); setSourceIndex(current?.value ?? options[0]?.value ?? 0); }).catch(() => { if (alive){setSources([]);setSourcesReady(false);setError("无法确认终端目录，请重新打开工作区后重试。");} }); return () => { alive = false; }; }, [workspace, conversationId]);
    async function refresh() { if(!sourcesReady)return; const own = ++version.current, key = scopeKey; try {
        const rows = await bridge?.list?.(workspace, sourceIndex, conversationId);
        if (own !== version.current || activeScope.current !== key)
            return;
        if (rows) {
            setSessions(rows);
            setSelected(old => rows.some(row => row.id === old) ? old : rows.at(-1)?.id || "");
        }
    }
    catch (failure) {
        if (own === version.current)
            setError(failure instanceof Error ? failure.message : "无法恢复终端");
    } }
    useEffect(() => { setSessions([]); setSelected(""); setError("");setBusy(false); void refresh(); void bridge?.shells?.().then(setShells).catch(() => { }); return () => { version.current++; }; }, [workspace, conversationId, sourceIndex,sourcesReady]);
    useEffect(() => { if (!visible)
        return; const timer = setInterval(() => void refresh(), 2000); return () => clearInterval(timer); }, [visible, workspace, conversationId, sourceIndex]);
    async function create() { if (!bridge || busy || !sourcesReady)
        return; const key = scopeKey; setBusy(true); setError(""); try {
        const id = await bridge.start(workspace, sourceIndex, conversationId, 80, 24, shell);
        if (activeScope.current !== key)
            return;
        if (bridge.list)
            await refresh();
        else
            setSessions(old => [...old, { id, shellId: shell, label: shells.find(item => item.id === shell)?.label || shell, state: "running", output: "", offsetStart: 0, offsetEnd: 0 }]);
        setSelected(id);
    }
    catch (failure) {
        if (activeScope.current === key)
            setError(failure instanceof Error ? failure.message : "启动终端失败");
    }
    finally {
        if (activeScope.current === key)
            setBusy(false);
    } }
    async function close(id: string) { const key = scopeKey; try {
        await bridge?.stop(id, conversationId);
        if (activeScope.current !== key)
            return;
        setSessions(old => old.filter(item => item.id !== id));
        setSelected(old => old === id ? "" : old);
    }
    catch (failure) {
        if (activeScope.current === key)
            setError(failure instanceof Error ? failure.message : "关闭终端失败");
    } }
    return <section className="workspace-embedded-terminal" aria-label="项目终端" hidden={!visible}>
    <div className="workspace-panel-row">{sources.length > 1 && <Select aria-label="终端来源目录" value={sourceIndex} options={sources} onChange={setSourceIndex}/>}<Select aria-label="终端 Shell" value={shell} onChange={setShell} options={shells.map(item => ({ value: item.id, label: item.label }))}/><Button disabled={!bridge || !sourcesReady || sessions.length >= 4} loading={busy} onClick={() => void create()}>新建终端</Button></div>
    {!bridge && <Alert type="info" message="请在 Somnus Windows 桌面版中使用项目终端。"/>}{error && <Alert type="error" message={error}/>}
    <div className="workspace-terminal-tabs" role="tablist" aria-label="终端标签">{sessions.map((item, index) => <div key={item.id}><button role="tab" aria-selected={selected === item.id} onClick={() => setSelected(item.id)}>{item.label || item.shellId} {index + 1}{item.state === "disconnected" ? " · 连接中断" : item.state === "scope-changed" ? " · 目录已变更" : item.state === "exited" ? " · 已停止" : ""}</button><Button size="small" aria-label={"关闭终端 " + (index + 1)} onClick={() => void close(item.id)}>×</Button></div>)}</div>
    {sessions.filter(item => item.id === selected).map(item => <TerminalSurface key={item.id} session={item} cid={conversationId} visible={visible && selected === item.id} onState={() => void refresh()}/>)}
    {!sessions.length && <p className="small-note">选择本机可用 Shell 新建终端。切换页面会保留终端；关闭标签才结束进程。</p>}
  </section>;
}
