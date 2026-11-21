export type Source = 'demo' | 'live';
export type SourceInfo = { label: string } & (
  { mode: 'demo' | 'unconfigured'; connected: false } | { mode: 'live'; connected: true }
);
export type Metric = { value: number | null; previous: number | null; trend: (number | null)[]; unit: string; label: string };
export type UserRow = {
  id: string; name: string; model: string; device_id: string; firmware: string;
  state: 'therapy' | 'online' | 'offline'; today_treatment_hours: number | null;
  leak_value: number | null; leak_unit: string; leak_flag: boolean;
  events_24h: number | null; priority: 'high' | 'medium' | 'low'; priority_reason: string;
  recording_ref: null;
};
export type Point = [number, number | null];
export type Waveform = { duration_seconds: number; origin: 'synthetic'; sampling_note: string;
  channels: { key: string; label: string; unit: string; points: Point[] }[] };
export type AlertItem = { id: string; device_id: string; user_id: string; severity: 'critical' | 'warning' | 'info';
  type: string; title: string; at: string; description: string; status: 'open'; preview: Waveform | null };
export type Candidate = { id: string; start: number; end: number; type: string; status: 'candidate' };
export type UserDetail = { source: SourceInfo; user: UserRow; waveform: Waveform; events: Candidate[]; event_count: number; date: string };
export type DataQuality = { expected_records: number | null; received_records: number | null; lost_records: number | null; loss_rate: number | null; unit: 'records'; basis: string };
export type HomeMetric = Pick<Metric, 'label' | 'value' | 'unit'> & { digits?: number };
export type HomeTrend = { label: string; unit: string; points: { date: string; value: number | null }[] };
export type HomeModelOption = { value: string; label: string; home_only?: boolean };
export type Dashboard = {
  schema_version: 1; source: SourceInfo; generated_at: string;
  period: { start_date: string; end_date: string; kpi_date: string; time_zone: 'Asia/Shanghai'; date_basis: string };
  model_scope: string[]; model_options?: HomeModelOption[];
  home?: { metrics: HomeMetric[]; charts: HomeTrend[] };
  data_quality: DataQuality; kpis: { active_users: Metric; treatment_hours: Metric; reported_events: Metric; online_rate: Metric; avg_ahi?: Metric };
  daily: { date: string; active_users: number; treatment_hours: number; event_count: number | null; online_rate: number }[];
  fleet: { online: number | null; total: number | null; in_therapy: number | null; offline: number | null; latency_seconds: null };
  users: UserRow[]; alerts: AlertItem[]; alert_distribution: { name: string; value: number }[];
  insights: { kind: 'summary' | 'observation' | 'next_step'; title: string; text: string; evidence: string[] }[];
  constraints: string[];
};
