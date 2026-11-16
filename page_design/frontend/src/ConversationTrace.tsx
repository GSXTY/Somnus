import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Spin, Tag } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { conversationTrace } from './assistantApi';
import type { ConversationTrace as Trace } from './assistantApi';
import { describeError } from './errors.mjs';
import { formatDateTime } from './format.mjs';

const categories = { tool: '工具', approval: '审批', file: '文件', usage: '用量' };
const statuses: Record<string, string> = {
  pending: '待处理', in_progress: '进行中', completed: '已完成', complete: '已完成', failed: '失败',
  error: '失败', approved: '已批准', applied: '已写入', rejected: '已拒绝', denied: '已拒绝',
  expired: '已过期', cancelled: '已取消', declined: '已拒绝', recorded: '已记录', partial: '部分记录', closed: '已关闭',
};
const count = new Intl.NumberFormat('zh-CN');

export function ConversationTraceButton({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<Trace>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setTrace(undefined);
    setLoading(true);
    setError('');
    void conversationTrace(conversationId, controller.signal).then(result => {
      if (!controller.signal.aborted) setTrace(result);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(describeError(failure, '无法读取执行记录'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, open, revision]);

  function exportTrace() {
    if (!trace) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'somnus-conversation-trace.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <>
    <Button type="text" size="small" icon={<HistoryOutlined />} aria-label="执行记录" title="执行记录" onClick={() => setOpen(true)} />
    <Modal width={760} title="会话执行记录" open={open} onCancel={() => setOpen(false)}
      footer={<Space>
        <Button loading={loading} onClick={() => setRevision(value => value + 1)}>刷新</Button>
        <Button disabled={loading || !trace?.events.length} onClick={exportTrace}>导出 JSON</Button>
        <Button onClick={() => setOpen(false)}>关闭</Button>
      </Space>}>
      {error && <Alert type="error" showIcon message={error} />}
      {loading && <Spin size="small" />}
      {trace?.truncated && <Alert type="info" showIcon message="仅显示最近保存的执行记录。" />}
      {trace && !trace.events.length && <p>此会话暂无已保存的执行记录。</p>}
      {trace && trace.events.length > 0 && <ol className="assistant-trace-list">
        {trace.events.map(event => <li key={event.id}>
          <div><Tag>{categories[event.kind]}</Tag><strong>{event.title}</strong></div>
          <small>
            {typeof event.at === 'number' && formatDateTime(event.at, { seconds: true })}
            {statuses[event.status] && ' · ' + statuses[event.status]}
            {typeof event.duration_ms === 'number' && ' · ' + count.format(event.duration_ms / 1000) + ' 秒'}
          </small>
          {event.usage && <small>输入 {count.format(event.usage.input_tokens)} · 输出 {count.format(event.usage.output_tokens)}
            {typeof event.usage.cached_input_tokens === 'number' && ' · 缓存 ' + count.format(event.usage.cached_input_tokens)}
            {event.usage.partial && ' · 部分用量'}</small>}
        </li>)}
      </ol>}
    </Modal>
  </>;
}
