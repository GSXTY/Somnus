import { useEffect, useState } from "react";
import { Alert, Button } from "antd";
import { safePluginDocument } from "./pluginDocument.mjs";
import type { OwnedPluginPage } from "./DshPluginPage";
import { PluginBlockView } from "./PluginBlocks";
import type { PluginDocument, PluginAction } from "./pluginDocumentTypes";
export type { PluginDocument } from "./pluginDocumentTypes";
export type PluginCard = {
    pluginId: string;
    document: PluginDocument;
};
export function DeclarativePlugin({ pluginId, document, onOpen, }: {
    pluginId: string;
    document: unknown;
    onOpen?: (page: OwnedPluginPage) => void;
}) {
    const value = safePluginDocument(document, pluginId) as PluginDocument | null, [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [revisions, setRevisions] = useState<Record<string, number>>({}), [snapshots, setSnapshots] = useState<Record<string, Record<string, string | number | boolean>>>({}), [settingsLoading, setSettingsLoading] = useState(false);
    const settingsKey = JSON.stringify(value?.actions?.filter(action => action.type === 'save-own-settings') || []);
    useEffect(() => {
        let alive = true;
        setSnapshots({});
        setRevisions({});
        const actions = value?.actions?.filter((action): action is PluginAction & {
            type: 'save-own-settings';
        } => action.type === 'save-own-settings') || [];
        if (!actions.length)
            return;
        setSettingsLoading(true);
        setError('');
        void (async () => {
            const bridge = window.vvmanAcp;
            if (!bridge?.dshInstalledPlugins || !bridge.dshPluginSettings)
                throw Error('当前宿主不能读取插件设置。');
            const installed = await bridge.dshInstalledPlugins();
            const target = installed.plugins.find(plugin => plugin.name === pluginId && plugin.enabled && plugin.available);
            if (!target)
                throw Error('此插件未启用或无法验证归属。');
            const config = await bridge.dshPluginSettings(target.id, target.source);
            if (!config.writable)
                throw Error('此插件设置当前不可写。');
            const revisions: Record<string, number> = {}, snapshots: Record<string, Record<string, string | number | boolean>> = {};
            for (const action of actions) {
                const section = config.sections.find(section => section.id === action.sectionId);
                if (!section)
                    throw Error('此插件设置分区不存在。');
                revisions[action.id] = section.revision;
                const values: Record<string, string | number | boolean> = {};
                for (const block of value!.blocks.filter(block => block.type === 'form' && block.submitActionId === action.id)) {
                    if (block.type !== 'form')
                        continue;
                    for (const field of block.fields) {
                        const actual = section.fields.find(item => item.key === field.key);
                        if (!actual || actual.type !== field.kind)
                            throw Error('表单字段与此插件真实设置不匹配。');
                        if (['string', 'number', 'boolean'].includes(typeof actual.value))
                            values[field.key] = actual.value as string | number | boolean;
                    }
                }
                snapshots[action.id] = values;
            }
            if (alive) {
                setRevisions(revisions);
                setSnapshots(snapshots);
            }
        })().catch(failure => { if (alive)
            setError(failure instanceof Error ? failure.message : '读取插件设置失败'); }).finally(() => { if (alive)
            setSettingsLoading(false); });
        return () => { alive = false; };
    }, [pluginId, settingsKey]);
    if (!value)
        return (<Alert type="warning" message="此插件界面声明无效，未执行任何内容。"/>);
    async function action(item: PluginAction, edits?: Record<string, string | number | boolean>) {
        setError("");
        setNotice("");
        if (item.type === "insertDraft") {
            window.dispatchEvent(new CustomEvent("somnus:insert-draft", { detail: { text: item.text.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (whole, key) => edits && Object.hasOwn(edits, key) ? String(edits[key]) : whole) } }));
            setNotice("已放入当前会话草稿，尚未发送。");
            return;
        }
        if (item.type === 'save-own-settings') {
            if (!edits) {
                setError('请通过对应表单提交设置。');
                return;
            }
            setBusy(true);
            try {
                const bridge = window.vvmanAcp;
                if (!bridge?.dshInstalledPlugins || !bridge.saveDshPluginSettings)
                    throw Error('当前宿主不支持插件设置保存。');
                const installed = await bridge.dshInstalledPlugins();
                const target = installed.plugins.find(plugin => plugin.name === pluginId && plugin.enabled && plugin.available);
                if (!target)
                    throw Error('此插件未启用或无法验证归属。');
                const updated = await bridge.saveDshPluginSettings(target.id, target.source, item.sectionId, revisions[item.id] ?? -1, Object.entries(edits).map(([key, value]) => ({ key, value })));
                const section = updated.sections.find(section => section.id === item.sectionId);
                if (section)
                    setRevisions(old => ({ ...old, [item.id]: section.revision }));
                setNotice('插件设置已保存。');
            }
            catch (failure) {
                setError(failure instanceof Error ? failure.message : '插件设置保存失败，表单尚未提交。');
            }
            finally {
                setBusy(false);
            }
            return;
        }
        if (item.type === "read-own-settings") {
            window.dispatchEvent(new CustomEvent("somnus:open-plugin-settings", {
                detail: { pluginId },
            }));
            return;
        }
        setBusy(true);
        try {
            const pages = await window.somnusDshPluginPage?.list?.();
            const page = pages?.find((page) => page.pluginId === pluginId && page.id === item.pageId);
            if (!page)
                throw Error("此插件页面不存在或不属于当前插件。");
            if (!onOpen)
                throw Error("当前页面无法打开插件窗口。");
            onOpen(page);
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : "无法打开插件页面");
        }
        finally {
            setBusy(false);
        }
    }
    return (<article className="declarative-plugin" aria-label={value.title || "插件卡片"}>
      {value.title && <h3>{value.title}</h3>}
      {value.blocks.map((block, index) => <PluginBlockView key={index} block={block} actions={value.actions || []} busy={busy || settingsLoading || Boolean(block.type === 'form' && value.actions?.some(action => action.id === block.submitActionId && action.type === 'save-own-settings') && snapshots[block.submitActionId] === undefined)} initialValues={block.type === 'form' ? snapshots[block.submitActionId] : undefined} onAction={action}/>)}
      {error&&<Alert type="error" message={error}/>}
      {notice&&<p role="status">{notice}</p>}
      <footer>
        {value.actions?.filter(item => !value.blocks.some(block => block.type === 'form' && block.submitActionId === item.id)).map((item, index) => (<Button key={index} size="small" disabled={busy} onClick={() => void action(item)}>
            {item.label}
          </Button>))}
      </footer>
      <small className="small-note">{pluginId}</small>
    </article>);
}
export function DeclarativePluginCards({ cards, onOpen, }: {
    cards?: PluginCard[];
    onOpen?: (page: OwnedPluginPage) => void;
}) {
    return Array.isArray(cards) ? (<section aria-label="插件结果卡片">
      {cards.map((card, index) => (<DeclarativePlugin key={index} {...card} onOpen={onOpen}/>))}
    </section>) : null;
}
