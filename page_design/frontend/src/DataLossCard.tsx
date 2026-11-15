import { Card, Tag } from 'antd';
import { Chart } from './Chart';
import { dataLossOption } from './chartOptions';
import { formatNumber } from './logic.mjs';
import type { DataQuality, Source } from './types';

export function DataLossCard({ quality, source }: { quality?: DataQuality; source: Source }) {
  const known = typeof quality?.expected_records === 'number' && quality.expected_records > 0 && typeof quality.loss_rate === 'number';
  const zeroExpected = quality?.expected_records === 0;
  return <Card className="panel-card data-loss-panel" title="数据丢失率" extra={<Tag>{source === 'demo' ? '合成演示' : '未接入'}</Tag>}>
    <div className="data-loss-period">今日上报数据 · 当前所选型号</div>
    <div className="data-loss-visual"><Chart height={245} label={known ? `数据完整性：已接收${quality!.received_records}条，数据丢失${quality!.lost_records}条，丢失率${formatNumber(quality!.loss_rate, 2)}%` : '数据完整性未知，暂无可计算的丢失率'} option={dataLossOption(quality)} /><div className="data-loss-center"><strong>{known ? formatNumber(quality!.loss_rate, 2) : '—'}{known && <span>%</span>}</strong><small>数据丢失率</small></div></div>
    <div className="data-loss-values"><span><i className="data-loss-dot" />已接收<b>{formatNumber(quality?.received_records, 0)}</b></span><span><i className="data-loss-dot lost" />数据丢失<b>{formatNumber(quality?.lost_records, 0)}</b></span></div>
    {!known && <div className="data-loss-unknown">{zeroExpected ? '应上报量为0，丢失率不适用' : '记录计数未接入，丢失率未知'}</div>}
    <div className="data-loss-basis">应上报 {formatNumber(quality?.expected_records, 0)} 条<br />缺失上报量 ÷ 应上报量 × 100%</div>
  </Card>;
}
