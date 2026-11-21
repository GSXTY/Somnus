import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Spin, Tag } from 'antd';
import { ApiOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import {
  addDiscoveredModels, discoverProviderModels, listProviders, removeCompanyProviderKey, removeModel, saveCompanyProvider, saveModel, saveModelSupplier, setDefaultModel, testModelConnection,
} from '../chat/assistantApi';
import type { Provider, ProviderApi, ProviderConnection, ProviderConnectionTest, ProviderRetry, ReasoningEffort, ModelCapabilities } from '../chat/assistantApi';
import { describeError } from '../shared/errors.mjs';
import './models.css';
import { providerCatalog } from './modelProviderCatalog';

type Supplier = { id: string; name: string; baseUrl: string; builtin?: boolean; groupId?: string; models: Provider[] };
type Editor = {
  setup?: 'catalog' | 'custom';
  preset?: string;
  kind: 'new-supplier' | 'supplier' | 'new-model' | 'model' | 'company';
  supplier?: Supplier;
  id?: string;
  name: string;
  base_url: string;
  api_key: string;
  connection: ProviderConnection;
  auth: 'key' | 'environment' | 'aws';
  model: string;
  vision_enabled: boolean;
  reasoning_efforts: ReasoningEffort[];
  capabilities: ModelCapabilities;
};

function groupProviders(providers: Provider[]) {
  const groups = new Map<string, Supplier>();
  for (const row of providers) {
    const id = row.group_id || (row.builtin ? row.id : JSON.stringify([row.name, row.base_url]));
    const group = groups.get(id);
    if (group) group.models.push(row);
    else groups.set(id, { id, name: row.builtin ? 'DeepSeek' : row.name, baseUrl: row.base_url, builtin: row.builtin, groupId: row.group_id, models: [row] });
  }
  return [...groups.values()];
}

function makeEditor(kind: Editor['kind'], supplier?: Supplier, model?: Provider): Editor {
  return {
    kind, supplier, id: model?.id, setup: kind === 'new-supplier' ? 'catalog' : undefined, name: supplier?.name || '',
    base_url: supplier?.baseUrl || '',
    api_key: '', connection: supplier?.models[0] ? connectionFrom(supplier.models[0]) : { api: 'openai-completions' },
    auth: supplier?.models[0]?.auth_env ? 'environment' : supplier?.models[0]?.api === 'bedrock-converse-stream' && !supplier?.models[0]?.has_api_key ? 'aws' : 'key',
    model: model?.model || '', vision_enabled: Boolean(model?.vision_enabled),
    reasoning_efforts: model?.reasoning_efforts || [],
    capabilities: { context_window: model?.context_window ?? null, max_output_tokens: model?.max_output_tokens ?? null, supports_developer_role: model?.supports_developer_role ?? null, supports_long_cache_retention: model?.supports_long_cache_retention ?? null, cache_retention: model?.cache_retention ?? null },
  };
}

const protocolLabels: Record<ProviderApi, string> = {
  'openai-completions': 'Chat Completions', 'openai-responses': 'Responses',
  'anthropic-messages': 'Anthropic Messages', 'bedrock-converse-stream': 'AWS Bedrock Converse',
};
const protocolOptions = (['openai-completions', 'openai-responses', 'anthropic-messages', 'bedrock-converse-stream'] as const)
  .map(value => ({ value, label: protocolLabels[value] }));
const retryOptions = [
  { value: 'default', label: '默认（暂时性错误）' }, { value: 'none', label: '不重试' },
  { value: 'normal', label: '自定义暂时性错误' }, { value: 'always', label: '重试所有错误' },
];
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;

function connectionFrom(row: Provider): ProviderConnection {
  return { api: row.api ?? 'openai-completions', auth_env: row.auth_env ?? '', region: row.region ?? '', retry_policy: row.retry_policy ?? null };
}

function supplierPayload(editor: Editor) {
  return { name: editor.name.trim(), base_url: editor.base_url.trim(), ...editor.connection,
    auth_env: editor.auth === 'environment' ? editor.connection.auth_env?.trim() || '' : '',
    region: editor.connection.api === 'bedrock-converse-stream' ? editor.connection.region?.trim() || '' : '',
    ...(editor.auth !== 'key' ? { api_key: '' } : editor.api_key.trim() ? { api_key: editor.api_key.trim() } : {}),
  };
}

function RetrySettings({ value, onChange }: { value?: ProviderRetry | null; onChange: (policy: ProviderRetry | null) => void }) {
  const mode = !value ? 'default' : value.mode === 'normal' && value.maxRetries === 0 ? 'none' : value.mode;
  return <>
    <label>重试策略<Select<'default' | 'none' | 'normal' | 'always'> aria-label="重试策略" options={retryOptions} value={mode} onChange={next => {
      onChange(next === 'default' ? null : next === 'none' ? { mode: 'normal', maxRetries: 0 } : { mode: next });
    }} /></label>
    {value && mode !== 'none' && <>
      {mode === 'normal' && <label>最大重试次数<InputNumber min={0} precision={0} value={value.maxRetries}
        onChange={maxRetries => onChange({ ...value, maxRetries: maxRetries ?? undefined })} /></label>}
      {mode === 'normal' && <label>可重试错误代码<Select mode="tags" tokenSeparators={[',']} aria-label="可重试错误代码"
        value={value.retryableCodes} onChange={retryableCodes => onChange({ ...value, retryableCodes: retryableCodes.length ? retryableCodes : undefined })} /></label>}
      <label>初始等待时间（毫秒）<InputNumber min={1} precision={0} value={value.backoff?.initialDelayMs}
        onChange={initialDelayMs => onChange({ ...value, backoff: { ...value.backoff, initialDelayMs: initialDelayMs ?? undefined } })} /></label>
      <label>最长等待时间（毫秒）<InputNumber min={1} precision={0} value={value.backoff?.maxDelayMs}
        onChange={maxDelayMs => onChange({ ...value, backoff: { ...value.backoff, maxDelayMs: maxDelayMs ?? undefined } })} /></label>
      <label>等待时间随机比例<InputNumber min={0} max={1} step={0.1} value={value.backoff?.jitterRatio}
        onChange={jitterRatio => onChange({ ...value, backoff: { ...value.backoff, jitterRatio: jitterRatio ?? undefined } })} /></label>
    </>}
  </>;
}

const editorTitles = { 'new-supplier': '添加供应商', supplier: '编辑供应商', 'new-model': '添加模型', model: '编辑模型', company: 'DeepSeek API Key' };
const deepSeekKeyPage = 'https://platform.deepseek.com/api_keys';
const effortNames = { low: '低', medium: '中', high: '高' };
const effortOptions = (Object.keys(effortNames) as ReasoningEffort[]).map(value => ({ value, label: effortNames[value] }));

export function Models({ windowsDesktop = false }: { windowsDesktop?: boolean } = {}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [active, setActive] = useState('');
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Editor>();
  const [editError, setEditError] = useState('');
  const [testing, setTesting] = useState<string>();
  const [discovered, setDiscovered] = useState<{ models: string[]; connection: Parameters<typeof discoverProviderModels>[0] }>();
  const [checked, setChecked] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [modelFetch, setModelFetch] = useState(false);
  const discoveryRequest = useRef<AbortController | undefined>(undefined);
  const [outcomes, setOutcomes] = useState<Record<string, ProviderConnectionTest>>({});
  async function notifyRuntimeChange() {
    if (!window.vvmanAcp?.nativeConfigChanged) return;
    try { await window.vvmanAcp.nativeConfigChanged(); }
    catch { /* The catalog also observes saved configuration periodically. */ }
  }

  async function load(signal?: AbortSignal, preferredId?: string) {
    try {
      const data = await listProviders(signal);
      if (signal?.aborted) return;
      setProviders(windowsDesktop ? data.providers.filter(provider => !provider.builtin) : data.providers);
      setActive(data.active);
      if (preferredId) setSelected(preferredId);
      setError('');
    } catch (failure) {
      if (!signal?.aborted) setError(describeError(failure, '读取供应商失败'));
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => { abort.abort(); discoveryRequest.current?.abort(); };
  }, []);

  const normalized = query.trim().toLowerCase();
  const groups = groupProviders(providers);
  const matches = groups.filter(item => [item.name, item.baseUrl, ...item.models.map(model => model.model)].some(value => value.toLowerCase().includes(normalized)));
  const supplier = matches.find(item => item.id === selected) || matches.find(item => item.models.some(model => model.id === active)) || matches[0];

  function edit(kind: Editor['kind'], group?: Supplier, model?: Provider) {
    setEditError('');
    setEditor(makeEditor(kind, group, model));
  }
  async function submit() {
    if (!editor || busy || editor.kind === 'company' && !editor.api_key.trim()) return;
    const cap = editor.capabilities;
    if (cap.context_window && cap.max_output_tokens && cap.max_output_tokens >= cap.context_window) { setEditError('最大输出必须小于上下文窗口。'); return; }
    if (cap.context_window && cap.max_output_tokens && cap.max_output_tokens > cap.context_window - Math.min(8192, Math.floor(cap.context_window / 2))) { setEditError('最大输出过大，请为输入、工具和压缩保留至少 ' + Math.min(8192, Math.floor(cap.context_window / 2)) + ' tokens。'); return; }
    if (cap.cache_retention === 'long' && cap.supports_long_cache_retention !== true) { setEditError('选择长期缓存前，请先确认服务支持长期缓存。'); return; }
    setBusy(true);
    setEditError('');
    const { kind, supplier: group, id, model, vision_enabled, reasoning_efforts, api_key } = editor;
    try {
      const modelFields = { model: model.trim(), vision_enabled, reasoning_efforts, ...editor.capabilities };
      const supplierFields = supplierPayload(editor);
      let preferredId = group?.id;
      if (kind === 'company') {
        await saveCompanyProvider(api_key.trim());
        if (id) setOutcomes(old => Object.fromEntries(Object.entries(old).filter(([key]) => key !== id)));
      } else if (kind === 'supplier' && group?.groupId) {
        await saveModelSupplier(group.groupId, supplierFields);
        setOutcomes({});
      } else {
        const row = await saveModel(kind === 'new-supplier' ? { ...modelFields, ...supplierFields }
          : kind === 'new-model' ? { ...modelFields, group_id: group?.groupId } : modelFields, id);
        preferredId = row.group_id || preferredId;
        setOutcomes(old => Object.fromEntries(Object.entries(old).filter(([key]) => key !== row.id)));
      }
      setEditor(undefined);
      setQuery('');
      await load(undefined, preferredId);
      await notifyRuntimeChange();
    } catch (failure) { setEditError(describeError(failure, '无法保存配置')); }
    finally { setBusy(false); }
  }

  async function fetchModels(group?: Supplier) {
    if (modelFetch || busy || (!group && editor?.kind !== 'new-supplier')) return;
    const fields = group?.groupId ? { group_id: group.groupId }
      : supplierPayload(editor!);
    const controller = new AbortController();
    discoveryRequest.current = controller;
    setModelFetch(true);
    if (group) setError(''); else setEditError('');
    try {
      const entries = await discoverProviderModels(fields, controller.signal);
      if (controller.signal.aborted) return;
      const existing = new Set(group?.models.map(model => model.model));
      const candidates = entries.filter(model => !existing.has(model));
      if (!candidates.length) throw Error('没有可添加的模型，可手工填写模型 ID。');
      setDiscovered({ models: candidates, connection: fields });
      setChecked([]);
      setModelQuery('');
    } catch (failure) {
      if (!controller.signal.aborted) {
        const message = describeError(failure, '无法获取模型');
        if (group) setError(message); else setEditError(message);
      }
    } finally {
      if (!controller.signal.aborted) setModelFetch(false);
    }
  }

  async function saveDiscovered() {
    if (!checked.length || checked.length > 64 || busy) return;
    if (!discovered) return;
    const fields = discovered.connection;
    setBusy(true);
    try {
      const added = await addDiscoveredModels({ ...fields, models: checked });
      setDiscovered(undefined);
      setEditor(undefined);
      setQuery('');
      await load(undefined, added[0]?.group_id);
      await notifyRuntimeChange();
    } catch (failure) { setError(describeError(failure, '无法保存模型')); }
    finally { setBusy(false); }
  }

  async function removeCompanyKey() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await removeCompanyProviderKey();
      await notifyRuntimeChange();
      setOutcomes({});
      await load();
    } catch (failure) { setError(describeError(failure, '无法移除密钥')); }
    finally { setBusy(false); }
  }

  async function updateModel(id: string, operation: 'default' | 'remove') {
    setBusy(true);
    setError('');
    try {
      if (operation === 'default') await setDefaultModel(id);
      else await removeModel(id);
      await notifyRuntimeChange();
      await load();
    } catch (failure) { setError(describeError(failure, '无法更新模型')); }
    finally { setBusy(false); }
  }

  async function test(id: string) {
    if (testing) return;
    setTesting(id);
    try {
      const result = await testModelConnection(id);
      setOutcomes(old => ({ ...old, [id]: result }));
      if (result.ok) await notifyRuntimeChange();
    } catch (failure) {
      setOutcomes(old => ({ ...old, [id]: { ok: false, code: '', message: describeError(failure, '无法完成连接测试'), elapsed_ms: 0 } }));
    } finally { setTesting(undefined); }
  }

  const supplierEditor = editor?.kind === 'supplier' || editor?.kind === 'new-supplier';
  const companyEditor = editor?.kind === 'company';
  const managedCompany = Boolean(supplier?.builtin && supplier.models.some(item => item.requires_api_key));
  const keyConfigured = Boolean(supplier?.models.some(item => item.api_key_masked && item.api_key_masked !== '未配置'));
  const modelEditor = editor?.kind !== 'supplier' && !companyEditor;
  const locked = busy || modelFetch || Boolean(testing);
  const protocol = editor?.connection.api ?? 'openai-completions';
  const bedrock = protocol === 'bedrock-converse-stream';
  const supplierProtocol = supplier?.models[0]?.api ?? 'openai-completions';
  const supplierFieldsMissing = Boolean(editor && (!editor.name.trim() || (!bedrock && !editor.base_url.trim()) ||
    editor.auth === 'environment' && !envName.test(editor.connection.auth_env?.trim() || '')));
  const supplierPreset = providerCatalog.find(item => item.id === editor?.preset);
  return <div className="provider-page">
    {error && <Alert type="error" showIcon message={error} />}
    <div className="provider-layout">
      <aside className="provider-list" aria-label="模型供应商">
        <div className="provider-list-head"><h2>模型供应商</h2><Button type="text" icon={<PlusOutlined />} aria-label="添加供应商" title="添加供应商"
          disabled={locked || loading} onClick={() => edit('new-supplier')} /></div>
        <Input value={query} allowClear prefix={<SearchOutlined />} placeholder="搜索供应商或模型" aria-label="搜索供应商或模型" onChange={event => setQuery(event.target.value)} />
        {loading ? <Spin size="small" /> : !matches.length && <p className="small-note">{normalized ? '没有匹配的供应商或模型。' : '暂无供应商。'}</p>}
        <div className="provider-list-items">{matches.map(item => <button key={item.id} type="button" aria-pressed={supplier?.id === item.id}
          onClick={() => setSelected(item.id)}>
          <span className="provider-symbol" aria-hidden="true"><ApiOutlined /></span>
          <span><strong>{item.name}</strong><small>{item.models.length} 个模型</small></span>
        </button>)}</div>
      </aside>
      <section className="provider-detail" aria-label="供应商详情">
        {supplier ? <>
          <div className="provider-detail-head">
            <div><h2>{supplier.name}</h2><div>{managedCompany ? '使用 DeepSeek 开放平台' : supplier.builtin ? '默认供应商' : windowsDesktop ? 'DSH runtime · ' + protocolLabels[supplierProtocol] : protocolLabels[supplierProtocol]}</div></div>
            {managedCompany && windowsDesktop && <div className="provider-model-actions">
              <Button disabled={locked} onClick={() => edit('company', supplier, supplier.models[0])}>
                {keyConfigured ? '更换 API Key' : '填写 API Key'}
              </Button>
              {keyConfigured && <Popconfirm title="移除 DeepSeek API Key？" description="重新填写密钥前，默认模型将暂停使用。"
                okText="移除" cancelText="取消" onConfirm={removeCompanyKey}>
                <Button disabled={locked}>移除 API Key</Button>
              </Popconfirm>}
            </div>}
            {!supplier.builtin && supplier.groupId && <Button disabled={locked} onClick={() => edit('supplier', supplier)}>编辑供应商</Button>}
          </div>
          <dl className="provider-credentials">
            <div><dt>接口地址</dt><dd>{supplier.baseUrl || (supplierProtocol === 'bedrock-converse-stream' ? '按 AWS 区域选择' : '未配置')}</dd></div>
            <div><dt>认证</dt><dd>{supplier.models[0]?.auth_env
              ? `${supplier.models[0].auth_env} · ${supplier.models[0].auth_env_present ? '已检测' : '未检测'}`
              : keyConfigured ? 'API Key 已配置' : supplierProtocol === 'bedrock-converse-stream' ? 'AWS 原生凭据' : '未配置'}</dd></div>
            {supplierProtocol === 'bedrock-converse-stream' && <div><dt>AWS 区域</dt><dd>{supplier.models[0]?.region || 'AWS_REGION / AWS_DEFAULT_REGION'}</dd></div>}
            <div><dt>连接配置</dt><dd>{supplier.models.some(item => item.configured) ? '可测试' : '待配置'}</dd></div>
          </dl>
          {managedCompany && !keyConfigured && <Alert type="warning" showIcon message="尚未填写 DeepSeek API Key" />}
          {managedCompany && <p className="small-note">使用你在 DeepSeek 开放平台创建的 API Key。查询数据库仍需单独配置数据网关。</p>}
          <div className="provider-models-head"><h3>模型</h3>{!supplier.builtin && supplier.groupId &&
            <span>{supplierProtocol !== 'bedrock-converse-stream' && <Button size="small" loading={modelFetch} disabled={locked} onClick={() => void fetchModels(supplier)}>获取可用模型</Button>}{' '}
            <Button size="small" icon={<PlusOutlined />} disabled={locked} onClick={() => edit('new-model', supplier)}>添加模型</Button></span>}</div>
          <div className="provider-models">{supplier.models.map(model => {
            const result = outcomes[model.id];
            return <div className="provider-model-row" key={model.id}>
              <div className="provider-model-title"><strong>{model.model || '未设置模型'}</strong>{!windowsDesktop && active === model.id && <Tag color="blue">默认</Tag>}</div>
              <div className="provider-model-capabilities">
                {model.vision_enabled && <Tag>图片</Tag>}
                {model.context_window && <Tag>上下文 {new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(model.context_window)}</Tag>}
                {model.max_output_tokens && <Tag>最大输出 {new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(model.max_output_tokens)}</Tag>}
                {model.cache_retention === 'long' && <Tag>长期缓存</Tag>}
                {Boolean(model.reasoning_efforts?.length) && <Tag>推理 · {model.reasoning_efforts?.map(effort => effortNames[effort]).join(' / ')}</Tag>}
              </div>
              <div className="provider-model-actions">
                {supplierProtocol !== 'bedrock-converse-stream' && <Button size="small" loading={testing === model.id} disabled={busy || Boolean(testing && testing !== model.id) || !model.configured} onClick={() => void test(model.id)}>测试连接</Button>}
                {!windowsDesktop && active !== model.id && <Button size="small" type="text" disabled={locked || !model.configured} onClick={() => void updateModel(model.id, 'default')}>设为默认</Button>}
                {!model.builtin && <><Button size="small" type="text" disabled={locked} onClick={() => edit('model', supplier, model)}>编辑</Button>
                  <Popconfirm title="移除这个模型？" description={active === model.id && !windowsDesktop ? '默认模型将切回内置模型。' : undefined}
                    onConfirm={() => updateModel(model.id, 'remove')} okText="移除" cancelText="取消">
                    <Button size="small" type="text" danger disabled={locked}>移除</Button>
                  </Popconfirm></>}
              </div>
              {result && <Alert type={result.ok ? 'success' : 'error'} showIcon message={result.message}
                description={result.elapsed_ms > 0 ? '耗时 ' + (result.elapsed_ms / 1000).toFixed(1) + ' 秒' : undefined} />}
            </div>;
          })}</div>
        </> : !loading && (normalized
          ? <p className="small-note">没有匹配的供应商。</p>
          : <div className="provider-empty">
              <span className="provider-empty-icon" aria-hidden="true"><ApiOutlined /></span>
              <h2>还没有配置供应商</h2>
              <p>添加模型供应商后，可在聊天中选择其模型。</p>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => edit('new-supplier')}>添加供应商</Button>
            </div>)}
      </section>
    </div>
    <Modal title="选择模型" open={Boolean(discovered)} onCancel={() => { if (!busy) setDiscovered(undefined); }}
      onOk={() => void saveDiscovered()} confirmLoading={busy} okText="添加所选模型" cancelText="取消"
      okButtonProps={{ disabled: !checked.length }}>
      <Input allowClear value={modelQuery} placeholder="搜索模型" onChange={event => setModelQuery(event.target.value)} />
      <div style={{ marginBlock: 10 }}>已选择 {checked.length} 个模型 <Button type="link" onClick={() => setChecked([])}>清空选择</Button></div>
      <div style={{ maxHeight: 355, overflowY: 'auto', display: 'grid', gap: 10 }}>
        {discovered?.models.filter(model => model.toLowerCase().includes(modelQuery.trim().toLowerCase())).map(model =>
          <Checkbox key={model} checked={checked.includes(model)} disabled={checked.length >= 64 && !checked.includes(model)}
            onChange={event => setChecked(old => event.target.checked ? [...old, model] : old.filter(item => item !== model))}>{model}</Checkbox>)}
      </div>
      {error && <Alert type="error" showIcon message={error} />}
    </Modal>
    <Modal title={editor && editorTitles[editor.kind]} styles={{ body: { maxHeight: 'min(70vh, 720px)', overflowY: 'auto', paddingRight: 6 } }} open={Boolean(editor) && !discovered} onCancel={() => { if (!busy && !modelFetch) setEditor(undefined); }}
      onOk={() => void submit()} okText="保存" cancelText="取消" confirmLoading={busy}
      okButtonProps={{ disabled: modelFetch || !editor || Boolean(supplierEditor && supplierFieldsMissing) ||
        Boolean(companyEditor && !editor.api_key.trim()) ||
        Boolean(modelEditor && !editor.model.trim()) }}>
      {editor && <div className="provider-editor">
        {windowsDesktop && editor.kind === 'new-supplier' && <div className="provider-setup">
          <Segmented<"catalog" | "custom"> block aria-label="供应商添加方式" value={editor.setup ?? 'catalog'}
            options={[{ value: 'catalog', label: '供应商目录' }, { value: 'custom', label: '自定义 API' }]}
            onChange={setup => setEditor({ ...makeEditor('new-supplier'), setup })} />
          <p>{editor.setup === 'custom'
            ? '选择 API 协议，填写服务地址、认证和模型。'
            : '从目录选择供应商，并配置其认证和模型。'}</p>
          {editor.setup !== 'custom' && <label>供应商<Select aria-label="供应商目录" value={editor.preset}
            showSearch optionFilterProp="label" placeholder="请选择供应商" options={providerCatalog.map(item => ({ value: item.id, label: item.name }))}
            onChange={preset => {
              const item = providerCatalog.find(entry => entry.id === preset);
              if (item) setEditor({ ...editor, preset, name: item.name, base_url: item.baseUrl, api_key: '', model: '',
                auth: item.api === 'bedrock-converse-stream' ? 'aws' : 'key', connection: { api: item.api ?? 'openai-completions' } });
            }} /></label>}
        </div>}
        {supplierEditor && <>
          {!(windowsDesktop && editor.kind === 'new-supplier' && editor.setup === 'catalog') && <label>供应商名称<Input value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>}
          <label>API 协议<Select aria-label="API 协议" options={protocolOptions} value={protocol} onChange={api => {
            setEditor({ ...editor, auth: api === 'bedrock-converse-stream' ? 'aws' : 'key', connection: { ...editor.connection, api, auth_env: '', region: '' }, capabilities: { ...editor.capabilities, ...(api === 'anthropic-messages' || api === 'bedrock-converse-stream' ? { supports_developer_role: null } : {}), ...(api === 'bedrock-converse-stream' ? { supports_long_cache_retention: null, cache_retention: editor.capabilities.cache_retention === 'long' ? null : editor.capabilities.cache_retention } : {}) } });
          }} /></label>
          <label>认证方式<Select aria-label="认证方式" value={editor.auth} options={[
            { value: 'key', label: 'API Key' }, { value: 'environment', label: '环境变量' },
            ...(bedrock ? [{ value: 'aws', label: 'AWS 原生凭据' }] : []),
          ]} onChange={auth => setEditor({ ...editor, auth, connection: { ...editor.connection,
            auth_env: auth === 'environment' ? editor.connection.auth_env || supplierPreset?.env || '' : '' } })} /></label>
          {editor.auth === 'key' && <label>{bedrock ? 'AWS Bedrock Bearer Token' : 'API Key'}<Input.Password autoComplete="new-password"
            placeholder={editor.kind === 'supplier' ? '留空保留现有密钥' : '输入 API Key'}
            value={editor.api_key} onChange={event => setEditor({ ...editor, api_key: event.target.value })} /></label>}
          {editor.auth === 'environment' && <label>凭据环境变量<Input aria-label="凭据环境变量" autoComplete="off" placeholder={supplierPreset?.env || 'OPENAI_API_KEY'}
            value={editor.connection.auth_env} onChange={event => setEditor({ ...editor, connection: { ...editor.connection, auth_env: event.target.value } })} /></label>}
          {editor.auth === 'aws' && <p className="small-note">由 AWS SDK 读取本机 AWS 配置、SSO 或环境变量。</p>}
          <details className="provider-advanced" open={editor.setup === 'custom' || undefined}>
            <summary>高级设置</summary>
            <label>接口地址<Input aria-label="接口地址" placeholder={bedrock ? '留空，按 AWS 区域选择' : 'https://api.example.com/v1'}
              value={editor.base_url} onChange={event => setEditor({ ...editor, base_url: event.target.value })} /></label>
            {bedrock && <label>AWS 区域<Input placeholder="AWS_REGION / AWS_DEFAULT_REGION" value={editor.connection.region}
              onChange={event => setEditor({ ...editor, connection: { ...editor.connection, region: event.target.value } })} /></label>}
            <RetrySettings value={editor.connection.retry_policy} onChange={retry_policy => setEditor({ ...editor, connection: { ...editor.connection, retry_policy } })} />
          </details>
        </>}
        {companyEditor && <>
          <p>在 DeepSeek 开放平台创建密钥，再粘贴到下方。</p>
          <a href={deepSeekKeyPage} target="_blank" rel="noreferrer">打开 DeepSeek API Keys</a>
          <label>API Key<Input.Password autoComplete="new-password" placeholder="粘贴 DeepSeek API Key"
            value={editor.api_key} onChange={event => setEditor({ ...editor, api_key: event.target.value })} /></label>
        </>}
        {editor.kind === 'new-supplier' && !bedrock && <Button loading={modelFetch} disabled={supplierFieldsMissing || editor.auth === 'key' && !editor.api_key.trim()}
          onClick={() => void fetchModels()}>获取可用模型</Button>}
        {modelEditor && <>
          <label>模型 ID<Input value={editor.model} onChange={event => setEditor({ ...editor, model: event.target.value })} /></label>
          <Checkbox checked={editor.vision_enabled} onChange={event => setEditor({ ...editor, vision_enabled: event.target.checked })}>模型支持图片</Checkbox>
          <label>模型支持的推理档位<Select mode="multiple" aria-label="模型支持的推理档位" value={editor.reasoning_efforts}
            options={effortOptions} onChange={reasoning_efforts => setEditor({ ...editor, reasoning_efforts })} /></label>
          <details className="provider-advanced provider-model-advanced">
            <summary>模型能力</summary>
            <p className="small-note">留空使用兼容默认值。请按模型与 API 服务实际支持的能力填写，配置不会增加服务本身的额度或能力。</p>
            <label>上下文窗口（tokens）<InputNumber aria-label="上下文窗口" min={1024} max={10000000} precision={0} placeholder="自动" value={editor.capabilities.context_window}
              onChange={context_window => setEditor({ ...editor, capabilities: { ...editor.capabilities, context_window } })} /></label>
            <label>最大输出（tokens）<InputNumber aria-label="最大输出" min={1} max={1000000} precision={0} placeholder="自动" value={editor.capabilities.max_output_tokens}
              onChange={max_output_tokens => setEditor({ ...editor, capabilities: { ...editor.capabilities, max_output_tokens } })} /></label>
            <label>Developer 角色<Select aria-label="Developer 角色" disabled={protocol === 'anthropic-messages' || bedrock}
              value={editor.capabilities.supports_developer_role == null ? 'auto' : editor.capabilities.supports_developer_role ? 'yes' : 'no'}
              options={[{ value: 'auto', label: '自动（兼容默认）' }, { value: 'yes', label: '服务支持' }, { value: 'no', label: '不支持' }]}
              onChange={value => setEditor({ ...editor, capabilities: { ...editor.capabilities, supports_developer_role: value === 'auto' ? null : value === 'yes' } })} /></label>
            {(protocol === 'anthropic-messages' || bedrock) && <small className="small-note">此原生协议不使用 Developer 角色。</small>}
            <label>长期缓存能力<Select aria-label="长期缓存能力" disabled={bedrock}
              value={editor.capabilities.supports_long_cache_retention == null ? 'auto' : editor.capabilities.supports_long_cache_retention ? 'yes' : 'no'}
              options={[{ value: 'auto', label: '自动（兼容默认）' }, { value: 'yes', label: '服务支持' }, { value: 'no', label: '不支持' }]}
              onChange={value => setEditor({ ...editor, capabilities: { ...editor.capabilities, supports_long_cache_retention: value === 'auto' ? null : value === 'yes', ...(value !== 'yes' && editor.capabilities.cache_retention === 'long' ? { cache_retention: null } : {}) } })} /></label>
            <label>缓存策略<Select aria-label="缓存策略" value={editor.capabilities.cache_retention || 'auto'} options={[
              { value: 'auto', label: '自动（运行时默认）' }, { value: 'none', label: '关闭' }, { value: 'short', label: '短期' },
              { value: 'long', label: '长期', disabled: bedrock || editor.capabilities.supports_long_cache_retention !== true },
            ]} onChange={value => setEditor({ ...editor, capabilities: { ...editor.capabilities, cache_retention: value === 'auto' ? null : value as 'none' | 'short' | 'long' } })} /></label>
            {bedrock && <small className="small-note">当前 Bedrock 连接支持关闭或短期缓存；长期缓存暂未接入。</small>}
            <small className="small-note">缓存是否命中及保留时长由上游服务决定。重试策略在供应商的高级设置中配置。</small>
          </details>
        </>}
        {editError && <Alert type="error" showIcon message={editError} />}
      </div>}
    </Modal>
  </div>;
}
