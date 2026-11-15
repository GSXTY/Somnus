import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Popconfirm, Select, Spin, Tag } from 'antd';
import { ApiOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import {
  listProviders, removeModel, saveModel, saveModelSupplier, setDefaultModel, testModelConnection,
} from './assistantApi';
import type { Provider, ProviderConnectionTest, ReasoningEffort } from './assistantApi';
import { describeError } from './errors.mjs';
import './models.css';

type Supplier = { id: string; name: string; baseUrl: string; builtin?: boolean; groupId?: string; models: Provider[] };
type Editor = {
  kind: 'new-supplier' | 'supplier' | 'new-model' | 'model';
  supplier?: Supplier;
  id?: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  vision_enabled: boolean;
  reasoning_efforts: ReasoningEffort[];
};

function groupProviders(providers: Provider[]) {
  const groups = new Map<string, Supplier>();
  for (const row of providers) {
    const id = row.group_id || (row.builtin ? row.id : JSON.stringify([row.name, row.base_url]));
    const group = groups.get(id);
    if (group) group.models.push(row);
    else groups.set(id, { id, name: row.builtin ? '公司默认' : row.name, baseUrl: row.base_url, builtin: row.builtin, groupId: row.group_id, models: [row] });
  }
  return [...groups.values()];
}

function makeEditor(kind: Editor['kind'], supplier?: Supplier, model?: Provider): Editor {
  return {
    kind, supplier, id: model?.id, name: supplier?.name || '', base_url: supplier?.baseUrl || '',
    api_key: '', model: model?.model || '', vision_enabled: Boolean(model?.vision_enabled),
    reasoning_efforts: model?.reasoning_efforts || [],
  };
}

const editorTitles = { 'new-supplier': '添加供应商', supplier: '编辑供应商', 'new-model': '添加模型', model: '编辑模型' };
const effortNames = { low: '低', medium: '中', high: '高' };
const effortOptions = (Object.keys(effortNames) as ReasoningEffort[]).map(value => ({ value, label: effortNames[value] }));

export function Models() {
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
  const [outcomes, setOutcomes] = useState<Record<string, ProviderConnectionTest>>({});

  async function load(signal?: AbortSignal, preferredId?: string) {
    try {
      const data = await listProviders(signal);
      if (signal?.aborted) return;
      setProviders(data.providers);
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
    return () => abort.abort();
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
    if (!editor || busy) return;
    setBusy(true);
    setEditError('');
    const { kind, supplier: group, id, model, vision_enabled, reasoning_efforts, name, base_url, api_key } = editor;
    try {
      const modelFields = { model: model.trim(), vision_enabled, reasoning_efforts };
      const supplierFields = { name: name.trim(), base_url: base_url.trim(), ...(api_key ? { api_key } : {}) };
      let preferredId = group?.id;
      if (kind === 'supplier' && group?.groupId) {
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
    } catch (failure) { setEditError(describeError(failure, '无法保存配置')); }
    finally { setBusy(false); }
  }

  async function updateModel(id: string, operation: 'default' | 'remove') {
    setBusy(true);
    setError('');
    try {
      if (operation === 'default') await setDefaultModel(id);
      else await removeModel(id);
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
    } catch (failure) {
      setOutcomes(old => ({ ...old, [id]: { ok: false, code: '', message: describeError(failure, '无法完成连接测试'), elapsed_ms: 0 } }));
    } finally { setTesting(undefined); }
  }

  const supplierEditor = editor?.kind === 'supplier' || editor?.kind === 'new-supplier';
  const modelEditor = editor?.kind !== 'supplier';
  const locked = busy || Boolean(testing);
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
            <div><h2>{supplier.name}</h2><div>{supplier.builtin ? '由公司配置' : '兼容 OpenAI 的 API'}</div></div>
            {!supplier.builtin && supplier.groupId && <Button disabled={locked} onClick={() => edit('supplier', supplier)}>编辑供应商</Button>}
          </div>
          <dl className="provider-credentials">
            <div><dt>接口地址</dt><dd>{supplier.baseUrl || '未配置'}</dd></div>
            <div><dt>API Key</dt><dd>{supplier.models.some(item => item.api_key_masked && item.api_key_masked !== '未配置') ? '已配置' : '未配置'}</dd></div>
            <div><dt>连接配置</dt><dd>{supplier.models.some(item => item.configured) ? '可测试' : '待配置'}</dd></div>
          </dl>
          <div className="provider-models-head"><h3>模型</h3>{!supplier.builtin && supplier.groupId &&
            <Button size="small" icon={<PlusOutlined />} disabled={locked} onClick={() => edit('new-model', supplier)}>添加模型</Button>}</div>
          <div className="provider-models">{supplier.models.map(model => {
            const result = outcomes[model.id];
            return <div className="provider-model-row" key={model.id}>
              <div className="provider-model-title"><strong>{model.model || '未设置模型'}</strong>{active === model.id && <Tag color="blue">默认</Tag>}</div>
              <div className="provider-model-capabilities">
                {model.vision_enabled && <Tag>图片</Tag>}
                {Boolean(model.reasoning_efforts?.length) && <Tag>推理 · {model.reasoning_efforts?.map(effort => effortNames[effort]).join(' / ')}</Tag>}
              </div>
              <div className="provider-model-actions">
                <Button size="small" loading={testing === model.id} disabled={busy || Boolean(testing && testing !== model.id) || !model.configured} onClick={() => void test(model.id)}>测试连接</Button>
                {active !== model.id && <Button size="small" type="text" disabled={locked || !model.configured} onClick={() => void updateModel(model.id, 'default')}>设为默认</Button>}
                {!model.builtin && <><Button size="small" type="text" disabled={locked} onClick={() => edit('model', supplier, model)}>编辑</Button>
                  <Popconfirm title="移除这个模型？" description={active === model.id ? '默认模型将切回内置模型。' : undefined}
                    onConfirm={() => updateModel(model.id, 'remove')} okText="移除" cancelText="取消">
                    <Button size="small" type="text" danger disabled={locked}>移除</Button>
                  </Popconfirm></>}
              </div>
              {result && <Alert type={result.ok ? 'success' : 'error'} showIcon message={result.message}
                description={result.elapsed_ms > 0 ? '耗时 ' + (result.elapsed_ms / 1000).toFixed(1) + ' 秒' : undefined} />}
            </div>;
          })}</div>
        </> : !loading && <p className="small-note">选择供应商查看模型和连接设置。</p>}
      </section>
    </div>
    <Modal title={editor && editorTitles[editor.kind]} open={Boolean(editor)} onCancel={() => { if (!busy) setEditor(undefined); }}
      onOk={() => void submit()} okText="保存" cancelText="取消" confirmLoading={busy}
      okButtonProps={{ disabled: !editor || Boolean(supplierEditor && (!editor.name.trim() || !editor.base_url.trim())) || Boolean(modelEditor && !editor.model.trim()) }}>
      {editor && <div className="provider-editor">
        {supplierEditor && <>
          <label>供应商名称<Input value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
          <label>接口地址<Input placeholder="https://api.example.com/v1" value={editor.base_url} onChange={event => setEditor({ ...editor, base_url: event.target.value })} /></label>
          <label>API Key<Input.Password autoComplete="new-password" placeholder={editor.kind === 'supplier' ? '留空保留现有密钥' : '输入 API Key'}
            value={editor.api_key} onChange={event => setEditor({ ...editor, api_key: event.target.value })} /></label>
        </>}
        {modelEditor && <>
          <label>模型 ID<Input value={editor.model} onChange={event => setEditor({ ...editor, model: event.target.value })} /></label>
          <Checkbox checked={editor.vision_enabled} onChange={event => setEditor({ ...editor, vision_enabled: event.target.checked })}>模型支持图片</Checkbox>
          <label>模型支持的推理档位<Select mode="multiple" aria-label="模型支持的推理档位" value={editor.reasoning_efforts}
            options={effortOptions} onChange={reasoning_efforts => setEditor({ ...editor, reasoning_efforts })} /></label>
        </>}
        {editError && <Alert type="error" showIcon message={editError} />}
      </div>}
    </Modal>
  </div>;
}
