import { useEffect, useState } from 'react';
import { Alert, Button } from 'antd';
import { RecentSessions } from './RecentSessions';
import { sessionIndex } from './assistantApi';
import type { Conversation, ConversationOrganization } from './assistantApi';
import { orderSidebarItems, saveSidebarView, useSidebarView } from '../app/sidebarView';

type Props = React.ComponentProps<typeof RecentSessions> & { onOrganize: (item: Conversation, changes: ConversationOrganization) => Promise<Conversation>; workspace: string; onOpenWorkspace: (workspace: string, id: string) => void };
export function SidebarSessionList({ workspace, items, onOpenWorkspace, onOrganize, ...props }: Props) {
  const view = useSidebarView();
  const [index, setIndex] = useState<Conversation[]>([]), [overrides, setOverrides] = useState<Record<string, boolean>>({}), [error, setError] = useState(''), [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => sessionIndex().then(result => { if (alive) { setIndex(result.conversations); setTruncated(result.truncated); setError(''); } }).catch(() => { if (alive) setError('无法读取完整会话列表'); });
    const timer = setTimeout(() => void load(), 150); window.addEventListener('somnus:projects-changed', load);
    return () => { clearTimeout(timer); alive = false; window.removeEventListener('somnus:projects-changed', load); };
  }, [workspace, items]);
  const merged = new Map(index.map(item => [item.id, item]));
  for (const item of items) merged.set(item.id, { ...item, workspace_id: item.workspace_id || workspace });
  for (const [id, archived] of Object.entries(overrides)) { const item = merged.get(id); if (item) merged.set(id, { ...item, archived }); }
  const rows = orderSidebarItems([...merged.values()].filter(item => (view.group === 'flat' || (item.workspace_id || 'default') === workspace) &&
    (view.archived === 'show' || Boolean(item.archived) === (view.archived === 'only'))), view);
  async function organize(item: Conversation) {
    try {
      const next = await onOrganize({ ...item, workspace_id: item.workspace_id || workspace }, { archived: !item.archived });
      setOverrides(old => ({ ...old, [item.id]: Boolean(next.archived) }));
      setIndex(old => [...old.filter(value => value.id !== item.id), next]);
      window.dispatchEvent(new Event('somnus:projects-changed'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : '更新会话失败'); }
  }
  function move(item: Conversation, direction: number) {
    const ids = rows.map(row => row.id), current = ids.indexOf(item.id), next = current + direction;
    if (current < 0 || next < 0 || next >= ids.length) return;
    [ids[current], ids[next]] = [ids[next], ids[current]];
    saveSidebarView({ manual: [...ids, ...view.manual.filter(id => !ids.includes(id))], order: 'manual' });
  }
  return <>{error && <Alert type="warning" message={error} />}
    <RecentSessions {...props} items={rows} onOpen={id => { const item = merged.get(id); if (item) onOpenWorkspace(item.workspace_id || 'default', id); }}
      manualOrder={view.order === 'manual'} onMove={move} onArchive={organize} />
    {truncated && <small className="nav-recent-empty">仅显示最近部分会话；搜索可查找更多会话。</small>}
  </>;
}
