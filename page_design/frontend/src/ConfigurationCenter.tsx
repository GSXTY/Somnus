import { SomnusMark } from './SomnusMark';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Tabs, Tag } from 'antd';
import { DatabaseOutlined, DownloadOutlined, PlusOutlined, RobotOutlined, SafetyOutlined, SettingOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Models } from './Models';
import type { DshMcpConnection } from './McpServers';
import type { DshCatalogQuery, DshCommunityMarket, DshMarket, DshMarketSource, InstalledDshPlugin, InstalledDshPlugins } from './DshPluginMarket';
import type { DshPluginSettings, DshSettingEdit } from './PluginConfiguration';
import type { InstalledPluginSource } from './PluginSourceInstaller';
import type { DshSkill } from './PersonalSkills';
import type { DesktopExecutionSettings } from './AgentExecutionSettings';
import type { DshOarState } from './OarPluginSettings';
import { assistantStatus } from './assistantApi';
import type { AssistantStatus } from './assistantApi';
import type { ConfigurationCheckpoint } from './assistantApi';
import { ManagedDshAccount } from './ManagedDshAccount';
import { ConfigurationCheckpoints } from './ConfigurationCheckpoints';
import type { ManagedDshAccountStatus } from './ManagedDshAccount';
import './agentConfiguration.css';
import icon0 from './agent-icons/antigravity-acp.svg';
import icon1 from './agent-icons/claude-acp.svg';
import icon2 from './agent-icons/cline.svg';
import icon3 from './agent-icons/codebuddy-code.svg';
import icon4 from './agent-icons/codex-acp.svg';
import icon5 from './agent-icons/cursor.svg';
import icon6 from './agent-icons/deepseek.svg';
import icon7 from './agent-icons/devin.svg';
import icon8 from './agent-icons/gemini.svg';
import icon9 from './agent-icons/github-copilot-cli.svg';

type AdapterProvider = 'codex' | 'deepseek-harness-native' | 'codebuddy';
type AgentPreset = { provider?: AdapterProvider; label: string; icon: string; aliases?: string[]; packageName?: string; binary?: string; args?: string; launch?: string; guide: string; account?: string };
const setupPresets: AgentPreset[] = [
  { provider: 'codex', label: 'Codex', icon: 'codex-acp', packageName: '@agentclientprotocol/codex-acp', binary: 'dist/index.js', guide: 'https://github.com/agentclientprotocol/codex-acp', account: '使用 ChatGPT 账号登录 Codex。' },
  { provider: 'deepseek-harness-native', label: 'DeepSeek 官方 Agent', icon: 'deepseek', aliases: ['DeepSeek Harness 官方 ACP', 'DSH 插件运行时'], guide: 'https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md', account: '在 Somnus 中单独授权 DeepSeek 账号。' },
  { label: 'Claude Code', aliases: ['Claude Agent'], icon: 'claude-acp', guide: 'https://github.com/agentclientprotocol/claude-agent-acp' },
  { label: 'Cline', icon: 'cline', args: '--acp', launch: 'cline --acp', guide: 'https://github.com/cline/cline' },
  { provider: 'codebuddy', label: 'CodeBuddy Code', icon: 'codebuddy-code', guide: 'https://cloud.tencent.com/document/product/1831/137021', args: '--acp', launch: 'codebuddy --acp' },
  { label: 'Cursor', icon: 'cursor', args: 'acp', launch: 'agent acp', guide: 'https://cursor.com/docs/cli/acp' },
  { label: 'Devin CLI', aliases: ['Devin'], icon: 'devin', args: 'acp', launch: 'devin acp', guide: 'https://docs.devin.ai/cli' },
  { label: 'Gemini CLI', icon: 'gemini', args: '--acp', launch: 'gemini --acp', guide: 'https://github.com/google-gemini/gemini-cli' },
  { label: 'GitHub Copilot', icon: 'github-copilot-cli', args: '--acp', launch: 'copilot --acp', guide: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server' },
  { label: 'Google Antigravity', icon: 'antigravity-acp', guide: 'https://antigravity.google/docs/ide/extensions' },
];
// Vendor artwork from the ACP Registry and Lobe Icons, bundled for offline use.
const agentIcons: Record<string, string> = { 'antigravity-acp': icon0, 'claude-acp': icon1, 'cline': icon2, 'codebuddy-code': icon3, 'codex-acp': icon4, 'cursor': icon5, 'deepseek': icon6, 'devin': icon7, 'gemini': icon8, 'github-copilot-cli': icon9 };

function presetForAgent(name: string) {
  return setupPresets.find(item => [item.label, ...(item.aliases ?? [])].some(label => label.toLowerCase() === name.toLowerCase()));
}

function AgentIcon({ preset, builtin }: { preset?: AgentPreset; builtin?: boolean }) {
  const icon = preset && agentIcons[preset.icon];
  return <span className="configuration-brand-icon" aria-hidden="true">
    {builtin ? <SomnusMark /> : icon ? <img src={icon} alt="" /> : <RobotOutlined />}
  </span>;
}

function AgentSection({ title, description, icon, children }: { title: string; description?: string; icon: ReactNode; children: ReactNode }) {
  return <section className="configuration-detail-section" aria-label={title}>
    <header><span className="configuration-section-icon" aria-hidden="true">{icon}</span>
      <div><h3>{title}</h3>{description && <p>{description}</p>}</div></header>
    {children}
  </section>;
}
type Agent = { id: string; name: string; executable: string; args: string[] };
type LoginMethod = { id: string; name: string; kind: 'browser' | 'api-key' | 'terminal' | 'agent'; description?: string; providerRoute?: string };
type AgentInfo = {
  name: string; version?: string; authMethods: string[];
  authentication?: 'ready' | 'required' | 'unverified'; loginMethods?: LoginMethod[];
  provider?: 'codex' | 'deepseek-harness' | 'custom';
};
declare global {
  interface Window {
    vvmanAcp?: {
      list: () => Promise<Agent[]>;
      managedDshAccountStatus?: () => Promise<ManagedDshAccountStatus>;
      signInManagedDshAccount?: () => Promise<ManagedDshAccountStatus>;
      connectManagedDsh?: () => Promise<{ agent: Agent; info: AgentInfo }>;
      dshPluginMarket?: () => Promise<DshMarket>;
      dshInstalledPlugins?: () => Promise<InstalledDshPlugins>;
      dshMcpConnections?: () => Promise<{ connections: DshMcpConnection[] }>;
      dshPluginSettings?: (id: string, source: InstalledDshPlugin['source']) => Promise<DshPluginSettings>;
      saveDshPluginSettings?: (id: string, source: InstalledDshPlugin['source'], sectionId: string, revision: number,
        edits: DshSettingEdit[]) => Promise<DshPluginSettings>;
      dshSkills?: () => Promise<DshSkill[]>;
      agentExecutionSettings?: () => Promise<DesktopExecutionSettings>;
      setAgentExecutionSettings?: (settings: DesktopExecutionSettings) => Promise<DesktopExecutionSettings>;
      dshOarStatus?: () => Promise<DshOarState>;
      setDshOarEnabled?: (enabled: boolean) => Promise<DshOarState>;
      setDshInstalledPluginEnabled?: (id: string, source: InstalledDshPlugin['source'], enabled: boolean) => Promise<InstalledDshPlugins>;
      uninstallDshPlugin?: (id: string, source: InstalledDshPlugin['source']) => Promise<InstalledDshPlugins>;
      installDshPluginSource?: (reference: string) => Promise<InstalledPluginSource>;
      dshCommunityMarket?: (query?: string, refresh?: boolean, source?: string, options?: DshCatalogQuery) => Promise<DshCommunityMarket>;
      changeDshCommunityPlugin?: (id: string, action: 'install' | boolean, query?: string, source?: string) => Promise<DshCommunityMarket>;
      setDshCommunityMarketSources?: (urls: string[]) => Promise<{ sources: DshMarketSource[] }>;
      installDshCommunityPluginVersion?: (id: string, version: string, source?: string, query?: string) => Promise<DshCommunityMarket>;
      installDshPlugin?: (id: string) => Promise<DshMarket>;
      removeDshPlugin?: (id: string) => Promise<DshMarket>;
      detectAdapter?: (provider: AdapterProvider) => Promise<Omit<Agent, 'id'> | null>;
      connectCodex?: () => Promise<{ agent: Agent; info: AgentInfo }>;
      chooseExecutable: () => Promise<string | null>;
      save: (data: { id?: string; name: string; executable: string; args: string[] }) => Promise<Agent>;
      remove: (id: string) => Promise<void>;
      probe: (id: string) => Promise<AgentInfo>;
      saveConfigurationCheckpoint?: (id: string, revision: string) => Promise<ConfigurationCheckpoint>;
      authenticate?: (id: string, methodId: string) => Promise<AgentInfo>;
      cancelAuthentication?: () => Promise<void>;
      prompt: (id: string, text: string) => Promise<{ text: string; stopReason?: string }>;
      cancel: () => Promise<void>;
      onUpdate: (fn: (data: { agentId: string; text: string }) => void) => () => void;
    };
  }
}

function AgentConfig({ onOpen, restoredAgentId }: { onOpen: (view: string) => void; restoredAgentId?: string }) {
  const bridge = window.vvmanAcp;
  const [status, setStatus] = useState<AssistantStatus>();
  const [managedReady, setManagedReady] = useState(false);
  const [managedProfileId, setManagedProfileId] = useState<string>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [active, setActive] = useState<Agent>();
  const [edit, setEdit] = useState<{ id?: string; name: string; executable: string; args: string }>();
  const [probe, setProbe] = useState<AgentInfo>();
  const [authenticating, setAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const prompting = useRef(false);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState('');
  const [remove, setRemove] = useState<Agent>();
  const [editorError, setEditorError] = useState('');
  const [directory, setDirectory] = useState<string>();
  const [query, setQuery] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void assistantStatus(controller.signal).then(setStatus).catch(() => {});
    void bridge?.dshPluginMarket?.().then(result => {
      if (!controller.signal.aborted) setManagedReady(result.runtime.installed);
    }).catch(() => {});
    void bridge?.list().then(items => {
      if (controller.signal.aborted) return;
      setAgents(items);
      if (restoredAgentId) setActive(items.find(item => item.id === restoredAgentId));
    }).catch(error => {
      if (!controller.signal.aborted) setError(String(error));
    });
    return () => controller.abort();
  }, [bridge, restoredAgentId]);
  useEffect(() => () => { if (prompting.current) void bridge?.cancel().catch(() => {}); }, [bridge]);
  useEffect(() => bridge?.onUpdate(update => {
    if (prompting.current && update.agentId === active?.id) setReply(text => text + update.text);
  }), [bridge, active?.id]);

  async function run(action: () => Promise<void>, report = setError) {
    setBusy(true);
    report('');
    try { await action(); }
    catch (failure) { report(failure instanceof Error ? failure.message : '操作未完成'); }
    finally { setBusy(false); }
  }

  function addAgent(preset?: string) {
    setEditorError('');
    setEdit({ name: preset || '', executable: '', args: setupPresets.find(item => item.label === preset)?.args || '' });
  }

  function detectAgent(provider: AdapterProvider) {
    const detect = bridge?.detectAdapter;
    if (!detect) return;
    void run(async () => {
      const found = await detect(provider);
      if (!found) {
        setError('未在常用安装位置找到可用适配器。已安装在其他位置时，可手动接入。');
        return;
      }
      setEditorError('');
      setEdit({ ...found, args: found.args.join('\n') });
    });
  }

  function checkAccount() {
    if (!active || !bridge) return;
    setProbe(undefined);
    setLoginError('');
    void run(async () => setProbe(await bridge.probe(active.id)));
  }

  async function signIn(method: LoginMethod) {
    if (!active || !bridge?.authenticate || authenticating) return;
    setAuthenticating(true);
    setLoginError('');
    try {
      const result = await bridge.authenticate(active.id, method.id);
      setProbe(result);
      if (result.authentication === 'required') setLoginError('Agent 仍需要登录，请确认授权是否完成后刷新账号状态。');
    } catch (failure) {
      setLoginError(failure instanceof Error ? failure.message : '登录未完成');
    } finally {
      setAuthenticating(false);
    }
  }

  const accountReady = probe?.authentication === 'ready';
  const canLogin = Boolean(bridge?.authenticate);
  const loginInProgress = busy || authenticating || running;
  const matches = (label: string) => label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const catalogRows = setupPresets.flatMap<{ name: string; agent?: Agent; preset: AgentPreset }>(item => {
    const connected = agents.filter(agent => presetForAgent(agent.name) === item);
    return connected.length ? connected.map(agent => ({ name: item.provider === 'deepseek-harness-native' ? item.label : agent.name, agent, preset: item }))
      : [{ name: item.label, agent: undefined, preset: item }];
  });
  const customRows = agents.filter(agent => !presetForAgent(agent.name)).map(agent => ({ name: agent.name, agent, preset: undefined }));
  const listedRows = [...catalogRows, ...customRows].filter(row =>
    matches(row.name) || Boolean(row.preset && matches(row.preset.label)));
  const showBuiltin = matches('Somnus 内置');
  const preset = setupPresets.find(item => item.label === directory);
  const directCodex = preset?.provider === 'codex' && Boolean(bridge?.connectCodex);

  const managedPreset = preset?.provider === 'deepseek-harness-native';
  const managedActive = Boolean(active && (managedProfileId === active.id || ['DeepSeek Harness 官方 ACP', 'DSH 插件运行时'].includes(active.name)));
  const methods = managedActive || probe?.provider === 'deepseek-harness' ? [] :
    (probe?.loginMethods || []).filter(method => (method.kind === 'browser' || method.kind === 'terminal' || method.kind === 'agent') &&
      !/^api-key(?::|$)/i.test(method.id) && !method.providerRoute);
  const managedAccount = <ManagedDshAccount connected={managedActive} disabled={loginInProgress} />;
  function connectManagedDsh() {
    if (!bridge?.connectManagedDsh || loginInProgress) return;
    void run(async () => {
      const result = await bridge.connectManagedDsh!();
      setAgents(current => [...current.filter(item => item.id !== result.agent.id), result.agent]);
      setManagedProfileId(result.agent.id);
      selectAgent(result.agent);
      setProbe(result.info);
    });
  }

  async function connectCodex() {
    if (!bridge?.connectCodex || loginInProgress) return;
    setAuthenticating(true);
    setError('');
    try {
      const { agent, info } = await bridge.connectCodex();
      setAgents(current => [...current.filter(item => item.id !== agent.id), agent]);
      selectAgent(agent);
      setProbe(info);
      if (info.authentication === 'required') setLoginError('Codex 仍需登录，请完成浏览器授权后刷新账号状态。');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'ChatGPT 登录未完成');
      void bridge.list().then(setAgents).catch(() => {});
    } finally {
      setAuthenticating(false);
    }
  }

  function selectAgent(agent?: Agent, directoryName?: string) {
    setActive(agent); setDirectory(directoryName); setProbe(undefined);
    setQuestion(''); setReply(''); setError(''); setLoginError('');
  }
  return <div className="configuration-agents">
    <div className="configuration-agent-list">
      <Input.Search aria-label="搜索 Agent" placeholder="搜索 Agent" value={query}
        onChange={event => setQuery(event.target.value)} allowClear />
      {showBuiltin && <button type="button" className="configuration-agent-row" disabled={loginInProgress}
        aria-pressed={!active && !preset} onClick={() => selectAgent()}>
        <AgentIcon builtin /><span><strong>Somnus</strong><small>内置 Agent</small></span>
      </button>}
      {listedRows.map(row => <button type="button" className="configuration-agent-row" disabled={loginInProgress}
        aria-pressed={row.agent ? active?.id === row.agent.id : directory === row.name}
        key={row.agent?.id ?? row.name} onClick={() => row.agent ? selectAgent(row.agent) : selectAgent(undefined, row.name)}>
        <AgentIcon preset={row.preset} />
        <span><strong>{row.name}</strong><small>{row.agent ? '本地 ACP · 已接入' : '本地 ACP'}</small></span>
        <span className={row.agent ? 'configuration-connected' : 'configuration-agent-add'} aria-hidden="true">{row.agent ? '' : <PlusOutlined />}</span>
      </button>)}
      {!showBuiltin && !listedRows.length && <p>没有匹配的 Agent</p>}
      {bridge && <Button disabled={loginInProgress} onClick={() => addAgent()}>添加自定义 ACP</Button>}
    </div>
    <div className="configuration-agent-detail">
      <header className="configuration-agent-profile">
        <AgentIcon preset={active ? presetForAgent(active.name) : preset} builtin={!active && !preset} />
        <div><h2>{managedActive ? 'DeepSeek 官方 Agent' : active?.name || preset?.label || 'Somnus'}</h2>
          <p>{active || preset ? '本地 Agent · Agent Client Protocol' : 'Somnus 内置 Agent'}</p></div>
        <Tag color={active ? 'success' : undefined}>{active ? '已接入' : preset ? '未接入' : '内置'}</Tag>
      </header>
      {error && <Alert type="error" showIcon message={error} />}
      {active && bridge ? <>
        <AgentSection title="Agent 安装" icon={<DownloadOutlined />}>
          <div className="configuration-detail-actions"><Tag>已接入</Tag>{probe?.version && <small>{probe.version}</small>}</div>
          <Space wrap>
          <Button disabled={loginInProgress} onClick={() => { setEditorError(''); setEdit({ ...active, args: active.args.join('\n') }); }}>编辑</Button>
          <Button danger disabled={loginInProgress} onClick={() => setRemove(active)}>移除</Button></Space>
        </AgentSection>
        <AgentSection title="原生凭证" icon={<SafetyOutlined />}
          description={managedActive ? '在 Somnus 中单独授权 DeepSeek 账号。' : '使用 Agent 提供的账号登录方式。'}>
          {managedActive && managedAccount}
          <div className="configuration-detail-actions">
          <Tag color={accountReady ? 'success' : undefined}>
            {accountReady ? '会话已验证' : probe?.authentication === 'required' ? '需要登录' : probe?.authentication === 'unverified' ? '已连接 · 账号待验证' : '账号状态待检查'}
          </Tag>
          <Button disabled={loginInProgress} onClick={checkAccount}>{managedActive ? '验证 ACP 会话' : '刷新账号状态'}</Button>
          </div>
          {probe?.authentication === 'unverified' && <p>Agent 未报告账号状态，可通过试聊检查模型配置。</p>}
          {probe && <p>{probe.name}{probe.version ? ' · ' + probe.version : ''}</p>}
          {probe?.provider === 'custom' && probe.authentication === 'required' && !methods.length &&
            <p>请按此 Agent 的说明在终端完成认证，然后刷新账号状态。</p>}
          {methods.length ? <Space wrap>{methods.map(method =>
            method.kind === 'terminal' ? <p key={method.id}>{method.description || '请在终端完成认证，再刷新账号状态。'}</p>
              : <Button key={method.id} disabled={loginInProgress || !canLogin}
                onClick={() => void signIn(method)}>{method.name || '登录'}</Button>
          )}</Space> : null}
          {authenticating && <p role="status">等待 Agent 完成登录… {bridge.cancelAuthentication && <Button type="link"
            onClick={() => void bridge.cancelAuthentication?.().catch(failure => setLoginError(String(failure)))}>取消登录</Button>}</p>}
          {loginError && <Alert type="error" showIcon message={loginError} />}
        </AgentSection>
        <AgentSection title="模型供应商配置" icon={<DatabaseOutlined />} description="管理 Somnus 的模型供应商和 API Key。">
          <Button onClick={() => onOpen('models')}>管理 Provider</Button>
        </AgentSection>
        <details className="configuration-agent-test"><summary>试聊</summary>
        <p>此处只向 ACP 进程发送输入的文本。</p>
        <Input.TextArea aria-label="发送给 ACP Agent 的消息" value={question} disabled={running} rows={3} onChange={event => setQuestion(event.target.value)} />
        <div className="configuration-agent-compose">
          {running ? <Button onClick={() => void bridge.cancel().catch(error => setError(String(error)))}>停止</Button>
            : <Button type="primary" disabled={loginInProgress || !question.trim() || probe?.authentication === 'required'} onClick={() => {
              prompting.current = true; setRunning(true); setReply('');
              void run(async () => {
                const result = await bridge.prompt(active.id, question.trim());
                setReply(result.text || (result.stopReason === 'cancelled' ? '已停止' : '未返回文本'));
              }).finally(() => { prompting.current = false; setRunning(false); });
            }}>发送</Button>}
        </div>
        {reply && <pre className="configuration-agent-reply">{reply}</pre>}
        </details>
      </> : <>
        {preset && <AgentSection title="Agent 安装" icon={<DownloadOutlined />}>
          <div className="configuration-agent-setup">
          <div className="configuration-detail-actions"><Tag>{managedPreset && managedReady ? 'Somnus 内置运行时已就绪' : '等待接入'}</Tag></div>
          {managedPreset && managedReady && bridge?.connectManagedDsh &&
            <Button loading={busy} disabled={loginInProgress} onClick={connectManagedDsh}>连接 Somnus 内置运行时</Button>}
          {preset.provider === 'codebuddy' && bridge?.detectAdapter && <Button type="primary" loading={busy}
            onClick={() => detectAgent('codebuddy')}>连接 CodeBuddy Code</Button>}
          {!managedPreset && <details open={!preset.provider || (!directCodex && preset.provider !== 'codebuddy') || undefined}>
          <summary>{directCodex || preset.provider === 'codebuddy' ? '手动安装与接入' : '安装与接入'}</summary>
          {preset.packageName ? <><p>在 PowerShell 中运行下面两行，安装适配器并找到启动脚本。</p>
          <pre>{'npm install -g ' + preset.packageName}{'\n'}{'Join-Path (npm root -g) "' + preset.packageName + '/' + preset.binary + '"'}</pre>
          <p>添加时选择 <code>node.exe</code>，将脚本路径单独填为一行启动参数。</p></> :
          <><p>按官方说明安装支持 ACP 的运行时，选择其可执行程序并保存。</p>{preset.launch && <pre>{preset.launch}</pre>}</>}
          <Space wrap>
            {bridge?.detectAdapter && preset.provider !== 'codebuddy' && preset.provider && <Button type={directCodex ? 'default' : 'primary'} disabled={loginInProgress} loading={busy} onClick={() => preset.provider && detectAgent(preset.provider)}>检测本机安装</Button>}
            <Button type={bridge?.detectAdapter ? 'default' : 'primary'} disabled={!bridge || loginInProgress} onClick={() => addAgent(preset.label)}>手动接入</Button>
            <Button href={preset.guide} target="_blank" rel="noopener">适配器文档</Button>{preset.provider === 'codebuddy' && <Button href="https://www.codebuddy.ai/docs/cli/quickstart" target="_blank" rel="noopener">Windows 安装指南</Button>}
          </Space>
          </details>}
        </div></AgentSection>}
        {preset && <AgentSection title="原生凭证" icon={<SafetyOutlined />} description={preset.account || '接入后刷新账号状态，查看 Agent 提供的登录方式。'}>
          {managedPreset && managedAccount}
          {directCodex && <Button type="primary" loading={authenticating} disabled={loginInProgress}
            onClick={() => void connectCodex()}>使用 ChatGPT 登录</Button>}
          {directCodex && authenticating && <p role="status">请在浏览器完成 ChatGPT 授权。
            {bridge?.cancelAuthentication && <Button type="link"
              onClick={() => void bridge.cancelAuthentication?.().catch(failure => setError(String(failure)))}>取消登录</Button>}
          </p>}
        </AgentSection>}
        <AgentSection title="模型供应商配置" icon={<DatabaseOutlined />} description="管理 Somnus 的模型供应商和 API Key。">
          {!preset && <p>{status ? status.configured ? '模型已配置' : '模型尚未配置' : '模型状态待确认'}{status?.model ? ' · ' + status.model : ''}</p>}
          <Button onClick={() => onOpen('models')}>管理 Provider</Button>
        </AgentSection>
      </>}
    </div>
    <Modal title={edit?.id ? '编辑 ACP Agent' : '添加 ACP Agent'} open={Boolean(edit)} confirmLoading={busy}
      okText="保存" cancelText="取消" maskClosable={!busy} closable={!busy} keyboard={!busy}
      okButtonProps={{ disabled: !edit?.name.trim() || !edit?.executable }}
      onCancel={() => { if (!busy) setEdit(undefined); }} onOk={() => {
        if (!edit || !bridge) return;
        void run(async () => {
          const agent = await bridge.save({ ...edit, name: edit.name.trim(), args: edit.args.split(/\r?\n/).filter(Boolean) });
          setAgents(old => [...old.filter(item => item.id !== agent.id), agent]); selectAgent(agent); setEdit(undefined);
        }, setEditorError);
      }}>
      <p>测试连接或发送消息时，所选程序会以当前 Windows 用户的权限运行。</p>
      <Input aria-label="Agent 名称" placeholder="Agent 名称" value={edit?.name} disabled={busy} onChange={event => {
        const name = event.target.value; setEdit(old => old && { ...old, name });
      }} />
      <div className="configuration-agent-compose"><Button disabled={busy} onClick={() => {
        if (!bridge) return;
        void run(async () => {
          const executable = await bridge.chooseExecutable();
          if (executable) setEdit(old => old && { ...old, executable });
        }, setEditorError);
      }}>选择可执行程序</Button></div>
      {edit?.executable && <p className="configuration-agent-path">{edit.executable}</p>}
      <Input.TextArea aria-label="启动参数" placeholder="启动参数，每行一个" value={edit?.args} rows={3} disabled={busy} onChange={event => {
        const args = event.target.value; setEdit(old => old && { ...old, args });
      }} />
      {editorError && <Alert type="error" showIcon message={editorError} />}
    </Modal>
    <Modal title="移除 ACP Agent" open={Boolean(remove)} okText="移除" cancelText="取消" confirmLoading={busy}
      onCancel={() => { if (!busy) setRemove(undefined); }} onOk={() => {
        if (!bridge || !remove) return;
        void run(async () => { await bridge.remove(remove.id); setAgents(old => old.filter(agent => agent.id !== remove.id)); setActive(undefined); setRemove(undefined); });
      }}>
      <p>移除「{remove?.name}」的连接配置？</p>
    </Modal>
  </div>;
}

export const configurationSections = [
  { key: 'config', label: 'Agent', icon: <RobotOutlined /> },
  { key: 'models', label: 'Provider', icon: <SettingOutlined /> },
];

export function ConfigurationCenter({ view, onOpen, windowsDesktop }: {
  view: string; onOpen: (view: string) => void;
  windowsDesktop?: boolean;
}) {
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const [restoredAgentId, setRestoredAgentId] = useState<string>();
  function onRestore(agentId?: string) {
    setRestoredAgentId(agentId);
    setConfigurationRevision(value => value + 1);
    if (agentId) onOpen('config');
  }
  const sections = [<AgentConfig key="config" onOpen={onOpen} restoredAgentId={restoredAgentId} />,
    <Models key="models" windowsDesktop={windowsDesktop} />];
  const items = configurationSections.map((section, index) => ({ ...section, children: sections[index] }));
  return <div className="configuration-center">
    {windowsDesktop && <ConfigurationCheckpoints open={checkpointsOpen} onClose={() => setCheckpointsOpen(false)} onRestore={onRestore} />}
    <Tabs key={configurationRevision} activeKey={view} onChange={onOpen} items={items}
      tabBarExtraContent={windowsDesktop && view === 'config' ? <Button className="settings-toolbar-button"
        icon={<SafetyOutlined />} onClick={() => setCheckpointsOpen(true)}>验证与恢复</Button> : undefined} />
  </div>;
}
