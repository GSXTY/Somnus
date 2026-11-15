import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Skeleton, Space, Tag, Timeline, Typography } from 'antd';
import type { EChartsType } from 'echarts/core';
import { fetchUser } from './api';
import { Chart } from './Chart';
import { waveformOption } from './chartOptions';
import { formatNumber, formatOffset, createLatestGate } from './logic.mjs';
import type { Source, UserDetail, UserRow } from './types';

export function UserDrawer({ user, source, onClose, onAnalyze }: { user: UserRow | null; source: Source; onClose: () => void; onAnalyze: () => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [focusedEvent, setFocusedEvent] = useState('');
  const chart = useRef<EChartsType>();
  const gate = useRef(createLatestGate());
  const currentDetail = source === 'demo' && detail?.user.id === user?.id ? detail : null;
  useEffect(() => {
    setDetail(null); setError(''); setFocusedEvent(''); chart.current = undefined;
    if (!user || source !== 'demo') { setLoading(false); return; }
    const token = gate.current.next(), abort = new AbortController();
    setLoading(true);
    fetchUser(user.id, source, abort.signal).then(value => { if (gate.current.current(token)) setDetail(value); }).catch(failure => {
      if (gate.current.current(token) && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : '详情读取失败');
    }).finally(() => { if (gate.current.current(token)) setLoading(false); });
    return () => { abort.abort(); gate.current.invalidate(); };
  }, [user?.id, source, retry]);
  return <Drawer width={880} title={<Space><span>{user?.name || '用户'} · 当日记录详情</span><Tag color="blue">合成演示</Tag></Space>} open={Boolean(user)} onClose={onClose} destroyOnClose className="user-drawer">
    {loading ? <Skeleton active paragraph={{ rows: 10 }} /> : error ? <Alert type="error" showIcon message="详情加载失败" description={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : currentDetail ? <>
      <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} className="drawer-meta" items={[
        { key: 'date', label: '日期', children: currentDetail.date }, { key: 'model', label: '型号', children: currentDetail.user.model },
        { key: 'device', label: '设备', children: currentDetail.user.device_id }, { key: 'hours', label: '今日治疗', children: `${formatNumber(currentDetail.user.today_treatment_hours)} 小时` },
        { key: 'events', label: '演示候选', children: `${currentDetail.event_count} 条` }, { key: 'priority', label: '巡检依据', children: currentDetail.user.priority_reason },
      ]} />
      <div className="section-heading"><Typography.Title level={5}>当日合成波形 · 压力与流量</Typography.Title><Button size="small" onClick={() => { chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }); setFocusedEvent(''); }}>恢复全日</Button></div>
      <Chart key={currentDetail.user.id + currentDetail.date} label="当日合成压力与流量波形，可通过下方滑块缩放，支持拖动" height={330} option={waveformOption(currentDetail.waveform, currentDetail.events)} onReady={instance => { chart.current = instance; }} />
      <Typography.Paragraph type="secondary" className="small-note">{currentDetail.waveform.sampling_note} · 相对时间轴；图例可切换通道，滚轮/滑块缩放。</Typography.Paragraph>
      <div className="section-heading"><Typography.Title level={5}>候选时间线</Typography.Title><Tag>{currentDetail.events.length} 条 · 均待复核</Tag></div>
      {currentDetail.events.length ? <Timeline className="candidate-timeline" items={currentDetail.events.map(event => ({ key: event.id, color: focusedEvent === event.id ? 'blue' : 'gray', children: <Button type="text" className="timeline-button" onClick={() => {
        setFocusedEvent(event.id); chart.current?.dispatchAction({ type: 'dataZoom', startValue: Math.max(0, event.start - 90), endValue: Math.min(currentDetail.waveform.duration_seconds, event.end + 90) });
      }}>{formatOffset(event.start)} – {formatOffset(event.end)} <Tag>{event.type}</Tag><span>定位波形 →</span></Button> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无演示候选" />}
      <a href="#analysis" onClick={event => { event.preventDefault(); onClose(); onAnalyze(); }}>在波形分析中打开本地 CSV</a>
    </> : <Empty description="未取得用户详情" />}
  </Drawer>;
}
