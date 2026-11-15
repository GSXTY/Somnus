import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Space, Spin, Table, Tag, Tooltip } from 'antd';
import { DatabaseOutlined, PlayCircleOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { askQuestion, fetchSchema, runQuery } from './sqlApi';
import type { SqlResult, SqlSchema } from './sqlApi';
import { dataConnectionLabel } from './DataConnection';
import type { DataConnection } from './DataConnection';
import './sql-query.css';

const examples = [
  '各设备型号有多少用户？',
  '最近 7 天每天的平均治疗时长是多少？',
  'AHI 最高的 10 个用户是谁？',
];

const errorText = (value: unknown) => value instanceof Error ? value.message : '请求失败，请稍后重试';

export function SqlQuery({ dataConnection }: { dataConnection: DataConnection }) {
  const [schema, setSchema] = useState<SqlSchema | null>(null), [schemaError, setSchemaError] = useState('');
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [question, setQuestion] = useState(''), [sql, setSql] = useState('');
  const [result, setResult] = useState<SqlResult | null>(null), [error, setError] = useState('');
  const [asking, setAsking] = useState(false), [running, setRunning] = useState(false);
  const alive = useRef(true), controller = useRef<AbortController>();

  async function loadSchema() {
    setLoadingSchema(true); setSchemaError('');
    try {
      const next = await fetchSchema();
      if (alive.current) setSchema(next);
    } catch (failure) {
      if (alive.current) setSchemaError(errorText(failure));
    } finally {
      if (alive.current) setLoadingSchema(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    void loadSchema();
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);

  async function execute(statement: string) {
    setRunning(true); setError('');
    try {
      const next = await runQuery(statement);
      if (alive.current) { setResult(next); setSql(next.sql); }
    } catch (failure) {
      if (alive.current) { setError(errorText(failure)); setResult(null); }
    } finally {
      if (alive.current) setRunning(false);
    }
  }

  async function ask() {
    const text = question.trim();
    if (!text) { setError('请先输入问题。'); return; }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setAsking(true); setError('');
    try {
      const next = await askQuestion(text, abort.signal);
      if (alive.current) { setResult(next); setSql(next.sql); }
    } catch (failure) {
      if (alive.current && !abort.signal.aborted) { setError(errorText(failure)); setResult(null); }
    } finally {
      if (alive.current) setAsking(false);
    }
  }

  const busy = asking || running;
  const columns = useMemo(() => (result?.columns || []).map((name, index) => ({
    title: name, dataIndex: index, key: name + index, ellipsis: true,
    render: (value: unknown) => (value === null ? <span className="sql-null">NULL</span> : String(value)),
  })), [result]);

  const rows = useMemo(() => (result?.rows || []).map((row, index) => {
    const record: Record<string, unknown> = { key: index };
    row.forEach((value, cell) => { record[cell] = value; });
    return record;
  }), [result]);

  return <div className="sql-page">
    <div className="sql-topbar">
      <div className="sql-topbar-title"><DatabaseOutlined /><strong>数据查询</strong><span>用自然语言生成并执行只读 SQL</span></div>
      <Space size={8} wrap>
        <Tag color={dataConnection.mode === 'invalid' ? 'error' : 'default'}>{dataConnectionLabel(dataConnection)}</Tag>
        <Tag color={schema ? 'success' : schemaError ? 'error' : 'default'}>
          {loadingSchema ? '读取表结构…' : schemaError ? '数据源不可用' : `${schema?.database} · ${schema?.tables.length || 0} 张表`}
        </Tag>
        <Button size="small" icon={<ReloadOutlined spin={loadingSchema} />} onClick={() => void loadSchema()} disabled={loadingSchema}>刷新</Button>
      </Space>
    </div>

    {schemaError && <Alert className="sql-alert" type="warning" showIcon message="数据源不可用" description={schemaError} />}
    {error && <Alert className="sql-alert" type="error" showIcon message={error} closable onClose={() => setError('')} />}

    <div className="sql-layout">
      <section className="sql-panel sql-input">
        <label className="sql-label" htmlFor="sql-question">用一句话描述你要查什么</label>
        <Input.TextArea id="sql-question" value={question} onChange={event => setQuestion(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }}
          maxLength={1000} disabled={busy} placeholder="例如：最近 7 天每天的平均治疗时长是多少？"
          onPressEnter={event => { if (!event.shiftKey) { event.preventDefault(); void ask(); } }} />
        <div className="sql-actions">
          <Button type="primary" icon={<ThunderboltOutlined />} loading={asking} disabled={busy || !schema} onClick={() => void ask()}>生成并查询</Button>
        </div>
        <div className="sql-examples">{examples.map(item => <button type="button" key={item} disabled={busy} onClick={() => setQuestion(item)}>{item}</button>)}</div>

        <div className="sql-schema">
          <div className="sql-schema-head"><strong>可用数据</strong><small>{schema ? `${schema.tables.length} 张表` : '—'}</small></div>
          {loadingSchema ? <div className="sql-loading"><Spin size="small" /> 读取中…</div> : schema ? schema.tables.map(table =>
            <details key={table.table}><summary>{table.table}<small>{table.columns.length} 列</small></summary>
              <ul>{table.columns.map(column => <li key={column.name}><code>{column.name}</code><span>{column.type}</span></li>)}</ul>
            </details>) : <p className="sql-hint">无法读取表结构。</p>}
        </div>
      </section>

      <section className="sql-panel sql-output">
        <div className="sql-output-head">
          <strong>SQL</strong>
          {result && <small>{result.rows.length} 行 · {result.elapsed_ms} ms{result.truncated ? ' · 已截断' : ''}</small>}
        </div>
        <Input.TextArea className="sql-editor" value={sql} onChange={event => setSql(event.target.value)} autoSize={{ minRows: 3, maxRows: 10 }}
          spellCheck={false} disabled={busy} placeholder="生成的 SQL 会出现在这里，可以修改后再执行" />
        <div className="sql-actions">
          <Tooltip title="支持 SELECT 和 WITH 查询"><Button icon={<PlayCircleOutlined />} loading={running} disabled={busy || !sql.trim()} onClick={() => void execute(sql)}>执行 SQL</Button></Tooltip>
        </div>

        <div className="sql-result">
          {result ? (result.rows.length
            ? <Table size="small" columns={columns} dataSource={rows} pagination={result.rows.length > 20 ? { pageSize: 20, size: 'small' } : false} scroll={{ x: 'max-content' }} />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="查询成功，但没有匹配的数据" />)
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成或执行 SQL 后，结果会显示在这里" />}
        </div>
      </section>
    </div>
  </div>;
}
