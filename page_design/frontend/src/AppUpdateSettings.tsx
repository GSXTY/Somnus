import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Progress } from 'antd';
import { describeError } from './errors.mjs';

type UpdateState = {
  phase: 'unconfigured' | 'unsupported' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'error' | 'no-release' | 'manual';
  currentVersion: string;
  version?: string;
  percent?: number;
  error?: string;
  url?: string;
};
type UpdateAction = 'check' | 'download' | 'install';
type Updater = {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  subscribe(callback: (state: UpdateState) => void): () => void;
};

function updaterBridge() {
  const bridge = (window as Window & { somnusUpdater?: Partial<Updater> }).somnusUpdater;
  return bridge?.getState && bridge.check && bridge.download && bridge.install && bridge.subscribe ? bridge as Updater : undefined;
}

const actionLabels: Record<UpdateAction, string> = {
  check: '检查更新', download: '下载更新', install: '重启并更新',
};

function statusText(state: UpdateState) {
  const version = state.version ? ` v${state.version}` : '';
  switch (state.phase) {
    case 'unconfigured': return '本机尚未配置更新渠道。';
    case 'unsupported': return '此运行方式暂不支持应用内更新。';
    case 'checking': return '正在检查更新…';
    case 'current': return '已是最新版本。';
    case 'available': return `有新版本${version}可下载。`;
    case 'downloading': return `正在下载${version}…`;
    case 'downloaded': return `新版本${version}已下载。点击「重启并更新」安装。`;
    case 'no-release': return 'GitHub 暂无可用版本。';
    case 'manual': return `新版本${version}可以手动下载。`;
    case 'idle': return '检查是否有新版本。';
    case 'error': return '更新未完成。';
  }
}

export function AppUpdateSettings() {
  const bridge = updaterBridge();
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<UpdateAction>();
  const revision = useRef(0);
  const active = useRef(false);
  const pending = useRef<UpdateAction>();

  useEffect(() => {
    if (!bridge) return;
    active.current = true;
    const snapshot = revision.current;
    const unsubscribe = bridge.subscribe(next => {
      if (!active.current) return;
      revision.current++;
      setState(next);
      setError('');
    });
    void bridge.getState().then(next => {
      if (active.current && revision.current === snapshot) setState(next);
    }).catch(cause => {
      if (active.current && revision.current === snapshot) setError(describeError(cause, '无法读取更新状态。'));
    });
    return () => {
      active.current = false;
      revision.current++;
      unsubscribe();
    };
  }, [bridge]);

  async function run(action: UpdateAction) {
    if (!bridge || pending.current) return;
    pending.current = action;
    setBusy(action);
    setError('');
    const snapshot = revision.current;
    try {
      const next = await bridge[action]();
      if (active.current && revision.current === snapshot) setState(next);
    } catch (cause) {
      if (active.current) setError(describeError(cause, `${actionLabels[action]}未完成。`));
    } finally {
      pending.current = undefined;
      if (active.current) setBusy(undefined);
    }
  }

  if (!bridge) return null;
  const action: UpdateAction | undefined = state?.phase === 'available' ? 'download' :
    state?.phase === 'downloaded' ? 'install' :
    state?.phase === 'idle' || state?.phase === 'current' || state?.phase === 'error' ||
    state?.phase === 'no-release' || state?.phase === 'manual' || !state && error ? 'check' : undefined;
  const progress = state?.percent;
  const percent = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : undefined;
  const failure = error || (state?.phase === 'error' && state.error);
  const displayAction = busy || action || (state?.phase === 'unconfigured' ? 'check' : undefined);
  return <div className="settings-row settings-update">
    <div>
      <h3>应用更新</h3>
      <p role="status">{state ? statusText(state) : error ? '更新状态暂不可用。' : '正在读取更新状态…'}</p>
      {state?.phase === 'downloading' && percent !== undefined && <Progress aria-label="下载进度" percent={percent} size="small" />}
      {state?.phase === 'manual' && state.url && /^(https:\/\/github\.com\/GSXTY\/Somnus-Releases\/releases\/tag\/v\d+\.\d+\.\d+(?:-beta\.\d+)?)$/.test(state.url) &&
        <a href={state.url} target="_blank" rel="noreferrer noopener">在 GitHub 下载</a>}
      {failure && <Alert type="error" message={failure} showIcon />}
    </div>
    {displayAction && <div className="settings-row-action">
      <Button type={action === 'install' ? 'primary' : 'default'} loading={Boolean(busy)} disabled={!action || Boolean(busy)}
        onClick={() => { if (action) void run(action); }}>{actionLabels[displayAction]}</Button>
    </div>}
  </div>;
}
