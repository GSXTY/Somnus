import { Dropdown } from 'antd';
import { DeleteOutlined, EditOutlined, EllipsisOutlined, LoadingOutlined } from '@ant-design/icons';
import type { Conversation } from './assistantApi';
import type { DragEvent } from 'react';

type Props = {
  items: Conversation[];
  activeId?: string;
  locked: boolean;
  loading: boolean;
  runningIds?: ReadonlyMap<string, unknown>;
  onOpen: (id: string) => void;
  onReferenceDrag?: (event: DragEvent<HTMLButtonElement>, id: string) => void;
  onRename: (item: Conversation) => void;
  onDelete: (item: Conversation) => void;
};

export function RecentSessions({ items, activeId, locked, loading, runningIds, onOpen, onReferenceDrag, onRename, onDelete }: Props) {
  return <div className="nav-recent" aria-label="最近会话">
    <div className="nav-caption">最近会话</div>
    {!items.length && <small className="nav-recent-empty">{loading ? '正在读取会话…' : '还没有会话'}</small>}
    {items.map(item => {
      const running = runningIds?.has(item.id);
      const title = item.title || '新会话';
      const menu = {
        items: [
          { key: 'rename', label: '重命名', icon: <EditOutlined /> },
          { key: 'delete', label: '删除会话', icon: <DeleteOutlined />, danger: true },
        ],
        onClick: ({ key }: { key: string }) => {
          if (key === 'rename') onRename(item);
          else if (key === 'delete') onDelete(item);
        },
      };
      return <div key={item.id} className="nav-recent-row" data-current={item.id === activeId}>
        <Dropdown menu={menu} trigger={['contextMenu']} disabled={locked || running}>
          <button type="button" className="nav-recent-item" title={title} aria-description={running ? '生成中' : undefined}
            aria-current={item.id === activeId ? 'true' : undefined}
            draggable={Boolean(onReferenceDrag && !locked && item.id !== activeId && item.message_count)}
            onDragStart={event => onReferenceDrag?.(event, item.id)}
            aria-disabled={locked} onClick={() => { if (!locked) onOpen(item.id); }}>
            <span>{title}</span>{running && <LoadingOutlined aria-hidden="true" />}
          </button>
        </Dropdown>
        <Dropdown menu={menu} trigger={['click']} disabled={locked || running}>
          <button type="button" className="nav-recent-more" aria-label={`更多会话操作：${title}`}
            aria-haspopup="menu" disabled={locked || running}><EllipsisOutlined /></button>
        </Dropdown>
      </div>;
    })}
  </div>;
}
