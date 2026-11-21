import { useEffect, useRef, useState } from 'react';
import { Alert, Switch, Tag } from 'antd';
import { DesktopPluginArtwork } from './DesktopPluginArtwork';
import { describeError } from '../shared/errors.mjs';

export type DshOarState = {
  available: boolean;
  enabled: boolean;
  runtimes: Array<'codex' | 'claude'>;
  reason?: string;
};

const runtimeNames = { codex: 'Codex', claude: 'Claude Code' } as const;

export function OarPluginSettings({ active, revision }: { active: boolean; revision: number }) {
  const read = window.vvmanAcp?.dshOarStatus;
  const write = window.vvmanAcp?.setDshOarEnabled;
  const [state, setState] = useState<DshOarState>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);

  useEffect(() => {
    if (!active || !read || writing.current) return;
    let current = true;
    setLoading(true);
    setError('');
    void read().then(result => {
      if (current) setState(result);
    }).catch(failure => {
      if (current) setError(describeError(failure, '无法读取 OAR 状态'));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [active, read, revision]);

  async function change(enabled: boolean) {
    if (!write || !state || enabled && !state.available || loading || writing.current) return;
    writing.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await write(enabled);
      setState(result);
      if (result.enabled !== enabled) setError(result.reason || '桌面运行时没有确认 OAR 状态已更改。');
    } catch (failure) {
      setError(describeError(failure, enabled ? '无法启用 OAR' : '无法停用 OAR'));
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }

  return <section className="plugin-overview-integrations" aria-label="桌面插件">
    <div className="plugin-overview-row">
      <span className="plugin-symbol" aria-hidden="true"><DesktopPluginArtwork kind="subagent" /></span>
      <div className="plugin-row-copy">
        <strong>OAR 子智能体 <Tag>实验性</Tag></strong>
        <small>在 Somnus 托管的 DSH Web 会话中向编程智能体委派任务。</small>
        {state && state.runtimes.length > 0 && <small>可用 Agent {state.runtimes.map(runtime => runtimeNames[runtime]).join('、')}</small>}
        {state?.reason && state.reason !== error && <small>{state.reason}</small>}
        {!read && <small>当前桌面运行时未提供 OAR。</small>}
        {state && !state.available && !state.reason && <small>当前环境无法使用 OAR。</small>}
      </div>
      <Switch aria-label="启用 OAR Subagents" checked={Boolean(state?.enabled)}
        disabled={!active || !write || !(state?.available || state?.enabled) || loading || saving}
        loading={loading || saving} onChange={enabled => void change(enabled)} />
    </div>
    {error && <Alert type="error" showIcon message={error} />}
  </section>;
}
