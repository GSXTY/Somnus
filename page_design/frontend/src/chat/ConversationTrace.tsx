import { RuntimeLedger } from '../runtime/RuntimeLedger';
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Spin } from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { conversationTrace } from './assistantApi';
import type { ChatMessage, ConversationTrace as Trace, ConversationTraceEvent } from './assistantApi';
import { describeError } from '../shared/errors.mjs';
import { formatDateTime } from '../shared/format.mjs';

const categories = { tool: '工具', approval: '审批', file: '文件', usage: '用量' };
const statuses: Record<string, string> = {
  pending: '待处理', in_progress: '运行中', completed: '已完成', complete: '已完成', failed: '失败',
  error: '错误', approved: '已批准', applied: '已应用', rejected: '已拒绝', denied: '已拒绝',
  expired: '已过期', cancelled: '已取消', declined: '已拒绝', recorded: '已记录', partial: '部分记录', closed: '已关闭',
};
const count = new Intl.NumberFormat('zh-CN');

type Turn = { messages: ChatMessage[]; events: ConversationTraceEvent[] };

function groups(messages: ChatMessage[], events: ConversationTraceEvent[]) {
  const turns: Turn[] = [];
  const byMessage = new Map<string, Turn>();
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push({ messages: [], events: [] });
    const turn = turns[turns.length - 1];
    turn.messages.push(message);
    byMessage.set(message.id, turn);
  }
  const unassigned: ConversationTraceEvent[] = [];
  for (const event of events) {
    const turn = event.turn_id ? byMessage.get(event.turn_id) : undefined;
    (turn?.events ?? unassigned).push(event);
  }
  return { turns, unassigned };
}

export function ConversationTrajectory({ conversationId, messages, running, onReadChat, onOpenConversation }: {
  conversationId: string; messages: ChatMessage[]; running: boolean; onReadChat: () => void; onOpenConversation?: (id:string)=>void;
}) {
  const [ledgerOpen,setLedgerOpen] = useState(false);
  const [trace, setTrace] = useState<Trace>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void conversationTrace(conversationId, controller.signal).then(result => {
      if (!controller.signal.aborted) setTrace(result);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(describeError(failure, '无法读取对话轨迹'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, running, revision]);

  function exportTrace() {
    if (!trace) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'somnus-conversation-trace.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const term = query.trim().toLocaleLowerCase();
  const matches = (...values: string[]) => !term || values.some(value => value.toLocaleLowerCase().includes(term));
  const eventMatches = (event: ConversationTraceEvent) => matches(event.title, categories[event.kind], statuses[event.status] ?? event.status);
  const { turns, unassigned } = groups(messages, trace?.events ?? []);
  const rows = turns.flatMap((turn, index) => {
    const selectedMessages = turn.messages.filter(message => matches(message.content, message.role === 'user' ? '输入' : '回复'));
    const selectedEvents = turn.events.filter(eventMatches);
    return selectedMessages.length || selectedEvents.length
      ? [{ index, id: turn.messages[0].id, messages: selectedMessages, events: selectedEvents }] : [];
  });
  const otherEvents = unassigned.filter(eventMatches);

  const eventRow = (event: ConversationTraceEvent) => <li key={event.id} className="assistant-trajectory-record">
    <span className="assistant-trajectory-kind">{categories[event.kind]}</span>
    <div className="assistant-trajectory-copy"><strong>{event.title}</strong>
      {event.usage && <small>输入 {count.format(event.usage.input_tokens)} · 输出 {count.format(event.usage.output_tokens)}
        {typeof event.usage.cached_input_tokens === 'number' && ' · 缓存 ' + count.format(event.usage.cached_input_tokens)}
        {event.usage.partial && ' · 部分记录'}</small>}
    </div>
    <span className="assistant-trajectory-status">{statuses[event.status] ?? event.status}</span>
    <span className="assistant-trajectory-time">{typeof event.duration_ms === 'number' ? count.format(event.duration_ms / 1000) + ' 秒' :
      typeof event.at === 'number' ? formatDateTime(event.at, { seconds: true }) : ''}</span>
  </li>;

  return <div className="assistant-trajectory" aria-label="对话轨迹">
    <div className="assistant-trajectory-content"><div className="runtime-ledger-switch"><Button type={!ledgerOpen ? 'primary' : 'default'} onClick={()=>setLedgerOpen(false)}>会话摘要</Button><Button type={ledgerOpen ? 'primary' : 'default'} onClick={()=>setLedgerOpen(true)}>原始事件账本</Button></div>{ledgerOpen ? <RuntimeLedger conversationId={conversationId} messages={messages} onOpenConversation={onOpenConversation} /> : <>
      <div className="assistant-trajectory-tools">
        <Input size="small" aria-label="搜索轨迹" placeholder="搜索轨迹" prefix={<SearchOutlined />} allowClear
          value={query} onChange={event => setQuery(event.target.value)} />
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => setRevision(value => value + 1)}>刷新</Button>
        <Button size="small" icon={<DownloadOutlined />} disabled={!trace?.events.length} onClick={exportTrace}>导出 JSON</Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {trace?.truncated && <Alert type="info" showIcon message="轨迹过长，显示最近一段记录。" />}
      {running && <div className="assistant-trajectory-note" role="status">任务正在运行。需要处理审批或继续输入时可<Button type="link" size="small" onClick={onReadChat}>返回聊天</Button></div>}
      {loading && !trace && <Spin size="small" />}
      {!rows.length && !otherEvents.length && !loading && <p className="assistant-trajectory-note">{term ? '没有匹配的记录。' : '暂无对话记录。'}</p>}
      {rows.map(turn => <section key={turn.id} className="assistant-trajectory-turn">
        <h3>第 {turn.index + 1} 轮</h3>
        <ol>
          {turn.messages.map(message => <li key={message.id} className="assistant-trajectory-record">
            <span className="assistant-trajectory-kind">{message.role === 'user' ? '输入' : '回复'}</span>
            <details className="assistant-trajectory-copy">
              <summary>{message.content.trim().split('\n').find(Boolean)?.slice(0, 150) || (message.status === 'streaming' ? '回复生成中' : '附件消息')}</summary>
              {message.content && <pre>{message.content}</pre>}
              {!!message.attachments?.length && <small>附件 · {message.attachments.map(item => item.name).join('、')}</small>}
            </details>
            <span className="assistant-trajectory-status">{message.status === 'streaming' ? '运行中' : statuses[message.status]}</span>
            <time className="assistant-trajectory-time">{formatDateTime(message.created_at, { seconds: true })}</time>
          </li>)}
          {turn.events.map(eventRow)}
        </ol>
      </section>)}
      {otherEvents.length > 0 && <section className="assistant-trajectory-turn"><h3>会话事件</h3><ol>{otherEvents.map(eventRow)}</ol></section>}
    </>}
    </div>
  </div>;
}
