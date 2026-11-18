import { useState } from 'react';
import { Alert, Button, Dropdown, Modal } from 'antd';
import { AppstoreOutlined, FileTextOutlined, FolderOpenOutlined, InfoCircleOutlined, KeyOutlined, LogoutOutlined,
  MenuOutlined, ReloadOutlined, SafetyOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { describeError } from './errors.mjs';

type DesktopAction = 'open-project' | 'profiles' | 'recovery' | 'open-logs' | 'reload' | 'restart' | 'quit';
declare global {
  interface Window { somnusDesktop?: {
    run(action: DesktopAction): Promise<boolean>;
    teamwork?(conversationId?: string): Promise<{ available: boolean; enabled: boolean }>;
    setTeamwork?(conversationId: string, enabled: boolean): Promise<{ available: boolean; enabled: boolean }>;
  } }
}

const systemActions = [
  { key: 'open-project', label: '打开项目文件夹…', icon: <FolderOpenOutlined /> },
  { key: 'profiles', label: '管理配置…', icon: <AppstoreOutlined /> },
  { key: 'recovery', label: '配置恢复…', icon: <SafetyOutlined /> },
  { key: 'open-logs', label: '打开日志目录', icon: <FileTextOutlined /> },
  { key: 'reload', label: '重新加载窗口', icon: <ReloadOutlined /> },
  { key: 'restart', label: '重启 Somnus…', icon: <SyncOutlined /> },
  { key: 'quit', label: '退出 Somnus…', icon: <LogoutOutlined /> },
] as const;

export function DesktopAppMenu({ onSettings, onAbout, onShortcuts }: {
  onSettings: () => void; onAbout: () => void; onShortcuts: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bridge = window.somnusDesktop;
  async function dispatch(key: string) {
    if (key === 'settings') { onSettings(); return; }
    if (key === 'shortcuts') { onShortcuts(); return; }
    if (key === 'about') { onAbout(); return; }
    const selected = systemActions.find(item => item.key === key);
    if (!bridge || !selected || busy) return;
    setBusy(true);
    try { await bridge.run(selected.key); }
    catch (failure) { setError(describeError(failure, '无法完成桌面操作')); }
    finally { setBusy(false); }
  }
  return <>
    <Dropdown placement="bottomLeft" trigger={['click']} menu={{ items: [
      { key: 'settings', label: '设置', icon: <SettingOutlined /> },
      { key: 'shortcuts', label: '快捷键', icon: <KeyOutlined /> },
      { key: 'about', label: '关于 Somnus', icon: <InfoCircleOutlined /> },
      ...(bridge ? [{ type: 'divider' as const }, ...systemActions.map(item => ({ ...item, disabled: busy }))] : []),
    ], onClick: ({ key }) => void dispatch(key) }}>
      <Button type="text" className="desktop-app-menu-trigger" icon={<MenuOutlined />} title="Somnus 应用菜单"
        aria-label="Somnus 应用菜单" aria-haspopup="menu" />
    </Dropdown>
    {error && <Modal open title="桌面操作失败" footer={<Button onClick={() => setError('')}>关闭</Button>} onCancel={() => setError('')}>
      <Alert showIcon type="error" message={error} />
    </Modal>}
  </>;
}
