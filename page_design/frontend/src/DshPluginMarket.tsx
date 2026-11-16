import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Spin, Tag } from 'antd';
import { AppstoreOutlined, DownOutlined, GlobalOutlined, SearchOutlined } from '@ant-design/icons';
import { describeError } from './errors.mjs';

type MarketPlugin = {
  id: string;
  name: string;
  description: string;
  version: string;
  sourceUrl: string;
  author?: string;
  installed: boolean;
  present?: boolean;
  available?: boolean;
  installedVersion?: string;
  compatibility?: 'agent' | 'dsh-web' | 'unverified';
  reason?: string;
};
export type DshMarket = { runtime: { installed: boolean; version: string | null }; plugins: MarketPlugin[] };
export type DshCommunityMarket = DshMarket & { name: string; sourceUrl: string; total?: number };
type Market = 'official' | 'community';
export type InstalledDshPlugin = {
  id: string;
  name: string;
  description: string;
  version: string;
  source: Market;
  enabled: boolean;
  available: boolean;
  compatibility?: MarketPlugin['compatibility'];
};
export type InstalledDshPlugins = { plugins: InstalledDshPlugin[] };

export function DshPluginMarket({ revision, suggestedPlugin, onChanged }: {
  revision: number;
  suggestedPlugin?: string;
  onChanged: () => void;
}) {
  const bridge = window.vvmanAcp;
  const [official, setOfficial] = useState<DshMarket>();
  const [community, setCommunity] = useState<DshCommunityMarket>();
  const [market, setMarket] = useState<Market | undefined>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const catalogGeneration = useRef(0);
  const previousRevision = useRef(revision);
  const search = query.trim().toLowerCase();
  const communitySearch = market === 'community' ? search : '';
  const communityLoader = bridge?.dshCommunityMarket;

  useEffect(() => {
    if (!suggestedPlugin) return;
    setMarket('official');
    setQuery(suggestedPlugin);
  }, [suggestedPlugin]);

  useEffect(() => {
    const load = market === 'community' ? communityLoader && (() => {
      const refresh = previousRevision.current !== revision;
      previousRevision.current = revision;
      return communityLoader(communitySearch, refresh);
    }) : bridge?.dshPluginMarket;
    if (!load) return;
    let active = true;
    const generation = catalogGeneration.current;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void load().then(result => {
        if (!active || catalogGeneration.current !== generation) return;
        if ('sourceUrl' in result) setCommunity(result as DshCommunityMarket);
        else setOfficial(result);
      }).catch(failure => {
        if (active && catalogGeneration.current === generation) setError(describeError(failure, '无法读取 DSH 插件市场'));
      }).finally(() => { if (active) setLoading(false); });
    }, market === 'community' && communitySearch ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [bridge, communityLoader, revision, market, communitySearch]);

  async function change(item: MarketPlugin) {
    const marketAtStart = market;
    if (operation || loading) return;
    setOperation(item.id);
    setError('');
    try {
      if (marketAtStart === 'community' && bridge?.changeDshCommunityPlugin) {
        const action = item.present ? !item.installed : 'install';
        const result = await bridge.changeDshCommunityPlugin(item.id, action, communitySearch);
        catalogGeneration.current += 1;
        setCommunity(result);
      } else {
        const mutate = item.installed ? bridge?.removeDshPlugin : bridge?.installDshPlugin;
        if (!mutate) return;
        const result = await mutate(item.id);
        catalogGeneration.current += 1;
        setOfficial(result);
      }
      onChanged();
    } catch (failure) { setError(describeError(failure, item.installed ? '停用插件失败' : marketAtStart === 'community' && !item.present ? '安装插件失败' : '启用插件失败')); }
    finally { setOperation(''); }
  }

  async function openTerminal() {
    const action = bridge?.openManagedDshTerminal;
    if (!action || operation) return;
    setOperation('terminal');
    setError('');
    try { await action(); }
    catch (failure) { setError(describeError(failure, '无法打开 DSH 终端')); }
    finally { setOperation(''); }
  }

  const catalog = market === 'community' ? community : official;
  const runtime = catalog?.runtime || official?.runtime || community?.runtime;
  const ready = Boolean(runtime?.installed);
  const plugins = market === 'community' ? community?.plugins || [] :
    official?.plugins.filter(item => [item.name, item.id, item.description, item.sourceUrl].some(value => value?.toLowerCase().includes(search))) || [];
  const runtimeStatus = runtime ? ready ? '运行时 ' + (runtime.version || '已就绪') : '运行时尚未安装' : undefined;
  const sources: Array<{ key: Market; label: string; description: string; available: boolean }> = [
    { key: 'official', label: 'DSH 官方插件市场', description: '发现并启用随 DSH 提供的插件。', available: Boolean(bridge?.dshPluginMarket) },
    { key: 'community', label: 'DSH 社区插件市场', description: '搜索、安装和启用 dsh-market 社区里的插件。', available: Boolean(bridge?.dshCommunityMarket) },
  ];
  return <section className="plugin-section" aria-labelledby="plugin-market-title">
    <div className="plugin-section-heading">
      <h3 id="plugin-market-title">插件市场</h3>
      {ready && bridge?.openManagedDshTerminal && <Button loading={operation === 'terminal'} disabled={Boolean(operation)}
        onClick={() => void openTerminal()}>打开 DSH 终端</Button>}
    </div>
    <div className="plugin-market-sources">
      {sources.map(source => <button key={source.key} className="plugin-market-card" type="button"
        aria-expanded={market === source.key} aria-controls="dsh-market-list"
        disabled={!source.available || Boolean(operation)} onClick={() => {
          setMarket(value => value === source.key ? undefined : source.key);
          setQuery('');
          setError('');
        }}>
        <span className="plugin-symbol plugin-symbol-market" aria-hidden="true">{source.key === 'official' ? <AppstoreOutlined /> : <GlobalOutlined />}</span>
        <span className="plugin-row-copy"><strong>{source.label}</strong>
          <small>{source.available ? source.description : '市场接入需要 Somnus Windows 桌面版。'}</small>
        </span>
        {source.available && <DownOutlined className="plugin-market-arrow" aria-hidden="true" />}
      </button>)}
    </div>
    {error && <Alert type="error" showIcon message={error} />}
    <div id="dsh-market-list" className="plugin-market-list" hidden={!market}>
      <div className="plugin-section-heading">
        <p className="plugin-muted">{runtimeStatus}{market === 'community' && community?.name && ' · ' + community.name}</p>
        <Input prefix={<SearchOutlined />} allowClear value={query} placeholder="搜索 DSH 插件" aria-label="搜索 DSH 插件"
          disabled={Boolean(operation)} onChange={event => setQuery(event.target.value)} />
      </div>
      {loading && <Spin size="small" />}
      {catalog && <div className="plugin-rows">{plugins.map(item => {
        const canActivate = ready && item.available !== false && (market === 'community'
          ? bridge?.changeDshCommunityPlugin && (!item.present || item.compatibility !== 'dsh-web') : bridge?.installDshPlugin);
        const canDeactivate = market === 'community' ? bridge?.changeDshCommunityPlugin : bridge?.removeDshPlugin;
        const label = market === 'community' && !item.present ? '安装' : '启用';
        return <div key={item.id} className="plugin-row plugin-market-row">
          <span className="plugin-symbol" aria-hidden="true"><AppstoreOutlined /></span>
          <span className="plugin-row-copy"><strong>{item.name}</strong>
            {item.description && <small>{item.description}</small>}
            <small>{[item.name !== item.id && item.id, item.version && 'v' + item.version, item.author].filter(Boolean).join(' · ')}
              {item.installedVersion && item.installedVersion !== item.version && ' · 本机 v' + item.installedVersion}</small>
            {item.reason && <small>{item.reason}</small>}
          </span>
          <div className="plugin-market-row-actions">
            {item.compatibility === 'dsh-web' && <Tag>适用于 DSH 网页</Tag>}
            {item.compatibility === 'unverified' && <Tag>会话兼容性待验证</Tag>}
            {item.installed ? <Tag color="green">已启用</Tag> : item.available === false && ready
              ? <Tag>{market === 'official' ? '待接入 Somnus' : '暂不可安装'}</Tag>
              : !ready ? <Tag>运行时尚未就绪</Tag> : item.present ? <Tag>已安装</Tag> : null}
            {canActivate && !item.installed &&
              <Button size="small" loading={operation === item.id} disabled={Boolean(operation) || loading}
                onClick={() => void change(item)}>{label}</Button>}
            {item.installed && canDeactivate && <Popconfirm title="停用此 DSH 插件？" onConfirm={() => change(item)}
              okText="停用" cancelText="取消"><Button size="small" loading={operation === item.id} disabled={Boolean(operation) || loading}>停用</Button></Popconfirm>}
          </div>
        </div>;
      })}</div>}
      {market === 'community' && !loading && (community?.total || 0) > plugins.length &&
        <p className="plugin-muted">显示 {plugins.length} / {community?.total} 项，可搜索缩小结果。</p>}
      {catalog && !loading && !plugins.length && <p className="plugin-empty">{search ? '没有匹配的插件' : '此市场暂无插件'}</p>}
    </div>
  </section>;
}
