import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Radio, Select, Space, Tabs, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { McpMarket } from './McpMarket';
import type { MarketServer, MarketVariant } from './McpMarket';

type Server = {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  protocol_version?: string;
  env_names: string[];
  header_names: string[];
  status: 'disabled' | 'idle' | 'ready' | 'error';
  tools: Array<{ name: string; description?: string }>;
  error?: string;
  tool_permissions?: Record<string, 'read' | 'confirm'>;
};

type Draft = { name: string; transport: Server['transport']; command: string; args: string; url: string; protocolVersion: string; secretName: string; secretValue: string };
const blank: Draft = { name: '', transport: 'stdio', command: '', args: '', url: '', protocolVersion: '2025-11-25', secretName: '', secretValue: '' };
const endpoint = '/api/mcp/servers';
const labels = { disabled: '已停用', idle: '未测试', ready: '已连接', error: '连接失败' };
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<Server | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Server | null>(null);
  const [preview, setPreview] = useState<Server | null>(null);
  const [tab, setTab] = useState('installed');
  const [marketConfig, setMarketConfig] = useState<MarketVariant>();
  const [marketValues, setMarketValues] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);

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
      closeEditor();
      if (marketConfig) setTab('installed');
    }, setEditorError);
  }

  function serverPath(server: Server) { return endpoint + '/' + encodeURIComponent(server.id); }

  const installed = <Card className="panel-card" title="我的 MCP 服务器" extra={<Space wrap>
    <Button disabled={busy} onClick={() => importInput.current?.click()}>导入 JSON</Button>
    <Button type="primary" icon={<PlusOutlined />} disabled={busy} onClick={() => showEditor()}>添加 MCP 服务器</Button>
  </Space>}>
    <input type="file" hidden ref={importInput} accept=".json,application/json" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void act(async () => {
        if (file.size > 256 * 1024) throw new Error('配置文件不能超过 256 KB');
        let config: unknown;
        try { config = JSON.parse(await file.text()); } catch { throw new Error('无法读取 JSON 配置'); }
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('请选择 MCP 配置对象');
        const imported = await request<{ servers: Server[] }>(endpoint + '/import', 'POST', config);
        setServers(current => [...current.filter(item => !imported.servers.some(server => server.id === item.id)), ...imported.servers]);
      });
    }} />
    <p className="small-note">连接本机程序或 HTTPS 服务器，为助手提供额外工具。</p>
    {error && <Alert type="error" showIcon message={error} />}
    {!servers.length && !busy && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有添加 MCP 服务器" />}
    {servers.map(server => <div key={server.id} className="plugins-route">
      <div><strong>{server.name}</strong><small>{server.transport === 'stdio' ? '本机程序 · stdio' : 'HTTPS · Streamable HTTP'}</small>
        <Tag color={server.status === 'ready' ? 'success' : server.status === 'error' ? 'error' : 'default'}>
          {labels[server.status]}
        </Tag>{server.error && <small>{server.error}</small>}</div>
      <Space wrap size={4}>
        <Button size="small" disabled={busy} onClick={() => void act(async () => {
          const result = await request<{ server: Server }>(serverPath(server) + '/test', 'POST', {});
          updateServer(result.server);
          setPreview(result.server);
        })}>测试连接</Button>
        <Button size="small" disabled={busy || !server.tools.length} onClick={() => setPreview(server)}>查看工具（{server.tools.length}）</Button>
        <Button size="small" disabled={busy} onClick={() => void act(async () => {
          const result = await request<{ server: Server }>(serverPath(server), 'PUT', { enabled: !server.enabled });
          updateServer(result.server);
        })}>{server.enabled ? '停用' : '启用'}</Button>
        <Button size="small" disabled={busy} onClick={() => showEditor(server)}>编辑</Button>
        <Button size="small" type="text" danger disabled={busy} onClick={() => setRemoveTarget(server)}>移除</Button>
      </Space>
    </div>)}
  </Card>;

  return <>
    <Tabs className="mcp-config" type="card" activeKey={tab} onChange={setTab} items={[
      { key: 'installed', label: '我的服务器', children: installed },
      { key: 'market', label: 'MCP 市场', children: <McpMarket active={tab === 'market'} disabled={busy} onSelect={showMarketEditor} /> },
    ]} />
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
      onOk={() => { if (removeTarget) void act(async () => {
        await request(serverPath(removeTarget), 'DELETE');
        setServers(current => current.filter(item => item.id !== removeTarget.id));
        setRemoveTarget(null);
      }); }}>
      <p>移除「{removeTarget?.name}」及本机保存的连接配置？</p>
    </Modal>
    <Modal title={preview ? `${preview.name} · 工具` : 'MCP 工具'} open={Boolean(preview)}
      footer={<Button onClick={() => setPreview(null)}>关闭</Button>} onCancel={() => setPreview(null)}>
      {preview?.error && <Alert type="error" showIcon message={preview.error} />}
      {preview?.tools.length ? <>
        <p>仅将确定不会产生写入或外部副作用的工具标为只读。其余工具逐次确认后执行。</p>
        {error && <Alert type="error" showIcon message={error} />}
        <ul>{preview.tools.map(tool =>
          <li key={tool.name}>
            <strong>{tool.name}</strong>{tool.description && <p>{tool.description}</p>}
            <Select size="small" aria-label={tool.name + ' 权限'} disabled={busy}
              value={preview.tool_permissions?.[tool.name] || 'confirm'} options={[
                { value: 'confirm', label: '执行前确认' }, { value: 'read', label: '只读' },
              ]} onChange={value => void act(async () => {
                const result = await request<{ server: Server }>(serverPath(preview), 'PUT', {
                  tool_permissions: { ...preview.tool_permissions, [tool.name]: value },
                });
                updateServer(result.server);
                setPreview(result.server);
              })} />
          </li>)}</ul>
      </> : <p>服务器未返回工具。</p>}
    </Modal>
  </>;
}
