
import { useEffect, useState } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import { describeError } from './errors.mjs';

export type ManagedDshAccountStatus = {
  state: 'signed-out' | 'signed-in' | 'pending' | 'failed' | 'unavailable';
  version?: string;
  message?: string;
};

const accountLabels: Record<ManagedDshAccountStatus['state'], string> = {
  'signed-out': '未登录',
  'signed-in': '账号已登录',
  pending: '等待浏览器授权',
  failed: '登录未完成',
  unavailable: '此运行时暂未提供账号登录',
};

export function ManagedDshAccount({ connected, disabled }: { connected: boolean; disabled: boolean }) {
  const bridge = window.vvmanAcp;
  const [status, setStatus] = useState<ManagedDshAccountStatus>();
  const [busy, setBusy] = useState<'check' | 'login'>();
  const [error, setError] = useState('');
  const check = bridge?.managedDshAccountStatus;
  const signIn = bridge?.signInManagedDshAccount;
  const pending = status?.state === 'pending';
  const signedIn = status?.state === 'signed-in';

  useEffect(() => {
    if (!check || busy) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const next = await check();
        if (!active) return;
        setStatus(next);
        setError('');
        if (next.state === 'pending') timer = window.setTimeout(() => void refresh(), 2500);
      } catch (failure) {
        if (active) setError(describeError(failure, '无法读取 DeepSeek 账号状态'));
      }
    };
    if (!status) void refresh();
    else if (pending) timer = window.setTimeout(() => void refresh(), 2500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [check, busy, pending]);

  async function perform(operation: 'check' | 'login') {
    const action = operation === 'check' ? check : signIn;
    if (!action || busy || disabled) return;
    setBusy(operation);
    setError('');
    try { setStatus(await action()); }
    catch (failure) { setError(describeError(failure, operation === 'check' ? '无法读取 DeepSeek 账号状态' : '无法启动 DeepSeek 登录')); }
    finally { setBusy(undefined); }
  }

  return <section className="configuration-agent-account" aria-label="DeepSeek 账号">
    <h3>DeepSeek 账号</h3>
    <div role="status">
      <Tag color={signedIn ? 'success' : pending ? 'processing' : undefined}>
        {status ? accountLabels[status.state] : check && !error ? '检查账号状态…' : '账号状态待检查'}
      </Tag>
      {status?.version && <small>DSH {status.version}</small>}
    </div>
    {pending && <p>请在浏览器中完成授权，随后返回 Somnus。</p>}
    {status?.message && !pending && <p>{status.message}</p>}
    {signedIn && <p>{connected ? '可在下方验证 ACP 会话。' : '连接运行时后，可在聊天框的模型菜单选择官方 DSH。'}</p>}
    <Space wrap>
      {signIn && !signedIn && status && status.state !== 'unavailable' &&
        <Button type="primary" disabled={disabled || Boolean(busy) || pending} loading={busy === 'login'}
          onClick={() => void perform('login')}>登录 DeepSeek</Button>}
      {check && <Button disabled={disabled || Boolean(busy)} loading={busy === 'check'}
        onClick={() => void perform('check')}>刷新账号状态</Button>}
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
  </section>;
}

