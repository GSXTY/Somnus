import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Tag } from 'antd';
import {
  listConfigurationCheckpoints, restoreConfigurationCheckpoint, saveConfigurationCheckpoint,
} from '../chat/assistantApi';
import type { ConfigurationCheckpoint, ConfigurationCheckpointList } from '../chat/assistantApi';

type AgentRef = { id: string; name: string };
type Props = { open: boolean; onClose: () => void; onRestore: (agentId?: string) => void };

export function ConfigurationCheckpoints({ open, onClose, onRestore }: Props) {
  const [data, setData] = useState<ConfigurationCheckpointList>();
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [agentId, setAgentId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [restore, setRestore] = useState<ConfigurationCheckpoint>();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setAgentId(undefined);
    setError('');
    setNotice('');
    setRestore(undefined);
    setData(undefined);
    setAgents([]);
    const bridge = window.vvmanAcp;
    const agentList = bridge?.saveConfigurationCheckpoint ? bridge.list().catch(() => []) : [];
    void Promise.all([listConfigurationCheckpoints(controller.signal), agentList])
      .then(([result, available]) => {
        if (controller.signal.aborted) return;
        setData(result);
        setAgents(available);
      }).catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '无法读取配置。');
      });
    return () => controller.abort();
  }, [open]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '配置操作未完成。');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!data || busy) return;
    void run(async () => {
      const nativeSave = window.vvmanAcp?.saveConfigurationCheckpoint;
      if (agentId && !nativeSave) throw new Error('请在桌面端验证 ACP Agent。');
      const checkpoint = agentId && nativeSave
        ? await nativeSave(agentId, data.revision) : await saveConfigurationCheckpoint(data.revision);
      setData({ ...data, checkpoints: [checkpoint, ...data.checkpoints].slice(0, 5) });
      setNotice('验证通过，已保存检查点。');
    });
  }

  function apply() {
    if (!restore || busy) return;
    void run(async () => {
      if (restore.agent) {
        const live = await window.vvmanAcp?.list();
        if (!live?.some(item => item.id === restore.agent?.id)) throw new Error('检查点引用的 ACP Agent 已移除。');
      }
      const result = await restoreConfigurationCheckpoint(restore.id);
      onRestore(result.agent?.id);
      setRestore(undefined);
      setNotice('已恢复配置选择。');
      setData(await listConfigurationCheckpoints());
    });
  }

  const current = data?.current;
  const modelLabel = current ? [current.model.name, current.model.model].filter(Boolean).join(' · ') : '';
  return <Modal title="配置验证与恢复" open={open} onCancel={onClose} footer={null}
    maskClosable={!busy} keyboard={!busy} closable={!busy}>
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <p>检查点保存默认模型、所选 ACP Agent 和 Somnus 个人插件的启停状态。恢复时使用当前已保存的连接和凭据。</p>
      {error && <Alert type="error" showIcon message={error} />}
      {notice && <Alert type="success" showIcon message={notice} />}
      {current && data && <>
        <label htmlFor="checkpoint-agent">本次验证的连接</label>
        <Select id="checkpoint-agent" value={agentId ?? ''} onChange={id => setAgentId(id || undefined)}
          disabled={busy} options={[{ value: '', label: '默认模型 · ' + modelLabel },
            ...agents.map(agent => ({ value: agent.id, label: 'ACP · ' + agent.name }))]} style={{ width: '100%' }} />
        {agentId && <p>默认模型 · {modelLabel}</p>}
        <div><strong>已启用的 Somnus 个人插件</strong>
          <div>{current.plugins.some(item => item.enabled) ? current.plugins.filter(item => item.enabled).map(item =>
            <Tag key={item.id} color={item.ready ? undefined : 'warning'}>{item.name}{item.ready ? '' : ' · 依赖不可用'}</Tag>) : '无'}</div>
        </div>
        <Space wrap>
          <Button type="primary" loading={busy && !restore} disabled={busy || Boolean(restore)} onClick={save}>验证并保存</Button>
          <Button disabled={busy} onClick={() => void run(async () => setData(await listConfigurationCheckpoints()))}>刷新配置</Button>
        </Space>
        <div><strong>最近的检查点</strong>
          {!data.checkpoints.length && <p>暂无检查点</p>}
          <ul>{data.checkpoints.map(checkpoint => <li key={checkpoint.id}>
            <Space wrap>
              <time dateTime={new Date(checkpoint.created_at * 1000).toISOString()}>
                {new Date(checkpoint.created_at * 1000).toLocaleString()}
              </time>
              <span>{checkpoint.agent?.name || checkpoint.model.model || checkpoint.model.name}</span>
              <Button size="small" disabled={busy} onClick={() => { setError(''); setRestore(checkpoint); }}>恢复</Button>
            </Space>
          </li>)}</ul>
        </div>
      </>}
      {restore && <Alert showIcon type="warning" message="恢复这份配置？" description={<>
        <p>默认模型 · {restore.model.model || restore.model.name}</p>
        {restore.agent && <p>ACP · {restore.agent.name}</p>}
        <p>启用的个人插件 · {restore.plugins.filter(item => item.enabled).map(item => item.name).join('、') || '无'}</p>
        <Space>
          <Button disabled={busy} onClick={() => setRestore(undefined)}>取消</Button>
          <Button type="primary" loading={busy} onClick={apply}>确认恢复</Button>
        </Space>
      </>} />}
    </Space>
  </Modal>;
}
