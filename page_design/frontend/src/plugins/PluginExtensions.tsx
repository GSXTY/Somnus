import { DeclarativePlugin } from './DeclarativePlugin';
import { useEffect, useState } from 'react';
import { Alert, Button, Tag } from 'antd';
import { AppstoreOutlined, ArrowRightOutlined, CommentOutlined, LayoutOutlined, SettingOutlined } from '@ant-design/icons';
import type { OwnedPluginPage, PluginExtension } from './DshPluginPage';
import './plugin-extensions.css';
const slots = { settings: '设置', sidebar: '侧栏', 'chat-card': '聊天卡片' };
const icons = { settings: <SettingOutlined />, sidebar: <LayoutOutlined />, 'chat-card': <CommentOutlined /> };
export function PluginExtensions({ active, revision, pluginId, onOpen }: { active: boolean; revision: number; pluginId?: string; onOpen: (page: OwnedPluginPage) => void }) {
  const [rows, setRows] = useState<PluginExtension[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const bridge = window.somnusDshPluginPage;
    if (!active || !bridge) { setRows([]); return; }
    let current = true; setLoading(true); setError('');
    const read = bridge.extensions ? bridge.extensions() : bridge.list ? bridge.list().then(pages => pages.flatMap(page => [
      { id: page.id + ':settings', pluginId: page.pluginId, label: page.label, slot: 'settings' as const, renderer: 'page' as const, pageId: page.id, compatibility: 'ready' as const },
      ...(page.sidebar ? [{ id: page.id + ':sidebar', pluginId: page.pluginId, label: page.label, slot: 'sidebar' as const, renderer: 'page' as const, pageId: page.id, compatibility: 'ready' as const }] : []),
    ])) : Promise.resolve([]);
    void read.then(data => { if (current) setRows(data); }).catch(() => { if (current) setError('暂时无法读取插件界面扩展，请刷新后重试。'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, revision]);
  const matching = rows.filter(row => !pluginId || row.pluginId === pluginId);
  const grouped = new Map<string, { row: PluginExtension; slots: Set<PluginExtension['slot']> }>();
  for(const row of matching){const key=row.renderer==='page'&&row.pageId?JSON.stringify([row.pluginId,row.pageId]):row.id;const existing=grouped.get(key);if(existing)existing.slots.add(row.slot);else grouped.set(key,{row,slots:new Set([row.slot])});}
  const visible=[...grouped.values()];
  return <section className="plugin-section plugin-extensions" aria-label="插件界面扩展" aria-busy={loading}>
    <div className="plugin-section-heading"><div><h3><AppstoreOutlined /> 界面扩展</h3><p>在 Somnus 中使用插件提供的设置、侧栏页面和聊天卡片。</p></div><span className="plugin-extension-count">{visible.filter(({row}) => row.compatibility === 'ready').length} 项可用</span></div>
    {error && <Alert type="warning" showIcon message={error} />}
    {visible.length ? <div className="plugin-extension-list">{visible.map(({row,slots:positions}) => <div key={row.id} className="plugin-extension-row">
      <span className="plugin-extension-icon" aria-hidden="true">{icons[row.slot]}</span>
      <div className="plugin-extension-copy"><strong>{row.label}</strong><small>{row.compatibility==='ready'?'已适配：':'界面位置：'}{[...positions].map(slot=>slots[slot]).join(' · ')}</small>{row.sourceSlot&&<details className="plugin-slot-details"><summary>兼容详情</summary><small>来源插槽：{row.sourceSlot}{row.adapter?' · 已通过 '+row.adapter.upstream+' 适配':''} · {row.pluginId}</small></details>}{row.compatibilitySummary&&<small>已验证 {row.compatibilitySummary.verifiedExtensions} 项界面 · {row.compatibilitySummary.status==='partial'?'部分兼容':row.compatibilitySummary.status==='ready'?'声明范围内兼容':'需要适配'}{row.compatibilitySummary.reasons.length?' · '+row.compatibilitySummary.reasons.join('；'):''}</small>}{(row.description || row.reason) && <p>{row.compatibility === 'adapter-required' ? row.reason || row.description : row.description}</p>}
        {row.compatibility === 'ready' && row.renderer === 'declarative' && <DeclarativePlugin pluginId={row.pluginId} document={row.document} onOpen={onOpen} />}
        {row.compatibility === 'ready' && row.renderer === 'recommendation' && <p>由插件生成后显示在聊天回复中。</p>}
      </div>
      {row.compatibility === 'ready' && positions.has('settings') && positions.has('sidebar') && <Button size="small" onClick={()=>window.dispatchEvent(new CustomEvent('somnus:open-plugin-settings',{detail:{pluginId:row.pluginId}}))}>设置</Button>}
      {row.compatibility === 'ready' ? row.renderer === 'page' && row.pageId ? <Button size="small" icon={<ArrowRightOutlined />} onClick={() => onOpen({ id: row.pageId!, pluginId: row.pluginId, label: row.label, sidebar: row.slot === 'sidebar' })}>打开</Button> : <Tag color="green">已适配</Tag> : <Tag>需要界面适配</Tag>}
    </div>)}</div> : <p className="small-note">{loading ? '正在读取扩展…' : '当前没有已注册的界面扩展。工具、Skill 和 MCP 仍可按各自配置使用。'}</p>}
    <details className="plugin-extension-help"><summary>兼容范围</summary><p>工具、Skill 和 MCP 使用各自的执行接口；界面扩展须注册到 Somnus 支持的位置。DSH 专用界面插槽不会自动等同于 Somnus 的组件，未适配的扩展会明确标记，原有插件设置和独立页面仍保留。</p></details>
  </section>;
}
