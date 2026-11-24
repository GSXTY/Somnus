"""Guarded, read-only SQL access for the AI query feature.

The model may propose SQL, but nothing reaches the database until it passes
`guard()`; execution then runs on a read-only connection with a row cap, a
statement timeout and an audit trail. Never let a model touch a writable session.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit


class SqlAccessError(ValueError):
    """Rejected SQL or unavailable database, with an operator-facing message."""


FORBIDDEN = re.compile(
    r'\b(insert|update|delete|merge|replace|drop|alter|create|truncate|grant|revoke|'
    r'attach|detach|pragma|vacuum|reindex|load_extension|call|do|handler|rename)\b', re.I)
FORBIDDEN_PAIRS = re.compile(r'\b(into\s+(outfile|dumpfile)|for\s+update|lock\s+in\s+share\s+mode)\b', re.I)
SELECT_ONLY = re.compile(r'^\s*(select|with)\b', re.I)
TABLE_REF = re.compile(r'\b(?:from|join)\s+([`"\[]?[\w.]+[`"\]]?)', re.I)


@dataclass(frozen=True)
class SqlSettings:
    url: str
    max_rows: int = 200
    timeout_seconds: float = 15.0
    allowed_tables: tuple[str, ...] = field(default_factory=tuple)
    audit_path: Path | None = None

    @classmethod
    def from_env(cls, root: Path | None = None) -> 'SqlSettings':
        root = root or Path(__file__).resolve().parents[1]
        url = os.getenv('ANALYTICS_DB_URL', '').strip() or f'sqlite:///{(root / "data" / "analytics_demo.sqlite3").as_posix()}'
        tables = tuple(t.strip().lower() for t in os.getenv('ANALYTICS_SQL_TABLES', '').split(',') if t.strip())
        audit = Path(os.getenv('ANALYTICS_SQL_AUDIT', str(root / 'data' / 'logs' / 'sql-audit.jsonl')))
        return cls(url=url, max_rows=_int_env('ANALYTICS_SQL_MAX_ROWS', 200, 1, 5000),
                   timeout_seconds=_float_env('ANALYTICS_SQL_TIMEOUT', 15.0, 1.0, 120.0),
                   allowed_tables=tables, audit_path=audit)

    @property
    def driver(self) -> str:
        scheme = urlsplit(self.url).scheme.lower()
        if scheme in ('sqlite', 'sqlite3', 'file'):
            return 'sqlite'
        if scheme in ('mysql', 'mysql+pymysql'):
            return 'mysql'
        return scheme or 'sqlite'

    @property
    def sqlite_path(self) -> Path:
        url = self.url
        if url.startswith('sqlite:///'):
            return Path(unquote(url[len('sqlite:///'):]))
        if '://' not in url:
            return Path(url)
        raise SqlAccessError('仅支持 sqlite:///path 或 mysql://user:pass@host/db 形式的数据源。')

    @property
    def description(self) -> str:
        if self.driver == 'sqlite':
            return self.sqlite_path.name
        parts = urlsplit(self.url)
        return f'{parts.hostname or "?"}/{parts.path.lstrip("/") or "?"}'


def _int_env(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(low, min(high, value))


def _float_env(name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(low, min(high, value))


def guard(sql: str, settings: SqlSettings) -> str:
    """Return a normalized single SELECT statement or raise ``SqlAccessError``."""
    text = (sql or '').strip()
    if not text:
        raise SqlAccessError('SQL 为空。')
    if len(text) > 20000:
        raise SqlAccessError('SQL 过长。')
    body = text[:-1].strip() if text.endswith(';') else text
    if ';' in body:
        raise SqlAccessError('一次只能执行一条语句。')
    if not SELECT_ONLY.match(body):
        raise SqlAccessError('只允许 SELECT / WITH 查询。')
    if '--' in body or '/*' in body or '#' in body:
        raise SqlAccessError('SQL 中不允许注释。')
    if FORBIDDEN.search(body):
        raise SqlAccessError('SQL 包含不允许的关键字（写入、DDL 或系统调用）。')
    if FORBIDDEN_PAIRS.search(body):
        raise SqlAccessError('SQL 包含不允许的锁定或导出子句。')
    if settings.allowed_tables:
        referenced = {match.group(1).strip('`"[]').lower() for match in TABLE_REF.finditer(body)}
        unknown = sorted(name for name in referenced if name.split('.')[-1] not in settings.allowed_tables)
        if unknown:
            raise SqlAccessError('查询了未授权的表：' + '、'.join(unknown))
    if not re.search(r'\blimit\b', body, re.I):
        body = f'{body}\nLIMIT {settings.max_rows}'
    return body


def connect(settings: SqlSettings):
    """Open a read-only connection for the configured backend."""
    if settings.driver == 'sqlite':
        path = settings.sqlite_path
        if not path.is_file():
            raise SqlAccessError(f'数据源不存在：{path}。请先初始化演示库或配置 ANALYTICS_DB_URL。')
        # URI delimiters in an ordinary filename (notably # in sandbox/TEMP
        # paths) must not become fragments or query parameters. as_uri also
        # escapes literal percent signs and keeps the readonly flag our own.
        connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True,
                                     timeout=settings.timeout_seconds)
        connection.row_factory = sqlite3.Row
        return connection
    if settings.driver == 'mysql':
        try:
            import pymysql  # noqa: F401
        except ImportError as exc:
            raise SqlAccessError('未安装 MySQL 驱动：请执行 pip install pymysql 后重启服务。') from exc
        parts = urlsplit(settings.url)
        import pymysql
        try:
            connection = pymysql.connect(host=parts.hostname or '127.0.0.1', port=parts.port or 3306,
                                         user=unquote(parts.username or ''), password=unquote(parts.password or ''),
                                         database=(parts.path or '/').lstrip('/'), charset='utf8mb4',
                                         connect_timeout=int(settings.timeout_seconds),
                                         read_timeout=int(settings.timeout_seconds), autocommit=True)
        except Exception as exc:
            raise SqlAccessError(f'连接数据库失败：{exc}') from None
        with connection.cursor() as cursor:
            cursor.execute('SET SESSION TRANSACTION READ ONLY')
            cursor.execute(f'SET SESSION max_execution_time={int(settings.timeout_seconds * 1000)}')
        return connection
    raise SqlAccessError(f'不支持的数据源类型：{settings.driver}')


def schema(settings: SqlSettings, *, limit_tables: int = 60) -> list[dict]:
    """Return ``[{table, columns:[{name,type}]}]`` for the prompt and the UI."""
    connection = connect(settings)
    try:
        if settings.driver == 'sqlite':
            names = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            if settings.allowed_tables:
                names = [name for name in names if name.lower() in settings.allowed_tables]
            tables = []
            for name in names[:limit_tables]:
                columns = [dict(name=row[1], type=row[2] or '') for row in connection.execute(f'PRAGMA table_info("{name}")')]
                tables.append(dict(table=name, columns=columns))
            return tables
        with connection.cursor() as cursor:
            cursor.execute('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name')
            names = [row[0] for row in cursor.fetchall()]
            if settings.allowed_tables:
                names = [name for name in names if name.lower() in settings.allowed_tables]
            tables = []
            for name in names[:limit_tables]:
                cursor.execute('SELECT column_name, column_type FROM information_schema.columns '
                               'WHERE table_schema = DATABASE() AND table_name = %s ORDER BY ordinal_position', (name,))
                tables.append(dict(table=name, columns=[dict(name=r[0], type=r[1]) for r in cursor.fetchall()]))
            return tables
    finally:
        connection.close()


def run(sql: str, settings: SqlSettings) -> dict:
    """Guard, execute and audit one read-only query."""
    injected_limit = not re.search(r'\blimit\b', sql or '', re.I)
    statement = guard(sql, settings)
    started = time.monotonic()
    try:
        connection = connect(settings)
    except SqlAccessError:
        raise
    try:
        if settings.driver == 'sqlite':
            deadline = started + settings.timeout_seconds
            connection.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 5000)
        cursor = connection.cursor()
        cursor.execute(statement)
        columns = [column[0] for column in (cursor.description or [])]
        rows = cursor.fetchmany(settings.max_rows + 1)
        truncated = len(rows) > settings.max_rows or (injected_limit and len(rows) >= settings.max_rows)
        rows = rows[:settings.max_rows]
        data = [[_json_safe(value) for value in (tuple(row) if not hasattr(row, 'keys') else list(row))] for row in rows]
    except sqlite3.OperationalError as exc:
        raise SqlAccessError(f'查询失败：{exc}') from None
    except Exception as exc:  # driver-specific errors
        raise SqlAccessError(f'查询失败：{exc}') from None
    finally:
        connection.close()
    elapsed = round((time.monotonic() - started) * 1000)
    _audit(settings, statement, len(data), elapsed, error='')
    return dict(sql=statement, columns=columns, rows=data, truncated=truncated, elapsed_ms=elapsed)


def _json_safe(value):
    if value is None or isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


def _audit(settings: SqlSettings, statement: str, rows: int, elapsed: int, *, error: str) -> None:
    if not settings.audit_path:
        return
    try:
        settings.audit_path.parent.mkdir(parents=True, exist_ok=True)
        entry = dict(at=time.strftime('%Y-%m-%dT%H:%M:%S%z'), database=settings.description,
                     sql=statement, rows=rows, elapsed_ms=elapsed, error=error)
        with settings.audit_path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except OSError:
        pass


def describe_for_prompt(tables: list[dict]) -> str:
    """Compact schema text the model can read without blowing the context."""
    lines = []
    for table in tables:
        columns = ', '.join(f'{c["name"]} {c["type"]}'.strip() for c in table['columns'])
        lines.append(f'{table["table"]}({columns})')
    return '\n'.join(lines)
