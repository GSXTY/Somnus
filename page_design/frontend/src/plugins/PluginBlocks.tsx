import { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Select, Switch, Tag } from 'antd';
import type { PluginAction, PluginBlock } from './pluginDocumentTypes';
export function PluginBlockView({ block, actions, busy, onAction, initialValues }: {
    block: PluginBlock;
    actions: PluginAction[];
    busy: boolean;
    initialValues?: Record<string, string | number | boolean>;
    onAction: (action: PluginAction, edits?: Record<string, string | number | boolean>) => Promise<void>;
}) {
    const [edits, setEdits] = useState<Record<string, string | number | boolean>>({});
    useEffect(() => setEdits(initialValues || {}), [initialValues]);
    if (block.type === 'text')
        return <p>{block.text}</p>;
    if (block.type === 'list')
        return <ul>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
    if (block.type === 'metrics')
        return <dl className="declarative-plugin-metrics">{block.items.map((item, index) => <div key={index}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
    if (block.type === 'status')
        return <Alert type={block.state === 'error' ? 'error' : block.state === 'success' ? 'success' : 'info'} message={<><Tag>{({idle:"待命",running:"运行中",success:"已完成",error:"失败"})[block.state]}</Tag>{block.label}</>} description={block.detail} icon={block.state === 'running' ? <span role="status">运行中</span> : undefined}/>;
    if (block.type === 'table')
        return <div className="plugin-table-scroll"><table><thead><tr>{block.columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{block.columns.map(column => <td key={column.key}>{row[column.key] || ''}</td>)}</tr>)}</tbody></table></div>;
    if (block.type === 'chart') {
        const all = block.series.flatMap(series => series.values), scale=Math.max(1,...all.map(value=>Math.abs(value))), min = Math.min(0, ...all.map(value=>value/scale)), max = Math.max(1/scale, ...all.map(value=>value/scale)), x = (index: number) => 35 + index * 280 / Math.max(1, block.labels.length - 1), y = (value: number) => 140 - (value/scale - min) * 120 / (max - min);
        const colors = ['#16796a', '#b07848', '#657db1', '#a26c99'];
        return <figure className="plugin-data-chart"><svg viewBox="0 0 340 175" role="img" aria-label={block.series.map(series => series.label).join('、')}><path d="M30 15V145H325" fill="none" stroke="currentColor" opacity=".3"/>{block.series.map((series, si) => <g key={si} fill={colors[si]} stroke={colors[si]}>{block.chartType === 'line' ? <polyline fill="none" strokeWidth="2" points={series.values.map((value, index) => x(index) + ',' + y(value)).join(' ')}/> : series.values.map((value, index) => <rect key={index} x={25 + index * 290 / block.labels.length + si * 60 / block.labels.length / block.series.length} y={Math.min(y(value), y(0))} width={Math.max(2, 60 / block.labels.length / block.series.length)} height={Math.max(1, Math.abs(y(value) - y(0)))}/>)}</g>)}<text x="32" y="165" fill="currentColor" fontSize="9">{block.labels[0]}</text><text x="300" y="165" textAnchor="end" fill="currentColor" fontSize="9">{block.labels.at(-1)}</text></svg><figcaption>{block.series.map((series, index) => <Tag key={index} color={colors[index]}>{series.label}</Tag>)}</figcaption><details><summary>查看图表数据</summary><table><thead><tr><th>标签</th>{block.series.map((series, index) => <th key={index}>{series.label}</th>)}</tr></thead><tbody>{block.labels.map((label, index) => <tr key={index}><th>{label}</th>{block.series.map((series, i) => <td key={i}>{series.values[index]}</td>)}</tr>)}</tbody></table></details></figure>;
    }
    const action = actions.find(action => action.id === block.submitActionId);
    const values = Object.fromEntries(block.fields.map(field => [field.key, edits[field.key] ?? field.value ?? (field.kind === 'boolean' ? false : field.kind === 'number' ? 0 : '')])) as Record<string, string | number | boolean>;
    return <form className="plugin-declarative-form" onSubmit={event => { event.preventDefault(); if (action && !busy)
        void onAction(action, values); }}>{block.fields.map(field => <label key={field.key}><span>{field.label}</span>{field.kind === 'boolean' ? <Switch aria-label={field.label} disabled={busy} checked={Boolean(values[field.key])} onChange={value => setEdits({ ...edits, [field.key]: value })}/> : field.kind === 'enum' ? <Select aria-label={field.label} disabled={busy} value={String(values[field.key])} options={field.options?.map(value => ({ value, label: value }))} onChange={value => setEdits({ ...edits, [field.key]: value })}/> : field.kind === 'number' ? <InputNumber aria-label={field.label} disabled={busy} value={Number(values[field.key])} onChange={value => { if (value !== null)
        setEdits({ ...edits, [field.key]: value }); }}/> : <Input aria-label={field.label} disabled={busy} value={String(values[field.key])} onChange={event => setEdits({ ...edits, [field.key]: event.target.value })}/>}</label>)}<Button htmlType="submit" loading={busy} disabled={!action}>{action?.label || '此表单没有可用动作'}</Button></form>;
}
