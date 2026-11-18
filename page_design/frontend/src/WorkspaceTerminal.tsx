import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './workspaceTerminal.css';

type TerminalBridge = {
  start: (projectId: string, sourceIndex: number, conversationId: string, cols: number, rows: number) => Promise<string>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  stop: (id: string) => Promise<void>;
  onData: (listener: (id: string, data: string) => void) => () => void;
  onExit: (listener: (id: string, code: number) => void) => () => void;
};

declare global {
  interface Window { somnusWorkspaceTerminal?: TerminalBridge; }
}

type TerminalEvent = { id: string; data: string } | { id: string; code: number };

export function WorkspaceTerminal({ workspace, conversationId, visible }: {
  workspace: string;
  conversationId: string;
  visible: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const refit = useRef<() => void>();
  const terminalRef = useRef<Terminal>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [exited, setExited] = useState(false);
  const bridge = window.somnusWorkspaceTerminal;

  useEffect(() => {
    const element = mount.current;
    if (!element || !bridge) return;
    let alive = true;
    let session: string | undefined;
    let starting = true;
    let early: TerminalEvent[] = [];
    let frame = 0;
    const terminal = new Terminal({
      cursorBlink: true, scrollback: 2000, convertEol: false,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13, theme: { background: '#141918', foreground: '#eef1ef', cursor: '#edf6f3' },
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    const reportError = (failure: unknown) => {
      if (alive) setError(failure instanceof Error ? failure.message : '终端连接失败。');
    };
    function receive(event: TerminalEvent) {
      if (!alive) return;
      if (starting) {
        if (early.length < 128) early.push(event);
        return;
      }
      if (event.id !== session) return;
      if ('data' in event) terminal.write(event.data);
      else {
        session = undefined;
        terminal.writeln('\r\n[PowerShell 已退出，退出码 ' + event.code + ']');
        setExited(true);
      }
    }
    const removeData = bridge.onData((id, data) => receive({ id, data }));
    const removeExit = bridge.onExit((id, code) => receive({ id, code }));
    const input = terminal.onData(data => {
      if (session) void bridge.write(session, data).catch(reportError);
    });
    const size = terminal.onResize(({ cols, rows }) => {
      if (session) void bridge.resize(session, cols, rows).catch(reportError);
    });
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (alive && element.clientWidth && element.clientHeight) fit.fit();
      });
    };
    refit.current = scheduleFit;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleFit);
    observer?.observe(element);
    if (element.clientWidth && element.clientHeight) fit.fit();
    const startCols = terminal.cols;
    const startRows = terminal.rows;
    void bridge.start(workspace, 0, conversationId, startCols, startRows).then(id => {
      if (!alive) {
        void bridge.stop(id).catch(() => {});
        return;
      }
      session = id;
      starting = false;
      early.forEach(receive);
      early = [];
      if (session && (terminal.cols !== startCols || terminal.rows !== startRows)) {
        void bridge.resize(session, terminal.cols, terminal.rows).catch(reportError);
      }
    }).catch(failure => {
      starting = false;
      early = [];
      reportError(failure);
    });
    return () => {
      alive = false;
      if (session) void bridge.stop(session).catch(() => {});
      cancelAnimationFrame(frame);
      observer?.disconnect();
      refit.current = undefined;
      terminalRef.current = undefined;
      removeData();
      removeExit();
      input.dispose();
      size.dispose();
      terminal.dispose();
    };
  }, [workspace, conversationId, attempt, bridge]);

  useEffect(() => {
    if (visible) {
      refit.current?.();
      terminalRef.current?.focus();
    }
  }, [visible, attempt]);

  return <section className="workspace-embedded-terminal" aria-label="项目终端" hidden={!visible}>
    <div className="workspace-panel-row">
      <h3>PowerShell</h3>
      {bridge && (error || exited) && <Button size="small" onClick={() => {
        setError('');
        setExited(false);
        setAttempt(value => value + 1);
      }}>重新启动</Button>}
    </div>
    {!bridge && <Alert type="info" showIcon message="请在 Somnus Windows 桌面版中使用项目终端。" />}
    {error && <Alert type="error" showIcon message={error} />}
    {bridge && <div className="workspace-embedded-terminal-screen" ref={mount} />}
  </section>;
}
