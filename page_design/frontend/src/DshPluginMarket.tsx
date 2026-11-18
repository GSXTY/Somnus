import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Button, Dropdown, Input, Modal, Popconfirm, Spin, Tag } from 'antd';
import { AppstoreOutlined, BookFilled, BookOutlined, ClockCircleOutlined, CommentOutlined, DownloadOutlined, DownOutlined, EllipsisOutlined, EyeInvisibleOutlined, GithubOutlined, InfoCircleOutlined, LeftOutlined, ReloadOutlined, RightOutlined, SearchOutlined, StarOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons';
import { describeError } from './errors.mjs';
import { DSH_IM_PLUGIN } from './DshPluginPage';

type MarketScreenshot = { url: string; alt?: string };
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
  versions?: string[];
  compatibility?: 'agent' | 'dsh-web' | 'unverified';
  reason?: string;
  categories?: string[];
  updatedAt?: string;
  addedAt?: string;
  canUpdate?: boolean;
  iconUrl?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  authorAvatarUrl?: string;
  downloads?: number;
  downloadSource?: 'npm' | 'github';
  stars?: number;
  screenshots?: MarketScreenshot[];
  commentsUrl?: string;
  hostRequirement?: 'web';
  browseOnly?: boolean;
  installReference?: string;
};
export type DshMarket = { runtime: { installed: boolean; version: string | null }; plugins: MarketPlugin[] };
export type DshMarketSource = { id: string; name: string; url: string; builtin?: boolean };
export type DshCatalogQuery = {
  page?: number;
  pageSize?: number;
  sort?: 'default' | 'name' | 'newest';
  category?: string;
  installedOnly?: boolean;
  includeIds?: string[];
  excludeIds?: string[];
};
export type DshCommunityMarket = DshMarket & { name: string; sourceUrl: string; total?: number;
  page?: number; pageSize?: number; categories?: { id: string; label: string; count: number }[]; sources?: DshMarketSource[] };
export type Market = 'official' | 'community' | 'dsh-market';
export type InstalledDshPlugin = {
  id: string;
  name: string;
  description: string;
  version: string;
  source: Exclude<Market, 'dsh-market'>;
  enabled: boolean;
  managedDefault?: boolean;
  available: boolean;
  compatibility?: MarketPlugin['compatibility'];
};
export type InstalledDshPlugins = {
  plugins: InstalledDshPlugin[];
  defaultIm?: { status: 'ready' | 'pending' | 'failed'; message?: string };
};
const pageSize = 24;
const marketTabs = [
  { id: 'discover', label: '发现' }, { id: 'themes', label: '主题' }, { id: 'favorites', label: '收藏' },
  { id: 'installed', label: '已安装' }, { id: 'hidden', label: '已隐藏' }, { id: 'advanced', label: '高级' },
] as const;
type MarketTab = (typeof marketTabs)[number]['id'];
type Task = { time: string; name: string; action: string; status: string };
type Preferences = { favorites: string[]; hidden: string[]; tasks: Task[] };
const preferencesKey = 'somnus.plugin-market-preferences';
const communitySourcePreference = 'somnus.community-market-source';
let suppressUpdateReminders = false;
const compactNumber = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const fullNumber = new Intl.NumberFormat('zh-CN');
const hostRequirements = {
  agent: '支持 Somnus 会话',
  'dsh-web': '仅支持独立网页',
  unverified: '会话兼容性待验证',
} as const;

function externalLink(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function marketImage(value?: string) {
  return value?.length && value.length <= 131_072 && /^data:image\/(?:png|gif|jpe?g|webp|avif|svg\+xml)(?:;|,)/i.test(value)
    ? value : externalLink(value);
}

function MarketArtwork({ src: raw, avatar, name, fallback = false }: { src?: string; avatar?: string; name?: string; fallback?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = [marketImage(raw), marketImage(avatar)].find(url => url && !failed.includes(url));
  if (!src && !fallback && !name) return null;
  return <span className="plugin-symbol plugin-market-artwork" aria-hidden="true">
    {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(current => [...current, src])} />
      : name ? name.trim().slice(0, 1).toLocaleUpperCase() : <AppstoreOutlined />}
  </span>;
}

function MarketAuthor({ name, avatar }: { name: string; avatar?: string }) {
  const [failed, setFailed] = useState<string>();
  const src = marketImage(avatar);
  return <span className="plugin-market-author">
    <span className="plugin-market-avatar" aria-hidden="true">
      {src && failed !== src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
        : <UserOutlined />}
    </span><span>{name}</span>
  </span>;
}

function MarketMetrics({ downloads, downloadSource, stars }: Pick<MarketPlugin, 'downloads' | 'downloadSource' | 'stars'>) {
  const rows = [
    { title: downloadSource === 'npm' ? 'npm 近 30 天下载量' : downloadSource === 'github' ? 'GitHub 发布资产累计下载量' : '下载量',
      value: downloads, icon: <DownloadOutlined /> },
    { title: '星标', value: stars, icon: <StarOutlined /> },
  ].filter((row): row is typeof row & { value: number } => typeof row.value === 'number' && Number.isSafeInteger(row.value) && row.value >= 0);
  if (!rows.length) return null;
  return <span className="plugin-market-metrics">{rows.map(row => {
    const accessible = row.title + ' ' + fullNumber.format(row.value);
    return <span key={row.title} aria-label={accessible} title={accessible}>
      <span aria-hidden="true">{row.icon} {compactNumber.format(row.value)}</span>
    </span>;
  })}</span>;
}

function MarketHost({ hostRequirement, compatibility }: Pick<MarketPlugin, 'hostRequirement' | 'compatibility'>) {
  const labels = [];
  if (hostRequirement === 'web') labels.push('安装目标：DSH Web');
  if (compatibility) labels.push(hostRequirements[compatibility]);
  return labels.length ? <p className="plugin-market-host">{labels.join(' · ')}</p> : null;
}

function MarketDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const paragraph = ref.current;
    if (!paragraph || expanded) return;
    const measure = () => setTruncated(paragraph.scrollHeight > paragraph.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);
    measure();
    return () => observer.disconnect();
  }, [text, expanded]);
  if (!text) return null;
  return <div className="plugin-market-description">
    <p ref={ref} data-expanded={expanded}>{text}</p>
    {(expanded || truncated) && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? '收起' : '展开'}
    </button>}
  </div>;
}

type GalleryPreview = { title: string; images: MarketScreenshot[]; index: number };
function MarketScreenshotGallery({ plugin, onPreview }: { plugin: MarketPlugin; onPreview: (preview: GalleryPreview) => void }) {
  const [failed, setFailed] = useState<string[]>([]);
  const images = (plugin.screenshots || []).flatMap((image, index) => {
    const url = marketImage(image.url);
    return url && !failed.includes(url) ? [{ url, alt: image.alt || plugin.name + ' 截图 ' + (index + 1) }] : [];
  });
  if (!images.length) return null;
  return <div className="plugin-market-screenshots" aria-label={plugin.name + ' 的截图'}>
    {images.map((image, index) => <button type="button" key={image.url + index}
      aria-label={'查看 ' + image.alt} onClick={() => onPreview({ title: plugin.name, images, index })}>
      <img src={image.url} alt={image.alt} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(current => [...current, image.url])} />
    </button>)}
  </div>;
}

function readPreferences(): Preferences {
  const empty: Preferences = { favorites: [], hidden: [], tasks: [] };
  try {
    const value = JSON.parse(window.localStorage.getItem(preferencesKey) || '{}') as Partial<Preferences>;
    const packages = (items?: string[]) => Array.isArray(items) ? items.filter(item =>
      typeof item === 'string' && item.length <= 214 &&
      (/^(?:@[\w.-]+\/)?[\w.-]+$/i.test(item) || /^rich:[a-f0-9]{40}$/.test(item))).slice(0, 1_000) : [];
    return { favorites: packages(value.favorites), hidden: packages(value.hidden),
      tasks: Array.isArray(value.tasks) ? value.tasks.filter(task => task && typeof task.name === 'string').slice(0, 80) : [] };
  } catch { return empty; }
}

function readCommunitySource() {
  try {
    const source = window.localStorage.getItem(communitySourcePreference);
    return source && /^[\w-]{1,100}$/.test(source) ? source : undefined;
  } catch { return undefined; }
}

export function DshPluginMarket({ revision, suggestedPlugin, marketRequest, browse = true, sourcesOpen = false,
  onSourcesClose, installedIds = [], onOpenInstalled, onMarketChange, onInstallSource, onChanged }: {
  revision: number;
  suggestedPlugin?: string;
  marketRequest?: { market: Market };
  browse?: boolean;
  sourcesOpen?: boolean;
  onSourcesClose?: () => void;
  installedIds?: string[];
  onOpenInstalled?: (id: string) => void;
  onMarketChange?: (market: Market) => void;
  onInstallSource?: (reference: string) => void;
  onChanged: () => void;
}) {
  const bridge = window.vvmanAcp;
  const [official, setOfficial] = useState<DshMarket>();
  const [community, setCommunity] = useState<DshCommunityMarket>();
  const [market, setMarket] = useState<Market>(marketRequest?.market || (bridge?.dshPluginMarket ? 'official' : 'community'));
  const [marketMenuOpen, setMarketMenuOpen] = useState(false);
  const marketTrigger = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<MarketTab>('discover');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<NonNullable<DshCatalogQuery['sort']>>('default');
  const [category, setCategory] = useState('');
  const [themeCategory, setThemeCategory] = useState('');
  const [recent, setRecent] = useState<MarketPlugin[]>([]);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [snoozed, setSnoozed] = useState(suppressUpdateReminders);
  const [installedTotal, setInstalledTotal] = useState<number>();
  const [taskOpen, setTaskOpen] = useState(false);
  const [gallery, setGallery] = useState<GalleryPreview>();
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [marketSource, setMarketSource] = useState<string | undefined>(readCommunitySource);
  const [knownSources, setKnownSources] = useState<DshMarketSource[]>([]);
  const [editingSources, setEditingSources] = useState(false);
  const sourcesVisible = sourcesOpen || editingSources;
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesReady, setSourcesReady] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [sourceDraft, setSourceDraft] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<MarketPlugin>();
  const catalogGeneration = useRef(0);
  const previousRevision = useRef(revision);
  const previousReload = useRef(reloadToken);
  const search = query.trim().toLowerCase();
  const indexedMarket = market !== 'official';
  const catalogSource = market === 'dsh-market' ? market : marketSource;
  const canChangeCatalog = indexedMarket && Boolean(catalogSource) && catalogSource !== 'dsh-1024store' && catalogSource !== 'dshfind';
  const communitySearch = indexedMarket ? search : '';
  const communityLoader = bridge?.dshCommunityMarket;
  const favorites = preferences.favorites;
  const hidden = preferences.hidden;
  const browsingCategory = tab === 'themes' ? themeCategory || 'themes' : category || undefined;
  const galleryImage = gallery?.images[gallery.index];

  function stepGallery(offset: number) {
    setGallery(current => current && ({ ...current, index: (current.index + offset + current.images.length) % current.images.length }));
  }

  useEffect(() => {
    if (!gallery) return;
    const navigate = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      stepGallery(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [Boolean(gallery)]);

  useEffect(() => { if (!browse) setGallery(undefined); }, [browse]);

  function savePreferences(update: (value: Preferences) => Preferences) {
    setPreferences(current => {
      const next = update(current);
      try { window.localStorage.setItem(preferencesKey, JSON.stringify(next)); } catch { /* preserve current session */ }
      return next;
    });
  }

  function changePreference(key: 'favorites' | 'hidden', id: string) {
    setPage(1);
    savePreferences(current => ({ ...current, [key]: current[key].includes(id)
      ? current[key].filter(value => value !== id) : [id, ...current[key]].slice(0, 1_000) }));
  }

  function recordTask(name: string, action: string, status: string) {
    const task = { name, action, status, time: new Date().toISOString() };
    savePreferences(current => ({ ...current, tasks: [task, ...current.tasks].slice(0, 80) }));
  }

  function changeTab(next: MarketTab) {
    setTab(next);
    setCategory('');
    setPage(1);
    setSelectedEntry(undefined);
  }

  useEffect(() => {
    if (!marketRequest) return;
    if (market !== marketRequest.market) {
      setCommunity(undefined);
      setRecent([]);
      setInstalledTotal(undefined);
    }
    setMarket(marketRequest.market);
    changeTab('discover');
    setQuery('');
    setError('');
  }, [marketRequest]);

  useEffect(() => {
    if (!browse) return;
    if (!suggestedPlugin) return;
    setMarket('official');
    changeTab('discover');
    setQuery(suggestedPlugin);
  }, [browse, suggestedPlugin]);

  useEffect(() => {
    if (!browse) return;
    if (tab === 'advanced') {
      setLoading(false);
      return;
    }
    const load = indexedMarket ? communityLoader && (() => {
      const refresh = previousRevision.current !== revision || previousReload.current !== reloadToken;
      previousRevision.current = revision;
      previousReload.current = reloadToken;
      return communityLoader(communitySearch, refresh, catalogSource, {
        page, pageSize, sort, category: browsingCategory,
        installedOnly: tab === 'installed',
        includeIds: tab === 'favorites' ? favorites : tab === 'hidden' ? hidden : undefined,
        excludeIds: tab === 'discover' || tab === 'themes' ? hidden : undefined,
      });
    }) : bridge?.dshPluginMarket;
    if (!load) return;
    let active = true;
    const generation = catalogGeneration.current;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void load().then(result => {
        if (!active || catalogGeneration.current !== generation) return;
        if ('sourceUrl' in result) {
          const next = result as DshCommunityMarket;
          setCommunity(next);
          if (next.sources) setKnownSources(next.sources);
          if ((tab === 'discover' || tab === 'themes') && !category && !communitySearch) {
            setThemeCategory(next.categories?.find(item => /^(themes?|主题)$/i.test(item.id) || /^(themes?|主题)$/i.test(item.label))?.id || '');
          }
        }
        else setOfficial(result);
      }).catch(failure => {
        if (active && catalogGeneration.current === generation) setError(describeError(failure, '无法读取插件市场'));
      }).finally(() => { if (active) setLoading(false); });
    }, indexedMarket && communitySearch ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [browse, bridge, communityLoader, revision, reloadToken, catalogRevision, market, communitySearch, catalogSource,
    tab, sort, browsingCategory, page, favorites, hidden]);

  const hasCatalogMetadata = Boolean(community?.page);
  useEffect(() => {
    if (!browse || !hasCatalogMetadata || !indexedMarket || !communityLoader) return;
    let active = true;
    void communityLoader('', false, catalogSource, { pageSize: 9, sort: 'newest', excludeIds: hidden })
      .then(result => { if (active) setRecent(result.plugins.filter(item => item.addedAt || item.updatedAt)); })
      .catch(() => { if (active) setRecent([]); });
    return () => { active = false; };
  }, [browse, hasCatalogMetadata, market, communityLoader, catalogSource, hidden, catalogRevision, reloadToken]);

  useEffect(() => {
    if (!browse || !hasCatalogMetadata || !indexedMarket || !communityLoader) return;
    let active = true;
    setInstalledTotal(undefined);
    void communityLoader('', false, catalogSource, { installedOnly: true, pageSize: 1 })
      .then(result => { if (active) setInstalledTotal(result.total ?? 0); }).catch(() => {});
    return () => { active = false; };
  }, [browse, hasCatalogMetadata, market, communityLoader, catalogSource, revision, catalogRevision, reloadToken]);

  useEffect(() => {
    if (!sourcesVisible || !communityLoader) return;
    let current = true;
    setSourcesLoading(true);
    setSourcesReady(false);
    setSourceError('');
    void communityLoader().then(result => {
      if (current) {
        setKnownSources(result.sources || []);
        setSourceDraft((result.sources || [])
          .filter(source => !source.builtin && source.id !== 'community').map(source => source.url).join('\n'));
        setSourcesReady(true);
      }
    }).catch(failure => {
      if (current) setSourceError(describeError(failure, '无法读取插件市场来源'));
    }).finally(() => { if (current) setSourcesLoading(false); });
    return () => { current = false; };
  }, [sourcesVisible, communityLoader]);

  async function change(item: MarketPlugin, version?: string) {
    const marketAtStart = market;
    if (operation || loading) return;
    const label = version ? '更新版本' : item.installed ? '停用' : marketAtStart !== 'official' && !item.present ? '安装' : '启用';
    setOperation(item.id);
    setError('');
    try {
      if (marketAtStart !== 'official' && bridge?.changeDshCommunityPlugin) {
        const action = item.present ? !item.installed : 'install';
        const result = version && bridge.installDshCommunityPluginVersion
          ? await bridge.installDshCommunityPluginVersion(item.id, version, catalogSource, communitySearch)
          : await bridge.changeDshCommunityPlugin(item.id, action, communitySearch, catalogSource);
        let observed = result.plugins.find(plugin => plugin.id === item.id);
        if (hasCatalogMetadata) {
          const latest = await communityLoader?.('', false, catalogSource, { includeIds: [item.id], pageSize: 1 }).catch(() => undefined);
          observed = latest?.plugins[0] || observed;
          setCatalogRevision(value => value + 1);
        } else {
          catalogGeneration.current += 1;
          setCommunity(result);
        }
        if (observed && selectedEntry?.id === observed.id) setSelectedEntry(observed);
        const applied = version ? observed?.installedVersion === version :
          action === 'install' ? observed?.present : observed?.installed === action;
        recordTask(item.name, label, applied ? '已完成' : '未确认变更');
      } else {
        const mutate = item.installed ? bridge?.removeDshPlugin : bridge?.installDshPlugin;
        if (!mutate) return;
        const result = await mutate(item.id);
        catalogGeneration.current += 1;
        setOfficial(result);
        const observed = result.plugins.find(plugin => plugin.id === item.id);
        if (observed && selectedEntry?.id === observed.id) setSelectedEntry(observed);
        recordTask(item.name, label, observed?.installed === !item.installed ? '已完成' : '未确认变更');
      }
      onChanged();
    } catch (failure) {
      setError(describeError(failure, label + '插件失败'));
      recordTask(item.name, label, '失败');
    }
    finally { setOperation(''); }
  }

  async function updateAll() {
    const update = bridge?.installDshCommunityPluginVersion;
    if (operation || loading || !update || !communityLoader || !canChangeCatalog) return;
    setOperation('update-all');
    setError('');
    try {
      let currentPage = 1;
      let lastPage = 1;
      let foundUpdates = false;
      do {
        const result = await communityLoader('', false, catalogSource, { installedOnly: true, page: currentPage, pageSize: 80 });
        lastPage = Math.ceil((result.total || 0) / (result.pageSize || 80));
        for (const item of result.plugins.filter(plugin => plugin.canUpdate)) {
          foundUpdates = true;
          try {
            await update(item.id, item.version, catalogSource);
            const latest = await communityLoader('', false, catalogSource, { includeIds: [item.id], pageSize: 1 });
            recordTask(item.name, '更新版本', latest.plugins[0]?.installedVersion === item.version ? '已完成' : '未确认变更');
          } catch (failure) {
            recordTask(item.name, '更新版本', describeError(failure, '更新失败'));
          }
        }
        currentPage += 1;
      } while (currentPage <= lastPage);
      if (!foundUpdates) recordTask('当前市场', '全部更新', '没有待更新插件');
      onChanged();
    } catch (failure) {
      setError(describeError(failure, '无法读取待更新插件'));
      recordTask('当前市场', '全部更新', '失败');
    } finally {
      setCatalogRevision(value => value + 1);
      setOperation('');
      setTaskOpen(true);
    }
  }

  function exportTasks() {
    const file = new Blob([JSON.stringify(preferences.tasks, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'somnus-plugin-market-tasks.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function closeSources() {
    setEditingSources(false);
    onSourcesClose?.();
  }

  async function saveSources() {
    if (!bridge?.setDshCommunityMarketSources || operation || sourcesLoading || !sourcesReady) return;
    setOperation('sources');
    try {
      const result = await bridge.setDshCommunityMarketSources([...new Set(sourceDraft.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]);
      catalogGeneration.current += 1;
      setKnownSources(result.sources);
      if (marketSource) {
        if (!result.sources.some(source => source.id === marketSource)) chooseCommunitySource(undefined);
      }
      closeSources();
      if (browse) setReloadToken(value => value + 1);
    } catch (failure) { setSourceError(describeError(failure, '无法保存插件市场来源')); }
    finally { setOperation(''); }
  }

  const catalog = indexedMarket ? community : official;
  const runtime = catalog?.runtime || official?.runtime || community?.runtime;
  const ready = Boolean(runtime?.installed);
  const officialResults = (official?.plugins || []).filter(item => {
    if (tab === 'themes' || tab === 'installed' && !item.installed && !installedIds.includes(item.id)) return false;
    if (tab === 'favorites' && !favorites.includes(item.id) || tab === 'hidden' && !hidden.includes(item.id) ||
        tab === 'discover' && hidden.includes(item.id)) return false;
    return [item.name, item.id, item.description, item.sourceUrl].some(value => value?.toLowerCase().includes(search));
  });
  if (sort === 'name') officialResults.sort((left, right) => left.name.localeCompare(right.name));
  const plugins = indexedMarket ? community?.plugins || [] : officialResults;
  const total = indexedMarket ? community?.total ?? plugins.length : plugins.length;
  const pageCount = Math.max(1, Math.ceil(total / (community?.pageSize || pageSize)));
  const currentPage = indexedMarket ? community?.page ?? page : 1;
  const runtimeStatus = runtime ? ready ? '运行时 ' + (runtime.version || '已就绪') : '运行时尚未安装' : undefined;
  const sources: Array<{ key: Market; label: string; disabled: boolean }> = [
    { key: 'community', label: 'dsh-community-market · Beta', disabled: !bridge?.dshCommunityMarket },
    { key: 'dsh-market', label: 'dsh-market', disabled: !bridge?.dshCommunityMarket },
    ...(!bridge?.dshCommunityMarket || market === 'official'
      ? [{ key: 'official' as const, label: 'Somnus 官方插件', disabled: !bridge?.dshPluginMarket }] : []),
  ];
  const selectedSource = sources.find(source => source.key === market);
  const available = sources.some(source => !source.disabled);
  const entry = selectedEntry;
  function canInstall(item: MarketPlugin) {
    return indexedMarket && ready && item.id !== DSH_IM_PLUGIN && !item.browseOnly && !item.present && !item.installed &&
      item.available !== false && Boolean(bridge?.changeDshCommunityPlugin);
  }
  function directInstallAction(item: MarketPlugin) {
    const source = item.installReference;
    if (!ready || !source || !onInstallSource || item.id === DSH_IM_PLUGIN || item.present || item.installed) return null;
    return <Button size="small" disabled={Boolean(operation) || loading} aria-label={'安装 ' + item.name}
      onClick={() => onInstallSource(source)}>安装</Button>;
  }
  function marketActions(item: MarketPlugin) {
    if (item.id === DSH_IM_PLUGIN) return <><Tag>默认</Tag>{onOpenInstalled &&
      <Button size="small" onClick={() => onOpenInstalled(item.id)}>管理</Button>}</>;
    if (item.browseOnly) return directInstallAction(item);
    const canActivate = ready && item.available !== false && (indexedMarket
      ? bridge?.changeDshCommunityPlugin && (!item.present || item.compatibility !== 'dsh-web') : bridge?.installDshPlugin);
    const canDeactivate = indexedMarket ? bridge?.changeDshCommunityPlugin : bridge?.removeDshPlugin;
    const label = indexedMarket && !item.present ? '安装' : '启用';
    return <>
      {item.installed ? <Tag color="green">已启用</Tag> : item.available === false && ready
        ? <Tag>{market === 'official' ? '待接入 Somnus' : '暂不可安装'}</Tag>
        : !ready ? <Tag>运行时尚未就绪</Tag> : item.present ? <Tag>已安装</Tag> : null}
      {installedIds.includes(item.id) && onOpenInstalled && <Button size="small" onClick={() => onOpenInstalled(item.id)}>管理</Button>}
      {canActivate && !item.installed && <Button size="small" loading={operation === item.id} disabled={Boolean(operation) || loading}
        onClick={() => void change(item)}>{label}</Button>}
      {!canActivate && directInstallAction(item)}
      {item.canUpdate && bridge?.installDshCommunityPluginVersion && <Button size="small"
        disabled={Boolean(operation) || loading} onClick={() => void change(item, item.version)}>更新</Button>}
      {item.installed && canDeactivate && <Popconfirm title="停用此插件？" onConfirm={() => change(item)} okText="停用" cancelText="取消">
        <Button size="small" loading={operation === item.id} disabled={Boolean(operation) || loading}>停用</Button>
      </Popconfirm>}
    </>;
  }
  function selectMarket(next: Market) {
    setCommunity(undefined);
    setRecent([]);
    setInstalledTotal(undefined);
    setMarket(next);
    changeTab('discover');
    setQuery('');
    setError('');
    if (next !== 'official') onMarketChange?.(next);
  }

  function chooseCommunitySource(next?: string) {
    if (next === marketSource) return;
    setMarketSource(next);
    try {
      if (next) window.localStorage.setItem(communitySourcePreference, next);
      else window.localStorage.removeItem(communitySourcePreference);
    } catch { /* preserve the current selection in memory */ }
    if (market !== 'community') return;
    setCommunity(undefined);
    setRecent([]);
    setInstalledTotal(undefined);
    changeTab(tab);
    setError('');
  }
  function categoryLabels(item: MarketPlugin) {
    return (item.categories || []).map(id => community?.categories?.find(category => category.id === id)?.label || id);
  }

  function cardControls(item: MarketPlugin) {
    const comments = externalLink(item.commentsUrl);
    const links = [
      { key: 'homepage', label: '项目主页', href: externalLink(item.homepageUrl) },
      { key: 'source', label: item.browseOnly ? '目录页面' : '发行包', href: externalLink(item.sourceUrl) },
    ];
    const bookmarked = favorites.includes(item.id);
    const hiddenItem = hidden.includes(item.id);
    return <div className="plugin-market-card-controls">
      <Button type="text" size="small" icon={bookmarked ? <BookFilled /> : <BookOutlined />} aria-pressed={bookmarked}
        aria-label={(bookmarked ? '取消收藏 ' : '收藏 ') + item.name} onClick={() => changePreference('favorites', item.id)} />
      {comments && <Button type="text" size="small" icon={<CommentOutlined />} href={comments}
        target="_blank" rel="noreferrer noopener" aria-label={'评论 ' + item.name}>评论</Button>}
      <Dropdown trigger={['click']} menu={{ items: [
        { key: 'hidden', icon: <EyeInvisibleOutlined />, label: hiddenItem ? '取消隐藏' : '隐藏',
          onClick: () => changePreference('hidden', item.id) },
        ...links.flatMap(link => link.href ? [{ key: link.key, label: <a href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a> }] : []),
      ] }}>
        <Button type="text" size="small" aria-label={'更多操作 ' + item.name} aria-haspopup="menu" icon={<EllipsisOutlined />} />
      </Dropdown>
    </div>;
  }
  function closeMarketMenuOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (!marketMenuOpen || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setMarketMenuOpen(false);
    marketTrigger.current?.focus();
  }
  const installedCount = market === 'official' ? (official?.plugins || [])
    .filter(item => item.installed || installedIds.includes(item.id)).length : installedTotal;
  const showUpdateReminder = !snoozed && plugins.some(item => item.canUpdate);
  const showRecent = tab === 'discover' && !search && !category && !loading && indexedMarket && recent.length > 0;
  const communitySources = market === 'community' && knownSources.length > 0;
  const selectableSources = knownSources.filter(source => source.id !== 'community' && source.id !== 'dsh-market');
  const sourceSelector = <Dropdown trigger={['click']} autoFocus open={marketMenuOpen} onOpenChange={setMarketMenuOpen}
    getPopupContainer={() => document.body} disabled={Boolean(operation)}
    popupRender={menu => <div onKeyDown={closeMarketMenuOnEscape}>{menu}</div>} menu={{
      items: sources, selectable: true, selectedKeys: [market], onClick: ({ key }) => {
        setMarketMenuOpen(false);
        if (key !== market && (key === 'official' || key === 'community' || key === 'dsh-market')) selectMarket(key);
      },
    }}>
    <Button ref={marketTrigger} aria-label="切换插件市场" aria-haspopup="menu" aria-expanded={marketMenuOpen}
      onKeyDown={closeMarketMenuOnEscape}>{selectedSource?.label}<DownOutlined aria-hidden="true" /></Button>
  </Dropdown>;
  const communitySourcePicker = <label className="plugin-market-source-picker">
    <select aria-label="市场来源" disabled={loading || Boolean(operation)} value={marketSource || ''}
      onChange={event => chooseCommunitySource(event.target.value || undefined)}>
      <option value="">未选择数据源</option>
      {selectableSources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
    </select>
  </label>;
  const sourceOptions = (advanced = false) => <>
    {communitySources && communitySourcePicker}
    {advanced && market === 'community' && bridge?.setDshCommunityMarketSources && <Button size="small"
      disabled={Boolean(operation)} onClick={() => setEditingSources(true)}>管理市场来源</Button>}
  </>;
  return <section className="plugin-section" aria-label={browse ? '市场目录' : undefined} hidden={!browse}>
    {!available && <p className="plugin-muted">市场接入需要 Somnus Windows 桌面版。</p>}
    {error && <Alert type="error" showIcon message={error} />}
    {entry && <section className="plugin-detail-page" aria-labelledby="market-detail-name">
      <nav className="plugin-detail-breadcrumb" aria-label="市场路径">
        <Button type="text" icon={<LeftOutlined />} aria-label="返回市场目录" onClick={() => setSelectedEntry(undefined)}>
          {marketTabs.find(item => item.id === tab)?.label}
        </Button>
      </nav>
      <header className="plugin-detail-top">
        <MarketArtwork src={entry.iconUrl} fallback />
        <div className="plugin-detail-toolbar">{marketActions(entry)}</div>
      </header>
      <div className="plugin-detail-title"><h2 id="market-detail-name">{entry.name}</h2>{entry.version && <Tag>v{entry.version}</Tag>}</div>
      <div className="plugin-detail-content">
        {entry.description && <p>{entry.description}</p>}
        {entry.reason && <p className="plugin-muted">{entry.reason}</p>}
        {entry.browseOnly && !(entry.installReference && onInstallSource) &&
          <p className="plugin-muted">此条目可在公开目录中查看。安装需要市场提供可用的软件包或仓库地址。</p>}
        {(entry.author || entry.downloads !== undefined || entry.stars !== undefined) && <div className="plugin-market-byline">
          {entry.author && <MarketAuthor name={entry.author} avatar={entry.authorAvatarUrl} />}
          <MarketMetrics downloads={entry.downloads} downloadSource={entry.downloadSource} stars={entry.stars} />
        </div>}
        <MarketScreenshotGallery plugin={entry} onPreview={setGallery} />
        <MarketHost hostRequirement={entry.hostRequirement} compatibility={entry.compatibility} />
        {(categoryLabels(entry).length > 0 || externalLink(entry.commentsUrl)) && <div className="plugin-market-tile-footer">
          <div className="plugin-market-tile-categories">
            {categoryLabels(entry).map(label => <Tag key={label}>{label}</Tag>)}
          </div>
          {cardControls(entry)}
        </div>}
        {indexedMarket && entry.id !== DSH_IM_PLUGIN && !entry.browseOnly && Boolean(entry.versions?.length) && <section aria-label="插件版本">
          <h3>版本</h3>
          <ul className="plugin-market-versions">
            {entry.versions?.map(version => <li key={version}>
              <span>v{version}{entry.installedVersion === version && <Tag>本机版本</Tag>}</span>
              {ready && version !== entry.installedVersion && bridge?.installDshCommunityPluginVersion &&
                <Popconfirm title={`安装 ${entry.name} v${version}？`} okText="安装" cancelText="取消" onConfirm={() => change(entry, version)}>
                  <Button size="small" disabled={Boolean(operation) || loading}>安装此版本</Button>
                </Popconfirm>}
            </li>)}
          </ul>
        </section>}
        <dl className="provider-credentials">
          <div><dt>插件 ID</dt><dd>{entry.id}</dd></div>
          {entry.author && <div><dt>作者</dt><dd>{entry.author}</dd></div>}
          <div><dt>来源</dt><dd>{selectedSource?.label}</dd></div>
          {([{ title: entry.browseOnly ? '目录页面' : '发行包', url: entry.sourceUrl }, { title: '主页', url: entry.homepageUrl },
            { title: '项目仓库', url: entry.repositoryUrl }, { title: '评论', url: entry.commentsUrl }]).map(link => {
            const href = externalLink(link.url);
            return href && <div key={link.title}><dt>{link.title}</dt><dd>
              <a href={href} target="_blank" rel="noreferrer noopener">{href}</a></dd></div>;
          })}
        </dl>
      </div>
    </section>}
    <div id="dsh-market-list" className="plugin-market-list" aria-busy={loading} hidden={Boolean(entry)}>
      <header className="plugin-market-toolbar">
        <nav className="plugin-market-tabs" aria-label="市场浏览">
          {marketTabs.map(item => <Button key={item.id} type="text" aria-pressed={tab === item.id}
            disabled={Boolean(operation)} onClick={() => changeTab(item.id)}>
            {item.id === 'installed' && installedCount !== undefined ? item.label + ' (' + installedCount + ')' : item.label}
          </Button>)}
        </nav>
        <div className="plugin-market-toolbar-actions">
          <Button icon={<ReloadOutlined />} disabled={!available || Boolean(operation)} loading={loading && previousReload.current !== reloadToken}
            onClick={() => { if (tab === 'advanced') changeTab('discover'); setReloadToken(value => value + 1); }}>更新市场</Button>
          <Popconfirm title="更新当前市场中已安装的插件？" description="每个更新会由桌面版确认。" okText="继续" cancelText="取消"
            onConfirm={() => updateAll()}>
            <Button disabled={!ready || !canChangeCatalog || !bridge?.installDshCommunityPluginVersion || Boolean(operation) || loading}
              loading={operation === 'update-all'}>
              全部更新{showUpdateReminder && <span className="plugin-market-update-dot" aria-label="当前页有可更新插件" />}
            </Button>
          </Popconfirm>
          <Button icon={<ClockCircleOutlined />} aria-pressed={snoozed}
            title="暂停提示，直到重启 Somnus，手动更新仍可使用"
            onClick={() => { suppressUpdateReminders = !snoozed; setSnoozed(!snoozed); }}>
            {snoozed ? '恢复提示' : '暂缓提示'}
          </Button>
        </div>
      </header>
      <div className="plugin-market-secondary">
        <Button icon={<DownloadOutlined />} disabled={!preferences.tasks.length} onClick={exportTasks}>导出</Button>
        <Button icon={<UnorderedListOutlined />} onClick={() => setTaskOpen(true)}>任务</Button>
      </div>
      <div className="plugin-discover-toolbar">
        {tab !== 'advanced' && <Input prefix={<SearchOutlined />} allowClear value={query} maxLength={200}
          placeholder="搜索插件" aria-label="搜索插件" disabled={Boolean(operation)} onChange={event => {
            setQuery(event.target.value); setPage(1);
          }} />}
        {sourceSelector}
        {tab !== 'advanced' && sourceOptions()}
        {tab !== 'advanced' && <select className="plugin-market-sort" aria-label="排序" value={sort}
          disabled={Boolean(operation)} onChange={event => { setSort(event.target.value as typeof sort); setPage(1); }}>
          <option value="default">默认排序</option><option value="name">按名称</option>
          {indexedMarket && <option value="newest">最近更新</option>}
        </select>}
      </div>
      {tab === 'advanced' && <div className="plugin-market-advanced">
        {runtimeStatus && <p className="plugin-muted">{runtimeStatus}{indexedMarket && community?.name && ' · ' + community.name}</p>}
        <div className="plugin-discover-meta">{sourceOptions(true)}</div>
      </div>}
      {tab !== 'advanced' && <>
        {tab !== 'themes' && Boolean(community?.categories?.length) && indexedMarket &&
          <div className="plugin-market-categories" aria-label="插件分类">
            <Button size="small" aria-pressed={!category} onClick={() => { setCategory(''); setPage(1); }}>全部</Button>
            {community?.categories?.map(item => <Button size="small" key={item.id} aria-pressed={category === item.id}
              onClick={() => { setCategory(item.id); setPage(1); }}>{item.label} <small>{item.count}</small></Button>)}
          </div>}
        {tab === 'discover' && indexedMarket && <p className="plugin-market-compatibility">
          <InfoCircleOutlined aria-hidden="true" />部分社区插件仅支持独立网页，安装前请查看插件的兼容性说明。
        </p>}
        {showRecent && <section className="plugin-market-recent" aria-labelledby="plugin-market-recent-title">
          <h3 id="plugin-market-recent-title">最近</h3>
          <div className="plugin-market-recent-strip">
            {recent.map(item => <article key={item.id} className="plugin-market-recent-item">
              <button type="button" className="plugin-market-recent-open" onClick={() => setSelectedEntry(item)}>
                <MarketArtwork src={item.iconUrl} avatar={item.authorAvatarUrl} name={item.name} />
                <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}
                  <small>{item.addedAt ? '上架 ' + item.addedAt : '发布 ' + item.updatedAt?.slice(0, 10)}</small></span>
              </button>
              {canInstall(item) ? <Button size="small" loading={operation === item.id} disabled={Boolean(operation) || loading}
                aria-label={'安装 ' + item.name} onClick={() => void change(item)}>安装</Button> : directInstallAction(item)}
            </article>)}
          </div>
        </section>}
        {loading && <Spin size="small" />}
        {catalog && <div className="plugin-market-grid">
          {plugins.map(item => <article key={item.id} className="plugin-market-tile">
            <header className="plugin-market-tile-header">
              <MarketArtwork src={item.iconUrl} />
              <div className="plugin-row-copy">
                <button className="plugin-market-card-title" type="button" onClick={() => setSelectedEntry(item)}>{item.name}</button>
              </div>
              <div className="plugin-market-tile-actions">
                {externalLink(item.repositoryUrl) && <Button type="text" size="small" href={externalLink(item.repositoryUrl)}
                  target="_blank" rel="noreferrer noopener" aria-label={'项目仓库 ' + item.name} icon={<GithubOutlined />} />}
                {marketActions(item)}
              </div>
            </header>
            <div className="plugin-market-byline">
              {item.author && <MarketAuthor name={item.author} avatar={item.authorAvatarUrl} />}
              {item.version && <span>v{item.version}</span>}
              <MarketMetrics downloads={item.downloads} downloadSource={item.downloadSource} />
            </div>
            <MarketMetrics stars={item.stars} />
            <MarketDescription text={item.description || item.reason || ''} />
            <MarketScreenshotGallery plugin={item} onPreview={setGallery} />
            {item.installedVersion && item.installedVersion !== item.version && <small>本机 v{item.installedVersion}</small>}
            <MarketHost hostRequirement={item.hostRequirement} compatibility={item.compatibility} />
            <div className="plugin-market-tile-footer">
              <div className="plugin-market-tile-categories">
                {categoryLabels(item).map(label => <Tag key={label}>{label}</Tag>)}
              </div>
              {cardControls(item)}
            </div>
          </article>)}
        </div>}
        {catalog && !loading && !plugins.length && <p className="plugin-empty">{search ? '没有匹配的插件' :
          tab === 'themes' ? '当前市场未提供主题。' : tab === 'favorites' ? '暂无收藏插件。' :
          tab === 'hidden' ? '暂无隐藏插件。' : '此目录暂无插件。'}</p>}
        {indexedMarket && pageCount > 1 && <nav className="plugin-market-pagination" aria-label="市场分页">
          <Button aria-label="上一页" icon={<LeftOutlined />} disabled={currentPage <= 1 || loading || Boolean(operation)}
            onClick={() => setPage(currentPage - 1)} />
          <span>第 {currentPage} / {pageCount} 页 · {total} 项</span>
          <Button aria-label="下一页" icon={<RightOutlined />} disabled={currentPage >= pageCount || loading || Boolean(operation)}
            onClick={() => setPage(currentPage + 1)} />
        </nav>}
      </>}
    </div>
    {gallery && galleryImage && <Modal open className="plugin-market-lightbox" title={gallery.title} width="min(1040px, calc(100vw - 32px))"
      footer={null} onCancel={() => setGallery(undefined)}>
      <img className="plugin-market-lightbox-image" src={galleryImage.url} alt={galleryImage.alt} referrerPolicy="no-referrer" />
      {gallery.images.length > 1 && <div className="plugin-market-lightbox-toolbar">
        <Button icon={<LeftOutlined />} aria-label="上一张截图" onClick={() => stepGallery(-1)} />
        <span aria-live="polite">{gallery.index + 1} / {gallery.images.length}</span>
        <Button icon={<RightOutlined />} aria-label="下一张截图" onClick={() => stepGallery(1)} />
      </div>}
    </Modal>}
    <Modal open={taskOpen} title="市场任务" footer={null} onCancel={() => setTaskOpen(false)}>
      {!preferences.tasks.length && <p>暂无插件操作记录。</p>}
      <ul className="plugin-market-task-records">{preferences.tasks.map((task, index) =>
        <li key={task.time + index}><strong>{task.name}</strong><span>{task.action} · {task.status}</span>
          <time dateTime={task.time}>{new Date(task.time).toLocaleString()}</time></li>)}</ul>
    </Modal>
    {sourcesVisible && <Modal open title="市场来源配置" okText="保存" cancelText="取消"
      onOk={() => void saveSources()} confirmLoading={operation === 'sources'}
      okButtonProps={{ disabled: sourcesLoading || !sourcesReady }}
      onCancel={() => { if (operation !== 'sources') closeSources(); }}>
      {sourcesReady && <div className="plugin-market-sources-row"><span>dsh-community-market · Beta</span>{communitySourcePicker}</div>}
      <label>自定义市场地址（每行一个 HTTPS 地址）
        <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} value={sourceDraft} disabled={sourcesLoading || operation === 'sources'}
          onChange={event => { setSourceDraft(event.target.value); setSourceError(''); }} />
      </label>
      {sourcesLoading && <Spin size="small" />}
      {sourceError && <Alert type="error" showIcon message={sourceError} />}
    </Modal>}
  </section>;
}
