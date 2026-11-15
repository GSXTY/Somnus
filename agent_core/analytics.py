"""Read-only user analytics; never infer real usage from waveform coverage."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Protocol
import re
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo('Asia/Shanghai')
UTC = timezone.utc
DEFINITIONS = {
    'total_users': '截止结束日已注册的去重用户数。',
    'new_users': '所选日期内注册的去重用户数。',
    'active_users': '范围内有有效实际使用区间的去重用户数。',
    'avg_daily_usage_minutes': '实际使用总分钟数 ÷ 活跃用户天数；无使用记录时为未知。',
    'active_user_days': '所选范围每天活跃用户数之和，同一用户跨天分别计入。',
    'usage_minutes': '按用户合并重叠使用区间，裁剪到所选日期，按上海自然日拆分。',
}


@dataclass(frozen=True)
class User:
    user_id: str
    registered_at: datetime
    display_name: str = ''


@dataclass(frozen=True)
class UsageSession:
    user_id: str
    start_at: datetime
    end_at: datetime


@dataclass(frozen=True)
class Snapshot:
    users: tuple[User, ...]
    sessions: tuple[UsageSession, ...]


class AnalyticsRepository(Protocol):
    """Adapters supply cumulative users and actual usage overlapping the period.

    Registration timestamps must include timezone information. Sessions represent
    verified usage, not a recording's first/last sample timestamps. Adapters must
    return complete data for these metrics or raise; never present a page as the
    complete population. Production adapters should use consistent read snapshots.
    """

    def snapshot(self, start_at: datetime, end_at: datetime) -> Snapshot: ...


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('用户与使用时间必须带有明确时区。')
    return value.astimezone(UTC)


def parse_period(query: dict, today: date | None = None):
    today = today or datetime.now(SHANGHAI).date()
    source = query.get('source', ['live'])[0]
    if source not in ('live', 'demo'):
        raise ValueError('不支持的数据来源。')
    try:
        end_text = query.get('end_date', [today.isoformat()])[0]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', end_text):
            raise ValueError()
        end = date.fromisoformat(end_text)
        start_text = query.get('start_date', [(end-timedelta(days=29)).isoformat()])[0]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', start_text):
            raise ValueError()
        start = date.fromisoformat(start_text)
        if end == date.max:
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        raise ValueError('日期格式必须为 YYYY-MM-DD。') from None
    if start > end or (end-start).days >= 366:
        raise ValueError('请选择起止顺序正确、最多 366 天的日期范围。')
    return source, start, end


def aggregate(snapshot: Snapshot, start: date, end: date) -> dict:
    """Compute actual usage, unioning overlapping sessions for each user."""
    start_at = datetime.combine(start, time.min, SHANGHAI).astimezone(UTC)
    end_at = datetime.combine(end+timedelta(days=1), time.min, SHANGHAI).astimezone(UTC)
    users = {}
    for user in snapshot.users:
        if not isinstance(user.user_id, str) or not user.user_id:
            raise ValueError('用户标识不能为空。')
        registered = _utc(user.registered_at)
        if user.user_id in users:
            if users[user.user_id] != user:
                raise ValueError('同一用户标识出现冲突的注册信息。')
            continue
        users[user.user_id] = user
    users = {key: user for key, user in users.items() if _utc(user.registered_at) < end_at}
    days = {(start+timedelta(days=n)).isoformat(): dict(date=(start+timedelta(days=n)).isoformat(),
            new_users=0, active_users=0, usage_minutes=0.0, avg_daily_usage_minutes=None)
            for n in range((end-start).days+1)}
    for user in users.values():
        key = user.registered_at.astimezone(SHANGHAI).date().isoformat()
        if key in days:
            days[key]['new_users'] += 1
    intervals = {uid: [] for uid in users}
    unknown = 0
    for session in snapshot.sessions:
        a, b = _utc(session.start_at), _utc(session.end_at)
        if b <= a:
            raise ValueError('实际使用区间的结束时间必须晚于开始时间。')
        if session.user_id not in users:
            unknown += 1
            continue
        a = max(a, start_at, _utc(users[session.user_id].registered_at))
        b = min(b, end_at)
        if b > a:
            intervals[session.user_id].append((a, b))
    summaries = []
    active_users = 0
    for uid, user in users.items():
        merged = []
        for a, b in sorted(intervals[uid]):
            if merged and a <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        minutes = {}
        for a, b in merged:
            while a < b:
                day = a.astimezone(SHANGHAI).date()
                boundary = datetime.combine(day+timedelta(days=1), time.min, SHANGHAI).astimezone(UTC)
                stop = min(b, boundary)
                key = day.isoformat()
                minutes[key] = minutes.get(key, 0.0)+(stop-a).total_seconds()/60
                a = stop
        for key, value in minutes.items():
            days[key]['usage_minutes'] += value
            days[key]['active_users'] += 1
        active_days = len(minutes)
        total = sum(minutes.values())
        active_users += bool(active_days)
        summaries.append(dict(user_id=uid, display_name=user.display_name or uid,
            registered_at=user.registered_at.astimezone(SHANGHAI).isoformat(),
            usage_minutes=round(total, 3), active_days=active_days,
            avg_daily_usage_minutes=round(total/active_days, 3) if active_days else None,
            recordings_available=False))
    total_usage = sum(day['usage_minutes'] for day in days.values())
    active_user_days = sum(day['active_users'] for day in days.values())
    for day in days.values():
        if day['active_users']:
            day['avg_daily_usage_minutes'] = round(day['usage_minutes']/day['active_users'], 3)
        day['usage_minutes'] = round(day['usage_minutes'], 3)
    return dict(metrics=dict(total_users=len(users), new_users=sum(d['new_users'] for d in days.values()),
        active_users=active_users, avg_daily_usage_minutes=round(total_usage/active_user_days, 3) if active_user_days else None,
        total_usage_minutes=round(total_usage, 3), active_user_days=active_user_days),
        daily=list(days.values()), users=sorted(summaries, key=lambda u: (u['registered_at'], u['user_id']), reverse=True),
        warnings=[f'{unknown} 条使用记录未关联到范围内已注册用户，未计入统计。'] if unknown else [])


class DemoRepository:
    """Deterministic synthetic dataset, stable across filters for a given day."""
    def __init__(self, today: date | None = None):
        self.today = today or datetime.now(SHANGHAI).date()

    def snapshot(self, start_at: datetime, end_at: datetime) -> Snapshot:
        users = tuple(User(f'demo-{n+1:03}', datetime.combine(self.today-timedelta(days=offset), time(9), SHANGHAI),
                    f'演示用户 {n+1}') for n, offset in enumerate((60, 25, 9, 2)))
        sessions = []
        for n, user in enumerate(users):
            for offset in range(45):
                day = self.today-timedelta(days=offset)
                a = datetime.combine(day, time(20), SHANGHAI)
                if a < user.registered_at or (offset+n) % 4 == 0:
                    continue
                b = a+timedelta(minutes=60+((offset*17+n*29) % 180))
                if a < end_at and b > start_at:
                    sessions.append(UsageSession(user.user_id, a, b))
        return Snapshot(users, tuple(sessions))


def dashboard(query: dict, repository: AnalyticsRepository | None = None, today: date | None = None) -> dict:
    source, start, end = parse_period(query, today)
    result = dict(schema_version=2, scope='users', period=dict(start_date=start.isoformat(),
        end_date=end.isoformat(), timezone='Asia/Shanghai'), definitions=DEFINITIONS.copy())
    if source == 'demo':
        repository = DemoRepository(today)
    if repository is None:
        return dict(result, source=dict(mode='unconfigured', connected=False, label='未连接数据库'),
            metrics={key: None for key in ('total_users','new_users','active_users','avg_daily_usage_minutes',
                                        'total_usage_minutes','active_user_days')}, daily=[], users=[],
            warnings=['尚未连接用户数据库。请接入注册信息与实际使用记录后查看真实运营数据。'])
    a = datetime.combine(start, time.min, SHANGHAI)
    b = datetime.combine(end+timedelta(days=1), time.min, SHANGHAI)
    stats = aggregate(repository.snapshot(a, b), start, end)
    if source == 'demo':
        stats['warnings'].insert(0, '演示数据：所有用户及使用记录均为合成，未连接真实数据库。')
    return dict(result, source=dict(mode='demo' if source == 'demo' else 'live', connected=source != 'demo',
        label='演示数据' if source == 'demo' else '已连接用户数据源'), **stats)
