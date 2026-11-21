import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Radio, Segmented, Select, Spin, Switch, Tag } from 'antd';
import { ApiOutlined, CodeOutlined, DatabaseOutlined, DownloadOutlined, LockOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { McpMarket } from './McpMarket';
import type { MarketServer, MarketVariant } from './McpMarket';
import { ExtensionHeading, ExtensionItem } from './ExtensionSettingsParts';
import './mcpServers.css';

type Server = {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
  builtin?: boolean;
  runtime_managed?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  protocol_version?: string;
  env_names: string[];
  header_names: string[];
  status: 'disabled' | 'idle' | 'ready' | 'error' | 'unavailable';
  tools: Array<{ name: string; description?: string }>;
  error?: string | null;
  tool_permissions?: Record<string, 'read' | 'confirm'>;
};
export type DshMcpConnection = { id: string; name: string; transport: 'stdio' | 'streamable-http'; enabled: boolean;
  status: 'active' | 'configured' | 'disabled' | 'error';
  builtin?: boolean;
  runtime_managed?: boolean;
};
const dshMcpLabels = { active: '已由运行环境加载', configured: '已配置', disabled: '已停用', error: '状态异常' };

type Draft = { name: string; transport: Server['transport']; command: string; args: string; url: string; protocolVersion: string; secretName: string; secretValue: string };
const blank: Draft = { name: '', transport: 'stdio', command: '', args: '', url: '', protocolVersion: '2025-11-25', secretName: '', secretValue: '' };
const endpoint = '/api/mcp/servers';
const labels = { disabled: '已停用', idle: '未测试', ready: '已连接', error: '连接失败', unavailable: '暂不可用' };
const permissionLabels = { confirm: '执行前确认', read: '只读' };
const dataTools = {
  database: {
    title: '数据库',
    description: '查看授权数据库的表结构并执行只读 SQL。',
    capabilities: ['查看有权限的数据表与字段。', '执行单条只读 SQL，并返回有限行数的结果。'],
  },
  'text-to-sql': {
    title: 'Text to SQL',
    description: '将业务问题转换为可核对的 SQL 草稿。',
    capabilities: ['根据授权表结构与数据库策略生成 SQL 草稿。', '返回草稿供核对，执行查询时可使用数据库工具。'],
  },
};

function isLocked(server: Server) {
  return server.builtin === true || server.runtime_managed === true;
}

function dataTool(server: Server) {
  if (!server.builtin || !server.runtime_managed) return undefined;
  if (server.id === 'database' || server.id === 'text-to-sql') return dataTools[server.id];
}

const errorMessage = (value: unknown) => value instanceof Error ? value.message : '操作失败，请稍后重试';

async function request<T>(path: string, method: string, body?: object): Promise<T> {
  const response = await fetch(path, {
    method, cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(typeof result?.error === 'string' ? result.error : 'MCP 服务暂不可用');
  return result as T;
}

export function McpServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [nativeServers, setNativeServers] = useState<DshMcpConnection[]>();
  const [nativeLoading, setNativeLoading] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<Server | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Server | null>(null);
  const [preview, setPreview] = useState<Server | null>(null);
  const [nativePreview, setNativePreview] = useState<DshMcpConnection>();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('installed');
  const [marketConfig, setMarketConfig] = useState<MarketVariant>();
  const [marketValues, setMarketValues] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);
  const nativeList = window.vvmanAcp?.dshMcpConnections;
  async function loadNativeServers() {
    if (!nativeList) return;
    setNativeLoading(true);
    setNativeError('');
    try { setNativeServers((await nativeList()).connections); }
    catch (failure) { setNativeError(errorMessage(failure)); }
    finally { setNativeLoading(false); }
  }
  useEffect(() => { void loadNativeServers(); }, [nativeList]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    request<{ servers: Server[]; error?: string }>(endpoint, 'GET')
      .then(result => { if (alive) { setServers(result.servers); setError(result.error || ''); } })
      .catch(failure => { if (alive) setError(errorMessage(failure)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, []);

  function showEditor(server?: Server) {
    if (server && isLocked(server)) return;
    setMarketConfig(undefined);
    setMarketValues({});
    setEditing(server || null);
    setDraft(server ? {
      name: server.name, transport: server.transport, command: server.command || '',
      args: (server.args || []).join('\n'), url: server.url || '', protocolVersion: server.protocol_version || '2025-11-25', secretName: '', secretValue: '',
    } : blank);
    setEditorError('');
    setEditorOpen(true);
  }

  function showMarketEditor(server: MarketServer, variant: MarketVariant) {
    showEditor();
    setMarketConfig(variant);
    setDraft({ ...blank, transport: 'http', name: (server.title || server.name).slice(0, 100), url: variant.url });
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  function updateServer(server: Server) {
    setServers(current => current.some(item => item.id === server.id)
      ? current.map(item => item.id === server.id ? server : item) : [...current, server]);
  }

  async function act(run: () => Promise<void>, report = setError) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    report('');
    try { await run(); }
    catch (failure) { report(errorMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }

  function closeEditor() {
    setEditorOpen(false);
    setDraft(blank);
    setEditorError('');
    setMarketConfig(undefined);
    setMarketValues({});
  }

  async function save() {
    if (editing && isLocked(editing)) return;
    await act(async () => {
      const name = draft.name.trim();
      if (!name) throw new Error('请输入服务器名称');
      const secretName = draft.secretName.trim();
      if (Boolean(secretName) !== Boolean(draft.secretValue)) throw new Error('请同时填写密钥名称和值');
      const credentials = secretName ? { [secretName]: draft.secretValue } : undefined;
      const base = { name, transport: draft.transport };
      let config: object;
      if (draft.transport === 'stdio') {
        const command = draft.command.trim();
        if (!command) throw new Error('请输入可执行程序名称或路径');
        config = { ...base, command, args: draft.args.split(/\r?\n/).filter(Boolean), ...(credentials ? { env: credentials } : {}) };
      } else {
        const url = draft.url.trim();
        if (!url.startsWith('https://')) throw new Error('请输入 HTTPS 服务器地址');
        const headers = marketConfig ? Object.fromEntries(marketConfig.inputs.flatMap(item => {
          const value = Object.hasOwn(marketValues, item.id) ? marketValues[item.id] : '';
          if (item.required && !value.trim()) throw new Error('请填写 ' + (item.label || item.id));
          return value ? [[item.id, item.template?.replace('{value}', () => value) || value]] : [];
        })) : credentials;
        config = { ...base, url, protocol_version: draft.protocolVersion,
          ...(headers && Object.keys(headers).length ? { headers } : {}) };
      }
      const path = editing ? endpoint + '/' + encodeURIComponent(editing.id) : endpoint;
      const result = await request<{ server: Server }>(path, editing ? 'PUT' : 'POST', editing ? config : { ...config, enabled: false });
      updateServer(result.server);
      setPreview(current => current?.id === result.server.id ? result.server : current);
      closeEditor();
      if (marketConfig) setTab('installed');
    }, setEditorError);
  }

  function serverPath(server: Server) { return endpoint + '/' + encodeURIComponent(server.id); }

  const builtinNames = new Set(servers.filter(isLocked).map(server => server.name));
  const term = query.trim().toLocaleLowerCase();
  const matches = (name: string, description?: string) =>
    [name, description].some(value => value?.toLocaleLowerCase().includes(term));
  const visibleServers = servers.filter(server => {
    const data = dataTool(server);
    return matches(server.name, data?.description) || Boolean(data && matches(data.title));
  });
  const visibleNativeServers = nativeServers?.filter(server => !builtinNames.has(server.name) && matches(server.name)) ?? [];
  const defaultServers = visibleServers.filter(isLocked);
  const personalServers = visibleServers.filter(server => !isLocked(server));
  const defaultNativeServers = visibleNativeServers.filter(server => server.builtin || server.runtime_managed);
  const personalNativeServers = visibleNativeServers.filter(server => !server.builtin && !server.runtime_managed);
  const previewDataTool = preview ? dataTool(preview) : undefined;
  const iconFor = (server: Server) => server.runtime_managed && server.id === 'database' ? <DatabaseOutlined />
    : server.runtime_managed && server.id === 'text-to-sql' ? <CodeOutlined /> : <ApiOutlined />;
  const connectionStatus = (server: Server) => <span className="extension-status" data-tone={server.status}>
    {dataTool(server) && server.status === 'idle' ? '已配置' : labels[server.status]}
  </span>;
  const nativeStatus = (server: DshMcpConnection) => <span className="extension-status"
    data-tone={server.status === 'active' ? 'ready' : server.status}>{dshMcpLabels[server.status]}</span>;
  const leaveDetail = () => { setPreview(null); setNativePreview(undefined); setError(''); };

  function toggle(server: Server, enabled: boolean) {
    if (isLocked(server)) return;
    void act(async () => {
      const result = await request<{ server: Server }>(serverPath(server), 'PUT', { enabled });
      updateServer(result.server);
      setPreview(current => current?.id === server.id ? result.server : current);
    });
  }

  function test(server: Server) {
    if (isLocked(server)) return;
    void act(async () => {
      const result = await request<{ server: Server }>(serverPath(server) + '/test', 'POST', {});
      updateServer(result.server);
      setPreview(result.server);
    });
  }

  const serverSwitch = (server: Server) => <Switch size="small" checked={server.enabled} disabled={busy}
    aria-label={server.name + ' 启用状态'} onChange={enabled => toggle(server, enabled)} />;

  return <div className="extension-settings mcp-config">
    <input type="file" hidden ref={importInput} accept=".json,application/json" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void act(async () => {
        if (file.size > 256 * 1024) throw new Error('配置文件不能超过 256 KB');
        let config: unknown;
        try { config = JSON.parse(await file.text()); } catch { throw new Error('无法读取 JSON 文件'); }
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('请选择 MCP 配置文件');
        const imported = await request<{ servers: Server[] }>(endpoint + '/import', 'POST', config);
        setServers(current => [...current.filter(item => !imported.servers.some(server => server.id === item.id)), ...imported.servers]);
      });
    }} />
    {preview ? <>
      <ExtensionHeading title={previewDataTool?.title ?? preview.name} icon={iconFor(preview)} onBack={leaveDetail}
        description={previewDataTool?.description} actions={isLocked(preview) ? <Tag icon={<LockOutlined />}>内置</Tag> : <>
          {serverSwitch(preview)}
          <Button size="small" disabled={busy} onClick={() => showEditor(preview)}>配置</Button>
          <Button size="small" danger disabled={busy} onClick={() => setRemoveTarget(preview)}>移除</Button>
        </>} />
      <section className="extension-detail" aria-label="MCP 连接详情">
        <h3>连接</h3>
        <dl>
          <dt>传输</dt><dd>{preview.transport === 'stdio' ? 'stdio' : 'Streamable HTTP'}</dd>
          <dt>状态</dt><dd>{connectionStatus(preview)}</dd>
          {!isLocked(preview) && preview.url && <><dt>端点</dt><dd>{preview.url}</dd></>}
          {!isLocked(preview) && preview.command && <><dt>命令</dt><dd><code>{preview.command}</code></dd></>}
        </dl>
        {isLocked(preview) ? <p className="extension-note">由 Somnus 管理，连接配置始终启用。</p>
          : <div><Button size="small" icon={<ReloadOutlined />} disabled={busy} onClick={() => test(preview)}>测试连接</Button></div>}
        {preview.error && <Alert type={preview.status === 'unavailable' ? 'warning' : 'error'} showIcon message={preview.error} />}
      </section>
      <section className="extension-detail" aria-label="MCP 工具">
        <h3>工具</h3>
        {previewDataTool ? <ul>{previewDataTool.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul>
          : preview.tools.length > 0 ? <ul className="mcp-tools">
            {preview.tools.map(tool => <li key={tool.name}>
              <div><strong>{tool.name}</strong>{tool.description && <p>{tool.description}</p>}</div>
              {isLocked(preview) ? <Tag>{permissionLabels[preview.tool_permissions?.[tool.name] || 'confirm']}</Tag>
                : <Select size="small" aria-label={tool.name + ' 权限'} disabled={busy}
                  value={preview.tool_permissions?.[tool.name] || 'confirm'} options={[
                    { value: 'confirm', label: permissionLabels.confirm }, { value: 'read', label: permissionLabels.read },
                  ]} onChange={value => void act(async () => {
                    const result = await request<{ server: Server }>(serverPath(preview), 'PUT', {
                      tool_permissions: { ...preview.tool_permissions, [tool.name]: value },
                    });
                    updateServer(result.server);
                    setPreview({ ...result.server, tools: preview.tools });
                  })} />}
            </li>)}
          </ul> : <p className="extension-note">{isLocked(preview) ? '暂无工具信息。' : '测试连接后显示可用工具。'}</p>}
      </section>
    </> : nativePreview ? <>
      <ExtensionHeading title={nativePreview.name} icon={<ApiOutlined />} onBack={leaveDetail}
        actions={nativePreview.builtin || nativePreview.runtime_managed ? <Tag icon={<LockOutlined />}>默认</Tag> : <Tag>DSH 原生</Tag>} />
      <section className="extension-detail" aria-label="DSH 原生 MCP 连接详情">
        <h3>连接</h3>
        <dl><dt>传输</dt><dd>{nativePreview.transport === 'stdio' ? 'stdio' : 'Streamable HTTP'}</dd>
          <dt>状态</dt><dd>{nativeStatus(nativePreview)}</dd></dl>
        <p className="extension-note">{nativePreview.builtin || nativePreview.runtime_managed
          ? '由 Somnus 管理，无法修改连接配置。' : '由 DSH 的运行配置管理。'}</p>
      </section>
    </> : <>
      <ExtensionHeading title="MCP" description="通过 stdio 或 Streamable HTTP 连接工具" actions={tab === 'installed' ? <>
        <Button size="small" icon={<DownloadOutlined />} disabled={busy} onClick={() => importInput.current?.click()}>导入 JSON</Button>
        <Button size="small" type="primary" icon={<PlusOutlined />} disabled={busy} onClick={() => showEditor()}>添加连接</Button>
      </> : undefined} />
      <Segmented className="mcp-settings-tabs" aria-label="MCP 分类" value={tab} onChange={setTab}
        options={[{ label: '已安装', value: 'installed' }, { label: '发现', value: 'market' }]} />
      <div hidden={tab !== 'market'}>
        <McpMarket active={tab === 'market'} disabled={busy} onSelect={showMarketEditor} />
      </div>
      {tab === 'installed' && <>
        <Input className="extension-search" allowClear prefix={<SearchOutlined />} placeholder="搜索连接"
          aria-label="搜索连接" value={query} onChange={event => setQuery(event.target.value)} />
        {window.somnusNativeDshChat && <p className="extension-note">自定义连接由 Somnus 管理，并按 Agent 路由提供。</p>}
        {busy && !servers.length && <p className="extension-note" role="status"><Spin size="small" /> 正在加载连接…</p>}
        {!busy && !error && !nativeError && !visibleServers.length && !visibleNativeServers.length && !nativeLoading &&
          <p className="extension-empty">{term ? '没有匹配的连接' : '暂无 MCP 连接'}</p>}
        {(defaultServers.length > 0 || defaultNativeServers.length > 0) &&
          <section className="extension-section" aria-label="默认 MCP">
            <h3>默认</h3>
            <ul className="extension-list" aria-label="默认 MCP 连接">
              {defaultServers.map(server => {
                const data = dataTool(server);
                return <ExtensionItem key={server.id} title={data?.title ?? server.name} icon={iconFor(server)}
                  description={data?.description ?? (server.transport === 'stdio' ? 'stdio' : 'Streamable HTTP')}
                  onOpen={() => { setError(''); setPreview(server); }}
                  status={<><Tag icon={<LockOutlined />}>内置</Tag>{connectionStatus(server)}</>} />;
              })}
              {defaultNativeServers.map(server => <ExtensionItem key={server.id} title={server.name} icon={<ApiOutlined />}
                description={server.transport === 'stdio' ? 'stdio' : 'Streamable HTTP'}
                onOpen={() => setNativePreview(server)} status={<><Tag icon={<LockOutlined />}>内置</Tag>{nativeStatus(server)}</>} />)}
            </ul>
          </section>}
        {personalServers.length > 0 && <section className="extension-section" aria-label="个人 MCP">
          <h3>个人</h3>
          <ul className="extension-list" aria-label="个人 MCP 连接">
          {personalServers.map(server => {
            const data = dataTool(server);
            return <ExtensionItem key={server.id} title={data?.title ?? server.name} icon={iconFor(server)}
              description={data?.description ?? (server.transport === 'stdio' ? 'stdio' : 'Streamable HTTP')}
              onOpen={() => { setError(''); setPreview(server); }}
              status={<>{isLocked(server) && <Tag icon={<LockOutlined />}>内置</Tag>}{connectionStatus(server)}</>}
              actions={isLocked(server) ? undefined : serverSwitch(server)} />;
          })}
        </ul></section>}
        {nativeList && (personalNativeServers.length > 0 || nativeLoading || nativeError) &&
          <section className="extension-section" aria-label="DSH 原生 MCP">
          <div className="mcp-section-heading"><h3>DSH 原生</h3>
            <Button size="small" type="text" aria-label="刷新 DSH 原生 MCP" icon={<ReloadOutlined />}
              loading={nativeLoading} onClick={() => void loadNativeServers()} /></div>
          {nativeError && <Alert type="error" showIcon message={nativeError} />}
          {personalNativeServers.length > 0 && <ul className="extension-list" aria-label="DSH 原生连接">
            {personalNativeServers.map(item => <ExtensionItem key={item.id} title={item.name} icon={<ApiOutlined />}
              description={item.transport === 'stdio' ? 'stdio' : 'Streamable HTTP'} status={nativeStatus(item)}
              onOpen={() => setNativePreview(item)} />)}
          </ul>}
          {!nativeLoading && !nativeError && personalNativeServers.length === 0 &&
            <p className="extension-note">{term ? '没有匹配的原生连接' : '暂无原生连接'}</p>}
        </section>}
      </>}
    </>}
    {error && <Alert type="error" showIcon message={error} />}
    <Modal title={editing ? '编辑 MCP 服务器' : '添加 MCP 服务器'} open={editorOpen}
      onCancel={() => { if (!busy) closeEditor(); }} onOk={() => void save()} confirmLoading={busy}
      okText="保存" cancelText="取消" keyboard={!busy} maskClosable={!busy} closable={!busy}>
      <Form layout="vertical" disabled={busy}>
        <Form.Item label="服务器名称" htmlFor="mcp-name"><Input id="mcp-name" value={draft.name} onChange={event => updateDraft('name', event.target.value)} /></Form.Item>
        <Form.Item label="连接方式"><Radio.Group disabled={Boolean(editing || marketConfig)} value={draft.transport} onChange={event => {
          setDraft(current => ({ ...current, transport: event.target.value, secretName: '', secretValue: '' }));
        }} options={[{ label: '本机程序（stdio）', value: 'stdio' }, { label: 'HTTPS', value: 'http' }]} /></Form.Item>
        {draft.transport === 'stdio' ? <>
          <Alert type="warning" showIcon message="测试连接或启用后，该程序可使用当前 Windows 用户的权限运行。" />
          <Form.Item label="可执行程序" htmlFor="mcp-command"><Input id="mcp-command" value={draft.command}
            placeholder="例如 C:\\Tools\\mcp-server.exe" onChange={event => updateDraft('command', event.target.value)} /></Form.Item>
          <Form.Item label="启动参数（每行一个）" htmlFor="mcp-args"><Input.TextArea id="mcp-args" rows={3} value={draft.args}
            onChange={event => updateDraft('args', event.target.value)} /></Form.Item>
        </> : <><Alert type="info" showIcon message="调用工具时，助手提供的工具参数会发送给该 HTTPS 服务。" /><Form.Item label="HTTPS 地址" htmlFor="mcp-url"><Input id="mcp-url" value={draft.url} readOnly={Boolean(marketConfig)}
          placeholder="https://example.com/mcp" onChange={event => updateDraft('url', event.target.value)} /></Form.Item>
          <Form.Item label="协议版本"><Select value={draft.protocolVersion}
            onChange={value => updateDraft('protocolVersion', value)}
            options={['2025-11-25', '2026-07-28'].map(value => ({ value, label: value }))} /></Form.Item>
        </>}
        {marketConfig ? <>
          {marketConfig.inputs.map((item, index) => {
            const Field = item.secret || item.id.toLowerCase() === 'authorization' ? Input.Password : Input;
            const fieldId = 'mcp-market-header-' + index;
            return <Form.Item key={item.id} label={item.label || item.id} required={item.required} htmlFor={fieldId}
              extra={[item.description, item.template ? '会自动加上 ' + item.template.replace('{value}', '').trim() : undefined].filter(Boolean).join(' · ') || undefined}>
              <Field id={fieldId} value={Object.hasOwn(marketValues, item.id) ? marketValues[item.id] : ''} autoComplete="off"
                placeholder={!item.template && item.id.toLowerCase() === 'authorization' ? '例如 Bearer …' : undefined}
                onChange={event => setMarketValues(current => ({ ...current, [item.id]: event.target.value }))} />
            </Form.Item>;
          })}
          <p className="small-note">保存后先在「我的服务器」测试连接，再按需启用。</p>
        </> : <><Form.Item label={draft.transport === 'stdio' ? '环境变量名称（可选）' : '请求头名称（可选）'} htmlFor="mcp-secret-name"
          extra={editing ? `留空保留配置。已有名称：${(draft.transport === 'stdio' ? editing.env_names : editing.header_names).join('、') || '无'}` : '保存后页面只显示名称。'}>
          <Input id="mcp-secret-name" value={draft.secretName} autoComplete="off"
            placeholder={draft.transport === 'stdio' ? 'API_KEY' : 'Authorization'}
            onChange={event => updateDraft('secretName', event.target.value)} />
        </Form.Item>
        <Form.Item label="对应值" htmlFor="mcp-secret-value">
          <Input.Password id="mcp-secret-value" value={draft.secretValue} autoComplete="new-password"
            onChange={event => updateDraft('secretValue', event.target.value)} />
        </Form.Item></>}
        {editorError && <Alert type="error" showIcon message={editorError} />}
      </Form>
    </Modal>
    <Modal title="移除 MCP 服务器" open={Boolean(removeTarget)} okText="移除" cancelText="取消"
      okButtonProps={{ danger: true }} confirmLoading={busy} onCancel={() => { if (!busy) setRemoveTarget(null); }}
      onOk={() => { if (removeTarget && !isLocked(removeTarget)) void act(async () => {
        await request(serverPath(removeTarget), 'DELETE');
        setServers(current => current.filter(item => item.id !== removeTarget.id));
        setRemoveTarget(null);
        setPreview(null);
      }); }}>
      <p>移除「{removeTarget?.name}」及本机保存的连接配置？</p>
    </Modal>
  </div>;
}
