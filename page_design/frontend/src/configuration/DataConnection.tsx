import { nativeFetch } from '../shared/nativeFetch.mjs';
import { useEffect, useState } from 'react';
import { Alert, Card, Descriptions, Tag } from 'antd';

type ConnectionStatus = { mode: 'local' | 'remote' | 'invalid'; url: string | null };
export type DataConnection = ConnectionStatus | { mode: 'loading' | 'unavailable'; url: null };

export function useDataConnection(): DataConnection {
  const [status, setStatus] = useState<DataConnection>({ mode: 'loading', url: null });
  useEffect(() => {
    const controller = new AbortController();
    nativeFetch('/api/remote-data/status', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('读取连接设置失败');
        const result = await response.json() as ConnectionStatus;
        if (!['local', 'remote', 'invalid'].includes(result.mode) ||
            (result.url !== null && typeof result.url !== 'string')) {
          throw new Error('连接设置格式不正确');
        }
        if (!controller.signal.aborted) setStatus(result);
      })
      .catch(() => { if (!controller.signal.aborted) setStatus({ mode: 'unavailable', url: null }); });
    return () => controller.abort();
  }, []);
  return status;
}

export function dataConnectionLabel(status: DataConnection) {
  switch (status.mode) {
    case 'local': return '本机直连 · 只读';
    case 'remote': return '远程网关 · 只读';
    case 'invalid': return '远程配置有误';
    case 'loading': return '读取连接设置…';
    case 'unavailable': return '连接设置状态未知';
  }
}

export function DataConnectionSettings({ status }: { status: DataConnection }) {
  return <Card className="panel-card" title="数据连接">
    {status.mode === 'invalid' && <Alert type="error" showIcon
      message="远程网关配置有误" description="请核对桌面程序的网关地址和令牌，保存后重新启动。" />}
    <Descriptions column={1} size="small" items={[
      { key: 'mode', label: '连接方式', children: <Tag>{dataConnectionLabel(status)}</Tag> },
      ...(status.url ? [{ key: 'url', label: '网关地址', children: status.url }] : []),
      { key: 'scope', label: '适用功能', children: '主页、数据查询和已获准的深度分析。CSV 波形分析仍由本机处理。' },
    ]} />
    {status.mode === 'remote' && <p className="small-note">使用远程网关时，网关可记录访问账号、客户端版本与最近连接时间。</p>}
    <p className="small-note">
      使用远程网关时，请将管理员提供的 HTTPS 地址和令牌分别填入桌面程序
      <code> .env </code>中的 <code>DATA_AGENT_REMOTE_URL</code> 和 <code>DATA_AGENT_REMOTE_TOKEN</code>，然后重新启动。
    </p>
  </Card>;
}
