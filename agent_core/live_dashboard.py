"""Live dashboard metrics read from the analytics database.

Only aggregate queries against whitelisted tables; every range is bounded by a
date window so a dashboard refresh can never scan the whole warehouse.
"""
from __future__ import annotations

from datetime import date, timedelta

from agent_core.sql_access import connect, SqlAccessError, SqlSettings

DAY_LABELS = 'Asia/Shanghai'
YA50_MODEL = 'YA50'
YA50_TABLE = 'resp_statistics'
YA50_INDEX_LABEL = '昨日设备上报平均呼吸事件指数'
SNORE_SUMMARY_TABLES = {'YA43': 'statistics_ya43', 'YA46': 'statistics_ya46'}
SUMMARY_REQUIRED_COLUMNS = {'record_date', 'userid', 'deviceid', 'snore_count'}


class SummaryFieldsUnavailable(SqlAccessError):
    """A product summary cannot be mapped without guessing a column meaning."""


def _rows(settings, sql, params=()):
    connection = connect(settings)
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()
    finally:
        connection.close()


def _scalar(settings, sql, params=()):
    rows = _rows(settings, sql, params)
    return rows[0][0] if rows else None


def available(settings):
    try:
        _scalar(settings, 'SELECT 1')
        return True
    except Exception:
        return False


def ya50_available(settings):
    """Check the application allowlist and the database's required columns."""
    if YA50_TABLE not in settings.allowed_tables or settings.driver != 'mysql':
        return False
    try:
        _rows(settings, 'SELECT record_date, userid, treat_time FROM resp_statistics WHERE 1 = 0')
        return True
    except Exception:
        return False


def snore_product_options(settings):
    return [
        dict(value=model, label=model, home_only=True)
        for model, table in SNORE_SUMMARY_TABLES.items()
        if settings.driver == 'mysql' and table in settings.allowed_tables
    ]


def snore_product_snapshot(settings, now, model):
    """Aggregate the two confirmed summary schemas on their supported report dates."""
    table = SNORE_SUMMARY_TABLES[model]
    if settings.driver != 'mysql' or table not in settings.allowed_tables:
        raise SummaryFieldsUnavailable(f'{model} 汇总表 {table} 尚未加入当前数据源白名单')
    columns = _rows(settings, '''
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = %s
        ORDER BY ordinal_position
    ''', (table,))
    if not columns:
        raise SummaryFieldsUnavailable(f'无法读取 {model} 汇总表 {table} 的字段结构，请核对表权限')
    column_types = {name.lower(): data_type.lower() for name, data_type in columns}
    if SUMMARY_REQUIRED_COLUMNS - column_types.keys():
        raise SummaryFieldsUnavailable(f'{model} 汇总表 {table} 缺少已确认的日期、用户、设备或鼾声次数字段')
    if column_types['record_date'] not in ('varchar', 'char', 'date'):
        raise SummaryFieldsUnavailable(f'{model} 汇总表 {table} 的 record_date 类型与已确认的日期字段不一致')
    end = now.date() - timedelta(days=1)
    start = end - timedelta(days=6)
    has_success_count = model == 'YA43' and column_types.get('success_count') in ('smallint', 'int', 'bigint')
    success_count = 'SUM(CASE WHEN success_count >= 0 THEN success_count END)' if has_success_count else 'NULL'
    rows = _rows(settings, f'''
        SELECT SUBSTRING(record_date, 1, 10) AS report_day,
               COUNT(*), COUNT(DISTINCT userid), COUNT(DISTINCT NULLIF(TRIM(deviceid), '')),
               SUM(CASE WHEN snore_count >= 0 THEN snore_count END), {success_count}
        FROM `{table}`
        WHERE record_date >= %s AND record_date < %s
              AND record_date REGEXP %s
        GROUP BY report_day ORDER BY report_day
    ''', (start.isoformat(), now.date().isoformat(),
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|[ T][0-9]{2}:[0-9]{2})'))
    by_day = {str(day): [int(value) if value is not None else None for value in values]
              for day, *values in rows}
    dates = [(start + timedelta(days=offset)).isoformat() for offset in range(7)]
    yesterday = by_day.get(end.isoformat(), [0, 0, 0, None, None])
    fields = [
        ('昨日汇总记录', '条', 0), ('昨日上报用户', '人', 1),
        ('昨日上报设备', '台', 2), ('昨日设备上报鼾声次数', '次', 3),
    ]
    if has_success_count:
        fields.append(('昨日设备上报成功次数', '次', 4))
    trends = [('近7天 · 每日上报用户', '人', 1, 0), ('近7天 · 设备上报鼾声次数', '次', 3, None)]
    return dict(
        date_basis=f'后台汇总记录日期（{table}.record_date，ISO 日期）',
        home=dict(
            metrics=[
                dict(label=label, value=yesterday[index], unit=unit, digits=0)
                for label, unit, index in fields
            ],
            charts=[
                dict(label=label, unit=unit, points=[
                    dict(date=day, value=by_day[day][index] if day in by_day else missing)
                    for day in dates
                ])
                for label, unit, index, missing in trends
            ],
        ),
        constraints=[
            f'{model} 按后台汇总表的 ISO 报告日期统计。用户和设备分别按日去重。',
            '鼾声次数按汇总表的非负设备上报值相加。未知值以空白显示。',
            '当前图表仅覆盖以上报告日期格式。',
        ],
    )


def ya50_snapshot(settings, now):
    """Summarize only the approved YA50 daily reporting table."""
    has_index = True
    try:
        _rows(settings, 'SELECT breath_event_index FROM resp_statistics WHERE 1 = 0')
    except Exception as exc:
        # A column may be absent or not granted even when the core report is readable.
        if not exc.args or exc.args[0] not in (1054, 1143):
            raise
        has_index = False

    yesterday = now.date() - timedelta(days=1)
    start = yesterday - timedelta(days=6)
    index_expression = 'AVG(CASE WHEN breath_event_index >= 0 THEN breath_event_index END)' if has_index else 'NULL'
    rows = _rows(settings, f'''
        SELECT day, COUNT(*), ROUND(SUM(minutes) / 60.0, 1), ROUND(AVG(reported_index), 2)
        FROM (
            SELECT record_date AS day, userid, MAX(treat_time) AS minutes,
                   {index_expression} AS reported_index
            FROM resp_statistics
            WHERE record_date BETWEEN %s AND %s AND userid IS NOT NULL AND treat_time >= 1
                  AND TRIM(CAST(userid AS CHAR)) <> ''
            GROUP BY record_date, userid
        ) AS report_days
        GROUP BY day ORDER BY day
    ''', (start.isoformat(), yesterday.isoformat()))
    by_day = {str(row[0]): row for row in rows}
    daily = []
    for offset in range(7):
        day = (start + timedelta(days=offset)).isoformat()
        row = by_day.get(day)
        daily.append(dict(date=day, active_users=int(row[1]) if row else 0,
                          treatment_hours=float(row[2]) if row else 0.0, event_count=None))

    activity = [day['active_users'] for day in daily]
    hours = [day['treatment_hours'] for day in daily]
    yesterday_row = by_day.get(yesterday.isoformat())
    index_value = yesterday_row[3] if yesterday_row else None
    return dict(kpis={
        'active_users': dict(value=activity[-1], previous=activity[-2], trend=activity,
                             label='昨日活跃用户', unit='人'),
        'treatment_hours': dict(value=hours[-1], previous=hours[-2], trend=hours,
                                label='昨日治疗时长', unit='小时'),
        'reported_events': dict(value=None, previous=None, trend=[],
                                label='昨日设备上报事件', unit='次'),
        'avg_ahi': dict(value=float(index_value) if index_value is not None else None,
                        previous=None, trend=[], label=YA50_INDEX_LABEL, unit='次/小时'),
    }, daily=daily,
        constraints=[
            'YA50 活跃人数按有至少 1 分钟治疗时长的用户计，每人每天去重。重复报告采用当日最长治疗时长。',
            'YA50 事件总次数暂缺可核对的计数口径。',
            '呼吸事件指数为设备上报值。' if has_index else '当前数据源无法读取 YA50 呼吸事件指数字段。',
        ])


def snapshot(settings: SqlSettings, now, model='all'):
    """Return KPI/daily/user data for the workbench live mode."""
    yesterday = (now.date() - timedelta(days=1)).isoformat()
    scope = '' if model in ('all', '', None) else ' AND device_type = %s'
    scope_args = () if model in ('all', '', None) else (model,)

    week_ago = (now.date() - timedelta(days=7)).isoformat()

    active_today = _scalar(
        settings, 'SELECT COUNT(DISTINCT userid) FROM resp_statistics_ya70 WHERE recorde_date = %s' + scope, (yesterday, *scope_args)) or 0
    hours_today = _scalar(
        settings, 'SELECT ROUND(COALESCE(SUM(treat_time), 0) / 60, 1) FROM resp_statistics_ya70 WHERE recorde_date = %s' + scope,
        (yesterday, *scope_args)) or 0
    events_today = _scalar(
        settings,
        'SELECT COALESCE(SUM(COALESCE(apnea_count_total, 0) + COALESCE(hypopnea_count_total, 0) + COALESCE(ca_count_total, 0)), 0) FROM resp_statistics_ya70 WHERE recorde_date = %s' + scope, (yesterday, *scope_args)) or 0
    users_total = _scalar(settings, 'SELECT COUNT(*) FROM app_user') or 0
    devices_total = _scalar(settings, 'SELECT COUNT(*) FROM product_info') or 0

    daily_rows = _rows(
        settings,
        'SELECT recorde_date, COUNT(DISTINCT userid), ROUND(COALESCE(SUM(treat_time), 0) / 60, 1), '
        'COALESCE(SUM(COALESCE(apnea_count_total, 0) + COALESCE(hypopnea_count_total, 0) + COALESCE(ca_count_total, 0)), 0) '
        'FROM resp_statistics_ya70 WHERE recorde_date BETWEEN %s AND %s ' + scope + ' '
        'GROUP BY recorde_date ORDER BY recorde_date', (week_ago, yesterday, *scope_args))
    by_day = {str(row[0]): row for row in daily_rows}
    daily = []
    for offset in range(7, 0, -1):
        day = (now.date() - timedelta(days=offset)).isoformat()
        row = by_day.get(day)
        daily.append(dict(date=day,
                          active_users=int(row[1]) if row else 0,
                          treatment_hours=float(row[2]) if row else 0.0,
                          event_count=int(row[3]) if row else 0))

    top_rows = _rows(
        settings,
        'SELECT userid, ROUND(COALESCE(AVG(ahi), 0), 2) AS ahi, ROUND(COALESCE(SUM(treat_time), 0) / 60, 1) AS hours, '
        'MAX(device_type) AS device_type, COUNT(*) AS days '
        'FROM resp_statistics_ya70 WHERE recorde_date = %s AND ahi IS NOT NULL ' + scope + ' '
        'GROUP BY userid ORDER BY ahi DESC, hours DESC LIMIT 10', (yesterday, *scope_args))
    users = []
    for userid, ahi, hours, device_type, days in top_rows:
        value = float(ahi or 0)
        priority = 'high' if value >= 5 else 'medium' if value >= 2 else 'low'
        users.append(dict(
            id=str(userid), name=f'用户 {userid}',
            model=f'设备类型 {device_type}' if device_type else '未知型号',
            device_id='—', firmware='—', state='therapy',
            today_treatment_hours=float(hours or 0), leak_value=None, leak_unit='未接入',
            leak_flag=False, events_24h=None, priority=priority,
            priority_reason=f'真实数据：昨日设备上报 AHI {value:g}（工程筛查用，非临床诊断）',
            recording_ref=None, ahi=value, days=int(days)))

    trend = [item['active_users'] for item in daily]
    previous = trend[-2] if len(trend) > 1 else None
    change = round((trend[-1] - previous) / previous * 100, 1) if previous else None
    avg_ahi = _scalar(settings, 'SELECT ROUND(AVG(ahi), 2) FROM resp_statistics_ya70 WHERE recorde_date = %s AND ahi IS NOT NULL' + scope,
                      (yesterday, *scope_args))

    kpis = {
        'active_users': dict(value=int(active_today), previous=previous,
                             trend=trend[-7:], label='昨日活跃用户', unit='人'),
        'treatment_hours': dict(value=float(hours_today), previous=None,
                                trend=[item['treatment_hours'] for item in daily][-7:],
                                label='昨日治疗时长', unit='小时'),
        'reported_events': dict(value=int(events_today), previous=None,
                                trend=[item['event_count'] for item in daily][-7:],
                                label='昨日设备上报事件', unit='次'),
        'avg_ahi': dict(value=float(avg_ahi) if avg_ahi is not None else None, previous=None,
                        trend=[], label='昨日平均 AHI', unit='次/小时'),
    }
    return dict(kpis=kpis, daily=daily, users=users, active_change=change,
                users_total=int(users_total), devices_total=int(devices_total))


def device_types(settings, days=30):
    """Distinct device_type values seen recently, for the model filter."""
    rows = _rows(
        settings,
        'SELECT device_type, COUNT(*) FROM resp_statistics_ya70 '
        'WHERE recorde_date >= DATE_SUB(CURDATE(), INTERVAL %s DAY) AND device_type IS NOT NULL '
        'GROUP BY device_type ORDER BY 2 DESC', (days,))
    return [dict(value=str(row[0]), label=f'设备类型 {row[0]}', count=int(row[1])) for row in rows]
