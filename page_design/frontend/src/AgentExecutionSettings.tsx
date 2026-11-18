import { useEffect, useState } from 'react';
import { Alert, InputNumber, Modal, Select, Spin, Switch } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { DesktopPluginArtwork } from './DesktopPluginArtwork';
import { delegationSettings, saveDelegationSettings } from './assistantApi';
import type { DelegationAgent, DelegationSettings } from './assistantApi';
import { describeError } from './errors.mjs';

export type DesktopExecutionSettings = {
  loop: { maxCalls: number; maxConcurrent: number };
  shell: { timeoutSeconds: number; outputKiB: number };
};

const sections = [
  { key: 'subagent', title: 'Subagent', description: '设置委派目标，以及默认 Agent 的递归深度和并发。' },
  { key: 'loop', title: 'Agent loop', description: '设置 ACP 聊天中，Somnus 工具的调用次数和并发上限。' },
  { key: 'shell', title: 'Shell', description: '设置 Somnus PowerShell 命令的运行时间和输出上限。' },
] as const;

const limits = {
  maxCalls: [1, 48],
  maxConcurrent: [1, 8],
  timeoutSeconds: [1, 150],
  outputKiB: [1, 64],
  delegationCalls: [1, 4],
  dshDepth: [0, 3],
  dshActive: [1, 8],
} as const;

type Section = typeof sections[number]['key'];
type Range = readonly [number, number];
type NumericFields<T> = { [K in keyof T]: number | null };

function valid(value: number | null, [min, max]: Range): value is number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

function NumberField({ name, value, range, unit, disabled, onChange }: {
  name: string;
  value: number | null;
  range: Range;
  unit: string;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  return <label className="agent-execution-field">
    <span>{name}<small>{range.join('–')} {unit}</small></span>
    <InputNumber aria-label={name} value={value} min={range[0]} max={range[1]} precision={0}
      status={valid(value, range) ? undefined : 'error'} disabled={disabled} onChange={onChange} />
  </label>;
}

export function AgentExecutionSettings() {
  const bridge = window.vvmanAcp;
  const hasDesktopSettings = Boolean(bridge?.agentExecutionSettings && bridge?.setAgentExecutionSettings);
  const [active, setActive] = useState<Section>();
  const [desktopSettings, setDesktopSettings] = useState<DesktopExecutionSettings>();
  const [loop, setLoop] = useState<NumericFields<DesktopExecutionSettings['loop']>>();
  const [shell, setShell] = useState<NumericFields<DesktopExecutionSettings['shell']>>();
  const [subagent, setSubagent] = useState<
    Omit<DelegationSettings, 'max_calls' | 'dsh_max_depth' | 'dsh_max_active'> &
    NumericFields<Pick<DelegationSettings, 'max_calls' | 'dsh_max_depth' | 'dsh_max_active'>>
  >();
  const [agents, setAgents] = useState<DelegationAgent[]>([]);
  const [agentListError, setAgentListError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    async function load() {
      if (active === 'subagent') {
        const [settings, agentList] = await Promise.all([
          delegationSettings(controller.signal),
          bridge ? bridge.list().then(items => ({ items, failed: false })).catch(() => ({ items: [], failed: true }))
            : Promise.resolve({ items: [], failed: false }),
        ]);
        if (!controller.signal.aborted) {
          setSubagent(settings);
          setAgents(agentList.items);
          setAgentListError(agentList.failed);
        }
      } else {
        if (!bridge?.agentExecutionSettings) throw new Error('当前版本无法读取桌面执行设置。');
        const settings = await bridge.agentExecutionSettings();
        if (!controller.signal.aborted) {
          setDesktopSettings(settings);
          setLoop(settings.loop);
          setShell(settings.shell);
        }
      }
    }
    void load()
      .catch(failure => { if (!controller.signal.aborted) setError(describeError(failure, '无法读取执行设置')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, bridge]);

  const validLoop = loop && valid(loop.maxCalls, limits.maxCalls) && valid(loop.maxConcurrent, limits.maxConcurrent);
  const validShell = shell && valid(shell.timeoutSeconds, limits.timeoutSeconds) && valid(shell.outputKiB, limits.outputKiB);
  const validSubagent = subagent && valid(subagent.max_calls, limits.delegationCalls)
    && valid(subagent.dsh_max_depth, limits.dshDepth) && valid(subagent.dsh_max_active, limits.dshActive);
  const canSave = active === 'subagent' ? validSubagent : desktopSettings && (active === 'loop' ? validLoop : validShell);
  const agentOptions = [...agents];
  for (const id of subagent?.agent_ids || []) {
    if (!agentOptions.some(agent => agent.id === id)) agentOptions.push({ id, name: id });
  }

  function open(section: Section) {
    setError('');
    setDesktopSettings(undefined);
    setSubagent(undefined);
    setLoop(undefined);
    setShell(undefined);
    setLoading(true);
    setActive(section);
  }

  async function save() {
    if (saving || loading) return;
    setError('');
    setSaving(true);
    try {
      if (active === 'subagent' && subagent && valid(subagent.max_calls, limits.delegationCalls)
          && valid(subagent.dsh_max_depth, limits.dshDepth) && valid(subagent.dsh_max_active, limits.dshActive)) {
        const { enabled, max_calls, agent_ids, dsh_max_depth, dsh_max_active } = subagent;
        await saveDelegationSettings({ enabled, max_calls, agent_ids, dsh_max_depth, dsh_max_active });
      } else if (desktopSettings && bridge?.setAgentExecutionSettings) {
        if (active === 'loop' && loop && valid(loop.maxCalls, limits.maxCalls) && valid(loop.maxConcurrent, limits.maxConcurrent)) {
          await bridge.setAgentExecutionSettings({ ...desktopSettings, loop: { maxCalls: loop.maxCalls, maxConcurrent: loop.maxConcurrent } });
        } else if (active === 'shell' && shell && valid(shell.timeoutSeconds, limits.timeoutSeconds) && valid(shell.outputKiB, limits.outputKiB)) {
          await bridge.setAgentExecutionSettings({ ...desktopSettings, shell: { timeoutSeconds: shell.timeoutSeconds, outputKiB: shell.outputKiB } });
        } else return;
      } else return;
      setActive(undefined);
    } catch (failure) {
      setError(describeError(failure, '无法保存执行设置'));
    } finally {
      setSaving(false);
    }
  }

  return <section className="plugin-section" aria-labelledby="agent-execution-title">
    <h3 id="agent-execution-title">内置插件设置</h3>
    <div className="plugin-rows">
      {sections.filter(section => section.key === 'subagent' || hasDesktopSettings).map(section =>
        <div className="plugin-execution-item" key={section.key}>
        <div className="plugin-row">
          <button type="button" className="plugin-row-link" onClick={() => open(section.key)}>
            <span className="plugin-symbol" aria-hidden="true"><DesktopPluginArtwork kind={section.key} /></span>
            <span className="plugin-row-copy"><strong>{section.title}</strong><small>{section.description}</small></span>
            <RightOutlined className="plugin-row-arrow" aria-hidden="true" />
          </button>
        </div>
        {section.key === 'subagent' && <div className="plugin-row plugin-overview-row">
          <span className="plugin-symbol" aria-hidden="true"><DesktopPluginArtwork kind="search" /></span>
          <div className="plugin-row-copy"><strong>Web search</strong><small>此处没有可配置的全局网页搜索工具。</small></div>
          <RightOutlined className="plugin-row-arrow plugin-unavailable-arrow" aria-hidden="true" />
        </div>}
        </div>
      )}
    </div>
    <Modal title={sections.find(section => section.key === active)?.title} open={Boolean(active)}
      okText="保存" cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: loading || !canSave }}
      maskClosable={!saving} keyboard={!saving} closable={!saving}
      onCancel={() => { if (!saving) setActive(undefined); }} onOk={() => void save()}>
      <div className="agent-execution-form">
        {error && <Alert type="error" showIcon message={error} />}
        {loading && <span role="status"><Spin size="small" /> 正在读取设置</span>}
        {!loading && active === 'subagent' && subagent && <>
          <div className="agent-execution-field"><span>启用子 Agent</span>
            <Switch aria-label="启用子 Agent" checked={subagent.enabled} disabled={saving}
              onChange={enabled => setSubagent({ ...subagent, enabled })} /></div>
          <h4>Somnus 内置 Agent</h4>
          <p>委派给其他 ACP Agent 前会请你确认。</p>
          <NumberField name="每轮委派上限" value={subagent.max_calls} range={limits.delegationCalls} unit="次"
            disabled={saving || !subagent.enabled} onChange={max_calls => setSubagent({ ...subagent, max_calls })} />
          <div className="agent-execution-targets">
            <label htmlFor="agent-execution-targets">可委派的 Agent</label>
            <Select id="agent-execution-targets" aria-label="可委派的 Agent" mode="multiple" placeholder="全部已接入的 Agent"
              value={subagent.agent_ids} disabled={saving || !subagent.enabled || agentListError}
              maxCount={64}
              options={agentOptions.map(agent => ({ value: agent.id, label: agent.name }))}
              optionFilterProp="label" onChange={agent_ids => setSubagent({ ...subagent, agent_ids })} />
            <small>留空时可委派给全部已接入的 Agent。</small>
            {agentListError && <Alert showIcon type="warning" message="无法读取已接入的 Agent，原有选择会保留。" />}
          </div>
          <h4>默认 Agent</h4>
          <p>下一轮默认 Agent 会话生效。子 Agent 使用默认模型，递归深度设为 0 时关闭子 Agent。</p>
          <NumberField name="递归深度" value={subagent.dsh_max_depth} range={limits.dshDepth} unit="层"
            disabled={saving || !subagent.enabled} onChange={dsh_max_depth => setSubagent({ ...subagent, dsh_max_depth })} />
          <NumberField name="并发子 Agent 上限" value={subagent.dsh_max_active} range={limits.dshActive} unit="个"
            disabled={saving || !subagent.enabled || subagent.dsh_max_depth === 0}
            onChange={dsh_max_active => setSubagent({ ...subagent, dsh_max_active })} />
        </>}
        {!loading && active === 'loop' && loop && <>
          <p>从下一轮 ACP 聊天起生效。调用次数只计算通过 Somnus 调用的工具。部分工具仍会依次运行。</p>
          <NumberField name="每轮调用上限" value={loop.maxCalls} range={limits.maxCalls} unit="次"
            disabled={saving} onChange={maxCalls => setLoop({ ...loop, maxCalls })} />
          <NumberField name="同时运行上限" value={loop.maxConcurrent} range={limits.maxConcurrent} unit="个"
            disabled={saving} onChange={maxConcurrent => setLoop({ ...loop, maxConcurrent })} />
        </>}
        {!loading && active === 'shell' && shell && <>
          <p>作用于 Somnus 在绑定项目内启动的 PowerShell。命令仍需会话开启完全访问。</p>
          <NumberField name="单条命令超时" value={shell.timeoutSeconds} range={limits.timeoutSeconds} unit="秒"
            disabled={saving} onChange={timeoutSeconds => setShell({ ...shell, timeoutSeconds })} />
          <NumberField name="捕获输出上限" value={shell.outputKiB} range={limits.outputKiB} unit="KiB"
            disabled={saving} onChange={outputKiB => setShell({ ...shell, outputKiB })} />
        </>}
      </div>
    </Modal>
  </section>;
}
