import { SomnusMark } from './SomnusMark';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Space, Tabs, Tag } from 'antd';
import { ApiOutlined, AppstoreOutlined, RobotOutlined, SettingOutlined } from '@ant-design/icons';
import { Models } from './Models';
import { McpServers } from './McpServers';
import type { DshCommunityMarket, DshMarket, InstalledDshPlugin, InstalledDshPlugins } from './DshPluginMarket';
import { PluginConfiguration } from './PluginConfiguration';
import { PersonalSkills } from './PersonalSkills';
import { assistantStatus } from './assistantApi';
import type { AssistantStatus } from './assistantApi';
import { ManagedDshAccount } from './ManagedDshAccount';
import type { ManagedDshAccountStatus } from './ManagedDshAccount';

type AdapterProvider = 'codex' | 'deepseek-harness-native' | 'codebuddy';
const setupPresets: Array<{ provider: AdapterProvider; label: string; packageName?: string; binary?: string; args?: string; guide: string; account: string }> = [
  { provider: 'codex', label: 'Codex', packageName: '@agentclientprotocol/codex-acp', binary: 'dist/index.js', guide: 'https://github.com/agentclientprotocol/codex-acp', account: '可使用适配器提供的 ChatGPT 浏览器登录。' },
  { provider: 'deepseek-harness-native', label: 'DeepSeek Harness · 官方 DSH', args: '--profile acp', guide: 'https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md', account: '登录个人 DeepSeek 账号，并连接官方 DSH 运行时。' },
  { provider: 'codebuddy', label: 'CodeBuddy Code', guide: 'https://cloud.tencent.com/document/product/1831/137021', args: '--acp', account: '连接后在「账户」中刷新状态，再选择 CodeBuddy 提供的登录方式。' },
];
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
      openManagedDshSettings?: () => Promise<void>;
      managedDshAccountStatus?: () => Promise<ManagedDshAccountStatus>;
      signInManagedDshAccount?: () => Promise<ManagedDshAccountStatus>;
      connectManagedDsh?: () => Promise<{ agent: Agent; info: AgentInfo }>;
      dshPluginMarket?: () => Promise<DshMarket>;
      dshInstalledPlugins?: () => Promise<InstalledDshPlugins>;
      setDshInstalledPluginEnabled?: (id: string, source: InstalledDshPlugin['source'], enabled: boolean) => Promise<InstalledDshPlugins>;
      dshCommunityMarket?: (query?: string, refresh?: boolean) => Promise<DshCommunityMarket>;
      changeDshCommunityPlugin?: (id: string, action: 'install' | boolean, query?: string) => Promise<DshCommunityMarket>;
      installDshPlugin?: (id: string) => Promise<DshMarket>;
      removeDshPlugin?: (id: string) => Promise<DshMarket>;
      detectAdapter?: (provider: AdapterProvider) => Promise<Omit<Agent, 'id'> | null>;
      connectCodex?: () => Promise<{ agent: Agent; info: AgentInfo }>;
      chooseExecutable: () => Promise<string | null>;
      save: (data: { id?: string; name: string; executable: string; args: string[] }) => Promise<Agent>;
      remove: (id: string) => Promise<void>;
      probe: (id: string) => Promise<AgentInfo>;
      authenticate?: (id: string, methodId: string) => Promise<AgentInfo>;
      cancelAuthentication?: () => Promise<void>;
      prompt: (id: string, text: string) => Promise<{ text: string; stopReason?: string }>;
      cancel: () => Promise<void>;
      onUpdate: (fn: (data: { agentId: string; text: string }) => void) => () => void;
    };
  }
}

function AgentConfig({ onOpen }: { onOpen: (view: string) => void }) {
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
    void bridge?.list().then(items => { if (!controller.signal.aborted) setAgents(items); }).catch(error => {
      if (!controller.signal.aborted) setError(String(error));
    });
    return () => controller.abort();
  }, [bridge]);
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
  const listedAgents = agents.filter(agent => matches(agent.name));
  const listedPresets = setupPresets.filter(preset => matches(preset.label));
  const showBuiltin = matches('Somnus 内置');
  const preset = setupPresets.find(item => item.label === directory);
  const directCodex = preset?.provider === 'codex' && Boolean(bridge?.connectCodex);

  const managedPreset = preset?.provider === 'deepseek-harness-native';
  const managedActive = Boolean(active && (managedProfileId === active.id || ['DeepSeek Harness 官方 ACP', 'DSH 插件运行时'].includes(active.name)));
  const methods = managedActive || probe?.provider === 'deepseek-harness' ? [] :
    (probe?.loginMethods || []).filter(method => (method.kind === 'browser' || method.kind === 'terminal') &&
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
      {showBuiltin && <button type="button" className="builtin-tool" disabled={loginInProgress}
        aria-pressed={!active && !preset} onClick={() => selectAgent()}>
        <span className="configuration-somnus-label"><SomnusMark /><span><strong>Somnus</strong><small>内置 Agent</small></span></span>
      </button>}
      {listedAgents.length > 0 && <h3>已接入</h3>}
      {listedAgents.map(agent => <button type="button" className="builtin-tool" disabled={loginInProgress}
        aria-pressed={active?.id === agent.id} key={agent.id} onClick={() => selectAgent(agent)}>
        <span><strong>{agent.name}</strong><small>本地 ACP</small></span>
      </button>)}
      {listedPresets.length > 0 && <h3>适配器目录</h3>}
      {listedPresets.map(item => <button type="button" className="builtin-tool" disabled={loginInProgress}
        aria-pressed={directory === item.label} key={item.label} onClick={() => selectAgent(undefined, item.label)}>
        <span><strong>{item.label}</strong><small>本地 ACP</small></span>
      </button>)}
      {!showBuiltin && !listedAgents.length && !listedPresets.length && <p>没有匹配的 Agent</p>}
      {bridge && <Button disabled={loginInProgress} onClick={() => addAgent()}>添加自定义 ACP</Button>}
    </div>
    <Card className="panel-card" title={active?.name || preset?.label || 'Somnus'} extra={!active && !preset && <Tag>内置</Tag>}>
      {error && <Alert type="error" showIcon message={error} />}
      {active && bridge ? <>
        <Space wrap>{!managedActive && <Button disabled={loginInProgress} onClick={checkAccount}>刷新账号状态</Button>}
          <Button disabled={loginInProgress} onClick={() => { setEditorError(''); setEdit({ ...active, args: active.args.join('\n') }); }}>编辑</Button>
          <Button danger disabled={loginInProgress} onClick={() => setRemove(active)}>移除</Button></Space>
        {managedActive && managedAccount}
        <section aria-label="Agent 账户" className="configuration-agent-account">
          <h3>{managedActive ? 'ACP 会话' : '账户'}</h3>
          {managedActive && <Button disabled={loginInProgress} onClick={checkAccount}>验证 ACP 会话</Button>}
          <Tag color={accountReady ? 'success' : undefined}>
            {accountReady ? '会话已验证' : probe?.authentication === 'required' ? '需要登录' : probe?.authentication === 'unverified' ? '已连接 · 账号待验证' : '账号状态待检查'}
          </Tag>
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
        </section>
        <h3>试聊</h3><p>此处只向 ACP 进程发送输入的文本。</p>
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
      </> : <>
        {preset ? <div className="configuration-agent-setup">
          <p>{preset.account}</p>
          {managedPreset && managedAccount}
          {managedPreset && managedReady && bridge?.connectManagedDsh &&
            <Button loading={busy} disabled={loginInProgress} onClick={connectManagedDsh}>连接 DSH 插件运行时</Button>}
          {preset.provider === 'codebuddy' && bridge?.detectAdapter && <Button type="primary" loading={busy}
            onClick={() => detectAgent('codebuddy')}>连接 CodeBuddy Code</Button>}
          {directCodex && <>
            <Button type="primary" loading={authenticating} disabled={loginInProgress && !authenticating}
              onClick={() => void connectCodex()}>使用 ChatGPT 登录</Button>
            {authenticating && <p role="status">正在连接 Codex。若浏览器打开，请在浏览器完成授权。
              {bridge?.cancelAuthentication && <Button type="link"
                onClick={() => void bridge.cancelAuthentication?.().catch(failure => setError(String(failure)))}>取消登录</Button>}
            </p>}
          </>}
          <details open={!directCodex && !(managedPreset && managedReady) && preset.provider !== 'codebuddy' || undefined}>
          <summary>{directCodex || preset.provider === 'codebuddy' ? '手动安装与接入' : '安装与接入'}</summary>
          {preset.packageName ? <><p>在 PowerShell 中运行下面两行，安装适配器并找到启动脚本。</p>
          <pre>{'npm install -g ' + preset.packageName}{'\n'}{'Join-Path (npm root -g) "' + preset.packageName + '/' + preset.binary + '"'}</pre>
          <p>添加时选择 <code>node.exe</code>，将脚本路径单独填为一行启动参数。</p></> : managedPreset ? <p>如已有官方 DSH CLI，可检测本机安装或手动选择启动程序，将 <code>--profile</code> 和 <code>acp</code> 分行填写为启动参数。</p> : <><p>按官方说明安装 Windows 原生版，再选择 codebuddy.exe。接入后可刷新账号状态。</p><pre>codebuddy --acp</pre></>}
          <Space wrap>
            {bridge?.detectAdapter && preset.provider !== 'codebuddy' && <Button type={directCodex ? 'default' : 'primary'} disabled={authenticating} loading={busy} onClick={() => detectAgent(preset.provider)}>检测本机安装</Button>}
            <Button type={bridge?.detectAdapter ? 'default' : 'primary'} disabled={!bridge || loginInProgress} onClick={() => addAgent(preset.label)}>手动接入</Button>
            <Button href={preset.guide} target="_blank" rel="noopener">适配器文档</Button>{preset.args === '--acp' && <Button href="https://www.codebuddy.ai/docs/cli/quickstart" target="_blank" rel="noopener">Windows 安装指南</Button>}
          </Space>
          </details>
        </div> : <>
        <p>Somnus 自研 Agent，可在会话中处理项目工作，并按配置查询公司数据。</p>
        <p>{status ? status.configured ? '模型已配置' : '模型尚未配置' : '模型状态待确认'}{status?.model ? ' · ' + status.model : ''}</p>
        <Button onClick={() => onOpen('models')}>管理 Provider</Button>
        </>}
      </>}
    </Card>
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
  { key: 'mcp', label: 'MCP', icon: <ApiOutlined /> },
  { key: 'skills', label: 'Skill', icon: <AppstoreOutlined /> },
  { key: 'plugin-config', label: '插件', icon: <AppstoreOutlined /> },
];

export function ConfigurationCenter({ view, onOpen, suggestedPlugin, sidebarNavigation = false }: {
  view: string; onOpen: (view: string) => void; suggestedPlugin?: string; sidebarNavigation?: boolean;
}) {
  const sections = [
    <AgentConfig key="config" onOpen={onOpen} />, <Models key="models" />, <McpServers key="mcp" />,
    <PersonalSkills key="skills" />, <PluginConfiguration key="plugin-config" suggestedPlugin={suggestedPlugin} />,
  ];
  const items = configurationSections.map((section, index) => ({ ...section, children: sections[index] }));
  return <div className="configuration-center">
    <header className="configuration-heading">
      <h1 className="tools-heading">配置中心</h1>
      <p>管理账号、模型供应商和工具接入。</p>
    </header>
    <Tabs activeKey={view} onChange={onOpen} items={items} renderTabBar={sidebarNavigation
      ? () => <div className="configuration-section-title"><span>{configurationSections.find(section => section.key === view)?.label}</span></div>
      : undefined} />
  </div>;
}
