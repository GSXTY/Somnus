import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Segmented, Space } from 'antd';
import { decideFileProposal, listFileProposals } from './assistantApi';
import { lineCounts, unifiedFileDiff } from './fileProposalDiff';
import type { ChatMessage, FileProposal } from './assistantApi';

export function useFileProposals(conversationId?: string, latest?: FileProposal[]) {
  const [stored, setStored] = useState<{ id: string; items: FileProposal[] }>();
  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    listFileProposals(conversationId).then(items => {
      if (alive) setStored(current => {
        if (current?.id !== conversationId) return { id: conversationId, items };
        const merged = new Map(items.map(item => [item.id, item]));
        for (const item of current.items) if (!merged.has(item.id) || item.status !== 'pending') merged.set(item.id, item);
        return { id: conversationId, items: [...merged.values()] };
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [conversationId]);
  const items = new Map((latest || []).map(item => [item.id, item]));
  if (stored && stored.id === conversationId) for (const item of stored.items) {
    items.set(item.id, { ...items.get(item.id), ...item });
  }
  function record(result: FileProposal) {
    if (!conversationId) return;
    const updated = { ...items.get(result.id), ...result };
    setStored(current => ({
      id: conversationId,
      items: [...(current?.id === conversationId ? current.items : []).filter(item => item.id !== result.id), updated],
    }));
  }
  return { items: [...items.values()], record };
}

export function associateFileProposals(items: FileProposal[], messages: ChatMessage[]) {
  const byReply = new Map<string, FileProposal[]>();
  const legacy: FileProposal[] = [];
  const replies = new Set(messages.filter(message => message.role === 'assistant').map(message => message.id));
  for (const item of items) {
    let replyId = item.assistant_message_id;
    if (!replyId && Number.isFinite(item.created_at)) {
      // A proposal is created within its turn, after its assistant row and before the next message.
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.created_at > item.created_at) continue;
        if (message.created_at < item.created_at && message.role === 'assistant') replyId = message.id;
        break;
      }
    }
    if (replyId && replies.has(replyId)) byReply.set(replyId, [...(byReply.get(replyId) || []), item]);
    else legacy.push(item);
  }
  return { byReply, legacy };
}

const proposalLabels = { pending: '待审阅', applied: '已应用', rejected: '已拒绝' };

export function FileChangeCards({ items, onPreview }: { items: FileProposal[]; onPreview: (item: FileProposal) => void }) {
  if (!items.length) return null;
  const paths = new Map<string, FileProposal[]>();
  for (const item of items) {
    const key = JSON.stringify([item.source_folder, item.path]);
    paths.set(key, [...(paths.get(key) || []), item]);
  }
  return <div className="assistant-file-changes" aria-label="文件修改">
    {[...paths.entries()].map(([key, proposals]) => {
      const ordered = proposals.sort((a, b) => b.created_at - a.created_at);
      const item = ordered.find(proposal => proposal.status === 'pending') || ordered[0];
      const counts = lineCounts(item.old_content, item.new_content);
      const path = item.source_folder ? item.source_folder + ' / ' + item.path : item.path;
      return <div className="assistant-file-change" key={key}>
        <button type="button" onClick={() => onPreview(item)} title={path}>
          <span>{item.path}{item.source_folder && <small className="assistant-file-source">{item.source_folder}</small>}</span>
          {counts && <><span className="file-change-added" aria-label={'新增 ' + counts.added + ' 行'}>+{counts.added}</span><span className="file-change-removed" aria-label={'删除 ' + counts.removed + ' 行'}>−{counts.removed}</span></>}
          <small>{proposalLabels[item.status]}</small>
        </button>
        {ordered.length > 1 && <details><summary>此文件的其他修改</summary>{ordered.filter(proposal => proposal !== item).map(proposal =>
          <Button key={proposal.id} type="text" size="small" onClick={() => onPreview(proposal)}>{proposalLabels[proposal.status]}</Button>)}</details>}
      </div>;
    })}
  </div>;
}

export function FileProposalReview({ conversationId, preview, onClose, onDecision }: {
  conversationId: string;
  preview?: FileProposal;
  onClose: () => void;
  onDecision: (item: FileProposal) => void;
}) {
  const [view, setView] = useState<'diff' | 'full'>('diff');
  const diff = useMemo(() => preview ? unifiedFileDiff(preview.old_content, preview.new_content) : null, [preview]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(action: 'approve' | 'reject') {
    if (!preview || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await decideFileProposal(conversationId, preview.id, action);
      onDecision(result);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '文件修改操作失败');
    } finally { setBusy(false); }
  }
  return <Modal title="审阅文件修改" width={850} open={Boolean(preview)}
      onCancel={() => { if (!busy) onClose(); }} closable={!busy} keyboard={!busy} maskClosable={!busy}
      footer={preview?.status === 'pending' ? <Space>
        <Button disabled={busy} onClick={() => void decide('reject')}>拒绝修改</Button>
        <Button type="primary" loading={busy} onClick={() => void decide('approve')}>批准并写入</Button>
      </Space> : <Button onClick={onClose}>关闭</Button>}>
      <p><code>{preview?.source_folder ? preview.source_folder + ' / ' : ''}{preview?.path}</code></p>
      <Segmented<'diff' | 'full'> aria-label="文件比较视图" value={view} onChange={setView}
        options={[{ label: '变更差异', value: 'diff' }, { label: '完整内容', value: 'full' }]} />
      {view === 'full' ? <div className="proposal-comparison">
        <section><h3>原内容</h3><pre tabIndex={0}>{preview?.old_content ?? '新文件'}</pre></section>
        <section><h3>建议内容</h3><pre tabIndex={0}>{preview?.new_content}</pre></section>
      </div> : !diff ? <p>差异较大，请切换到「完整内容」查看。</p> : !diff.length ? <p>
        {preview?.old_content === preview?.new_content ? '没有内容变更。' : '没有逐行差异。文件换行格式或文件状态可能已变化。'}
      </p> : <div className="proposal-unified-diff" role="region" aria-label="文件逐行差异" tabIndex={0}>
        {diff.map((hunk, index) => <section key={index}>
          {hunk.omittedBefore > 0 && <div className="proposal-diff-omitted">已折叠 {hunk.omittedBefore} 行未修改内容</div>}
          <div className="proposal-diff-header"><code>{hunk.header}</code></div>
          {hunk.rows.map((line, rowIndex) => <div className="proposal-diff-line" data-change={line.kind} key={rowIndex}>
            <span>{line.oldNumber}</span><span>{line.newNumber}</span>
            <code>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</code><code>{line.text}</code>
          </div>)}
          {hunk.omittedAfter > 0 && <div className="proposal-diff-omitted">已折叠 {hunk.omittedAfter} 行未修改内容</div>}
        </section>)}
      </div>}
      {error && <Alert type="error" showIcon message={error} />}
    </Modal>;
}
