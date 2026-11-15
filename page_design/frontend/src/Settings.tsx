import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Select, Switch } from 'antd';
import { AppstoreOutlined, ArrowRightOutlined, CodeOutlined, DatabaseOutlined, KeyOutlined, MessageOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { DataConnectionSettings } from './DataConnection';
import type { DataConnection } from './DataConnection';
import { ProjectTestSettings } from './ProjectTools';
import { AppUpdateSettings } from './AppUpdateSettings';
import './settings.css';

export type StartupPage = 'dashboard' | 'chat';
export const startupPageKey = 'vvman.startup-page';

const categories = [
  { key: 'general', title: '通用', icon: <SettingOutlined />, terms: '外观 启动页 自动刷新 大盘 版本 关于 更新' },
  { key: 'chat', title: '会话与项目', icon: <MessageOutlined />, terms: '权限 只读 修改前确认 项目 归档' },
  { key: 'agents', title: 'Agent 与工具', icon: <AppstoreOutlined />, terms: '模型 供应商 Provider MCP Skills' },
  { key: 'project-tests', title: '项目测试', icon: <CodeOutlined />, terms: '测试 预设 Git 命令 程序 来源文件夹' },
  { key: 'data', title: '数据连接', icon: <DatabaseOutlined />, terms: '网关 地址 本机 数据源' },
  { key: 'shortcuts', title: '快捷键', icon: <KeyOutlined />, terms: '搜索 命令面板 输入 帮助' },
] as const;
type Category = typeof categories[number]['key'];

export function KeyboardShortcuts({ mac }: { mac: boolean }) {
  return <ul className="shortcut-list">
    <li><kbd>{mac ? '⌘' : 'Ctrl'}</kbd> + <kbd>K</kbd><span>打开命令面板</span></li>
    <li><kbd>?</kbd><span>查看快捷键</span></li>
    <li><kbd>Enter</kbd><span>发送会话消息</span></li>
    <li><kbd>Shift</kbd> + <kbd>Enter</kbd><span>输入换行</span></li>
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
  autoRefresh: boolean;
  onAutoRefresh: (value: boolean) => void;
  dataConnection: DataConnection;
  appVersion: string;
  mac: boolean;
  onOpen: (view: string) => void;
  workspace: string;
  startup: StartupPage;
  onStartupChange: (value: StartupPage) => void;
};

export function Settings({ autoRefresh, onAutoRefresh, dataConnection, appVersion, mac, onOpen, workspace, startup, onStartupChange }: Props) {
  const [category, setCategory] = useState<Category>('general');
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = categories.filter(item => `${item.title} ${item.terms}`.toLowerCase().includes(term));
  const selected = matches.find(item => item.key === category) || matches[0];
  const link = (view: string, label = '打开') => <Button icon={<ArrowRightOutlined />} iconPosition="end" onClick={() => onOpen(view)}>{label}</Button>;

  return <div className="settings-page">
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
    <section className="settings-content" aria-labelledby="settings-category-heading">
      <h2 id="settings-category-heading">{selected?.title || '没有匹配的设置'}</h2>
      {selected?.key === 'general' && <>
        <h3 className="settings-subheading">启动</h3>
        <div className="settings-card">
          <SettingRow title="启动页" detail="从桌面打开 Somnus 时显示的页面。">
            <Select aria-label="启动页" value={startup} onChange={onStartupChange} options={[{ value: 'dashboard', label: '数据大盘' }, { value: 'chat', label: '最近会话' }]} />
          </SettingRow>
        </div>
        <h3 className="settings-subheading">显示</h3>
        <div className="settings-card">
          <SettingRow title="数据大盘自动刷新" detail="每小时刷新一次。页面隐藏时暂停。">
            <Switch aria-label="数据大盘自动刷新" checked={autoRefresh} onChange={onAutoRefresh} />
          </SettingRow>
          <SettingRow title="外观"><span>浅色</span></SettingRow>
        </div>
        <h3 className="settings-subheading">关于</h3>
        <div className="settings-card">
          <SettingRow title="Somnus"><span>{appVersion === '—' ? '—' : `v${appVersion}`}</span></SettingRow>
          <AppUpdateSettings />
        </div>
      </>}
      {selected?.key === 'chat' && <>
        <div className="settings-card">
          <SettingRow title="新会话文件权限" detail="打开会话后，可在输入框下切换为「修改前确认」。">
            <span>只读</span>
          </SettingRow>
          <SettingRow title="项目和归档" detail="在会话侧栏管理项目及已归档项目。">{link('assistant', '前往会话')}</SettingRow>
        </div>
      </>}
      {selected?.key === 'agents' && <>
        <div className="settings-card">
          <SettingRow title="Agent" detail="管理本地 ACP Agent。">{link('config')}</SettingRow>
          <SettingRow title="模型供应商" detail="管理模型连接。会话默认使用上次选择的模型。">{link('models')}</SettingRow>
          <SettingRow title="MCP">{link('mcp')}</SettingRow>
          <SettingRow title="Skills">{link('skills')}</SettingRow>
        </div>
      </>}
      {selected?.key === 'project-tests' && <ProjectTestSettings key={workspace} workspace={workspace} />}
      {selected?.key === 'data' && <DataConnectionSettings status={dataConnection} />}
      {selected?.key === 'shortcuts' && <div className="settings-card settings-shortcuts"><KeyboardShortcuts mac={mac} /></div>}
    </section>
  </div>;
}
