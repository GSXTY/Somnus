"""Deterministic, explicitly synthetic data for the enterprise workbench.

No database, model, device or patient is contacted. These fixtures must never
be used as a fallback when a real source fails or as clinical thresholds.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
import math

from agent_core.analytics import SHANGHAI

MODELS = ('YA70A20', 'YA70B20', 'YA70B25', 'YA70B30/YA70Pro', 'YA70LAB')
# Independent synthetic upload counters (expected, received), not inferred
# from users' online state, alerts, CSV row density or an assumed sample rate.
DEMO_REPORT_COUNTS = {
    'YA70A20': (120000, 119040),
    'YA70B20': (96000, 94560),
    'YA70B25': (108000, 105840),
    'YA70B30/YA70Pro': (132000, 128040),
    'YA70LAB': (84000, 84000),
}
CONSTRAINTS = [
    '所有用户、设备、事件及波形均为合成演示，未连接真实后台、设备或大模型。',
    '巡检优先级和漏气提示是演示工作流标记，不是患者健康评分或临床判断。',
    '事件为演示模型候选，不与后台上报事件、本地检测历史或临床AHI混算。',
    '10Hz、治疗阈值、事件触发规则及真实时区尚待验证，未改动现有检测算法。',
]


def _options(query):
    source = query.get('source', ['demo'])[0]
    model = query.get('model', ['all'])[0]
    if source not in ('demo', 'live'):
        raise ValueError('数据来源必须为 demo 或 live。')
    if model not in ('all', *MODELS) and not (source == 'live' and isinstance(model, str) and model.strip()):
        raise ValueError('请选择有效的 YA70 型号。')
    return source, model


def _clock(now=None):
    return (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)


def _source(demo):
    return dict(mode='demo' if demo else 'unconfigured', connected=False,
                label='合成演示数据' if demo else '未连接真实数据源')


def reporting_quality(expected_records=None, received_records=None, *, demo=False):
    """Validate comparable upload counters and calculate their missing share.

    Null counters remain unknown. Zero expected reports has no defined rate.
    This function never infers the expected count from another dashboard KPI.
    """
    for value in (expected_records, received_records):
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
            raise ValueError('上报计数必须为非负整数或未知值。')
    known = expected_records is not None and received_records is not None
    if known and received_records > expected_records:
        raise ValueError('实收上报量不能超过同口径应上报量。')
    lost = expected_records-received_records if known else None
    rate = lost/expected_records*100 if known and expected_records > 0 else None
    basis = '缺失上报量 / 应上报量 × 100%；当前上海自然日截至生成时刻；'
    basis += ('合成上报记录计数，按所选型号汇总，不由在线率、告警数或CSV行数推算。'
              if demo else '真实应上报量与实收量尚未接入，保持未知。')
    return dict(expected_records=expected_records, received_records=received_records,
                lost_records=lost, loss_rate=rate, unit='records', basis=basis)


def _daily_values(index, day):
    """Actual fixture contributions, not measured or inferred CSV use."""
    seed = day.toordinal()
    active = (seed+index) % 5 != 0
    hours = round(3.5+((seed+index*3) % 10)/2, 2) if active else 0.0
    events = 2+(seed+index*7) % 17 if active else 0
    online = (seed+index*2) % 7 != 0
    return hours, events, online


def _users(model, now):
    today = now.date()
    rows = []
    for index in range(10):
        subtype = MODELS[index % len(MODELS)]
        if model != 'all' and subtype != model:
            continue
        hours, events, _ = _daily_values(index, today)
        state = ('therapy', 'online', 'offline', 'therapy', 'online')[index % 5]
        leak = None if index == 7 else float(8+(index*7) % 30)
        flagged = leak is not None and index in (2, 5, 8)
        priority = 'high' if index % 4 in (0, 1) else 'medium' if flagged or leak is None else 'low'
        reason = ('演示规则：设备记录或信号变化需优先核查' if priority == 'high' else
                  '演示规则：复核事件证据与上报完整性' if priority == 'medium' else
                  '演示规则：按常规顺序检查，不代表健康结论')
        rows.append(dict(id=f'demo-{index+1:03}', name=f'演示用户 {index+1:02}', model=subtype,
            device_id=f'DEMO-YA70-{index+1:03}', firmware='演示固件 1.0', state=state,
            today_treatment_hours=hours, leak_value=leak, leak_unit='L/min（演示）',
            leak_flag=flagged, events_24h=events, priority=priority, priority_reason=reason,
            recording_ref=None))
    return rows


def _waveform(duration, index, points=721):
    times = [round(duration*i/(points-1), 3) for i in range(points)]
    phase = index*.4
    channels = []
    for key, label, unit in (('pressure','压力','Pa（演示）'), ('flow','流量','L/min（演示）'),
                             ('leak','漏气','L/min（演示）')):
        values = []
        for i, t in enumerate(times):
            u = i/(points-1)
            dip = .18 if .37 < u < .405 or .72 < u < .745 else 1.0
            if key == 'pressure':
                value = 620+index*8+45*math.sin(i*.15+phase)+8*math.cos(i*.7)
            elif key == 'flow':
                value = 58+dip*(18*math.sin(i*.7+phase)+5*math.sin(i*1.2))
            else:
                value = 10+index%4+2*math.sin(i*.07)+ (10 if .52 < u < .61 else 0)
            values.append([t, round(value, 3)])
        channels.append(dict(key=key, label=label, unit=unit, points=values))
    return dict(duration_seconds=duration, origin='synthetic',
        sampling_note='合成展示样本，非真实波形降采样；不据此推定原始采样频率或实际治疗区间。',
        channels=channels)


def _alerts(users, now):
    alerts = []
    kinds = [('critical', 'upload_gap', '演示：设备上报中断待核查'),
             ('critical', 'flow_signal', '演示：流量信号候选需复核'),
             ('warning', 'leak_hint', '演示：漏气字段变化需核查'),
             ('info', 'review_pending', '演示：候选复核尚未完成')]
    for user in users:
        index = int(user['id'].split('-')[1])-1
        severity, kind, title = kinds[index % len(kinds)]
        alerts.append(dict(id='alert-'+user['id'], device_id=user['device_id'], user_id=user['id'],
            severity=severity, type=kind, title=title, at=(now-timedelta(minutes=index*11+3)).isoformat(),
            description='工程巡检演示告警；仅提示检查记录和原始信号，不诊断原因或调整设备。',
            status='open', preview=_waveform(30, index, 61) if severity == 'critical' else None))
    return alerts


def dashboard(query, now=None, *, settings=None):
    source, model = _options(query)
    now = _clock(now)
    yesterday = now.date()-timedelta(days=1)
    period = dict(start_date=(yesterday-timedelta(days=6)).isoformat(), end_date=yesterday.isoformat(),
                  kpi_date=yesterday.isoformat(), time_zone='Asia/Shanghai',
                  date_basis='演示上海自然日；真实后台业务日及字段口径待核实')
    scope = list(MODELS) if model == 'all' else [model]
    base = dict(schema_version=1, source=_source(source == 'demo'), generated_at=now.isoformat(),
                period=period, model_scope=scope, constraints=CONSTRAINTS.copy())
    labels = [('active_users','昨日活跃用户','人'), ('treatment_hours','昨日治疗时长','小时'),
              ('reported_events','昨日演示模型候选','次'), ('online_rate','当前设备在线率','%')]
    if source == 'live':
        from agent_core.live_dashboard import (
            SNORE_SUMMARY_TABLES, YA50_INDEX_LABEL, YA50_MODEL, YA50_TABLE, SummaryFieldsUnavailable,
            available, device_types, snapshot, snore_product_options, snore_product_snapshot,
            ya50_available, ya50_snapshot,
        )
        from agent_core.sql_access import SqlSettings
        settings = settings or SqlSettings.from_env()
        show_ya50 = YA50_TABLE in settings.allowed_tables and settings.driver == 'mysql'
        home_options = [dict(value=YA50_MODEL, label=YA50_MODEL)] if show_ya50 else []
        home_options.extend(snore_product_options(settings))
        base['model_options'] = home_options
        snore_product = model in SNORE_SUMMARY_TABLES
        if snore_product:
            base['home'] = dict(metrics=[], charts=[])
            base['period']['date_basis'] = '后台汇总记录日期待核对'

        unavailable_labels = [*labels[:2], ('reported_events', '昨日设备上报事件', '次'), labels[3],
            ('avg_ahi', YA50_INDEX_LABEL if model == YA50_MODEL else '设备上报平均 AHI', '次/小时')
        ]
        missing_kpis = {key: dict(value=None, previous=None, trend=[], label=label, unit=unit)
                        for key, label, unit in unavailable_labels}

        def unavailable(message):
            base['source'] = dict(mode='unconfigured', connected=False, label=message)
            return dict(base, kpis=missing_kpis, daily=[], users=[], alerts=[],
                        fleet=dict(online=None, total=None, in_therapy=None, offline=None, latency_seconds=None),
                        data_quality=reporting_quality(), alert_distribution=[],
                        insights=[dict(kind='next_step', title='检查数据源', text=message, evidence=[])])

        if snore_product and not any(option['value'] == model for option in home_options):
            return unavailable(f'{model} 汇总表 {SNORE_SUMMARY_TABLES[model]} 尚未加入当前数据源白名单')
        if not available(settings):
            return unavailable('暂时无法连接只读数据库')
        try:
            live_models = device_types(settings)
        except Exception:
            live_models = []
        base['model_options'] = [*live_models, *home_options]
        if snore_product:
            try:
                live = snore_product_snapshot(settings, now, model)
            except SummaryFieldsUnavailable as exc:
                return unavailable(str(exc))
            except Exception:
                return unavailable(f'无法读取 {model} 汇总记录，请检查数据库连接和表权限')
            base['source'] = dict(mode='live', connected=True, label='真实数据（RDS 只读）')
            base['period']['date_basis'] = live['date_basis']
            base['home'] = live['home']
            base['constraints'] = live['constraints']
            return dict(base, kpis=missing_kpis, daily=[], users=[], alerts=[],
                        fleet=dict(online=None, total=None, in_therapy=None, offline=None, latency_seconds=None),
                        data_quality=reporting_quality(), alert_distribution=[], insights=[])

        if model == YA50_MODEL:
            base['period']['date_basis'] = '真实后台治疗报告日期（resp_statistics.record_date）'
            if not ya50_available(settings):
                return unavailable('无法读取 YA50 治疗日报，请核对当前数据源的表和字段权限')
            try:
                live = ya50_snapshot(settings, now)
            except Exception:
                return unavailable('YA50 治疗日报查询失败，请检查数据库连接和字段权限')
            base['source'] = dict(mode='live', connected=True, label='真实数据（RDS 只读）')
            base['constraints'] = live['constraints']
            return dict(base, kpis=live['kpis'], daily=live['daily'], users=[], alerts=[],
                        fleet=dict(online=None, total=None, in_therapy=None, offline=None, latency_seconds=None),
                        data_quality=reporting_quality(), alert_distribution=[], insights=[])

        live = snapshot(settings, now, model)
        base['source'] = dict(mode='live', connected=True, label='真实数据（RDS 只读）')
        base['model_scope'] = ([item['value'] for item in live_models] or ['all']) if model == 'all' else [model]
        base['period']['date_basis'] = '真实后台自然日（resp_statistics_ya70.recorde_date）'
        base['constraints'] = [
            '真实数据来自只读账号，查询范围遵循当前白名单。',
            '在线率、漏气判级与事件候选尚未接入真实来源，保持未知。',
            'AHI 为设备上报值，与工程候选事件不是同一口径，不作诊断依据。',
        ]
        users = live['users']
        fleet = dict(online=None, total=live['devices_total'], in_therapy=None,
                     offline=None, latency_seconds=None)
        insights = [
            dict(kind='summary', title='昨日真实摘要',
                 text=f"{yesterday.isoformat()}：{live['kpis']['active_users']['value']} 位活跃用户，"
                      f"累计 {live['kpis']['treatment_hours']['value']:g} 小时，"
                      f"{live['kpis']['reported_events']['value']} 次设备上报事件。",
                 evidence=[f'日期：{yesterday.isoformat()}', '来源：resp_statistics_ya70 聚合查询',
                           f'累计注册用户：{live["users_total"]} 人']),
            dict(kind='observation', title='观察变化，暂不归因',
                 text='活跃用户较前日变化 {0}%。数量受使用规模与数据完整性影响，不能据此推断病情或设备原因。'.format(
                     live['active_change'] if live['active_change'] is not None else '未知'),
                 evidence=[f'近 8 天趋势：{", ".join(str(item["active_users"]) for item in live["daily"])}',
                           '在线状态与漏气判级未接入']),
            dict(kind='next_step', title='建议下一步',
                 text='先补齐设备型号编码、user_state 与事件类型编码，再考虑接入在线状态与漏气告警。',
                 evidence=['待确认：app_user.user_state 编码', '待确认：event_type 编码表']),
        ]
        return dict(base, kpis=live['kpis'], daily=live['daily'], users=users, alerts=[],
                    data_quality=reporting_quality(), fleet=fleet, alert_distribution=[], insights=insights)

    users = _users(model, now)
    quality = reporting_quality(sum(DEMO_REPORT_COUNTS[m][0] for m in scope),
                                sum(DEMO_REPORT_COUNTS[m][1] for m in scope), demo=True)
    indices = [int(user['id'].split('-')[1])-1 for user in users]
    days = []
    for offset in range(7, -1, -1):
        day = yesterday-timedelta(days=offset)
        contributions = [_daily_values(index, day) for index in indices]
        days.append(dict(date=day.isoformat(), active_users=sum(h>0 for h,_,_ in contributions),
            treatment_hours=round(sum(h for h,_,_ in contributions), 2),
            event_count=sum(e for _,e,_ in contributions),
            online_rate=round(100*sum(online for _,_,online in contributions)/len(indices), 2)))
    daily = days[1:]
    online = sum(user['state'] != 'offline' for user in users)
    rate = round(100*online/len(users), 2)
    fields = dict(active_users='active_users', treatment_hours='treatment_hours', reported_events='event_count',
                  online_rate='online_rate')
    kpis = {}
    for key, label, unit in labels:
        field = fields[key]
        kpis[key] = dict(value=rate if key == 'online_rate' else days[-1][field],
            previous=days[-1][field] if key == 'online_rate' else days[-2][field],
            trend=([row[field] for row in daily[1:]]+[rate]) if key == 'online_rate' else [row[field] for row in daily],
            unit=unit, label=label)
    alerts = _alerts(users, now)
    names = dict(upload_gap='数据上报', flow_signal='信号复核', leak_hint='漏气字段', review_pending='复核待办')
    distribution = [dict(name=label, value=sum(alert['type']==key for alert in alerts)) for key,label in names.items()]
    previous = kpis['reported_events']['previous']
    change = kpis['reported_events']['value']-previous
    insights = [
        dict(kind='summary', title='昨日演示摘要',
             text=f"{yesterday.isoformat()}：{kpis['active_users']['value']} 位演示活跃用户，累计 {kpis['treatment_hours']['value']:g} 小时，{kpis['reported_events']['value']} 次演示模型候选。",
             evidence=[f'日期：{yesterday.isoformat()}', '来源：合成日记录，非真实设备数据']),
        dict(kind='observation', title='观察变化，暂不归因',
             text=f'候选数较前日变化 {change:+d} 次。数量还受使用规模和数据完整性影响，不能据此推断面罩、病情或设备原因。',
             evidence=[f'前日候选：{previous}', f"当前演示设备：{len(users)} 台"]),
        dict(kind='next_step', title='建议核查顺序',
             text='先检查数据归属、缺失与单位，再查看选定记录的波形和候选证据；确认后形成内部复核草稿。',
             evidence=['未连接实时设备或大模型', '原始波形与数据库用户尚未关联'])]
    return dict(base, kpis=kpis, daily=daily, users=users, alerts=alerts, data_quality=quality,
        fleet=dict(online=online, total=len(users), in_therapy=sum(u['state']=='therapy' for u in users),
                   offline=len(users)-online, latency_seconds=None), alert_distribution=distribution, insights=insights)


def user_detail(user_id, query, now=None):
    source, model = _options(query)
    now = _clock(now)
    if source == 'live':
        return dict(source=_source(False), user=None, waveform=None, events=[], event_count=None,
                    date=now.date().isoformat())
    user = next((u for u in _users(model, now) if u['id'] == user_id), None)
    if user is None:
        raise LookupError('所选演示用户不存在或不在当前型号范围内。')
    index = int(user_id.split('-')[1])-1
    duration = 24*60*60
    count = user['events_24h']
    events = []
    for n in range(count):
        start = round((n+1)*duration/(count+1), 3)
        events.append(dict(id=f'{user_id}-event-{n+1}', start=start, end=min(duration,start+12+n%5),
            type='流量波动减弱候选（演示）' if n%2 else '信号变化候选（演示）', status='candidate'))
    return dict(source=_source(True), user=user, waveform=_waveform(duration, index), events=events,
                event_count=len(events), date=now.date().isoformat())
