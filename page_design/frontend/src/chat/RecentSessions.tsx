import { Dropdown } from 'antd';
import { DeleteOutlined, EditOutlined, EllipsisOutlined, LoadingOutlined, PushpinOutlined } from '@ant-design/icons';
import type { Conversation } from './assistantApi';
import type { DragEvent } from 'react';
import type { RuntimeTaskSnapshot } from '../runtime/runtimeTasks';
import { runtimeConversation } from '../runtime/runtimeTasks';

type Props = {
  manualOrder?: boolean;
  onMove?: (item: Conversation, direction: number) => void;
  onArchive?: (item: Conversation) => void;
  items: Conversation[];
  activeId?: string;
  locked: boolean;
  loading: boolean;
  runningIds?: ReadonlyMap<string, unknown>;
  runtimeSnapshot?: RuntimeTaskSnapshot;
  onOpen: (id: string) => void;
  onReferenceDrag?: (event: DragEvent<HTMLButtonElement>, id: string) => void;
  onRename: (item: Conversation) => void;
  onDelete: (item: Conversation) => void;
};

export function RecentSessions({ manualOrder, onMove, onArchive, items, activeId, locked, loading, runningIds, runtimeSnapshot, onOpen, onReferenceDrag, onRename, onDelete }: Props) {
  return <div className="nav-recent" aria-label="最近会话">
    <div className="nav-caption">最近会话</div>
    {!items.length && <small className="nav-recent-empty">{loading ? '正在读取会话…' : '还没有会话'}</small>}
    {items.map(item => {
      const state = runtimeSnapshot && runtimeSnapshot.availability !== 'legacy' ? runtimeConversation(runtimeSnapshot, item.id) : undefined;
      const running = state ? state.active_count > 0 : runningIds?.has(item.id);
      const needsAttention = state && state.attention_count > 0;
      const title = item.title || '新会话';
      const menu = {
        items: [
          { key: 'rename', label: '重命名', icon: <EditOutlined />, disabled: locked || running || Boolean(needsAttention) },
          ...(onArchive ? [{ key: 'archive', label: item.archived ? '恢复会话' : '归档会话', disabled: locked || running || Boolean(needsAttention) }] : []),
          ...(manualOrder && onMove ? [{ key: 'up', label: '上移', disabled: locked }, { key: 'down', label: '下移', disabled: locked }] : []),
          { key: 'delete', label: '删除会话', icon: <DeleteOutlined />, danger: true, disabled: locked || running || Boolean(needsAttention) },
        ],
        onClick: ({ key }: { key: string }) => {
          if (locked || running || needsAttention) return;
          if (key === 'archive') onArchive?.(item);
          else if (key === 'up' || key === 'down') onMove?.(item, key === 'up' ? -1 : 1);
          else if (key === 'rename') onRename(item);
          else if (key === 'delete') onDelete(item);
        },
      };
      return <div key={item.id} className="nav-recent-row" data-current={item.id === activeId}>
        <Dropdown menu={menu} trigger={['contextMenu']} disabled={locked}>
          <button type="button" className="nav-recent-item" title={title} aria-description={state?.label || (running ? '生成中' : undefined)}
            aria-current={item.id === activeId ? 'true' : undefined}
            draggable={Boolean(onReferenceDrag && !locked && item.id !== activeId && item.message_count)}
            onDragStart={event => onReferenceDrag?.(event, item.id)}
            disabled={locked} aria-disabled={locked} onClick={() => { if (!locked) onOpen(item.id); }}>
            <span>{title}</span>{item.archived && <small className="nav-archived-badge">已归档</small>}{item.pinned && <PushpinOutlined aria-label="已置顶" />}{running ? <LoadingOutlined aria-hidden="true" /> : needsAttention ? <span className="runtime-session-attention" title={state?.label || '需要处理'} aria-label={state?.label || '需要处理'}>!</span> : null}
          </button>
        </Dropdown>
        <Dropdown menu={menu} trigger={['click']} disabled={locked || running || Boolean(needsAttention)}>
          <button type="button" className="nav-recent-more" aria-label={`更多会话操作：${title}`}
            aria-haspopup="menu" disabled={locked || running || Boolean(needsAttention)}><EllipsisOutlined /></button>
        </Dropdown>
      </div>;
    })}
  </div>;
}
