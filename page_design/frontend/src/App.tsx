import { SidebarResizeHandle, useSidebarLayout } from './SidebarResize';
import { SomnusMark } from './SomnusMark';
import { ConfigurationCenter, configurationSections } from './ConfigurationCenter';
import { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, ConfigProvider, Empty, Layout, Modal, Select, Space, Spin, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AppstoreOutlined, ArrowLeftOutlined, ArrowRightOutlined, BellOutlined, MenuFoldOutlined, MenuUnfoldOutlined, HomeOutlined, MessageOutlined, FileTextOutlined, SearchOutlined, RobotOutlined, ReloadOutlined, SettingOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { HomeDashboard } from './HomeDashboard';
import { filterUsers, formatNumber } from './logic.mjs';
import { useWorkbench } from './useWorkbench';
import { UserDrawer } from './UserDrawer';
import { KeyboardShortcuts, Settings, startupPageKey } from './Settings';
import type { StartupPage } from './Settings';
import { AIAssistant } from './AIAssistant';
import { DocumentLibrary } from './DocumentLibrary';
import { AnalysisView } from './AnalysisView';
import { DeepAnalysis } from './DeepAnalysis';
import { SqlQuery } from './SqlQuery';
import { dataConnectionLabel, useDataConnection } from './DataConnection';
import { Plugins } from './Plugins';
import { useWorkspacePlugins, type WorkspaceTool } from './workspacePlugins';
import { WorkspaceSwitch } from './WorkspaceSwitch';
import { CommandPanel } from './GlassExperience';
import './glass.css';
import './codex.css';
import './workspace-layout.css';
import { readProjectLaunch, readWorkspaceView, isStandardView, workspacePath, recordWorkspaceVisit } from './workspaceNavigation.mjs';
import { activeRailView, labelOf, workspaceRail } from './navigation.mjs';
import type { Source, UserRow } from './types';

const { Header, Sider, Content } = Layout;
const stateLabels = { therapy: '治疗中', online: '在线', offline: '离线' };
const priorityLabels = { high: '高', medium: '中', low: '低' };
const autoRefreshKey = 'vvman.dashboard-auto-refresh';
const dataViews = [
  { key: 'dashboard', label: '主页' },
  { key: 'users', label: '用户目录' },
  { key: 'devices', label: '设备目录' },
  { key: 'alerts', label: '告警中心' },
];

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
    chat: <MessageOutlined />, dashboard: <HomeOutlined />, robot: <RobotOutlined />,
    documents: <FileTextOutlined />, plugin: <AppstoreOutlined />,
  };
  const activeSection = activeRailView(view);
  const workspacePlugins = useWorkspacePlugins();
  const [appVersion, setAppVersion] = useState('—'), [helpOpen, setHelpOpen] = useState(false);
  const [newChatSignal, setNewChatSignal] = useState(0);
  const [sidebarSessions, setSidebarSessions] = useState<HTMLDivElement | null>(null);
  const [chatLocked, setChatLocked] = useState(false);
  const sidebar = useSidebarLayout();
  const compactNav = sidebar.compact;
  const chatView = view === 'assistant';
  const configurationView = configurationSections.some(section => section.key === view);
  const expandedSidebar = !compactNav;
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
  const [workspace, setWorkspace] = useState(() => {
    const launched = readProjectLaunch(window.location);
    if (launched) return launched;
    try { return localStorage.getItem('ya70.workspace') || 'default'; } catch { return 'default'; }
  });
  useEffect(() => { document.title = `Somnus · ${labelOf(view)}`; }, [view]);
  useEffect(() => { fetch('/api/health', { cache: 'no-store' }).then(response => response.json()).then(data => { if (data?.app_version) setAppVersion(data.app_version); }).catch(() => {}); }, []);
  useEffect(() => { const onHelp = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; const typing = target ? ['INPUT', 'TEXTAREA'].includes(target.tagName) : false; if (event.key === '?' && !typing) { event.preventDefault(); setHelpOpen(value => !value); } else if (event.key === 'Escape') setHelpOpen(false); }; window.addEventListener('keydown', onHelp); return () => window.removeEventListener('keydown', onHelp); }, []);
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
  function openTool(tool: WorkspaceTool) {
    if (tool.href) window.location.assign(tool.href);
    else changeView(tool.key);
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
    function openLaunchedProject() {
      const id = readProjectLaunch(window.location);
      if (!desktopPlatform || chatLocked || !id) return;
      setWorkspace(id);
      try { localStorage.setItem('ya70.workspace', id); } catch { /* optional preference */ }
      window.history.replaceState(window.history.state, '', workspacePath('assistant', window.location.href));
      window.dispatchEvent(new Event('somnus:projects-changed'));
    }
    openLaunchedProject();
    window.addEventListener('hashchange', openLaunchedProject);
    return () => window.removeEventListener('hashchange', openLaunchedProject);
  }, [desktopPlatform, chatLocked]);
  useEffect(() => {
    const openCommand = () => setCommandOpen(true);
    window.addEventListener('workbench:open-command', openCommand);
    return () => window.removeEventListener('workbench:open-command', openCommand);
  }, []);
  // useWorkbench keys each response to its requested source and device.
  const { data, error, loading, visible, reload } = useWorkbench(source, model, auto);
  const demo = Boolean(data?.source.mode === 'demo');
  const [deviceOptions, setDeviceOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (data?.model_options?.length) setDeviceOptions(data.model_options);
  }, [data?.model_options]);
  useEffect(() => { setSelected(null); }, [source, model]);
  const titles: Record<string, string> = { dashboard: '主页', devices: '设备目录', users: '用户目录', alerts: '告警中心' };
  const modelOptions = [{ value: 'all', label: '全部设备型号' }, ...deviceOptions];
  const deviceColumns = [{ title: '设备标识', dataIndex: 'device_id' }, { title: '型号', dataIndex: 'model' }, { title: '固件', dataIndex: 'firmware', render: (value: string) => value || '—' }, { title: demo ? '示例用户' : '用户', dataIndex: 'name' }, { title: '状态', dataIndex: 'state', render: (value: UserRow['state']) => stateLabels[value] || '—' }];
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176D61', colorSuccess: '#00a887', borderRadius: 8, fontSize: 13, colorBgLayout: '#F5F8F7', colorText: '#202A28', colorTextSecondary: '#526762', fontFamily: 'Inter, Microsoft YaHei, PingFang SC, sans-serif' }, components: { Card: { headerHeight: 49 }, Table: { headerBg: '#f8fafc' }, Menu: { itemHeight: 44 } } }}>
    <Layout className="workbench codex-theme" data-desktop-platform={desktopPlatform}>
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
            <button type="button" aria-current={activeSection === 'dashboard' ? 'page' : undefined} onClick={() => changeView('dashboard')}><HomeOutlined aria-hidden="true" />主页</button>
            <button type="button" aria-current={view === 'documents' ? 'page' : undefined} onClick={() => changeView('documents')}><FileTextOutlined aria-hidden="true" />文档</button>
            <button type="button" aria-current={activeSection === 'plugins' ? 'page' : undefined} onClick={() => changeView('plugins')}><AppstoreOutlined aria-hidden="true" />工具</button>
            <button type="button" aria-current={configurationView ? 'page' : undefined} onClick={() => changeView('config')}>
              <SettingOutlined aria-hidden="true" />配置中心
            </button>
          </nav>
          {chatView ? <WorkspaceSwitch value={workspace} onChange={setWorkspace} disabled={chatLocked} compact={false}>
            <div className="nav-session-slot" ref={setSidebarSessions} />
          </WorkspaceSwitch> : (activeSection === 'dashboard' || activeSection === 'plugins') &&
            <nav className="workspace-sidebar-links workspace-sidebar-configuration" aria-label={activeSection === 'dashboard' ? '主页分类' : '工具分类'}>
              <h2>{activeSection === 'dashboard' ? '数据目录' : '工具'}</h2>
              {activeSection === 'dashboard' ? dataViews.slice(1).map(({ key, label }) =>
                <button type="button" key={key} aria-current={view === key ? 'page' : undefined} onClick={() => changeView(key)}>{label}</button>
              ) : workspacePlugins.tools.filter(tool => tool.sidebar).map(tool =>
                <button type="button" key={tool.key} aria-current={view === tool.key ? 'page' : undefined} onClick={() => openTool(tool)}>{tool.label}</button>
              )}
            </nav>}
          <div className="workspace-sidebar-footer">
            <button type="button" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => changeView('settings')}><SettingOutlined aria-hidden="true" />设置</button>
          </div>
        </div>}
        {expandedSidebar && !sidebarHidden && <SidebarResizeHandle width={sidebar.width} max={sidebar.max}
          onPreview={sidebar.preview} onCommit={sidebar.commit} onCancel={sidebar.cancel} />}
      </Sider>
      <Content className="workspace-content">
      <div className={`workspace-panel standard-workspace-panel ${standardView === 'dashboard' ? 'home-workspace-panel' : ''}`} hidden={!isStandardView(view)}>
        <nav className="data-page-nav" aria-label="数据视图" hidden={expandedSidebar && !sidebarHidden && activeSection === 'dashboard'}>
          {dataViews.map(item => <button key={item.key} type="button" aria-current={standardView === item.key ? 'page' : undefined}
            onClick={() => changeView(item.key)}>{item.label}</button>)}
        </nav>
        <div className="page-toolbar">
          <Typography.Title level={3}>{titles[standardView]}</Typography.Title>
          <div className="toolbar-controls">
            <Select aria-label="筛选设备型号" value={model} onChange={setModel} options={modelOptions} />
            <Button icon={<ReloadOutlined spin={loading} />} onClick={() => void reload()}>刷新</Button>
          </div>
        </div>
        <div className="source-banner">
          <div><Tag color={dataConnection.mode === 'invalid' ? 'error' : 'default'}>{dataConnectionLabel(dataConnection)}</Tag>
            {standardView === 'dashboard' && <span>AHI 来源：设备上报</span>}</div>
          <Space><span className="refresh-state">{!visible ? '页面隐藏 · 已暂停刷新' : auto ? '每小时自动刷新' : '自动刷新已暂停'}</span>
            <Switch size="small" checked={auto} onChange={changeAutoRefresh} aria-label="主页自动刷新" /></Space>
        </div>
        <div className="snapshot-line">
          {data ? <><span>昨日统计 {data.period.kpi_date} · 更新于 {data.generated_at.slice(11, 16)}</span>
            <span>{data.period.start_date} — {data.period.end_date} · {data.period.time_zone}</span></> : <span>{loading ? '正在读取数据…' : '暂无数据快照'}</span>}
        </div>
        {error && <Alert className="data-error" type="error" showIcon message="工作台数据读取失败" description={error}
          action={<Button onClick={() => void reload()}>重试</Button>} />}
        {source === 'live' && !loading && !error && !data?.source?.connected && <Alert className="data-error" type="info" showIcon
          message="数据源尚未连接" action={<Button onClick={() => changeView('settings')}>打开设置</Button>} />}
      <div className="content-with-insights without-insights"><main className="dashboard-main" aria-busy={loading}>
        {standardView === 'dashboard' || !titles[standardView] ? <HomeDashboard data={data} loading={loading} /> : standardView === 'users' ? <Card className="panel-card" title={demo ? "示例用户" : "用户列表"}><UserTable users={data?.users || []} connected={demo} onUser={setSelected} full /></Card> : standardView === 'devices' ? <Card className="panel-card" title={demo ? "示例设备" : "设备列表"}><Table rowKey="device_id" columns={deviceColumns} dataSource={data?.users || []} size="middle" pagination={{ pageSize: 10 }} scroll={{ x: 650 }} locale={{ emptyText: '未取得设备数据' }} /></Card> : standardView === 'alerts' ? <Card className="panel-card" title={demo ? "演示告警" : "工程告警"}><Table rowKey="id" size="small" dataSource={data?.alerts || []} pagination={{ pageSize: 8 }} columns={[{ title: '级别', dataIndex: 'severity', render: (value: string) => <Tag color={value === 'critical' ? 'error' : value === 'warning' ? 'warning' : 'default'}>{value === 'critical' ? '严重工程告警' : value === 'warning' ? '工程提示' : '信息'}</Tag> }, { title: '设备', dataIndex: 'device_id' }, { title: '事项', dataIndex: 'title' }, { title: '说明', dataIndex: 'description' }, { title: '时间', dataIndex: 'at' }]} scroll={{ x: 750 }} /></Card> : null}
        {loading && !data && <div className="initial-loading"><Spin size="small" /> 正在读取数据…</div>}
      </main></div>
      </div><div className="workspace-panel assistant-workspace-panel" hidden={view !== 'assistant'}>
        <AIAssistant windowsDesktop={desktopPlatform === 'windows'} allowLocalAnalysisUpload={dataConnection.mode === 'local'} onModelConfig={() => changeView('models')} workspace={workspace} visible={view === 'assistant'} sidebar={sidebarSessions}
          newChatSignal={newChatSignal} onLockedChange={setChatLocked} onOpenChat={() => changeView('assistant')}
          onOpenDshPlugin={id => { setSuggestedPlugin(id); changeView('plugin-config'); }} />
      </div>{view === 'documents' && <div className="workspace-panel"><DocumentLibrary /></div>}{view === 'settings' && <div className="workspace-panel settings-workspace-panel"><Settings workspace={workspace} startup={startup} onStartupChange={changeStartup} autoRefresh={auto} onAutoRefresh={changeAutoRefresh} dataConnection={dataConnection} appVersion={appVersion} mac={mac} onOpen={changeView} /></div>}{view === 'sql' && <div className="workspace-panel assistant-workspace-panel"><SqlQuery dataConnection={dataConnection} /></div>}{configurationView && <div className="workspace-panel configuration-workspace-panel"><ConfigurationCenter view={view} suggestedPlugin={suggestedPlugin} onOpen={changeView} windowsDesktop={desktopPlatform === 'windows'} /></div>}
      {view === 'plugins' && <div className="workspace-panel plugins-workspace-panel">
        {workspacePlugins.status === 'error' && <Alert type="warning" message="插件入口读取失败" action={<Button size="small" onClick={workspacePlugins.retry}>重试</Button>} />}
        <Plugins tools={workspacePlugins.tools} onOpen={openTool} />
      </div>}
      {view === 'deep-analysis' && <div className="workspace-panel deep-analysis-workspace-panel"><DeepAnalysis dataConnection={dataConnection} /></div>}
      {analysisMounted && <div className="workspace-panel analysis-workspace-panel" hidden={view !== 'analysis'}>
        {workspacePlugins.analysisPath ? <AnalysisView active={view === 'analysis'} path={workspacePlugins.analysisPath} /> :
          workspacePlugins.status === 'loading' ? <Spin aria-label="读取波形分析入口" /> :
            <Alert type="warning" message={workspacePlugins.status === 'error' ? '插件入口读取失败' : '波形分析入口暂不可用'}
              action={<Button size="small" onClick={workspacePlugins.retry}>重试</Button>} />}
      </div>}
      </Content></Layout>
      <CommandPanel open={commandOpen} onClose={()=>setCommandOpen(false)} onNavigate={changeView}/>
      <Modal title="快捷键与说明" open={helpOpen} onCancel={() => setHelpOpen(false)} footer={null} width={460}>
        <KeyboardShortcuts mac={mac} />
      </Modal>
      <UserDrawer user={selected} source={source} onClose={() => setSelected(null)} onAnalyze={() => changeView('analysis')} />
    </Layout>
  </ConfigProvider>;
}
