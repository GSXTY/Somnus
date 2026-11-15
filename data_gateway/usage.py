"""Gateway operator view and minimal per-token usage records."""
from base64 import b64decode
from binascii import Error as Base64Error
from contextlib import closing
from datetime import datetime, timezone
from hashlib import sha256
from hmac import compare_digest
from html import escape
from pathlib import Path
import sqlite3
from time import time

from data_gateway.routes import TOKEN


ADMIN_PATH = '/admin'
ADMIN_USAGE_PATH = '/api/data-gateway/admin/usage'
PRESENCE_TIMEOUT = 150
RECENT_USAGE_TIMEOUT = 900
AUDIT_RETENTION_SECONDS = 30 * 24 * 3600
AUDIT_LIMIT = 10_000
AUDIT_DISPLAY_LIMIT = 100
AUDIT_OPERATIONS = {
    'dashboard': '数据看板', 'user_detail': '查看用户详情', 'sql_schema': '查看数据库结构',
    'sql_query': '执行只读查询', 'sql_ask': '生成并执行只读查询',
    'deep_status': '分析服务状态', 'deep_sample': '分析样例', 'deep_upload': '上传分析文件',
    'deep_list': '查看分析任务', 'deep_create': '创建分析任务', 'deep_task': '查看分析任务详情',
    'deep_cancel': '取消分析任务', 'deep_artifact': '读取分析产物',
}
ADMIN_CHALLENGE = {'WWW-Authenticate': 'Basic realm="Somnus Gateway Admin", charset="UTF-8"'}
ADMIN_PAGE_HEADERS = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
}


def _identity(token):
    return sha256(b'vv-man:gateway-usage:v1\x00' + token).hexdigest()


def _utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec='seconds') if timestamp else None


class Usage:
    def __init__(self, database, password, tokens, labels=None):
        if not isinstance(password, str) or not TOKEN.fullmatch(password) or any(compare_digest(password, token) for token in tokens):
            raise ValueError('管理员密码须使用独立生成的 32–256 字符随机密码。')
        labels = {} if labels is None else labels
        if (not isinstance(labels, dict) or not set(labels).issubset(tokens)
                or any(not isinstance(label, str) or not label.strip() or len(label) > 80 or not label.isprintable()
                       for label in labels.values())):
            raise ValueError('用户备注须对应现有访问令牌，且限 1–80 个可显示字符。')
        self.password = password.encode('ascii')
        self.users = {_identity(token.encode('ascii')): labels.get(token, '').strip() for token in tokens}
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as db, db:
            db.execute('''CREATE TABLE IF NOT EXISTS gateway_usage (
                identity TEXT PRIMARY KEY,
                last_request REAL,
                request_count INTEGER NOT NULL DEFAULT 0,
                last_presence REAL,
                client_version TEXT
            )''')
            db.execute('''CREATE TABLE IF NOT EXISTS gateway_audit (
                id INTEGER PRIMARY KEY, identity TEXT NOT NULL, operation TEXT NOT NULL,
                status INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL, recorded_at REAL NOT NULL
            )''')
            db.execute('CREATE INDEX IF NOT EXISTS gateway_audit_recorded_at ON gateway_audit(recorded_at)')
            db.execute('DELETE FROM gateway_audit WHERE recorded_at < ?', (time() - AUDIT_RETENTION_SECONDS,))

    def _connect(self):
        db = sqlite3.connect(self.database, timeout=2)
        db.row_factory = sqlite3.Row
        return db

    def allows_admin(self, headers):
        values = headers.getlist('authorization')
        if len(values) != 1 or len(values[0]) > 512:
            return False
        scheme, _, value = values[0].partition(' ')
        if scheme.lower() != 'basic':
            return False
        try:
            username, separator, password = b64decode(value, validate=True).partition(b':')
        except (Base64Error, ValueError):
            return False
        password_matches = compare_digest(password, self.password)
        return password_matches and username == b'admin' and separator == b':'

    def record(self, token, *, version=None):
        identity = _identity(token)
        now = time()
        with closing(self._connect()) as db, db:
            if version is None:
                db.execute('''INSERT INTO gateway_usage(identity,last_request,request_count) VALUES(?,?,1)
                    ON CONFLICT(identity) DO UPDATE SET last_request=max(coalesce(last_request,0),excluded.last_request),
                    request_count=request_count+1''', (identity, now))
            else:
                db.execute('''INSERT INTO gateway_usage(identity,last_presence,client_version) VALUES(?,?,?)
                    ON CONFLICT(identity) DO UPDATE SET last_presence=excluded.last_presence,client_version=excluded.client_version
                    WHERE gateway_usage.last_presence IS NULL OR excluded.last_presence>=gateway_usage.last_presence''',
                           (identity, now, version))

    def audit(self, token, operation, status, elapsed_ms):
        identity = _identity(token)
        if operation not in AUDIT_OPERATIONS or identity not in self.users or not 100 <= status <= 599:
            return
        now = time()
        with closing(self._connect()) as db, db:
            db.execute('''INSERT INTO gateway_audit(identity,operation,status,elapsed_ms,recorded_at)
                VALUES(?,?,?,?,?)''', (identity, operation, status, max(0, min(elapsed_ms, 86_400_000)), now))
            db.execute('DELETE FROM gateway_audit WHERE recorded_at < ?', (now - AUDIT_RETENTION_SECONDS,))
            db.execute('''DELETE FROM gateway_audit WHERE id <= (SELECT id FROM gateway_audit
                ORDER BY id DESC LIMIT 1 OFFSET ?)''', (AUDIT_LIMIT,))

    def snapshot(self):
        now = time()
        with closing(self._connect()) as db:
            records = {row['identity']: row for row in db.execute('SELECT * FROM gateway_usage')}
            events = list(db.execute('''SELECT identity,operation,status,elapsed_ms,recorded_at FROM gateway_audit
                WHERE recorded_at >= ? ORDER BY id DESC LIMIT ?''',
                                     (now - AUDIT_RETENTION_SECONDS, AUDIT_DISPLAY_LIMIT)))
        users = []
        for identity, label in self.users.items():
            record = records.get(identity)
            last_request = record['last_request'] if record else None
            last_presence = record['last_presence'] if record else None
            last_seen = max(last_request or 0, last_presence or 0)
            active = bool(last_presence and last_presence >= now - PRESENCE_TIMEOUT)
            recent = bool(last_request and last_request >= now - RECENT_USAGE_TIMEOUT)
            users.append({
                'id': identity[:16],
                'name': label or '访客 ' + identity[:8],
                'last_seen': _utc(last_seen),
                'last_request': _utc(last_request),
                'request_count': record['request_count'] if record else 0,
                'last_presence': _utc(last_presence),
                'client_version': record['client_version'] if record else None,
                'status': 'online' if active else 'recent' if recent else 'offline' if last_seen else 'unseen',
            })
        users.sort(key=lambda row: (row['last_seen'] or '', row['id']), reverse=True)
        audit = []
        for row in events:
            identity = row['identity']
            audit.append({'user_id': identity[:16], 'name': self.users.get(identity) or '访客 ' + identity[:8],
                          'operation': row['operation'], 'status': row['status'],
                          'elapsed_ms': row['elapsed_ms'], 'recorded_at': _utc(row['recorded_at'])})
        return {'users': users, 'audit': audit, 'online_count': sum(user['status'] == 'online' for user in users),
                'presence_window_seconds': PRESENCE_TIMEOUT, 'recent_window_seconds': RECENT_USAGE_TIMEOUT}


def admin_page(snapshot):
    labels = {'online': '近期在线', 'recent': '最近访问', 'offline': '长时间无活动', 'unseen': '尚未访问'}
    rows = []
    for user in snapshot['users']:
        fields = (user['name'], user['id'], labels[user['status']], user['last_presence'],
                  user['last_request'], user['client_version'], user['request_count'])
        rows.append('<tr>' + ''.join('<td>' + escape('—' if value is None else str(value)) + '</td>' for value in fields) + '</tr>')
    audit_rows = []
    for event in snapshot['audit']:
        fields = (event['recorded_at'], event['name'], event['user_id'], AUDIT_OPERATIONS[event['operation']],
                  event['status'], event['elapsed_ms'])
        audit_rows.append('<tr>' + ''.join('<td>' + escape(str(value)) + '</td>' for value in fields) + '</tr>')
    return '''<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Somnus 使用情况</title>
<style>
:root {color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif;}
body {margin: 0; background: Canvas; color: CanvasText;}
main {max-width: 80rem; padding: 2rem 1rem; margin: auto;}
header {display:flex; align-items:center; justify-content:space-between; gap:1rem;}
h1 {font-size:1.7rem; margin:0;}
p {margin: 1rem 0;}
a {color: LinkText;}
.table {overflow:auto; border:1px solid color-mix(in srgb, CanvasText 24%, Canvas); border-radius:.7rem;}
table {border-collapse:collapse; width:100%; text-align:left; white-space:nowrap;}
th,td {padding:.7rem .85rem; border-bottom:1px solid color-mix(in srgb, CanvasText 18%, Canvas);}
tbody tr:last-child td {border-bottom:0;}
</style>
<main><header><h1>Somnus 使用情况</h1><a href="/admin">刷新</a></header>
<p>近期在线 <strong>''' + str(snapshot['online_count']) + '''</strong> · 已配置用户 <strong>''' + str(len(snapshot['users'])) + '''</strong></p>
<p>最近 150 秒有桌面心跳时显示为近期在线。旧版可以显示网关访问记录。时间使用 UTC。</p>
<div class="table"><table><thead><tr><th>用户备注</th><th>识别号</th><th>状态</th><th>上次桌面心跳</th>
<th>上次网关请求</th><th>桌面版本</th><th>网关请求次数</th></tr></thead>
<tbody>''' + ''.join(rows) + '''</tbody></table></div>
<h2>最近网关操作</h2>
<p>仅管理员可查看。记录操作类型、HTTP 状态和响应耗时，不保存请求内容。最多保留 30 天，显示最新 100 条。</p>
<div class="table"><table><thead><tr><th>时间</th><th>用户备注</th><th>识别号</th><th>操作</th>
<th>HTTP 状态</th><th>耗时（毫秒）</th></tr></thead>
<tbody>''' + ''.join(audit_rows) + '''</tbody></table></div></main></html>'''

