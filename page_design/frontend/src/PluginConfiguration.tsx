import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Alert, Button, Dropdown, Input, Modal, Popconfirm, Segmented, Select, Spin, Switch, Tag } from 'antd';
import { AppstoreOutlined, ControlOutlined, DeleteOutlined, DownloadOutlined, DownOutlined, LeftOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { importPlugin, isPortablePluginPackage, listDefaultPlugins, listInstalledPlugins, listSkills, publishDefaultPlugin, removeDefaultPlugin, removePlugin, setPluginEnabled } from './assistantApi';
import type { DefaultPlugin, InstalledPlugin, PluginManifest } from './assistantApi';
import { describeError } from './errors.mjs';
import { DshPluginMarket } from './DshPluginMarket';
import { PluginDevelopment } from './PluginDevelopment';
import { PluginSourceInstaller } from './PluginSourceInstaller';
import { AgentExecutionSettings } from './AgentExecutionSettings';
import { OarPluginSettings } from './OarPluginSettings';
import { McpServers } from './McpServers';
import { PersonalSkills } from './PersonalSkills';
import { DSH_IM_PLUGIN, DshPluginPage, OwnedDshPluginPage } from './DshPluginPage';
import type { OwnedPluginPage } from './DshPluginPage';
import type { InstalledDshPlugin, InstalledDshPlugins, Market } from './DshPluginMarket';
import './models.css';
import './plugin-management.css';

type BundledPlugin = { key: string; name: string; version?: string; tools: number };
type Reference = { id: string; name: string };
const marketPreference = 'somnus.plugin-market-v2';
const projectHandoffPluginId = 'bc02526a0f8856b89722ce466774a420';
const defaultImEntry = 'builtin:im-robot';
const markets = [
  { key: 'community', label: 'dsh-community-market', beta: true, description: '开放插件市场，支持添加和选择自定义插件数据源。',
    repository: 'https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/dsh-community-market' },
  { key: 'dsh-market', label: 'dsh-market', beta: false, description: '社区热门的插件市场，数据来自',
    repository: 'https://github.com/dsh-market/dsh-market' },
] as const;
const installedViews = [
  { key: 'plugin-config', label: '插件' }, { key: 'mcp', label: 'MCP' }, { key: 'skills', label: 'Skills' },
] as const;
type PluginConfigurationView = (typeof installedViews)[number]['key'];
export function isPluginConfigurationView(view: string): view is PluginConfigurationView {
  return installedViews.some(item => item.key === view);
}

function readMarketPreference(): { market?: Market; enabled: boolean } {
  try {
    const saved = window.localStorage.getItem(marketPreference);
    if (saved !== null) {
      const [market, state] = saved.split(':');
      return { market: market === 'community' ? market : 'dsh-market', enabled: state !== 'off' };
    }
    const previous = window.localStorage.getItem('somnus.plugin-market');
    if (previous !== null || window.localStorage.getItem('somnus.plugin-market-preferences')) {
      return { market: 'dsh-market', enabled: !previous?.endsWith(':off') };
    }
  } catch { /* no persisted preference */ }
  return { market: 'community', enabled: false };
}
type DshSettingValue = boolean | number | string | null | DshSettingValue[] | { [key: string]: DshSettingValue };
type DshSettingField = { key: string; type: 'boolean' | 'number' | 'string' | 'enum' | 'json'; value?: DshSettingValue;
  description?: string; min?: number; max?: number; step?: number; overridden: boolean; options?: DshSettingValue[] };
type DshSettingSection = { id: string; title?: string; revision: number; fields: DshSettingField[] };
export type DshPluginSettings = { writable: boolean; sections: DshSettingSection[] };
export type DshSettingEdit = { key: string; value?: DshSettingValue };
export type DshPluginRequest = { id: string; sequence: number };

function DshSettingsSection({ section, writable, busy, onSave }: {
  section: DshSettingSection; writable: boolean; busy: boolean; onSave: (edits: DshSettingEdit[]) => Promise<void>;
}) {
  const [edits, setEdits] = useState<Record<string, DshSettingEdit>>({});
  const [jsonDraft, setJsonDraft] = useState<Record<string, string>>({});
  const active = Object.values(edits);
  const invalidJson = Object.values(jsonDraft).some(text => {
    try { JSON.parse(text); return false; } catch { return true; }
  });
  return <fieldset className="provider-credentials" disabled={!writable || busy}>
    <legend>{section.title || section.id}</legend>
    {section.fields.map(field => {
      const edit = edits[field.key];
      const value = edit ? edit.value : field.value;
      const setValue = (value: DshSettingValue) => setEdits(current => ({ ...current, [field.key]: { key: field.key, value } }));
      return <div key={field.key}>
        <label>
          <span>{field.key}</span>
          {field.description && <small>{field.description}</small>}
          {field.type === 'json' ? <Input.TextArea value={jsonDraft[field.key] ?? (value === undefined ? '' : JSON.stringify(value, null, 2))}
            placeholder="输入 JSON" maxLength={12000} rows={4} onChange={event => {
              const input = event.target.value;
              setJsonDraft(current => ({ ...current, [field.key]: input }));
              try { setValue(JSON.parse(input)); } catch { /* keep draft editable until valid */ }
            }} /> : field.type === 'enum' ? <select value={String(field.options?.findIndex(option => option === value) ?? -1)}
            onChange={event => {
              const option = field.options?.[Number(event.target.value)];
              if (option !== undefined) setValue(option);
            }}>
            <option value="-1" disabled>默认</option>
            {field.options?.map((option, index) => <option key={index} value={index}>{String(option)}</option>)}
          </select> : field.type === 'boolean' ? <select value={value === undefined ? '' : String(value)}
            onChange={event => setValue(event.target.value === 'true')}>
            <option value="" disabled>默认</option><option value="true">启用</option><option value="false">停用</option>
          </select> : <Input type={field.type === 'number' ? 'number' : 'text'} value={String(value ?? '')}
            maxLength={field.type === 'string' ? 4000 : undefined} min={field.min} max={field.max} step={field.step} onChange={event => {
              const input = event.target.value;
              if (field.type === 'number') {
                const number = event.target.valueAsNumber;
                setValue(input && Number.isFinite(number) ? number : '');
              } else setValue(input);
            }} />}
        </label>
        {writable && (field.overridden || edit || jsonDraft[field.key] !== undefined) &&
          <Button size="small" onClick={() => {
            setJsonDraft(current => {
              const next = { ...current };
              delete next[field.key];
              return next;
            });
            setEdits(current => ({ ...current, [field.key]: { key: field.key } }));
          }}>恢复默认</Button>}
      </div>;
    })}
    {invalidJson && <Alert type="warning" showIcon message="请检查设置中的 JSON 格式。" />}
    {writable && <Button type="primary" loading={busy} disabled={invalidJson || !active.length || active.some(edit =>
      edit.value === '' && section.fields.find(field => field.key === edit.key)?.type === 'number')}
      onClick={() => void onSave(active)}>保存设置</Button>}
  </fieldset>;
}

function DshSettings({ plugin }: { plugin: InstalledDshPlugin }) {
  const bridge = window.vvmanAcp;
  const [config, setConfig] = useState<DshPluginSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void bridge?.dshPluginSettings?.(plugin.id, plugin.source).then(result => {
      if (active) setConfig(result);
    }).catch(failure => {
      if (active) setError(describeError(failure, '无法读取插件设置'));
    });
    return () => { active = false; };
  }, [bridge, plugin.id, plugin.source]);
  async function save(section: DshSettingSection, edits: DshSettingEdit[]) {
    if (busy || !bridge?.saveDshPluginSettings) return;
    setBusy(true);
    setError('');
    try { setConfig(await bridge.saveDshPluginSettings(plugin.id, plugin.source, section.id, section.revision, edits)); }
    catch (failure) { setError(describeError(failure, '无法保存插件设置')); }
    finally { setBusy(false); }
  }
  return <section aria-label="插件设置" className="plugin-settings-fields">
    {error && <Alert showIcon type="error" message={error} />}
    {!config && !error && <Spin size="small" />}
    {config?.sections.length === 0 && <p className="small-note">此插件没有可在这里配置的设置。</p>}
    {config?.sections.map(section => <DshSettingsSection key={section.id + ':' + section.revision}
      section={section} writable={config.writable && Boolean(bridge?.saveDshPluginSettings)} busy={busy}
      onSave={edits => save(section, edits)} />)}
  </section>;
}

function uniqueDshPlugins(plugins: InstalledDshPlugin[]) {
  const byId = new Map<string, InstalledDshPlugin>();
  for (const plugin of plugins) {
    const previous = byId.get(plugin.id);
    if (!previous || (previous.source === 'community' && plugin.source === 'official')) byId.set(plugin.id, plugin);
  }
  return [...byId.values()];
}

function dshSource(plugin: InstalledDshPlugin) {
  return plugin.source === 'official' ? '官方市场' : '社区市场';
}

export function PluginConfiguration({ active, view = 'plugin-config', onOpen, onOpenIm, suggestedPlugin, installedPluginRequest, overviewRequest, windowsDesktop }: {
  active?: boolean; suggestedPlugin?: string; installedPluginRequest?: DshPluginRequest; windowsDesktop?: boolean;
  view?: PluginConfigurationView; onOpen?: (view: PluginConfigurationView) => void; overviewRequest?: number;
  onOpenIm?: () => void;
}) {
  const bridge = window.vvmanAcp;
  const pluginsView = view === 'plugin-config';
  const [revision, setRevision] = useState(0);
  const [marketRevision, setMarketRevision] = useState(0);
  const [dshRevision, setDshRevision] = useState(0);
  const [dshInstalled, setDshInstalled] = useState<InstalledDshPlugin[]>([]);
  const [defaultImStatus, setDefaultImStatus] = useState<InstalledDshPlugins['defaultIm']>();
  const [imEnableError, setImEnableError] = useState('');
  const [dshLoading, setDshLoading] = useState(Boolean(bridge?.dshInstalledPlugins || bridge?.dshPluginMarket));
  const [dshError, setDshError] = useState('');
  const [builtins, setBuiltins] = useState<BundledPlugin[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [defaults, setDefaults] = useState<DefaultPlugin[]>([]);
  const [defaultGroupOpen, setDefaultGroupOpen] = useState(false);
  const [owner, setOwner] = useState(false);
  const [skills, setSkills] = useState<Reference[]>([]);
  const [mcp, setMcp] = useState<Reference[]>([]);
  const [selected, select] = useState('');
  const returnFocus = useRef<HTMLElement>();
  const shouldRestoreFocus = useRef(false);
  const [openPluginPage, setOpenPluginPage] = useState<InstalledDshPlugin>();
  const [openOwnedPage, setOpenOwnedPage] = useState<OwnedPluginPage>();
  const [ownedPages, setOwnedPages] = useState<OwnedPluginPage[]>([]);
  const [nativePage, setNativePage] = useState<string>();
  useEffect(() => {
    if (!active) { setOpenPluginPage(undefined); setOpenOwnedPage(undefined); }
  }, [active]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [sourceReference, setSourceReference] = useState<string>();
  const [developmentDraft, setDevelopmentDraft] = useState<string>();
  const [marketOpen, setBrowseMarket] = useState(false);
  const browseMarket = pluginsView && marketOpen;
  const [marketRequest, setMarketRequest] = useState<{ market: Market }>();
  const [preferredMarket, setPreferredMarket] = useState(readMarketPreference);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addPluginTrigger = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const [manifest, setManifest] = useState('');
  const [mode, setMode] = useState<'create' | 'json'>('create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [mcpIds, setMcpIds] = useState<string[]>([]);
  const canSubmit = mode === 'json' ? Boolean(manifest.trim()) : Boolean(name.trim() && (skillIds.length || mcpIds.length));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    const readRegistry = async (path: string) => {
      const response = await fetch(path, { cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error('无法读取插件引用');
      return response.json();
    };
    void readRegistry('/api/plugins').then(data => { if (!abort.signal.aborted) setBuiltins(data.plugins || []); }).catch(() => {});
    void listSkills(abort.signal).then(setSkills).catch(() => {});
    void readRegistry('/api/mcp/servers').then(data => setMcp(data.servers || [])).catch(() => {});
    void listDefaultPlugins(abort.signal).then(result => {
      if (!abort.signal.aborted) { setDefaults(result.plugins); setOwner(result.owner_configured); }
    }).catch(() => {});
    void listInstalledPlugins(abort.signal).then(items => { if (!abort.signal.aborted) setInstalled(items); })
      .catch(failure => { if (!abort.signal.aborted) setError(describeError(failure, '无法读取导入的插件')); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision]);

  useEffect(() => {
    if (!bridge?.dshInstalledPlugins && !bridge?.dshPluginMarket) return;
    let active = true;
    setDshLoading(true);
    setDshError('');
    async function load(): Promise<InstalledDshPlugins> {
      if (bridge?.dshInstalledPlugins) return bridge.dshInstalledPlugins();
      const market = await bridge?.dshPluginMarket?.();
      return { plugins: (market?.plugins || []).filter(item => item.installed)
        .map(item => ({ ...item, source: 'official', available: item.available !== false, enabled: true })) };
    }
    void load().then(({ plugins, defaultIm }) => {
      if (active) {
        setDshInstalled(uniqueDshPlugins(plugins));
        setDefaultImStatus(defaultIm);
      }
    })
      .catch(failure => { if (active) setDshError(describeError(failure, '无法读取已安装的原生插件')); })
      .finally(() => { if (active) setDshLoading(false); });
    return () => { active = false; };
  }, [bridge, revision, dshRevision, installedPluginRequest]);

  const handledSettingsRequest = useRef<number>();
  const requestedEntry = useRef<HTMLDivElement>(null);
  const defaultImRow = useRef<HTMLDivElement>(null);
  function openDefaultIm() {
    setBrowseMarket(false);
    setDefaultGroupOpen(true);
    select(defaultImEntry);
  }
  useEffect(() => {
    if (!active || !installedPluginRequest || dshLoading || handledSettingsRequest.current === installedPluginRequest.sequence) return;
    const plugin = dshInstalled.find(item => item.id === installedPluginRequest.id || item.name === installedPluginRequest.id);
    if (installedPluginRequest.id === DSH_IM_PLUGIN || plugin?.id === DSH_IM_PLUGIN) {
      handledSettingsRequest.current = installedPluginRequest.sequence;
      openDefaultIm();
      return;
    }
    if (plugin) {
      handledSettingsRequest.current = installedPluginRequest.sequence;
      setQuery('');
      select('dsh:' + plugin.id);
    }
  }, [active, installedPluginRequest, dshLoading, dshInstalled]);
  useEffect(() => {
    if (selected === defaultImEntry) defaultImRow.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const term = query.trim().toLowerCase();
  const imported = installed.filter(item => item.name.toLowerCase().includes(term));
  const defaultIm = dshInstalled.find(item => item.id === DSH_IM_PLUGIN);
  const showDefaultIm = Boolean(windowsDesktop || defaultIm);
  const legacyImDisabled = Boolean(defaultIm && !defaultIm.enabled && !defaultIm.managedDefault);
  const canEnableDefaultIm = legacyImDisabled && Boolean(bridge?.setDshInstalledPluginEnabled);
  const imState = defaultImStatus?.status === 'failed' ? '准备失败' :
    defaultIm?.enabled ? '已启用' : legacyImDisabled ? '已停用' : '等待运行时确认';
  const personalDsh = dshInstalled.filter(item => item.id !== DSH_IM_PLUGIN && !item.managedDefault);
  const visibleDefaults = defaults.filter(item => item.id !== projectHandoffPluginId && !(item.builtin && item.name === 'Project Handoff'));
  const visibleDsh = personalDsh.filter(item =>
    [item.name, item.id, item.description, dshSource(item)].some(value => value.toLowerCase().includes(term)));
  const hasPersonal = Boolean(installed.length || personalDsh.length);
  const personal = installed.find(item => 'personal:' + item.id === selected);
  const dshPlugin = personalDsh.find(item => 'dsh:' + item.id === selected);
  const isRequestedEntry = Boolean(active && installedPluginRequest && dshPlugin &&
    (dshPlugin.id === installedPluginRequest.id || dshPlugin.name === installedPluginRequest.id));
  useEffect(() => {
    if (isRequestedEntry) requestedEntry.current?.scrollIntoView({ block: 'nearest' });
  }, [isRequestedEntry, installedPluginRequest?.sequence]);
  useEffect(() => {
    setNativePage(undefined);
    setOwnedPages([]);
    const api = window.somnusDshPluginPage;
    if (!active || !dshPlugin?.enabled || dshPlugin.id === DSH_IM_PLUGIN || !api) return;
    let current = true;
    void api.status?.(dshPlugin.id, dshPlugin.source).then(result => {
      if (current && result.available) setNativePage(dshPlugin.id);
    }).catch(() => {});
    if (api.list && api.showOwned) void api.list().then(pages => {
      if (current) setOwnedPages(pages.filter(page => page.pluginId === dshPlugin.id));
    }).catch(() => {});
    return () => { current = false; };
  }, [active, dshPlugin?.id, dshPlugin?.source, dshPlugin?.enabled, revision, dshRevision]);
  const sharedPlugin = visibleDefaults.find(item => 'default:' + item.id === selected);
  const addon = personal || sharedPlugin;
  const builtin = builtins.find(item => 'builtin:' + item.key === selected);
  const defaultCount = builtins.length + visibleDefaults.length + Number(showDefaultIm);
  const detailName = pluginsView ? personal?.name || dshPlugin?.name : undefined;
  useEffect(() => {
    if (!detailName && shouldRestoreFocus.current) {
      shouldRestoreFocus.current = false;
      returnFocus.current?.focus();
    }
  }, [detailName]);

  async function changeDefault(id: string, operation: 'publish' | 'remove') {
    if (!owner || busy || (operation === 'remove' && defaults.some(item => item.id === id && item.builtin))) return;
    setBusy(true);
    setError('');
    try {
      if (operation === 'publish') {
        const plugin = await publishDefaultPlugin(id);
        setDefaults(items => [...items.filter(item => item.id !== plugin.id), plugin]);
        setDefaultGroupOpen(true);
        select('default:' + plugin.id);
      } else {
        await removeDefaultPlugin(id);
        setDefaults(items => items.filter(item => item.id !== id));
        select(current => current === 'default:' + id ? '' : current);
      }
    } catch (failure) { setError(describeError(failure, '无法更新默认插件')); }
    finally { setBusy(false); }
  }

  function closeImport() {
    setShowImport(false); setManifest(''); setImportError('');
    setName(''); setDescription(''); setSkillIds([]); setMcpIds([]);
  }
  async function loadFile(file?: File) {
    if (!file) return;
    setImportError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('插件包不能超过 2 MiB。');
      setManifest((await file.text()).replace(/^\uFEFF/, ''));
    } catch (failure) { setImportError(describeError(failure, '无法读取 JSON 文件')); }
  }
  async function install() {
    if (busy || !canSubmit) return;
    setBusy(true);
    setImportError('');
    try {
      let data: PluginManifest = { name: name.trim(), description: description.trim(), skill_ids: skillIds, mcp_ids: mcpIds };
      if (mode === 'json') {
        try { data = JSON.parse(manifest); } catch { throw new Error('请输入有效的 JSON。'); }
        if (isPortablePluginPackage(data)) {
          setDevelopmentDraft(manifest);
          closeImport();
          return;
        }
      }
      const plugin = await importPlugin(data);
      setInstalled(items => [...items.filter(item => item.id !== plugin.id), plugin]);
      setQuery('');
      select('personal:' + plugin.id);
      closeImport();
    } catch (failure) { setImportError(describeError(failure, '无法导入插件')); }
    finally { setBusy(false); }
  }
  async function change(plugin: InstalledPlugin, operation: 'toggle' | 'remove') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (operation === 'remove') {
        await removePlugin(plugin.id);
        setInstalled(items => items.filter(item => item.id !== plugin.id));
        select(current => current === 'personal:' + plugin.id ? '' : current);
      } else {
        const updated = await setPluginEnabled(plugin.id, !plugin.enabled);
        setInstalled(items => items.map(item => item.id === updated.id ? updated : item));
      }
    } catch (failure) { setError(describeError(failure, operation === 'remove' ? '无法卸载插件' : '无法更新插件')); }
    finally { setBusy(false); }
  }
  async function changeDsh(plugin: InstalledDshPlugin, operation: 'toggle' | 'uninstall' = 'toggle') {
    if (plugin.id === DSH_IM_PLUGIN || plugin.managedDefault) return;
    const uninstall = operation === 'uninstall';
    if (busy || dshLoading || !bridge || (uninstall ? !bridge.uninstallDshPlugin : !bridge.setDshInstalledPluginEnabled)) return;
    setBusy(true);
    setDshError('');
    try {
      const result = uninstall ? await bridge.uninstallDshPlugin!(plugin.id, plugin.source) :
        await bridge.setDshInstalledPluginEnabled!(plugin.id, plugin.source, !plugin.enabled);
      setDshInstalled(uniqueDshPlugins(result.plugins));
      if (uninstall) {
        if (result.plugins.some(item => item.id === plugin.id && item.source === plugin.source)) return;
        select(current => current === 'dsh:' + plugin.id ? '' : current);
      }
      setDshRevision(value => value + 1);
      setMarketRevision(value => value + 1);
    } catch (failure) {
      setDshError(describeError(failure, uninstall ? '无法卸载原生插件' : '无法更新原生插件'));
      if (uninstall && bridge.dshInstalledPlugins) {
        const remaining = await bridge.dshInstalledPlugins().catch(() => undefined);
        if (remaining) setDshInstalled(uniqueDshPlugins(remaining.plugins));
      }
    }
    finally { setBusy(false); }
  }
  async function enableDefaultIm() {
    if (busy || dshLoading || !canEnableDefaultIm || !defaultIm || !bridge?.setDshInstalledPluginEnabled) return;
    setBusy(true);
    setImEnableError('');
    try {
      const result = await bridge.setDshInstalledPluginEnabled(defaultIm.id, defaultIm.source, true);
      setDshInstalled(uniqueDshPlugins(result.plugins));
      setDefaultImStatus(result.defaultIm);
      if (!result.plugins.some(plugin => plugin.id === defaultIm.id && plugin.enabled)) {
        setImEnableError('桌面运行时没有确认 IM 机器人已启用。');
      }
      setDshRevision(value => value + 1);
      setMarketRevision(value => value + 1);
    } catch (failure) {
      setImEnableError(describeError(failure, '无法启用 IM 机器人'));
    } finally { setBusy(false); }
  }
  function referenceList(title: string, ids: string[], missing: string[], inactive: string[], references: Reference[]) {
    return <div className="provider-model-row"><strong>{title}</strong>{ids.length ? <ul>
      {ids.map(id => <li key={id}>{references.find(item => item.id === id)?.name || id}
        {missing.includes(id) ? <Tag color="error">已移除</Tag> : inactive.includes(id) ? <Tag>已停用</Tag> : <Tag color="green">可用</Tag>}
      </li>)}</ul> : <span>无</span>}</div>;
  }
  function entry(id: string, name: string, detail: string, personal = false, status?: ReactNode, action?: ReactNode) {
    const open = id === selected;
    const detailId = 'plugin-detail-' + id;
    return <div key={id} ref={id === defaultImEntry ? defaultImRow : undefined}
      className={'plugin-row plugin-inventory-row' + (personal ? ' plugin-personal-row' : '')}>
      <button className="plugin-row-link" type="button" aria-expanded={personal ? undefined : open} aria-controls={detailId}
        onClick={event => {
          if (personal) returnFocus.current = event?.currentTarget;
          select(open ? '' : id);
        }}>
        <span className={'plugin-symbol' + (personal ? ' plugin-symbol-personal' : '')} aria-hidden="true">
          {personal ? <AppstoreOutlined /> : <ControlOutlined />}
        </span>
        <span className="plugin-row-copy"><strong>{name}</strong><small>{detail}</small></span>
        {status && <span className="plugin-row-status">{status}</span>}
        <DownOutlined className="plugin-row-arrow" aria-hidden="true" />
      </button>
      {action && <div className="plugin-row-actions">{action}</div>}
      {!personal && <div className="plugin-inventory-details" id={detailId} hidden={!open}>{open && entryDetails}</div>}
    </div>;
  }

  const entryDetails = selected === defaultImEntry && showDefaultIm ? <>
      <div className="provider-detail-head"><div>在本机配置微信、飞书等机器人。</div><Tag>默认</Tag></div>
      <dl className="provider-credentials">
        <div><dt>插件 ID</dt><dd>{DSH_IM_PLUGIN}</dd></div>
        {defaultIm?.version && <div><dt>版本</dt><dd>{defaultIm.version}</dd></div>}
        <div><dt>状态</dt><dd>{imState}</dd></div>
      </dl>
      {defaultImStatus?.message && <Alert showIcon type={defaultImStatus.status === 'failed' ? 'error' : 'info'}
        message={defaultImStatus.message} />}
      {imEnableError && <Alert showIcon type="error" message={imEnableError} />}
      {(canEnableDefaultIm || onOpenIm) && <div className="provider-model-actions">
        {canEnableDefaultIm && <Button type="primary" disabled={busy || dshLoading}
          onClick={() => void enableDefaultIm()}>启用</Button>}
        {onOpenIm && <Button disabled={legacyImDisabled} onClick={onOpenIm}>配置机器人</Button>}
      </div>}
    </> : addon ? <>
      <div className="provider-detail-head"><div>{addon.description || '组合已配置的 Skill 和 MCP。'}</div>
        {!sharedPlugin?.builtin && <Tag>{sharedPlugin ? '默认' : addon.enabled ? '已启用' : '已停用'}</Tag>}</div>
      <dl className="provider-credentials"><div><dt>版本</dt><dd>{addon.version || '—'}</dd></div></dl>
      <div className="provider-models">
        {referenceList('Skill', addon.skill_ids, addon.missing_skills, addon.inactive_skills, skills)}
        {referenceList('MCP', addon.mcp_ids, addon.missing_mcp, addon.inactive_mcp, mcp)}
      </div>
      <p className="small-note">{sharedPlugin?.builtin ? '随 Somnus 提供，可按消息选用。' :
        sharedPlugin ? '此默认插件可在当前配置中按消息选用。' : '启用后可为单条消息选用。卸载插件会保留它引用的 Skill 和 MCP。'}</p>
      <div className="provider-model-actions">
        {personal && <>
          {owner && (defaults.some(item => item.source_id === personal.id) ? <Tag>已发布</Tag> :
            <Popconfirm title="发布到此配置的默认插件？" onConfirm={() => changeDefault(personal.id, 'publish')} okText="发布" cancelText="取消">
              <Button disabled={busy}>发布为默认插件</Button>
            </Popconfirm>)}
        </>}
        {sharedPlugin && !sharedPlugin.builtin && owner && <Popconfirm title="从当前配置的默认插件中移除？" onConfirm={() => changeDefault(sharedPlugin.id, 'remove')} okText="移除" cancelText="取消">
          <Button danger disabled={busy}>移除默认插件</Button>
        </Popconfirm>}
      </div>
    </> : builtin ? <>
      <dl className="provider-credentials">
        <div><dt>版本</dt><dd>{builtin.version || '—'}</dd></div>
        <div><dt>工具</dt><dd>{builtin.tools} 个</dd></div>
      </dl>
    </> : dshPlugin ? <>
      <div className="provider-detail-head">
        <div>{dshPlugin.description}</div>
        <Tag color={dshPlugin.enabled ? 'green' : undefined}>{dshPlugin.enabled ? '已启用' : '已停用'}</Tag>
      </div>
      <dl className="provider-credentials">
        <div><dt>来源</dt><dd>{dshSource(dshPlugin)}</dd></div>
        <div><dt>版本</dt><dd>{dshPlugin.version || '—'}</dd></div>
        <div><dt>插件 ID</dt><dd>{dshPlugin.id}</dd></div>
      </dl>
      {bridge?.dshPluginSettings && <DshSettings key={dshPlugin.id} plugin={dshPlugin} />}
      {ownedPages.length > 0 ? <div className="provider-model-actions" aria-label="插件页面">
        {ownedPages.map(page => <Button key={page.id} onClick={() => setOpenOwnedPage(page)}>{page.label}</Button>)}
      </div> : nativePage === dshPlugin.id &&
        <Button onClick={() => setOpenPluginPage(dshPlugin)}>打开插件页面</Button>}
      {dshError && <Alert type="error" showIcon message={dshError} />}
    </> : null;

  function marketAvailable(market: Market) {
    return Boolean(market === 'official' ? bridge?.dshPluginMarket : bridge?.dshCommunityMarket);
  }
  const fallbackMarket: Market | undefined = marketAvailable('dsh-market') ? 'dsh-market' :
    marketAvailable('official') ? 'official' : undefined;
  const selectedMarket = preferredMarket.market && marketAvailable(preferredMarket.market) ? preferredMarket.market : fallbackMarket;
  const activeMarket = preferredMarket.enabled ? selectedMarket : undefined;

  function chooseMarket(market: Market | undefined, enabled = true) {
    setPreferredMarket({ market, enabled });
    try { window.localStorage.setItem(marketPreference, (market || '') + (enabled ? '' : ':off')); }
    catch { /* keep the in-memory preference */ }
  }

  function openMarket(market: Market | undefined = activeMarket) {
    if (!pluginsView) {
      select('');
      onOpen?.('plugin-config');
    }
    setMarketRequest(market ? { market } : undefined);
    setBrowseMarket(true);
  }

  function openInstalled(next: PluginConfigurationView) {
    setBrowseMarket(false);
    select('');
    onOpen?.(next);
  }

  function personalSwitch(plugin: InstalledPlugin, label: string) {
    return <Switch aria-label={label} checked={plugin.enabled} disabled={busy} onChange={() => void change(plugin, 'toggle')} />;
  }
  function dshSwitch(plugin: InstalledDshPlugin, label: string) {
    return bridge?.setDshInstalledPluginEnabled && <Switch aria-label={label} checked={plugin.enabled}
      disabled={busy || dshLoading || !plugin.available && !plugin.enabled} onChange={() => void changeDsh(plugin)} />;
  }
  function uninstallPersonal(plugin: InstalledPlugin, compact = false) {
    return <Popconfirm title="卸载此插件？" description="插件引用的 Skill 和 MCP 会保留。"
      onConfirm={() => change(plugin, 'remove')} okText="卸载" cancelText="取消">
      <Button danger size={compact ? 'small' : undefined} icon={compact ? undefined : <DeleteOutlined />}
        aria-label={'卸载 ' + plugin.name} disabled={busy}>卸载</Button>
    </Popconfirm>;
  }
  function uninstallDsh(plugin: InstalledDshPlugin, compact = false) {
    return bridge?.uninstallDshPlugin && <Button danger size={compact ? 'small' : undefined}
      icon={compact ? undefined : <DeleteOutlined />} aria-label={'卸载 ' + plugin.name} disabled={busy || dshLoading}
      onClick={() => void changeDsh(plugin, 'uninstall')}>卸载</Button>;
  }

  useEffect(() => {
    if (!active) return;
    if (suggestedPlugin === DSH_IM_PLUGIN) { openDefaultIm(); return; }
    if (suggestedPlugin && marketAvailable('official') && activeMarket) {
      setMarketRequest(undefined);
      setBrowseMarket(true);
    }
  }, [active, suggestedPlugin]);

  useEffect(() => {
    if (active && installedPluginRequest) setBrowseMarket(false);
  }, [active, installedPluginRequest]);

  useEffect(() => {
    if (!overviewRequest) return;
    setBrowseMarket(false);
    select('');
  }, [overviewRequest]);

  function closeAddMenuOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (!addMenuOpen || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setAddMenuOpen(false);
    addPluginTrigger.current?.focus();
  }

  return <div className={'plugin-configuration' + (browseMarket ? ' plugin-configuration-market' : '')}>
    {detailName && <section className="plugin-detail-page" id={'plugin-detail-' + selected}
      ref={isRequestedEntry ? requestedEntry : undefined} aria-labelledby="plugin-detail-heading">
      <nav className="plugin-detail-breadcrumb" aria-label="插件路径">
        <Button type="text" icon={<LeftOutlined />} aria-label="返回插件列表" onClick={() => {
          shouldRestoreFocus.current = true;
          select('');
        }}>{browseMarket ? '插件市场' : '插件'}</Button>
      </nav>
      <header className="plugin-detail-top">
        <span className="plugin-symbol plugin-symbol-personal" aria-hidden="true"><AppstoreOutlined /></span>
        <div className="plugin-detail-toolbar">
          {personal && uninstallPersonal(personal)}
          {dshPlugin && uninstallDsh(dshPlugin)}
          {personal && personalSwitch(personal, '启用 ' + detailName)}
          {dshPlugin && dshSwitch(dshPlugin, '启用 ' + detailName)}
        </div>
      </header>
      <div className="plugin-detail-title"><h2 id="plugin-detail-heading">{detailName}</h2>
        {(personal?.version || dshPlugin?.version) && <Tag>v{personal?.version || dshPlugin?.version}</Tag>}
      </div>
      <div className="plugin-detail-content">
        {personal && error && <Alert type="error" showIcon message={error} />}
        {entryDetails}
      </div>
    </section>}
    <div className="plugin-list-view" hidden={Boolean(detailName)}>
    {!browseMarket && pluginsView && <header className="plugin-page-header">
      <div className="plugin-page-heading">
        <h2>插件</h2>
        <p>管理已安装的插件、插件市场和内置插件设置。</p>
      </div>
      <div className="plugin-page-actions">
        <Button className="plugin-refresh" icon={<ReloadOutlined />} aria-label="刷新插件" title="刷新插件"
          loading={loading} disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新</Button>
        <div className="plugin-add-group">
        <Button className="plugin-add" icon={<PlusOutlined />} disabled={busy} onClick={() => {
          if (bridge?.installDshPluginSource) setSourceReference('');
          else if (activeMarket) openMarket();
          else { setMode('create'); setShowImport(true); }
        }}>添加插件</Button>
        <Dropdown trigger={['click']} autoFocus open={addMenuOpen} onOpenChange={setAddMenuOpen} disabled={busy}
          getPopupContainer={() => document.body}
          popupRender={menu => <div onKeyDown={closeAddMenuOnEscape}>{menu}</div>} menu={{ items: [
          ...(bridge?.installDshPluginSource ? [{ key: 'source', icon: <DownloadOutlined />, label: <span className="plugin-add-menu-source">
            <span>安装第三方插件</span><small>npm 包、GitHub 仓库和 Release 压缩包</small></span> }] : []),
          { key: 'market', label: '从市场安装', disabled: !activeMarket }, { key: 'create', label: '创建插件' }, { key: 'json', label: '导入 JSON' },
          ...(windowsDesktop ? [{ key: 'develop', label: '插件开发', disabled: loading }] : []),
        ], onClick: ({ key }) => {
          setAddMenuOpen(false);
          if (key === 'source') { setSourceReference(''); return; }
          if (key === 'market') { openMarket(); return; }
          if (key === 'develop') { setDevelopmentDraft(''); return; }
          setMode(key === 'json' ? 'json' : 'create');
          setShowImport(true);
        } }}>
          <Button ref={addPluginTrigger} className="plugin-add plugin-add-options" icon={<DownOutlined />} aria-label="添加插件选项"
            aria-haspopup="menu" aria-expanded={addMenuOpen} onKeyDown={closeAddMenuOnEscape} />
        </Dropdown>
        </div>
      </div>
    </header>}
    <div className="plugin-page-topbar">
      <nav className="plugin-primary-tabs" aria-label="插件视图">
        <Button type="text" aria-pressed={!browseMarket} onClick={() => setBrowseMarket(false)}>已安装</Button>
        <Button type="text" aria-pressed={browseMarket} onClick={() => { if (!browseMarket) openMarket(); }}>插件市场</Button>
      </nav>
      {!browseMarket && <nav className="plugin-installed-tabs" aria-label="已安装的扩展">
        {installedViews.map(item => <Button type="text" key={item.key} aria-current={item.key === view ? 'page' : undefined}
          onClick={() => openInstalled(item.key)}>{item.label}</Button>)}
      </nav>}
    </div>
    {developmentDraft !== undefined && <PluginDevelopment owner={owner} skills={skills} mcp={mcp}
      initialManifest={developmentDraft} onClose={() => setDevelopmentDraft(undefined)}
      onInstalled={plugin => {
        setInstalled(items => [...items.filter(item => item.id !== plugin.id), plugin]);
        setQuery('');
      }} />}
    {browseMarket && !activeMarket && <Alert type="info" message={fallbackMarket ? '插件市场已停用。' : '插件市场需要 Somnus Windows 桌面版。'}
      action={fallbackMarket && <Button size="small" onClick={() => {
        chooseMarket(selectedMarket); openMarket(selectedMarket);
      }}>启用市场</Button>} />}
    <DshPluginMarket revision={revision + marketRevision} suggestedPlugin={marketRequest ? undefined : suggestedPlugin} marketRequest={marketRequest}
      browse={Boolean(browseMarket && activeMarket)} sourcesOpen={sourcesOpen} onSourcesClose={() => setSourcesOpen(false)}
      onMarketChange={chooseMarket}
      onInstallSource={bridge?.installDshPluginSource ? setSourceReference : undefined}
      installedIds={dshInstalled.map(item => item.id)} onOpenInstalled={id => {
        if (id === DSH_IM_PLUGIN) { openDefaultIm(); return; }
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        select('dsh:' + id);
      }}
      onChanged={() => setDshRevision(value => value + 1)} />
    {!browseMarket && view === 'mcp' && <McpServers />}
    {!browseMarket && view === 'skills' && <PersonalSkills />}
    <div className="plugin-view-panel plugin-overview" hidden={browseMarket || !pluginsView}>
    <section className="plugin-section plugin-market-overview" aria-labelledby="plugin-market-overview-title">
      <div className="plugin-section-heading">
        <div><h3 id="plugin-market-overview-title">插件市场</h3>
          <p>选择一个插件市场。一次只能启用一个。</p></div>
        <div className="plugin-overview-actions">
          <Button icon={<SettingOutlined />} disabled={!bridge?.dshCommunityMarket || !bridge?.setDshCommunityMarketSources}
            onClick={() => setSourcesOpen(true)}>来源配置</Button>
          <Switch aria-label="启用插件市场" checked={Boolean(activeMarket)} disabled={!fallbackMarket}
            onChange={enabled => chooseMarket(selectedMarket, enabled)} />
        </div>
      </div>
      <div className="plugin-market-choices" role="radiogroup" aria-labelledby="plugin-market-overview-title">
        {markets.map(({ key, label, beta, description, repository }) => <label className="plugin-market-choice" key={key}>
          <input type="radio" name="somnus-plugin-market" checked={activeMarket === key} disabled={!marketAvailable(key)}
            onChange={() => chooseMarket(key)} />
          <span className="plugin-row-copy">
            <strong><a href={repository} target="_blank" rel="noreferrer noopener">{label}</a>{beta && <Tag>Beta</Tag>}</strong>
            <small>{description}{key === 'dsh-market' && <> <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"
              target="_blank" rel="noreferrer noopener">awesome-dsh-plugin</a></>}</small>
          </span>
        </label>)}
      </div>
    </section>
    <OarPluginSettings active={Boolean(active && pluginsView && !browseMarket)} revision={revision} />
    {error && <Alert type="error" showIcon message={error} />}
    <AgentExecutionSettings />
    <section className="plugin-section" aria-labelledby="plugin-defaults-title">
      <h3 id="plugin-defaults-title">内置与默认插件</h3>
      {defaultCount > 0 && <div className="plugin-row plugin-inventory-row plugin-default-group">
        <button className="plugin-row-link" type="button" aria-expanded={defaultGroupOpen} aria-controls="plugin-default-group-items"
          onClick={() => {
            if (defaultGroupOpen) select(current => current.startsWith('builtin:') || current.startsWith('default:') ? '' : current);
            setDefaultGroupOpen(!defaultGroupOpen);
          }}>
          <span className="plugin-symbol" aria-hidden="true"><ControlOutlined /></span>
          <span className="plugin-row-copy"><strong>默认</strong><small>{defaultCount} 个插件</small></span>
          <DownOutlined className="plugin-row-arrow" aria-hidden="true" />
        </button>
        <div id="plugin-default-group-items" className="plugin-rows plugin-inventory-details plugin-default-group-items" hidden={!defaultGroupOpen}>
          {defaultGroupOpen && <>
            {builtins.map(item => entry('builtin:' + item.key, item.key === 'respiratory' && item.name === '默认' ? '数据查询与分析' : item.name,
              `${item.tools} 个工具`))}
            {showDefaultIm && entry(defaultImEntry, 'IM 机器人', '默认插件')}
            {visibleDefaults.map(item => entry('default:' + item.id, item.name, item.description || '此配置默认'))}
          </>}
        </div>
      </div>}
      {!loading && !defaultCount && <p className="plugin-empty">暂无内置或默认插件</p>}
    </section>
    <section className="plugin-section" aria-labelledby="plugin-personal-title">
      <div className="plugin-section-heading"><h3 id="plugin-personal-title">已安装的个人插件</h3>
        {hasPersonal && <Input allowClear prefix={<SearchOutlined />} placeholder="搜索个人插件" aria-label="搜索个人插件"
          value={query} onChange={event => setQuery(event.target.value)} />}
      </div>
      {dshError && <Alert type="error" showIcon message={dshError} />}
      {(loading || dshLoading) && !hasPersonal && <Spin size="small" />}
      {Boolean(imported.length || visibleDsh.length) && <div className="plugin-rows">
        {imported.map(item => entry('personal:' + item.id, item.name, item.description || 'Skill 与 MCP', true,
          <Tag color={item.enabled ? 'green' : undefined}>{item.enabled ? '已启用' : '已停用'}</Tag>,
          <>{uninstallPersonal(item, true)}{personalSwitch(item, '启用 ' + item.name)}</>))}
        {visibleDsh.map(item => entry('dsh:' + item.id, item.name, dshSource(item), true,
          <Tag color={item.enabled ? 'green' : undefined}>{item.enabled ? '已启用' : '已停用'}</Tag>,
          <>{uninstallDsh(item, true)}{dshSwitch(item, '启用 ' + item.name)}</>))}
      </div>}
      {!loading && !dshLoading && !imported.length && !visibleDsh.length && (!dshError || hasPersonal) &&
        <p className="plugin-empty">{term && hasPersonal ? '没有匹配的个人插件' : '暂无个人插件'}</p>}
    </section>
    </div>
    </div>
    {active && openPluginPage && <DshPluginPage key={openPluginPage.id} plugin={openPluginPage} onClose={() => setOpenPluginPage(undefined)} />}
    {active && openOwnedPage && <OwnedDshPluginPage key={openOwnedPage.id} page={openOwnedPage} onClose={() => setOpenOwnedPage(undefined)} />}
    {sourceReference !== undefined && bridge?.installDshPluginSource && <PluginSourceInstaller install={bridge.installDshPluginSource}
      initialReference={sourceReference}
      onInstalled={() => {
        setDshRevision(value => value + 1);
        setMarketRevision(value => value + 1);
      }} onEnable={bridge.setDshInstalledPluginEnabled ? async id => {
        const result = await bridge.setDshInstalledPluginEnabled!(id, 'community', true);
        if (!result.plugins.some(plugin => plugin.id === id && plugin.source === 'community' && plugin.enabled)) {
          throw new Error('桌面版没有确认插件已启用。');
        }
        setDshInstalled(uniqueDshPlugins(result.plugins));
        setMarketRevision(value => value + 1);
      } : undefined} onClose={() => setSourceReference(undefined)} />}
    <Modal title={mode === 'create' ? '创建插件' : '导入插件'} open={showImport} onCancel={() => { if (!busy) closeImport(); }} onOk={() => void install()}
      okText={mode === 'create' ? '创建' : '导入'} cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: !canSubmit }}>
      <div className="provider-editor">
        <Segmented<'create' | 'json'> aria-label="添加插件方式" value={mode} disabled={busy}
          options={[{ label: '创建插件', value: 'create' }, { label: '导入 JSON', value: 'json' }]}
          onChange={value => { setMode(value); setImportError(''); }} />
        {mode === 'create' ? <>
          <label>插件名称<Input value={name} onChange={event => setName(event.target.value)} /></label>
          <label>说明（可选）<Input value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label>Skill<Select mode="multiple" aria-label="选择 Skill" value={skillIds} onChange={setSkillIds}
            options={skills.map(item => ({ value: item.id, label: item.name }))} optionFilterProp="label" notFoundContent="暂无可引用的 Skill" /></label>
          <label>MCP<Select mode="multiple" aria-label="选择 MCP" value={mcpIds} onChange={setMcpIds}
            options={mcp.map(item => ({ value: item.id, label: item.name }))} optionFilterProp="label" notFoundContent="暂无可引用的 MCP" /></label>
          <p className="small-note">至少选择一个 Skill 或 MCP。创建后默认停用。</p>
        </> : <>
        <p>选择或粘贴插件 JSON。可引用本机已配置的 Skill 和 MCP，导入后默认停用。</p>
        <input type="file" ref={input} hidden accept="application/json,.json" onChange={event => {
          void loadFile(event.target.files?.[0]); event.target.value = '';
        }} />
        <Button onClick={() => input.current?.click()}>选择 JSON 文件</Button>
        <Input.TextArea value={manifest} aria-label="插件 JSON" placeholder='{"name":"我的插件","skill_ids":["Skill ID"],"mcp_ids":["MCP ID"]}'
          autoSize={{ minRows: 5, maxRows: 12 }} onChange={event => setManifest(event.target.value)} />
        <details><summary>查看可引用的 ID</summary>
          {referenceList('Skill', skills.map(item => item.id), [], [], skills.map(item => ({ ...item, name: item.name + ' · ' + item.id })))}
          {referenceList('MCP', mcp.map(item => item.id), [], [], mcp.map(item => ({ ...item, name: item.name + ' · ' + item.id })))}
        </details></>}
        {importError && <Alert type="error" showIcon message={importError} />}
      </div>
    </Modal>
  </div>;
}
