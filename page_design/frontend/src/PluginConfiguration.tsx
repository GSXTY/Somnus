import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Dropdown, Input, Modal, Popconfirm, Segmented, Select, Spin, Tag } from 'antd';
import { AppstoreOutlined, ControlOutlined, DownOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { dotTaskSetup, importPlugin, isPortablePluginPackage, listDefaultPlugins, listInstalledPlugins, listSkills, publishDefaultPlugin, removeDefaultPlugin, removePlugin, setDotTaskEnabled, setPluginEnabled } from './assistantApi';
import type { DefaultPlugin, InstalledPlugin, PluginManifest } from './assistantApi';
import { describeError } from './errors.mjs';
import { DshPluginMarket } from './DshPluginMarket';
import { DotConnectionGuide } from './DotConnectionGuide';
import { PluginDevelopment } from './PluginDevelopment';
import type { InstalledDshPlugin } from './DshPluginMarket';
import './models.css';
import './plugin-management.css';

type BundledPlugin = { key: string; name: string; version?: string; tools: number };
type Reference = { id: string; name: string };

function uniqueDshPlugins(plugins: InstalledDshPlugin[]) {
  const byId = new Map<string, InstalledDshPlugin>();
  for (const plugin of plugins) {
    const previous = byId.get(plugin.id);
    if (!previous || (previous.source === 'community' && plugin.source === 'official')) byId.set(plugin.id, plugin);
  }
  return [...byId.values()];
}

function dshSource(plugin: InstalledDshPlugin) {
  return plugin.source === 'official' ? 'DSH 官方市场' : 'DSH 社区市场';
}

export function PluginConfiguration({ suggestedPlugin, windowsDesktop }: { suggestedPlugin?: string; windowsDesktop?: boolean }) {
  const bridge = window.vvmanAcp;
  const [revision, setRevision] = useState(0);
  const [marketRevision, setMarketRevision] = useState(0);
  const [dshRevision, setDshRevision] = useState(0);
  const [dshInstalled, setDshInstalled] = useState<InstalledDshPlugin[]>([]);
  const [dshLoading, setDshLoading] = useState(Boolean(bridge?.dshInstalledPlugins || bridge?.dshPluginMarket));
  const [dshError, setDshError] = useState('');
  const [builtins, setBuiltins] = useState<BundledPlugin[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [defaults, setDefaults] = useState<DefaultPlugin[]>([]);
  const [owner, setOwner] = useState(false);
  const [skills, setSkills] = useState<Reference[]>([]);
  const [mcp, setMcp] = useState<Reference[]>([]);
  const [selected, select] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [developmentDraft, setDevelopmentDraft] = useState<string>();
  const [showDotGuide, setShowDotGuide] = useState(false);
  const [dotInstalled, setDotInstalled] = useState<{ ready: boolean; paused: boolean }>();
  const [dotChanging, setDotChanging] = useState(false);
  const [dotError, setDotError] = useState('');
  const dotOperation = useRef(0);
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
    void readRegistry('/api/plugins').then(data => setBuiltins((data.plugins || []).map((item: BundledPlugin) => item.key === 'respiratory' ? { ...item, name: '默认' } : item))).catch(() => {});
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
    if (!windowsDesktop || showDotGuide || dotChanging) return;
    const controller = new AbortController();
    const operation = dotOperation.current;
    void dotTaskSetup(controller.signal).then(setup => {
      if (controller.signal.aborted || operation !== dotOperation.current) return;
      if (setup.mode === 'hosted' && setup.error) {
        setDotInstalled(previous => previous && { ...previous, ready: false });
        return;
      }
      const configured = setup.mode === 'hosted' ? setup.paired : setup.port !== null && setup.secret_path !== null;
      setDotInstalled(configured ? { ready: setup.enabled && setup.ready, paused: setup.paused } : undefined);
    }).catch(() => {
      if (!controller.signal.aborted && operation === dotOperation.current) {
        setDotInstalled(previous => previous && { ...previous, ready: false });
      }
    });
    return () => controller.abort();
  }, [windowsDesktop, revision, showDotGuide, dotChanging]);

  useEffect(() => {
    if (!bridge?.dshInstalledPlugins && !bridge?.dshPluginMarket) return;
    let active = true;
    setDshLoading(true);
    setDshError('');
    async function load() {
      if (bridge?.dshInstalledPlugins) return (await bridge.dshInstalledPlugins()).plugins;
      const market = await bridge?.dshPluginMarket?.();
      return (market?.plugins || []).filter(item => item.installed)
        .map(item => ({ ...item, source: 'official' as const, available: item.available !== false, enabled: true }));
    }
    void load().then(items => { if (active) setDshInstalled(uniqueDshPlugins(items)); })
      .catch(failure => { if (active) setDshError(describeError(failure, '无法读取已安装的 DSH 插件')); })
      .finally(() => { if (active) setDshLoading(false); });
    return () => { active = false; };
  }, [bridge, revision, dshRevision]);

  const term = query.trim().toLowerCase();
  const imported = installed.filter(item => item.name.toLowerCase().includes(term));
  const visibleDsh = dshInstalled.filter(item =>
    [item.name, item.id, item.description, dshSource(item)].some(value => value.toLowerCase().includes(term)));
  const personalDot = windowsDesktop ? dotInstalled : undefined;
  const dotDetail = selected === 'dot:personal' ? personalDot : undefined;
  const dotLabel = personalDot?.paused ? '已停用' : personalDot?.ready ? '已连接' : '待连接';
  const visibleDot = personalDot && 'somnus dot 个人连接'.includes(term);
  const hasPersonal = Boolean(installed.length || dshInstalled.length || personalDot);
  const personal = installed.find(item => 'personal:' + item.id === selected);
  const dshPlugin = dshInstalled.find(item => 'dsh:' + item.id === selected);
  const sharedPlugin = defaults.find(item => 'default:' + item.id === selected);
  const addon = personal || sharedPlugin;
  const builtin = builtins.find(item => 'builtin:' + item.key === selected);

  async function changeDotEnabled(enabled: boolean) {
    if (dotChanging) return;
    dotOperation.current++;
    setDotChanging(true);
    setDotError('');
    try {
      const setup = await setDotTaskEnabled(enabled);
      setDotInstalled({ ready: setup.enabled && setup.ready, paused: setup.paused });
    } catch (failure) {
      setDotError(describeError(failure, enabled ? '无法启用 dot' : '无法停用 dot'));
    } finally {
      setDotChanging(false);
    }
  }

  async function changeDefault(id: string, operation: 'publish' | 'remove') {
    if (!owner || busy) return;
    setBusy(true);
    setError('');
    try {
      if (operation === 'publish') {
        const plugin = await publishDefaultPlugin(id);
        setDefaults(items => [...items.filter(item => item.id !== plugin.id), plugin]);
        select('default:' + plugin.id);
      } else {
        await removeDefaultPlugin(id);
        setDefaults(items => items.filter(item => item.id !== id));
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
      } else {
        const updated = await setPluginEnabled(plugin.id, !plugin.enabled);
        setInstalled(items => items.map(item => item.id === updated.id ? updated : item));
      }
    } catch (failure) { setError(describeError(failure, '无法更新插件')); }
    finally { setBusy(false); }
  }
  async function changeDsh(plugin: InstalledDshPlugin) {
    if (busy || !bridge?.setDshInstalledPluginEnabled) return;
    setBusy(true);
    setDshError('');
    try {
      const result = await bridge.setDshInstalledPluginEnabled(plugin.id, plugin.source, !plugin.enabled);
      setDshInstalled(uniqueDshPlugins(result.plugins));
      setDshRevision(value => value + 1);
      setMarketRevision(value => value + 1);
    } catch (failure) { setDshError(describeError(failure, '无法更新 DSH 插件')); }
    finally { setBusy(false); }
  }
  function referenceList(title: string, ids: string[], missing: string[], inactive: string[], references: Reference[]) {
    return <div className="provider-model-row"><strong>{title}</strong>{ids.length ? <ul>
      {ids.map(id => <li key={id}>{references.find(item => item.id === id)?.name || id}
        {missing.includes(id) ? <Tag color="error">已移除</Tag> : inactive.includes(id) ? <Tag>已停用</Tag> : <Tag color="green">可用</Tag>}
      </li>)}</ul> : <span>无</span>}</div>;
  }
  function entry(id: string, name: string, detail: string, personal = false, status?: ReactNode) {
    return <div key={id} className="plugin-row">
      <button className="plugin-row-link" type="button" onClick={() => select(id)}>
        <span className={'plugin-symbol' + (personal ? ' plugin-symbol-personal' : '')} aria-hidden="true">
          {personal ? <AppstoreOutlined /> : <ControlOutlined />}
        </span>
        <span className="plugin-row-copy"><strong>{name}</strong><small>{detail}</small></span>
        {status && <span className="plugin-row-status">{status}</span>}
        <RightOutlined className="plugin-row-arrow" aria-hidden="true" />
      </button>
    </div>;
  }

  return <div className="plugin-configuration">
    <header className="plugin-page-header">
      <div><h2>插件</h2><p>添加、启用和管理 Somnus 的插件。</p></div>
      <div className="plugin-page-actions">
        <Button type="text" className="plugin-refresh" icon={<ReloadOutlined />} aria-label="刷新插件" title="刷新插件"
          loading={loading} disabled={busy} onClick={() => setRevision(value => value + 1)} />
        {windowsDesktop && <Button onClick={() => setDevelopmentDraft('')} disabled={loading || busy}>插件开发</Button>}
        <Dropdown trigger={['click']} disabled={loading || busy} menu={{ items: [
          { key: 'create', label: '创建插件' }, { key: 'json', label: '导入 JSON' },
        ], onClick: ({ key }) => { setMode(key === 'json' ? 'json' : 'create'); setShowImport(true); } }}>
          <Button className="plugin-add" icon={<PlusOutlined />}>添加插件 <DownOutlined aria-hidden="true" /></Button>
        </Dropdown>
      </div>
    </header>
    {developmentDraft !== undefined && <PluginDevelopment owner={owner} skills={skills} mcp={mcp}
      initialManifest={developmentDraft} onClose={() => setDevelopmentDraft(undefined)}
      onInstalled={plugin => {
        setInstalled(items => [...items.filter(item => item.id !== plugin.id), plugin]);
        setQuery('');
      }} />}
    <DshPluginMarket revision={revision + marketRevision} suggestedPlugin={suggestedPlugin}
      onChanged={() => setDshRevision(value => value + 1)} />
    {error && <Alert type="error" showIcon message={error} />}
    {windowsDesktop && <section className="plugin-section" aria-labelledby="plugin-recommendations-title">
      <h3 id="plugin-recommendations-title">作者推荐</h3>
      <article className="plugin-recommendation">
        <span className="plugin-symbol" aria-hidden="true"><LinkOutlined /></span>
        <div className="plugin-row-copy">
          <strong>Somnus × dot</strong>
          <small>把会话输入框中的文字交给 dot，结果会返回同一会话。</small>
        </div>
        <Button onClick={() => setShowDotGuide(true)}>查看个人接入教程</Button>
      </article>
      {showDotGuide && <DotConnectionGuide onClose={() => setShowDotGuide(false)} />}
    </section>}
    <section className="plugin-section" aria-labelledby="plugin-defaults-title">
      <h3 id="plugin-defaults-title">内置与默认插件</h3>
      <div className="plugin-rows">
        {builtins.map(item => entry('builtin:' + item.key, item.name, `内置 · ${item.tools} 个工具`))}
        {defaults.map(item => entry('default:' + item.id, item.name, item.description || '此配置默认'))}
      </div>
      {!loading && !builtins.length && !defaults.length && <p className="plugin-empty">暂无内置或默认插件</p>}
    </section>
    <section className="plugin-section" aria-labelledby="plugin-personal-title">
      <div className="plugin-section-heading"><h3 id="plugin-personal-title">已安装的个人插件</h3>
        {hasPersonal && <Input allowClear prefix={<SearchOutlined />} placeholder="搜索个人插件" aria-label="搜索个人插件"
          value={query} onChange={event => setQuery(event.target.value)} />}
      </div>
      {dshError && <Alert type="error" showIcon message={dshError} />}
      {(loading || dshLoading) && !hasPersonal && <Spin size="small" />}
      {Boolean(imported.length || visibleDsh.length || visibleDot) && <div className="plugin-rows">
        {visibleDot && entry('dot:personal', 'Somnus × dot', '个人连接', true,
          <Tag color={personalDot.ready ? 'green' : undefined}>{dotLabel}</Tag>)}
        {imported.map(item => entry('personal:' + item.id, item.name, item.description || 'Skill 与 MCP', true,
          <Tag color={item.enabled ? 'green' : undefined}>{item.enabled ? '已启用' : '已停用'}</Tag>))}
        {visibleDsh.map(item => entry('dsh:' + item.id, item.name, dshSource(item), true,
          <Tag color={item.enabled ? 'green' : undefined}>{item.enabled ? '已启用' : '已停用'}</Tag>))}
      </div>}
      {!loading && !dshLoading && !imported.length && !visibleDsh.length && !visibleDot && (!dshError || hasPersonal) &&
        <p className="plugin-empty">{term && hasPersonal ? '没有匹配的个人插件' : '暂无个人插件'}</p>}
    </section>
    <Modal title={dotDetail ? 'Somnus × dot' : addon?.name || builtin?.name || dshPlugin?.name}
      open={Boolean(dotDetail || addon || builtin || dshPlugin)} onCancel={() => select('')}
      footer={<Button onClick={() => select('')}>关闭</Button>}>
        {dotDetail ? <>
          <div className="provider-detail-head">
            <div>将消息交给 dot，结果会回到发起任务的会话。</div>
            <Tag color={dotDetail.ready ? 'green' : undefined}>{dotLabel}</Tag>
          </div>
          <div className="provider-model-actions">
            <Button disabled={dotChanging} onClick={() => { select(''); setShowDotGuide(true); }}>
              {dotDetail.ready || dotDetail.paused ? '管理连接' : '重新连接'}
            </Button>
            <Button loading={dotChanging} onClick={() => void changeDotEnabled(dotDetail.paused)}>
              {dotDetail.paused ? '启用' : '停用'}
            </Button>
          </div>
          {dotError && <Alert type="error" showIcon message={dotError} />}
        </> : addon ? <>
          <div className="provider-detail-head"><div>{addon.description || '组合已配置的 Skill 和 MCP。'}</div>
            <Tag>{sharedPlugin ? '默认' : addon.enabled ? '已启用' : '已停用'}</Tag></div>
          <dl className="provider-credentials"><div><dt>版本</dt><dd>{addon.version || '—'}</dd></div></dl>
          <div className="provider-models">
            {referenceList('Skill', addon.skill_ids, addon.missing_skills, addon.inactive_skills, skills)}
            {referenceList('MCP', addon.mcp_ids, addon.missing_mcp, addon.inactive_mcp, mcp)}
          </div>
          <p className="small-note">{sharedPlugin ? '此默认插件可在当前配置中按消息选用。' : '启用后可为单条消息选用。移除插件会保留它引用的 Skill 和 MCP。'}</p>
          <div className="provider-model-actions">
            {personal && <>
              <Button disabled={busy} onClick={() => void change(personal, 'toggle')}>{personal.enabled ? '停用' : '启用'}</Button>
              <Popconfirm title="移除此插件？" onConfirm={() => change(personal, 'remove')} okText="移除" cancelText="取消"><Button danger disabled={busy}>移除</Button></Popconfirm>
              {owner && (defaults.some(item => item.source_id === personal.id) ? <Tag>已发布</Tag> :
                <Popconfirm title="发布到此配置的默认插件？" onConfirm={() => changeDefault(personal.id, 'publish')} okText="发布" cancelText="取消">
                  <Button disabled={busy}>发布为默认插件</Button>
                </Popconfirm>)}
            </>}
            {sharedPlugin && owner && <Popconfirm title="从当前配置的默认插件中移除？" onConfirm={() => changeDefault(sharedPlugin.id, 'remove')} okText="移除" cancelText="取消">
              <Button danger disabled={busy}>移除默认插件</Button>
            </Popconfirm>}
          </div>
        </> : builtin ? <>
          <Tag>内置</Tag>
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
          {bridge?.setDshInstalledPluginEnabled && <div className="provider-model-actions">
            {dshPlugin.enabled ?
              <Popconfirm title="停用此 DSH 插件？" onConfirm={() => changeDsh(dshPlugin)} okText="停用" cancelText="取消">
                <Button disabled={busy || dshLoading}>停用</Button>
              </Popconfirm> :
              <Button disabled={busy || dshLoading || !dshPlugin.available}
                onClick={() => void changeDsh(dshPlugin)}>启用</Button>}
          </div>}
          {dshError && <Alert type="error" showIcon message={dshError} />}
        </> : null}
        {error && <Alert type="error" showIcon message={error} />}
    </Modal>
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
