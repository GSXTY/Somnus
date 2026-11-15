"""Live dashboard metrics read from the analytics database.

Only aggregate queries against whitelisted tables; every range is bounded by a
date window so a dashboard refresh can never scan the whole warehouse.
"""
from __future__ import annotations

from datetime import date, timedelta

from agent_core.sql_access import connect, SqlAccessError, SqlSettings

DAY_LABELS = 'Asia/Shanghai'


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
