import { mainChatBridge } from './assistantAcp';
import type { ExternalAgent, ExternalModel, ExternalReasoning, ExternalSelection } from './assistantAcp';
import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Input, Popover, Tag } from 'antd';
import { ApiOutlined, BankOutlined, BulbOutlined, CheckOutlined, CodeOutlined, DownOutlined, RobotOutlined, SearchOutlined, SettingOutlined, StarFilled, StarOutlined, ThunderboltOutlined, UpOutlined } from '@ant-design/icons';
import { listProviders } from './assistantApi';
import type { Provider, ReasoningEffort } from './assistantApi';
import './model-picker.css';

const favoriteKey = 'vvman.model-favorites';
const effortNames: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高' };
const localKey = (id: string) => 'agent:' + id;
const localFavoritePrefix = (id: string) => 'external:' + encodeURIComponent(id) + ':';
const localFavoriteKey = (id: string, modelId: string) => localFavoritePrefix(id) + modelId;
const providerLabel = (provider: Provider) => provider.builtin ? '公司默认' : provider.name;
function agentIcon(agent: ExternalAgent) {
  const name = agent.name.toLocaleLowerCase();
  if (name.includes('codex')) return <CodeOutlined />;
  if (name.includes('deepseek') || name.includes('dsh')) return <ThunderboltOutlined className="model-picker-dsh-icon" />;
  return <RobotOutlined />;
}

export function ModelSwitch({ modelId, effort, onChange, onConfig, disabled, external, onExternal, agentReasoning }: {
  modelId?: string; effort?: ReasoningEffort;
  onChange: (id?: string, effort?: ReasoningEffort) => void; onConfig: () => void; disabled: boolean;
  external?: ExternalSelection; onExternal: (selection?: ExternalSelection) => void;
  agentReasoning?: { settings?: ExternalReasoning; value?: string; onChange: (value: string) => void };
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('company');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const bridge = mainChatBridge();
  const [agents, setAgents] = useState<ExternalAgent[]>([]);
  const [catalogs, setCatalogs] = useState<Record<string, { models: ExternalModel[]; error?: string }>>({});
  const [discovering, setDiscovering] = useState<string>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [active, setActive] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(favoriteKey) || '[]');
      return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
    } catch { return []; }
  });

  useEffect(() => {
    if (!bridge || !open) return;
    let alive = true;
    void bridge.list().then(items => {
      if (!alive) return;
      setAgents(items);
      const selected = items.find(agent => agent.id === external?.agentId);
      if (selected && !catalogs[selected.id]) void discover(selected);
    })
      .catch(() => { if (alive) setAgents([]); });
    return () => { alive = false; };
  }, [bridge, open]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listProviders(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setProviders(result.providers);
      setActive(result.active);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '无法读取模型');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);

  async function discover(agent: ExternalAgent) {
    if (!bridge || discovering) return;
    setDiscovering(agent.id);
    try {
      const result = await bridge.discoverModels(agent.id);
      setCatalogs(current => ({ ...current, [agent.id]: { models: result.models.length ? result.models : [{ id: '', name: 'Agent 默认模型' }] } }));
    } catch (error) {
      setCatalogs(current => ({ ...current, [agent.id]: { models: [], error: error instanceof Error ? error.message : '无法读取 Agent 模型' } }));
    } finally { setDiscovering(undefined); }
  }

  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
    setFavorites(next);
    try { localStorage.setItem(favoriteKey, JSON.stringify(next)); } catch { /* optional preference */ }
  }

  const current = providers.find(provider => provider.id === (modelId || active));
  const term = query.trim().toLocaleLowerCase();
  const matches = (...values: string[]) => values.join(' ').toLocaleLowerCase().includes(term);
  const company = providers.filter(provider => provider.builtin);
  const personal = providers.filter(provider => !provider.builtin);
  const selectedAgent = agents.find(agent => localKey(agent.id) === tab);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function modelRow(id: string, name: string, selected: boolean, unavailable: boolean, icon: React.ReactNode, select: () => void) {
    const favorite = favorites.includes(id);
    return <div className="model-picker-row" data-selected={selected} data-favorite={favorite} key={id}>
      <button type="button" disabled={disabled || unavailable} aria-pressed={selected} onClick={select}>
        <span className="model-picker-model-icon" aria-hidden="true">{icon}</span><span className="model-picker-model-name" title={name}>{name}</span>
        {unavailable ? <Tag>未配置</Tag> : selected && <CheckOutlined aria-hidden="true" />}
      </button>
      <Button type="text" size="small" onClick={() => toggleFavorite(id)}
        aria-label={favorite ? '取消收藏 ' + name : '收藏 ' + name} icon={favorite ? <StarFilled /> : <StarOutlined />} />
    </div>;
  }
  function providerRow(provider: Provider) {
    return modelRow(provider.id, provider.model || provider.name, !external && provider.id === current?.id,
      provider.configured === false, provider.builtin ? <BankOutlined /> : <ApiOutlined />, () => {
        onExternal();
        onChange(provider.id, provider.id === current?.id ? effort : undefined);
        close();
      });
  }
  function externalRow(agent: ExternalAgent, model: ExternalModel) {
    return modelRow(localFavoriteKey(agent.id, model.id), model.name, external?.agentId === agent.id && external.modelId === (model.id || undefined),
      false, agentIcon(agent), () => {
        onExternal({ agentId: agent.id, agentName: agent.name, modelId: model.id || undefined, modelName: model.name });
        close();
      });
  }
  function group(key: string, label: string, count: number, icon: React.ReactNode, rows: React.ReactNode) {
    return <section className="model-picker-group" key={key}>
      <button className="model-picker-group-heading" type="button" aria-expanded={!collapsed[key]}
        onClick={() => setCollapsed(previous => ({ ...previous, [key]: !previous[key] }))}>
        <span className="model-picker-group-icon" aria-hidden="true">{icon}</span><strong title={label}>{label}</strong>
        <span className="model-picker-model-count">{count} 个模型</span>
        {collapsed[key] ? <DownOutlined aria-hidden="true" /> : <UpOutlined aria-hidden="true" />}
      </button>
      {!collapsed[key] && rows}
    </section>;
  }
  function agentModels(agent: ExternalAgent) {
    const catalog = catalogs[agent.id];
    const models = (catalog?.models || []).filter(model => matches(agent.name, model.name, model.id));
    if (!catalog || catalog.error) return <section className="model-picker-agent-load" key={agent.id}>
      <strong>{agentIcon(agent)} {agent.name}</strong>
      <Button size="small" type="text" loading={discovering === agent.id} disabled={Boolean(discovering)}
        onClick={() => void discover(agent)}>{catalog?.error ? '重新读取' : '查看模型'}</Button>
      {catalog?.error && <p role="alert">{catalog.error}</p>}
    </section>;
    return models.length ? group(localKey(agent.id), agent.name + ' · 本地 Agent', models.length, agentIcon(agent),
      models.map(model => externalRow(agent, model))) : null;
  }
  function companyModels() {
    const filtered = company.filter(provider => matches(providerLabel(provider), provider.name, provider.model));
    return filtered.length ? group('company', '公司默认', filtered.length, <BankOutlined />, filtered.map(providerRow)) : null;
  }
  function personalModels() {
    const groups = new Map<string, Provider[]>();
    for (const provider of personal.filter(provider => matches(provider.name, provider.model, '个人供应商'))) {
      const key = provider.group_id || JSON.stringify([provider.name, provider.base_url]);
      const rows = groups.get(key);
      if (rows) rows.push(provider);
      else groups.set(key, [provider]);
    }
    return [...groups].map(([key, rows]) => group(key, rows[0].name, rows.length, <ApiOutlined />, rows.map(providerRow)));
  }
  function favoriteModels() {
    const models = providers.filter(provider => favorites.includes(provider.id) && matches(providerLabel(provider), provider.name, provider.model));
    const local = agents.flatMap(agent => {
      const catalog = catalogs[agent.id]?.models || [];
      return favorites.flatMap(id => catalog.filter(model => localFavoriteKey(agent.id, model.id) === id && matches(agent.name, model.name))
        .map(model => externalRow(agent, model)));
    });
    const unknown = agents.filter(agent => !catalogs[agent.id]?.models.length &&
      favorites.some(value => value.startsWith(localFavoritePrefix(agent.id))) && matches(agent.name));
    return <>{models.map(providerRow)}{local}{unknown.map(agentModels)}
      {!models.length && !local.length && !unknown.length && <p>{term ? '没有匹配的收藏' : '暂无收藏模型'}</p>}</>;
  }

  const tabs = [
    { id: 'favorites', label: '收藏', icon: <StarOutlined /> },
    { id: 'company', label: '公司默认', icon: <BankOutlined /> },
    ...(personal.length ? [{ id: 'personal', label: '个人供应商', icon: <ApiOutlined /> }] : []),
    ...agents.map(agent => ({ id: localKey(agent.id), label: agent.name + ' · 本地 Agent', icon: agentIcon(agent) })),
  ];
  const personalGroups = personalModels();
  const models = tab === 'favorites' ? favoriteModels() :
    tab === 'personal' ? personalGroups.length ? personalGroups : <p>没有匹配的模型</p> :
      selectedAgent ? agentModels(selectedAgent) || <p>没有匹配的模型</p> :
        companyModels() || (!loading && !error && <p>{term ? '没有匹配的模型' : '暂无公司默认模型'}</p>);

  const content = <section className="model-picker-popover" role="dialog" aria-label="选择模型"
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }}>
    <div className="model-picker-tabs" aria-label="模型来源">
      {tabs.map(item => <button key={item.id} type="button" aria-pressed={item.id === tab} aria-label={item.label} title={item.label}
        onClick={() => {
          setQuery('');
          setTab(item.id);
          const agent = agents.find(candidate => localKey(candidate.id) === item.id);
          if (agent && !catalogs[agent.id]) void discover(agent);
        }}>{item.icon}</button>)}
    </div>
    <div className="model-picker-search"><Input autoFocus allowClear prefix={<SearchOutlined />} placeholder="搜索模型供应商与模型"
      aria-label="搜索模型供应商与模型" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="model-picker-list">
      {loading && !selectedAgent && !providers.length && <p>正在读取模型…</p>}
      {!loading && error && !selectedAgent && <p role="alert">{error}</p>}
      {models}
    </div>
    <footer className="model-picker-footer">
      <Button type="text" icon={<SettingOutlined />} onClick={() => { setOpen(false); onConfig(); }}>配置 Agent</Button>
    </footer>
  </section>;

  const options = agentReasoning ? agentReasoning.settings?.options || [] :
    current?.reasoning_efforts?.length ? [
      { id: '', name: '默认' },
      ...current.reasoning_efforts.map(id => ({ id, name: effortNames[id] })),
    ] : [];
  const selectedEffort = agentReasoning ? agentReasoning.value ?? agentReasoning.settings?.value : effort ?? '';
  const selectedOption = options.find(option => option.id === selectedEffort);

  return <><Popover placement="topLeft" trigger="click" open={open} content={content}
    onOpenChange={next => {
      if (next) {
        setQuery('');
        setTab(external ? localKey(external.agentId) : current && !current.builtin ? 'personal' : 'company');
      }
      setOpen(next);
    }} destroyOnHidden classNames={{ root: 'model-picker-overlay' }} arrow={false} autoAdjustOverflow>
    <Button ref={trigger} type="text" size="small" className="model-picker-trigger" disabled={disabled}
      aria-label="选择模型" aria-haspopup="dialog" aria-expanded={open}
      onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
      <span>{external ? external.modelName || external.agentName : current?.model || '选择模型'}</span><DownOutlined aria-hidden="true" />
    </Button>
  </Popover>{options.length > 0 && <Dropdown trigger={['click']} placement="topLeft" disabled={disabled}
    menu={{
      items: options.map((option, index) => ({ key: String(index), label: option.name,
        title: 'description' in option && typeof option.description === 'string' ? option.description : undefined })),
      selectedKeys: selectedOption ? [String(options.indexOf(selectedOption))] : [],
      onClick: ({ key }) => {
        const option = options[Number(key)];
        if (!option) return;
        if (agentReasoning) agentReasoning.onChange(option.id);
        else if (current) onChange(current.id, current.reasoning_efforts?.find(value => value === option.id));
      },
    }}>
    <Button type="text" size="small" className="assistant-reasoning-trigger" icon={<BulbOutlined />} disabled={disabled}
      aria-label={'推理强度 · ' + (selectedOption?.name || '自动')} title="推理强度">
      {selectedOption?.name || '自动'} <DownOutlined aria-hidden="true" />
    </Button>
  </Dropdown>}</>;
}
