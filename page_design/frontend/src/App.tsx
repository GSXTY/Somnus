import { SidebarResizeHandle, useSidebarLayout } from './SidebarResize';
import { SomnusMark } from './SomnusMark';
import { ConfigurationCenter, configurationSections } from './ConfigurationCenter';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, ConfigProvider, Empty, Layout, Modal, Select, Space, Spin, Switch, Table, Tag, Tooltip, Typography, Input, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AppstoreOutlined, ArrowLeftOutlined, ArrowRightOutlined, BellOutlined, MenuFoldOutlined, MenuUnfoldOutlined, DashboardOutlined, DownloadOutlined, MessageOutlined, FileTextOutlined, SearchOutlined, RobotOutlined, ReloadOutlined, SettingOutlined, PlusOutlined, DatabaseOutlined, RightOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { Chart } from './Chart';
import { activityOption, eventsOption, sparkline } from './chartOptions';
import { comparison, filterUsers, formatNumber, knownMean, reportText } from './logic.mjs';
import { useWorkbench } from './useWorkbench';
import { UserDrawer } from './UserDrawer';
import { KeyboardShortcuts, Settings, startupPageKey } from './Settings';
import type { StartupPage } from './Settings';
import { DataLossCard } from './DataLossCard';
import { AIAssistant } from './AIAssistant';
import { AnalysisView } from './AnalysisView';
import { DeepAnalysis } from './DeepAnalysis';
import { SqlQuery } from './SqlQuery';
import { dataConnectionLabel, useDataConnection } from './DataConnection';
import { Plugins } from './Plugins';
import { WorkspaceSwitch } from './WorkspaceSwitch';
import { FocusModule, CommandPanel, RollingNumber } from './GlassExperience';
import './glass.css';
import './codex.css';
import './workspace-layout.css';
import { readWorkspaceView, isStandardView, workspacePath, recordWorkspaceVisit } from './workspaceNavigation.mjs';
import { activeRailView, builtInTools, labelOf, workspaceRail } from './navigation.mjs';
import type { Metric, Source, UserRow } from './types';

const { Header, Sider, Content } = Layout;
const stateLabels = { therapy: '治疗中', online: '在线', offline: '离线' };
const priorityLabels = { high: '高', medium: '中', low: '低' };
const autoRefreshKey = 'vvman.dashboard-auto-refresh';
const dataViews = [
  { key: 'dashboard', label: '总览' },
  { key: 'users', label: '用户目录' },
  { key: 'devices', label: '设备目录' },
  { key: 'alerts', label: '告警中心' },
];

const metricFallback = (label: string, unit: string): Metric => ({ label, unit, value: null, previous: null, trend: [] });
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function KpiCard({ metric }: { metric: Metric }) {
  const change = comparison(metric.value, metric.previous);
  return <Card className="kpi-card" size="small"><div className="kpi-title">{metric.label}</div><div className="kpi-body"><div className="ant-statistic"><div className="ant-statistic-content"><RollingNumber value={metric.value} precision={typeof metric.value === 'number' && metric.value % 1 !== 0 ? 1 : 0}/><span className="metric-unit">{metric.unit}</span></div></div><div className="sparkline">{metric.trend.length ? <Chart height={43} label={`${metric.label}七日迷你趋势`} option={sparkline(metric)} /> : <span className="unknown-spark">—</span>}</div></div><div className={`metric-comparison ${change.direction}`}><span>{change.text}</span><small>所选型号 · 昨日</small></div></Card>;
}
function PriorityTag({ user }: { user: UserRow }) {
  return <Tooltip title={user.priority_reason}><Tag color={user.priority === 'high' ? 'volcano' : user.priority === 'medium' ? 'gold' : 'default'}>{priorityLabels[user.priority]}优先级</Tag></Tooltip>;
}
function UserTable({ users, connected, onUser, full = false }: { users: UserRow[]; connected: boolean; onUser: (user: UserRow) => void; full?: boolean }) {
  const [priority, setPriority] = useState('all'), [state, setState] = useState('all');
  const rows = filterUsers(users, priority, state);
  const live = !connected;
  const columns: ColumnsType<UserRow> = [
    { title: '用户 / 设备', key: 'user', width: 148, render: (_, user) => <div className="user-cell"><Avatar size={30} style={{ color: '#3672bf', background: '#edf4fe' }}>{user.name.slice(-1)}</Avatar><div><strong>{user.name}</strong><small>{user.device_id}</small></div></div> },
    ...(live ? [{ title: '型号', dataIndex: 'model', width: 140 }] : [{ title: '状态', dataIndex: 'state', width: 88, render: (value: UserRow['state']) => <Badge status={value === 'therapy' ? 'processing' : value === 'online' ? 'success' : 'default'} text={stateLabels[value]} /> }]),
    { title: live ? '昨日治疗' : '今日治疗', dataIndex: 'today_treatment_hours', width: 92, render: value => <span className="tabular">{formatNumber(value)} <small>h</small></span> },
    ...(live ? [{ title: <Tooltip title="昨日设备上报的 AHI（次/小时）"><span>AHI ⓘ</span></Tooltip>, dataIndex: 'ahi', width: 84, render: (value: number | undefined) => <span className="tabular">{value === undefined || value === null ? '—' : formatNumber(value, 2)}</span> }] : [{ title: <Tooltip title="来源：合成演示漏气提示">漏气提示 ⓘ</Tooltip>, key: 'leak', width: 100, render: (_: unknown, user: UserRow) => <span className={user.leak_flag ? 'flagged-value' : 'tabular'}>{formatNumber(user.leak_value)} <small>{user.leak_unit}</small></span> }, { title: '24h候选', dataIndex: 'events_24h', width: 90, render: (value: number | null) => formatNumber(value, 0) }]),
    ...(live ? [] : [{ title: '巡检优先级', key: 'priority', width: 112, render: (_: unknown, user: UserRow) => <PriorityTag user={user} /> }]),
    ...(full && !live ? [{ title: '型号', dataIndex: 'model', width: 160 }, { title: '固件', dataIndex: 'firmware', width: 100 }] : []),
    { title: '操作', key: 'action', width: 82, fixed: 'right', render: (_, user) => <Button type="link" size="small" disabled={!connected} onClick={event => { event.stopPropagation(); onUser(user); }}>详情</Button> },
  ];
  return <><div className="table-filters"><Space wrap><Select aria-label="筛选巡检优先级" value={priority} onChange={setPriority} options={[{ value: 'all', label: '全部优先级' }, ...Object.entries(priorityLabels).map(([value, label]) => ({ value, label: label + '优先级' }))]} />{!live && <Select aria-label="筛选用户状态" value={state} onChange={setState} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(stateLabels).map(([value, label]) => ({ value, label }))]} />}</Space><Typography.Text type="secondary">{live ? (users.length ? `${rows.length} / ${users.length} 位用户 · 按昨日 AHI 排序` : '暂无用户数据') : `${rows.length} / ${users.length} 位示例用户`}</Typography.Text></div><Table<UserRow> rowKey="id" size="small" columns={columns} dataSource={rows} pagination={{ pageSize: full ? 10 : 5, size: 'small', showSizeChanger: false, hideOnSinglePage: true }} scroll={{ x: live ? (full ? 760 : 600) : (full ? 1060 : 780) }} onRow={user => ({ onClick: () => { if (connected) onUser(user); }, className: connected ? 'clickable-row' : '' })} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={users.length ? '没有符合筛选的用户' : '未取得用户数据'} /> }} />{!live && <p className="small-note">优先级与漏气提示来自合成演示规则。</p>}</>;
}
export default function App() {
  const [commandOpen, setCommandOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const mac = /Mac/.test(navigator.platform);
  const electron = /\bElectron\//.test(navigator.userAgent);
  const desktopPlatform = electron ? mac ? 'mac' : /Win/.test(navigator.platform) ? 'windows' : undefined : undefined;
  useEffect(() => { document.documentElement.dataset.visualTheme = 'codex'; }, []);
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(value => !value); } if (event.key === 'Escape') setCommandOpen(false); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);

  const dataConnection = useDataConnection();
  const source: Source = 'live';
  const [model, setModel] = useState('all'), [auto, setAuto] = useState(() => {
    try { return localStorage.getItem(autoRefreshKey) !== 'false'; } catch { return true; }
  });
  function changeAutoRefresh(value: boolean) {
    setAuto(value);
    try { localStorage.setItem(autoRefreshKey, String(value)); } catch { /* session preference */ }
  }
  const [startup, setStartup] = useState<StartupPage>(() => {
    try { return localStorage.getItem(startupPageKey) === 'chat' ? 'chat' : 'dashboard'; }
    catch { return 'dashboard'; }
  });
  function changeStartup(value: StartupPage) {
    setStartup(value);
    try { localStorage.setItem(startupPageKey, value); } catch { /* session preference */ }
  }
  const [view, setView] = useState(() => (
    desktopPlatform && !window.location.hash && !new URLSearchParams(window.location.search).has('view') && startup === 'chat'
      ? 'assistant' : readWorkspaceView(window.location)
  )), [selected, setSelected] = useState<UserRow | null>(null);
  const navIcons: Record<string, JSX.Element> = {
    chat: <MessageOutlined />, dashboard: <DashboardOutlined />, robot: <RobotOutlined />,
    plugin: <AppstoreOutlined />,
  };
  const activeSection = activeRailView(view);
  const [appVersion, setAppVersion] = useState('—'), [helpOpen, setHelpOpen] = useState(false);
  const [newChatSignal, setNewChatSignal] = useState(0);
  const [sidebarSessions, setSidebarSessions] = useState<HTMLDivElement | null>(null);
  const [chatLocked, setChatLocked] = useState(false);
  const sidebar = useSidebarLayout();
  const compactNav = sidebar.compact;
  const chatView = view === 'assistant';
  const configurationView = configurationSections.some(section => section.key === view);
  const expandedSidebar = !compactNav;
  const contextualConfig = configurationView && expandedSidebar && !sidebarHidden;
  function startChat() {
    if (chatLocked) return;
    changeView('assistant');
    setNewChatSignal(value => value + 1);
  }
  useEffect(() => {
    const onNewChat = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      startChat();
    };
    window.addEventListener('keydown', onNewChat);
    return () => window.removeEventListener('keydown', onNewChat);
  }, [chatLocked]);
  const [workspace, setWorkspace] = useState(() => { try { return localStorage.getItem('ya70.workspace') || 'default'; } catch { return 'default'; } });
  useEffect(() => { document.title = `Somnus · ${labelOf(view)}`; }, [view]);
  useEffect(() => { fetch('/api/health', { cache: 'no-store' }).then(response => response.json()).then(data => { if (data?.app_version) setAppVersion(data.app_version); }).catch(() => {}); }, []);
  useEffect(() => { const onHelp = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; const typing = target ? ['INPUT', 'TEXTAREA'].includes(target.tagName) : false; if (event.key === '?' && !typing) { event.preventDefault(); setHelpOpen(value => !value); } else if (event.key === 'Escape') setHelpOpen(false); }; window.addEventListener('keydown', onHelp); return () => window.removeEventListener('keydown', onHelp); }, []);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [standardView, setStandardView] = useState(() => isStandardView(view) ? view : 'dashboard');
  const [analysisMounted, setAnalysisMounted] = useState(() => readWorkspaceView(window.location) === 'analysis');
  function activate(next: string) { if (next !== 'plugin-config') setSuggestedPlugin(undefined); setView(next); if (isStandardView(next)) setStandardView(next); if (next === 'analysis') setAnalysisMounted(true); }
  const [suggestedPlugin, setSuggestedPlugin] = useState<string>();
  const [routeHistory, setRouteHistory] = useState({ entries: [view], index: 0 });
  const routeHistoryRef = useRef(routeHistory);
  function applyHistory(history: typeof routeHistory) {
    routeHistoryRef.current = history;
    setRouteHistory(history);
    activate(history.entries[history.index]);
  }
  function showRoute(history: typeof routeHistory) {
    const next = history.entries[history.index];
    window.history.replaceState(window.history.state, '', workspacePath(next, window.location.href));
    applyHistory(history);
  }
  function changeView(next: string) {
    const current = routeHistoryRef.current;
    const history = recordWorkspaceVisit(current, next);
    if (history !== current) showRoute(history);
  }
  function moveHistory(direction: -1 | 1) {
    const current = routeHistoryRef.current;
    const index = current.index + direction;
    if (index >= 0 && index < current.entries.length) showRoute({ ...current, index });
  }
  useEffect(() => {
    const sync = () => applyHistory(recordWorkspaceVisit(routeHistoryRef.current, readWorkspaceView(window.location)));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    const openCommand = () => setCommandOpen(true);
    window.addEventListener('workbench:open-command', openCommand);
    return () => window.removeEventListener('workbench:open-command', openCommand);
  }, []);
  const [draft, setDraft] = useState(''), [draftOpen, setDraftOpen] = useState(false);
  const [messages, holder] = message.useMessage();
  const { data: result, error, loading, visible, reload } = useWorkbench(source, model, auto);
  // Never display the prior source while the effect that starts the next request is pending.
  const data = result && String(result.source.mode) === source && (model === 'all' || result.model_scope.includes(model)) ? result : null;
  const demo = Boolean(data?.source.mode === 'demo');
  useEffect(() => { setSelected(null); }, [source, model]);
  useEffect(() => { try { const stored = localStorage.getItem('ya70-workbench-review-draft'); if (stored) setDraft(stored); } catch { /* storage optional */ } }, []);
  const means = useMemo(() => ({ hours: knownMean((data?.daily || []).map(d => d.treatment_hours)), users: knownMean((data?.daily || []).map(d => d.active_users)) }), [data?.daily]);
  const titles: Record<string, string> = { dashboard: '数据大盘', devices: '设备目录', users: '用户目录', alerts: '告警中心' };
  const modelOptions = [{ value: 'all', label: '全部设备型号' },
    ...((data as unknown as { model_options?: { value: string; label: string }[] })?.model_options || [])
      .map(item => ({ value: item.value, label: item.label }))];
  const metrics: Record<string, Metric> = (data?.kpis || { active_users: metricFallback('昨日活跃用户数', '人'), treatment_hours: metricFallback('昨日总治疗时长', '小时'), reported_events: metricFallback('昨日演示模型候选', '次'), avg_ahi: metricFallback('昨日平均 AHI', '次/小时') }) as Record<string, Metric>;
  const exportReport = () => { if (data?.source.mode === 'demo') { download(`Somnus-演示报告-${data.period.kpi_date}.txt`, reportText(data, model)); messages.success('已生成本地演示报告下载'); } };
  const generateDraft = () => {
    if (!data || !demo) return;
    const focus = data.users.filter(user => user.priority === 'high');
    const text = ['本地巡检复核草稿（未发送）', `来源：合成演示；快照 ${data.generated_at}`, `范围：${model}，${data.period.kpi_date}`, '', '建议复核对象', ...(focus.length ? focus.map(user => `${user.name} / ${user.device_id}：${user.priority_reason}`) : ['当前筛选无高优先级示例对象。']), '', '下一步：核对原始记录、单位、时间轴和候选证据，人工确认后再决定后续沟通。', '不自动推断原因、不发送随访消息、不提供诊断或调压建议。'].join('\n');
    setDraft(text); setDraftOpen(true);
    try { localStorage.setItem('ya70-workbench-review-draft', text); messages.success('草稿已保存在本浏览器，未发送'); } catch { messages.warning('浏览器存储不可用，草稿仅保留在本次页面会话'); }
  };
  const deviceColumns = [{ title: '设备标识', dataIndex: 'device_id' }, { title: '型号', dataIndex: 'model' }, { title: '固件', dataIndex: 'firmware', render: (value: string) => value || '—' }, { title: demo ? '示例用户' : '用户', dataIndex: 'name' }, { title: '状态', dataIndex: 'state', render: (value: UserRow['state']) => stateLabels[value] || '—' }];
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176D61', colorSuccess: '#00a887', borderRadius: 8, fontSize: 13, colorBgLayout: '#F5F8F7', colorText: '#202A28', colorTextSecondary: '#526762', fontFamily: 'Inter, Microsoft YaHei, PingFang SC, sans-serif' }, components: { Card: { headerHeight: 49 }, Table: { headerBg: '#f8fafc' }, Menu: { itemHeight: 44 } } }}>
    {holder}<Layout className="workbench codex-theme" data-desktop-platform={desktopPlatform}>
      <Header className="global-header">
        <nav className="topbar-navigation" aria-label="工作台导航">
          <Button type="text" aria-label={sidebarHidden ? '显示侧栏' : '隐藏侧栏'} title={sidebarHidden ? '显示侧栏' : '隐藏侧栏'}
            aria-controls="workbench-sidebar" aria-expanded={!sidebarHidden}
            icon={sidebarHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarHidden(value => !value)} />
          <Button type="text" aria-label="后退" title="后退" icon={<ArrowLeftOutlined />}
            disabled={routeHistory.index === 0} onClick={() => moveHistory(-1)} />
          <Button type="text" aria-label="前进" title="前进" icon={<ArrowRightOutlined />}
            disabled={routeHistory.index >= routeHistory.entries.length - 1} onClick={() => moveHistory(1)} />
        </nav>
        <div className="titlebar-drag-region"><span className="topbar-brand"><SomnusMark /><span>Somnus</span><small>{labelOf(view)}</small></span></div>
        <Button className="command-trigger" type="text" aria-label="打开命令面板" title="打开命令面板"
          icon={<SearchOutlined />} onClick={() => setCommandOpen(true)}>
          <span className="command-label">搜索功能</span><kbd>{mac ? '⌘ K' : 'Ctrl K'}</kbd>
        </Button>
        <Tooltip title="查看未处理工程告警">
          <Button type="text" aria-label="查看工程告警"
            icon={<Badge count={data?.alerts.length || 0} size="small"><BellOutlined /></Badge>}
            onClick={() => changeView('alerts')} />
        </Tooltip>
      </Header>
      <Layout className="workspace-shell-body"><Sider id="workbench-sidebar" width={sidebar.width}
        className={expandedSidebar ? 'navigation workspace-view-sidebar ' +
          (chatView ? 'workspace-chat-sidebar' : configurationView ? 'workspace-config-sidebar' : 'workspace-context-sidebar') : 'navigation nav-with-rail'}
        hidden={sidebarHidden} collapsedWidth={58}
        collapsed={!expandedSidebar} trigger={null}>
        {!expandedSidebar && <nav className="nav-rail" aria-label="主导航">
          {workspaceRail.map(item => <button type="button" key={item.key} className="nav-rail-primary"
            title={item.label} aria-current={activeSection === item.key ? 'page' : undefined}
            onClick={() => changeView(item.key)}>
            <span className="nav-rail-icon" aria-hidden="true">{navIcons[item.icon]}</span><span>{item.label}</span>
          </button>)}
          {chatView && compactNav && <div className="nav-rail-compact-actions">
            <button type="button" title="新建会话" aria-label="新建会话" onClick={startChat} disabled={chatLocked}><PlusOutlined /></button>
            <WorkspaceSwitch value={workspace} onChange={setWorkspace} disabled={chatLocked} compact>
              <div className="nav-session-slot nav-session-slot-compact" ref={setSidebarSessions} />
            </WorkspaceSwitch>
          </div>}
          <button type="button" className="nav-rail-primary nav-rail-settings" title="设置" aria-label="设置"
            aria-current={view === 'settings' ? 'page' : undefined} onClick={() => changeView('settings')}>
            <span className="nav-rail-icon" aria-hidden="true"><SettingOutlined /></span><span>设置</span>
          </button>
        </nav>}
        {expandedSidebar && <div className="workspace-sidebar-content">
          {chatView ? <button type="button" className="workspace-sidebar-feature" onClick={startChat} disabled={chatLocked}>
            <PlusOutlined aria-hidden="true" /><span>新建会话</span><kbd>{mac ? '⌘ N' : 'Ctrl N'}</kbd>
          </button> : <button type="button" className="workspace-sidebar-feature" onClick={() => changeView('assistant')}>
            <MessageOutlined aria-hidden="true" /><span>返回会话</span><RightOutlined aria-hidden="true" />
          </button>}
          <nav className="workspace-sidebar-links" aria-label="主导航">
            {chatView ? <button type="button" onClick={() => window.dispatchEvent(new Event('workbench:search-conversations'))}>
              <SearchOutlined aria-hidden="true" />搜索会话
            </button> : <h2>工作台</h2>}
            <button type="button" aria-current={activeSection === 'dashboard' ? 'page' : undefined} onClick={() => changeView('dashboard')}><DatabaseOutlined aria-hidden="true" />数据</button>
            <button type="button" aria-current={activeSection === 'plugins' ? 'page' : undefined} onClick={() => changeView('plugins')}><AppstoreOutlined aria-hidden="true" />工具</button>
            <button type="button" aria-current={configurationView ? 'page' : undefined} onClick={() => changeView('config')}>
              <SettingOutlined aria-hidden="true" />配置中心
            </button>
          </nav>
          {chatView ? <WorkspaceSwitch value={workspace} onChange={setWorkspace} disabled={chatLocked} compact={false}>
            <div className="nav-session-slot" ref={setSidebarSessions} />
          </WorkspaceSwitch> : configurationView ? <nav className="workspace-sidebar-links workspace-sidebar-configuration" aria-label="配置分类">
            <h2>配置</h2>
            {configurationSections.map(({ key, label }) => <button type="button" key={key} aria-current={view === key ? 'page' : undefined}
              onClick={() => changeView(key)}>{label}</button>)}
          </nav> : (activeSection === 'dashboard' || activeSection === 'plugins') && 
            <nav className="workspace-sidebar-links workspace-sidebar-configuration" aria-label={activeSection === 'dashboard' ? '数据分类' : '工具分类'}>
              <h2>{activeSection === 'dashboard' ? '数据' : '工具'}</h2>
              {(activeSection === 'dashboard' ? dataViews : builtInTools).map(({ key, label }) => 
                <button type="button" key={key} aria-current={view === key ? 'page' : undefined} onClick={() => changeView(key)}>{label}</button>)}
            </nav>}
          <div className="workspace-sidebar-footer">
            <button type="button" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => changeView('settings')}><SettingOutlined aria-hidden="true" />设置</button>
          </div>
        </div>}
        {expandedSidebar && !sidebarHidden && <SidebarResizeHandle width={sidebar.width} max={sidebar.max}
          onPreview={sidebar.preview} onCommit={sidebar.commit} onCancel={sidebar.cancel} />}
      </Sider>
      <Content className="workspace-content">
      <div className="workspace-panel standard-workspace-panel" hidden={!isStandardView(view)}>
        <nav className="data-page-nav" aria-label="数据视图" hidden={expandedSidebar && !sidebarHidden && activeSection === 'dashboard'}>
          {dataViews.map(item => <button key={item.key} type="button" aria-current={standardView === item.key ? 'page' : undefined}
            onClick={() => changeView(item.key)}>{item.label}</button>)}
        </nav>
        <div className="page-toolbar">
          <Typography.Title level={3}>{titles[standardView]}</Typography.Title>
          <div className="toolbar-controls">
            <Select aria-label="筛选设备型号" value={model} onChange={setModel} options={modelOptions} />
            <Button icon={<ReloadOutlined spin={loading} />} onClick={() => void reload()}>刷新</Button>
            {standardView === 'dashboard' && <Button onClick={() => setInsightsOpen(value => !value)}>{insightsOpen ? '收起' : '展开'}洞察</Button>}
          </div>
        </div>
        <div className="source-banner">
          <div><Tag color={dataConnection.mode === 'invalid' ? 'error' : 'default'}>{dataConnectionLabel(dataConnection)}</Tag>
            {standardView === 'dashboard' && <span>AHI 来源：设备上报</span>}</div>
          <Space><span className="refresh-state">{!visible ? '页面隐藏 · 已暂停刷新' : auto ? '每小时自动刷新' : '自动刷新已暂停'}</span>
            <Switch size="small" checked={auto} onChange={changeAutoRefresh} aria-label="数据大盘自动刷新" /></Space>
        </div>
        <div className="snapshot-line">
          {data ? <><span>快照 {data.generated_at} · 昨日指标 {data.period.kpi_date} · {data.period.date_basis}</span>
            <span>{data.period.start_date} — {data.period.end_date} · {data.period.time_zone}</span></> : <span>{loading ? '正在读取数据…' : '暂无数据快照'}</span>}
        </div>
        {error && <Alert className="data-error" type="error" showIcon message="工作台数据读取失败" description={error}
          action={<Button onClick={() => void reload()}>重试</Button>} />}
        {source === 'live' && !loading && !error && !data?.source?.connected && <Alert className="data-error" type="info" showIcon
          message="数据源尚未连接" action={<Button onClick={() => changeView('settings')}>打开设置</Button>} />}
      <div className={`content-with-insights ${insightsOpen && standardView === 'dashboard' ? '' : 'without-insights'}`}><main className="dashboard-main" aria-busy={loading}>
        {standardView === 'dashboard' || !titles[standardView] ? <><FocusModule id="metrics" className="metrics-module"><div className={`kpi-grid ${metrics.avg_ahi ? "has-average-ahi" : "without-average-ahi"}`}><KpiCard metric={metrics.active_users} /><KpiCard metric={metrics.treatment_hours} /><KpiCard metric={metrics.reported_events} />{metrics.avg_ahi && <KpiCard metric={metrics.avg_ahi} />}</div></FocusModule><div className="trend-grid"><FocusModule id="activity"><Card className="panel-card" title="近7天 · 活跃度与治疗趋势" extra={<Tag>按日统计</Tag>}><div className="chart-summary"><span>日均治疗 <b>{formatNumber(means.hours)} h</b></span><span>日均活跃 <b>{formatNumber(means.users)} 人</b></span></div>{data?.daily.length ? <Chart label="近七天治疗总小时柱图及活跃人数折线，左右两个单位轴" height={262} option={activityOption(data.daily)} /> : <div className="chart-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '趋势加载中' : '暂无有效趋势数据'} /></div>}</Card></FocusModule><FocusModule id="events"><Card className="panel-card" title={demo ? '每日演示候选' : '每日设备上报事件'}>{data?.daily.length ? <Chart label={demo ? '每日演示候选次数' : '每日设备上报事件次数'} height={294} option={eventsOption(data.daily)} /> : <div className="chart-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '趋势加载中' : demo ? '暂无演示候选' : '暂无上报事件'} /></div>}</Card></FocusModule></div><div className="bottom-grid"><FocusModule id="users" tilt={false}><Card className="panel-card users-panel" title="重点巡检对象" extra={demo ? <Tag>演示规则</Tag> : <Tag>设备上报 AHI</Tag>}><UserTable users={data?.users || []} connected={demo} onUser={setSelected} /></Card></FocusModule><FocusModule id="quality"><DataLossCard quality={data?.data_quality} source={source} /></FocusModule></div></> : standardView === 'users' ? <Card className="panel-card" title={demo ? "示例用户" : "用户列表"}><UserTable users={data?.users || []} connected={demo} onUser={setSelected} full /></Card> : standardView === 'devices' ? <Card className="panel-card" title={demo ? "示例设备" : "设备列表"}><Table rowKey="device_id" columns={deviceColumns} dataSource={data?.users || []} size="middle" pagination={{ pageSize: 10 }} scroll={{ x: 650 }} locale={{ emptyText: '未取得设备数据' }} /></Card> : standardView === 'alerts' ? <Card className="panel-card" title={demo ? "演示告警" : "工程告警"}><Table rowKey="id" size="small" dataSource={data?.alerts || []} pagination={{ pageSize: 8 }} columns={[{ title: '级别', dataIndex: 'severity', render: (value: string) => <Tag color={value === 'critical' ? 'error' : value === 'warning' ? 'warning' : 'default'}>{value === 'critical' ? '严重工程告警' : value === 'warning' ? '工程提示' : '信息'}</Tag> }, { title: '设备', dataIndex: 'device_id' }, { title: '事项', dataIndex: 'title' }, { title: '说明', dataIndex: 'description' }, { title: '时间', dataIndex: 'at' }]} scroll={{ x: 750 }} /></Card> : null}
        {loading && !data && <div className="initial-loading"><Spin size="small" /> 正在读取数据…</div>}
      </main>{insightsOpen && standardView === "dashboard" && <aside className="insights-aside"><FocusModule id="insights" className="insights-module"><Card className="insights-card" title={<Space><AppstoreOutlined /><span>巡检洞察</span></Space>} extra={<Tag color="blue">规则摘要</Tag>}><div className="insight-origin">来源：当前数据快照</div>{data?.insights.length ? data.insights.map((insight, index) => <section className="insight-section" key={insight.kind + index}><div className="insight-title"><span className={`insight-dot ${insight.kind}`} />{insight.title}</div><p>{insight.text}</p><details><summary>查看依据</summary><ul>{insight.evidence.map((evidence, i) => <li key={i}>{evidence}</li>)}</ul></details></section>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无巡检洞察" />}<div className="insight-actions">{demo && <><Button block type="primary" icon={<DownloadOutlined />} onClick={exportReport}>导出演示巡检报告</Button><Button block icon={<FileTextOutlined />} onClick={generateDraft}>生成本地复核草稿</Button></>}<Button block type="text" disabled={!draft} onClick={() => setDraftOpen(true)}>查看已保存的本地草稿</Button></div><p className="small-note">报告下载到本机，草稿保存在本浏览器。</p>{data?.constraints.length ? <details className="constraints"><summary>统计口径</summary><ul>{data.constraints.map((text, index) => <li key={index}>{text}</li>)}</ul></details> : null}</Card></FocusModule></aside>}</div>
      </div><div className="workspace-panel assistant-workspace-panel" hidden={view !== 'assistant'}>
        <AIAssistant allowLocalAnalysisUpload={dataConnection.mode === 'local'} onModelConfig={() => changeView('models')} workspace={workspace} visible={view === 'assistant'} sidebar={sidebarSessions}
          newChatSignal={newChatSignal} onLockedChange={setChatLocked} onOpenChat={() => changeView('assistant')}
          onOpenDshPlugin={id => { setSuggestedPlugin(id); changeView('plugin-config'); }} />
      </div>{view === 'settings' && <div className="workspace-panel settings-workspace-panel"><Settings workspace={workspace} startup={startup} onStartupChange={changeStartup} autoRefresh={auto} onAutoRefresh={changeAutoRefresh} dataConnection={dataConnection} appVersion={appVersion} mac={mac} onOpen={changeView} /></div>}{view === 'sql' && <div className="workspace-panel assistant-workspace-panel"><SqlQuery dataConnection={dataConnection} /></div>}{configurationView && <div className="workspace-panel configuration-workspace-panel"><ConfigurationCenter view={view} suggestedPlugin={suggestedPlugin} onOpen={changeView} sidebarNavigation={contextualConfig} /></div>}{view === 'plugins' && <div className="workspace-panel plugins-workspace-panel"><Plugins onOpen={changeView} /></div>}{view === 'deep-analysis' && <div className="workspace-panel deep-analysis-workspace-panel"><DeepAnalysis dataConnection={dataConnection} /></div>}{analysisMounted && <div className="workspace-panel analysis-workspace-panel" hidden={view !== 'analysis'}><AnalysisView active={view === 'analysis'} /></div>}</Content></Layout>
      <CommandPanel open={commandOpen} onClose={()=>setCommandOpen(false)} onNavigate={changeView}/>
      <Modal title="快捷键与说明" open={helpOpen} onCancel={() => setHelpOpen(false)} footer={null} width={460}>
        <KeyboardShortcuts mac={mac} />
      </Modal>
      <UserDrawer user={selected} source={source} onClose={() => setSelected(null)} onAnalyze={() => changeView('analysis')} />
      <Modal title="本地复核草稿 · 未发送" open={draftOpen} onCancel={() => setDraftOpen(false)} width={720} footer={<Space><Button onClick={() => setDraftOpen(false)}>关闭</Button><Button disabled={!draft} onClick={() => download('Somnus-本地复核草稿.txt', draft)}>下载草稿</Button><Button type="primary" disabled={!draft} onClick={() => { try { localStorage.setItem('ya70-workbench-review-draft', draft); messages.success('已保存到本浏览器，未发送'); } catch { messages.warning('无法保存到浏览器存储；可下载草稿'); } }}>保存本地修改</Button></Space>}><Alert type="info" showIcon message="供人工复核的本地草稿" /><Input.TextArea aria-label="本地复核草稿正文" value={draft} onChange={event => setDraft(event.target.value)} rows={14} style={{ marginTop: 16 }} placeholder="尚未生成草稿。请先在合成演示模式点击“生成本地复核草稿”。" /></Modal>
    </Layout>
  </ConfigProvider>;
}
