import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { DeclarativePlugin } from './DeclarativePlugin';
import type { PluginExtension } from './DshPluginPage';
export function PluginSidebar() {
    const [rows, setRows] = useState<PluginExtension[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
    useEffect(() => {
        let alive = true;
        setBusy(true);
        setError('');
        const bridge = window.somnusDshPluginPage;
        if (!bridge?.extensions) {
            setBusy(false);
            setError('当前宿主不支持插件侧栏扩展。');
            return;
        }
        void bridge.extensions().then(rows => { if (alive)
            setRows(rows.filter(row => row.slot === 'sidebar' && row.renderer === 'declarative')); }).catch(failure => { if (alive)
            setError(failure instanceof Error ? failure.message : '读取插件侧栏失败'); }).finally(() => { if (alive)
            setBusy(false); });
        return () => { alive = false; };
    }, [revision]);
    return <section aria-label="插件侧栏扩展"><div className="workspace-panel-row"><h3>插件</h3><Button size="small" loading={busy} onClick={() => setRevision(value => value + 1)}>刷新</Button></div>
 {error && <Alert type="warning" message={error}/>} {busy && <Spin size="small"/>}
 {rows.map(row => row.compatibility === 'ready' ? <DeclarativePlugin key={row.id + ':' + revision} pluginId={row.pluginId} document={row.document} onOpen={page => window.dispatchEvent(new CustomEvent('somnus:open-owned-page', { detail: { pluginId: page.pluginId, pageId: page.id } }))}/> : <Alert key={row.id} type="info" message={row.label + '：需要界面适配'}/>)}
 {!busy && !error && !rows.length && <p className="small-note">当前没有已启用的声明式侧栏插件。原有插件页面仍可从主导航打开。</p>}
 </section>;
}
