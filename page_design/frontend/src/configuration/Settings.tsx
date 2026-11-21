import { composerShortcutLabels } from '../chat/composerShortcuts.mjs';
import { useUiPreferences } from './uiPreferences';
import { RuntimeSettings } from '../runtime/RuntimeSettings';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Input, Select, Switch } from 'antd';
import { ArrowRightOutlined, CodeOutlined, DatabaseOutlined, InfoCircleOutlined, KeyOutlined, MessageOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { DataConnectionSettings } from './DataConnection';
import type { DataConnection } from './DataConnection';
import { ProjectTestSettings } from '../analysis/ProjectTools';
import './settings.css';

export type StartupPage = 'dashboard' | 'chat';
export const startupPageKey = 'vvman.startup-page';

const categories = [
  { key: 'general', title: '通用', icon: <SettingOutlined />, terms: '外观 启动页 自动刷新 大盘' },
  { key: 'chat', title: '会话与项目', icon: <MessageOutlined />, terms: '权限 只读 修改前确认 项目 归档' },
  { key: 'runtime', title: '任务与诊断', icon: <CodeOutlined />, terms: '长任务 超时 中断 心跳 诊断 日志' },
  { key: 'integrations', title: '模型与扩展', icon: <SettingOutlined />, terms: 'Agent Provider 模型 插件 MCP Skill IM 机器人' },
  { key: 'project-tests', title: '项目测试', icon: <CodeOutlined />, terms: '测试 预设 Git 命令 程序 来源文件夹' },
  { key: 'data', title: '数据连接', icon: <DatabaseOutlined />, terms: '网关 地址 本机 数据源' },
  { key: 'shortcuts', title: '快捷键', icon: <KeyOutlined />, terms: '搜索 命令面板 输入 帮助' },
  { key: 'about', title: '关于', icon: <InfoCircleOutlined />, terms: 'Somnus 版本 关于' },
] as const;
export type SettingsCategory = typeof categories[number]['key'];

const settingsSelector = {
  variant: 'filled', placement: 'bottomRight', popupMatchSelectWidth: false,
  classNames: { popup: { root: 'settings-selector-menu' } },
} as const;

export function KeyboardShortcuts({ mac }: { mac: boolean }) {
  const [preferences]=useUiPreferences();
  const shortcuts=composerShortcutLabels(preferences.sendKey,mac);
  return <ul className="shortcut-list">
    <li><kbd>{mac ? '⌘' : 'Ctrl'}</kbd> + <kbd>K</kbd><span>打开命令面板</span></li>
    <li><kbd>?</kbd><span>查看快捷键</span></li>
    <li><kbd>{shortcuts.send}</kbd><span>发送会话消息</span></li>
    <li><kbd>{shortcuts.newline}</kbd><span>输入换行</span></li>
    <li><kbd>{shortcuts.alternate}</kbd><span>生成时，在排队与追加指导之间切换本次操作（仅支持追加指导的任务）</span></li>
    <li><kbd>{shortcuts.steerQueue}</kbd><span>输入框为空时，追加全部排队消息（仅 Somnus 原生任务）</span></li>
    <li><kbd>Esc</kbd><span>关闭弹窗或图片预览</span></li>
  </ul>;
}

function SettingRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <div className="settings-row">
    <div><h3>{title}</h3>{detail && <p>{detail}</p>}</div>
    <div className="settings-row-action">{children}</div>
  </div>;
}

type Props = {
  appearanceError?:string;
  autoRefresh: boolean;
  onAutoRefresh: (value: boolean) => void;
  dataConnection: DataConnection;
  appVersion: string;
  mac: boolean;
  onOpen: (view: string) => void;
  workspace: string;
  startup: StartupPage;
  onStartupChange: (value: StartupPage) => void;
  expandRunningActivity?: boolean;
  onExpandRunningActivity?: (value: boolean) => void;
  workspaceLinks?: boolean;
  onWorkspaceLinks?: (value: boolean) => void;
  busySendMode?: 'queue' | 'steer';
  onBusySendMode?: (value: 'queue' | 'steer') => void;
  initialCategory?: SettingsCategory;
  embedded?: boolean;
};

export function Settings({ autoRefresh, onAutoRefresh, dataConnection, appVersion, mac, onOpen, workspace, startup, onStartupChange,
  appearanceError, initialCategory = 'general', embedded = false, expandRunningActivity = false, onExpandRunningActivity,
  workspaceLinks = false, onWorkspaceLinks, busySendMode = 'queue', onBusySendMode }: Props) {
  const [preferences, updatePreferences, preferenceState] = useUiPreferences();
  const shortcuts=composerShortcutLabels(preferences.sendKey,mac);
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  useEffect(() => setCategory(initialCategory), [initialCategory]);
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = categories.filter(item => `${item.title} ${item.terms}`.toLowerCase().includes(term));
  const selected = matches.find(item => item.key === category) || matches[0];
  const link = (view: string, label = '打开') => <Button icon={<ArrowRightOutlined />} iconPosition="end" onClick={() => onOpen(view)}>{label}</Button>;

  return <div className={embedded ? 'settings-page settings-page-embedded' : 'settings-page'}>
    <aside className="settings-sidebar">
      <h1>设置</h1>
      <Input aria-label="搜索设置" placeholder="搜索设置" prefix={<SearchOutlined />} value={query}
        allowClear onChange={event => setQuery(event.target.value)} />
      <nav aria-label="设置分类">
        {matches.map(item => <button type="button" key={item.key} onClick={() => setCategory(item.key)}
          aria-current={selected?.key === item.key ? 'page' : undefined}>
          {item.icon}<span>{item.title}</span>
        </button>)}
      </nav>
    </aside>
    <section className="settings-content" tabIndex={embedded ? 0 : undefined} aria-labelledby="settings-category-heading">
      {appearanceError && <Alert type="warning" showIcon message={appearanceError} />}
      {preferenceState.error && <Alert type="warning" showIcon message={preferenceState.error} />}
      <h2 id="settings-category-heading">{selected?.title || '没有匹配的设置'}</h2>
      {selected?.key === 'general' && <>
        <h3 className="settings-subheading">启动</h3>
        <div className="settings-card">
          <SettingRow title="启动页" detail="从桌面打开 Somnus 时显示的页面。">
            <Select {...settingsSelector} aria-label="启动页" value={startup} onChange={onStartupChange} options={[{ value: 'dashboard', label: '主页' }, { value: 'chat', label: '最近会话' }]} />
          </SettingRow>
        </div>
        <h3 className="settings-subheading">显示</h3>
        <div className="settings-card">
          <SettingRow title="主页自动刷新" detail="每小时刷新一次。页面隐藏时暂停。">
            <Switch aria-label="主页自动刷新" checked={autoRefresh} onChange={onAutoRefresh} />
          </SettingRow>
          <SettingRow title="外观"><Select {...settingsSelector} aria-label="外观" value={preferences.theme} onChange={theme => updatePreferences({ theme })} options={[{value:'light',label:'浅色'},{value:'dark',label:'深色'},{value:'system',label:'跟随系统'}]} /></SettingRow>
          <SettingRow title="聊天字号"><Select {...settingsSelector} aria-label="聊天字号" value={preferences.chatFontSize} onChange={chatFontSize => updatePreferences({ chatFontSize })} options={[13,14,15,16,18].map(value => ({value,label:value+' px'}))} /></SettingRow>
        </div>
      </>}
      {selected?.key === 'about' && <>
        <div className="settings-card">
          <SettingRow title="Somnus"><span>{appVersion === '—' ? '—' : `v${appVersion}`}</span></SettingRow>
        </div>
      </>}
      {selected?.key === 'chat' && <>
        <div className="settings-card">
          <SettingRow title="新会话文件权限" detail="仅用于之后创建的会话；既有会话与每次审批保持原权限。">
            <Select {...settingsSelector} aria-label="新会话文件权限" value={preferences.defaultPermission} onChange={defaultPermission => updatePreferences({defaultPermission})} options={[{value:'read_only',label:'只读'},{value:'workspace_write',label:'修改前确认'},{value:'workspace_direct',label:'工作区直接修改'},{value:'full',label:'完全访问'}]} />
          </SettingRow>
          {onExpandRunningActivity && <SettingRow title="自动展开执行过程" detail="从下一条回复开始生效。">
            <Switch aria-label="自动展开执行过程" checked={expandRunningActivity} onChange={onExpandRunningActivity} />
          </SettingRow>}
          {onWorkspaceLinks && <SettingRow title="会话链接打开位置">
            <Select {...settingsSelector} aria-label="会话链接打开位置" value={workspaceLinks ? 'workspace' : 'browser'} onChange={value => onWorkspaceLinks(value === 'workspace')}
              options={[{ value: 'browser', label: '系统浏览器' }, { value: 'workspace', label: '会话工作区' }]} />
          </SettingRow>}
          {onBusySendMode && <SettingRow title="生成时发送消息" detail={'支持追加指导的任务可用 '+shortcuts.alternate+' 切换本次的排队/追加指导操作。输入为空时用 '+shortcuts.steerQueue+' 追加整队纯文字消息。附件和扩展随排队消息发送。'}>
            <Select {...settingsSelector} aria-label="生成时发送消息" value={busySendMode} onChange={onBusySendMode}
              options={[{ value: 'queue', label: '排队等当前回复完成' }, { value: 'steer', label: '向当前任务追加指导' }]} />
          </SettingRow>}
          <SettingRow title="发送快捷键"><Select {...settingsSelector} aria-label="发送快捷键" value={preferences.sendKey} onChange={sendKey => updatePreferences({sendKey})} options={[{value:'enter',label:'Enter 发送'},{value:'mod-enter',label:mac?'⌘ Enter 发送':'Ctrl Enter 发送'}]} /></SettingRow>
          <SettingRow title="执行过程详细程度"><Select {...settingsSelector} aria-label="执行过程详细程度" value={preferences.detail} onChange={detail => updatePreferences({detail})} options={[{value:'full',label:'全部步骤'},{value:'compact',label:'当前步骤与结果'}]} /></SettingRow>
          <SettingRow title="执行过程收起时机"><Select {...settingsSelector} aria-label="执行过程收起时机" value={preferences.collapse} onChange={collapse => updatePreferences({collapse})} options={[{value:'never',label:'保留我的展开状态'},{value:'finished',label:'任务结束后收起'}]} /></SettingRow>
          <SettingRow title="收起时的回复"><Select {...settingsSelector} aria-label="收起时的回复" value={preferences.collapsedReply} onChange={collapsedReply => updatePreferences({collapsedReply})} options={[{value:'full',label:'显示完整回复'},{value:'preview',label:'回复显示预览，可展开'}]} /></SettingRow>
          <SettingRow title="项目和归档" detail="在会话侧栏管理项目及已归档项目。">{link('assistant', '前往会话')}</SettingRow>
        </div>
      </>}
      {selected?.key === 'runtime' && <RuntimeSettings />}
      {selected?.key === 'integrations' && <div className="settings-card">
        <SettingRow title="Agent" detail="配置 Somnus 与外接 Agent。">{link('config','管理 Agent')}</SettingRow>
        <SettingRow title="模型供应商" detail="API、认证、模型能力与重试。">{link('models','管理 Provider')}</SettingRow>
        {window.somnusDshPluginPage && <SettingRow title="IM 机器人" detail="与侧栏共用同一个插件与配置。"><Button onClick={()=>window.dispatchEvent(new CustomEvent('somnus:open-plugin-settings',{detail:{pluginId:'@xmanrui/dsh-im'}}))}>配置机器人</Button></SettingRow>}
        <SettingRow title="插件、MCP 与 Skill">{link('plugin-config','管理扩展')}</SettingRow>
      </div>}
      {selected?.key === 'project-tests'  && <ProjectTestSettings key={workspace} workspace={workspace} />}
      {selected?.key === 'data' && <DataConnectionSettings status={dataConnection} />}
      {selected?.key === 'shortcuts' && <div className="settings-card settings-shortcuts"><KeyboardShortcuts mac={mac} /></div>}
    </section>
  </div>;
}
