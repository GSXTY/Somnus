"""Opt-in local desktop companion for explicit Dot task handoff."""

import base64
from contextlib import closing
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid

from .dot_webhooks import iso, json_bytes, outbound, signed_headers


EVENT = 'task.created'
INFO = {'name': 'somnus-dot', 'version': '1.0.0'}
CAPABILITIES = {'tools': {}, 'events': {}}
VERSIONS = ('2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28')
TASK_TTL = 1800


def object_schema(*fields):
    return {'type': 'object', 'properties': {field: {'type': 'string'} for field in fields},
            'required': list(fields), 'additionalProperties': False}


TOOLS = [
    {'name': 'read_task', 'description': 'Read the explicitly submitted Somnus task.',
     'inputSchema': object_schema('task_id'), 'annotations': {'readOnlyHint': True}},
    {'name': 'submit_result', 'description': 'Write the result of a Somnus task.',
     'inputSchema': object_schema('task_id', 'result'),
     'annotations': {'readOnlyHint': False, 'destructiveHint': False,
                     'idempotentHint': True, 'openWorldHint': False}},
]


class DotError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


class RpcError(Exception):
    def __init__(self, code, message, reason=None):
        self.value = {'code': code, 'message': message}
        if reason:
            self.value['data'] = {'reason': reason}


class DotTasks:
    def __init__(self, folder, sender=outbound):
        self.folder = folder
        self.path = folder / 'dot_tasks.sqlite3'
        self.config_path = folder / 'dot-companion.json'
        self.sender = sender
        self.lock = threading.RLock()
        self.delivery_lock = threading.Lock()
        self.listener = None
        self.subscription = None
        self.route_key = None
        self.paused = False

    def config(self, *, strict=False):
        port = os.getenv('SOMNUS_DOT_MCP_PORT')
        secret_path = os.getenv('SOMNUS_DOT_MCP_PATH')
        if port is None and secret_path is None:
            try:
                config = json.loads(self.config_path.read_text(encoding='utf-8-sig'))
                port, secret_path = config['port'], config['secret_path']
            except FileNotFoundError:
                return None
            except (OSError, ValueError, KeyError, TypeError):
                if strict:
                    raise DotError('dot_config_invalid', '本机 Dot 配置无效或无法读取。', 409) from None
                return None
        try:
            if isinstance(port, str) and re.fullmatch(r'[0-9]{1,5}', port):
                port = int(port)
            if (type(port) is not int or not 1024 <= port <= 65535 or not isinstance(secret_path, str)
                    or not re.fullmatch(r'[A-Za-z0-9_-]{24,128}', secret_path)):
                raise ValueError
        except (TypeError, ValueError):
            if strict:
                raise DotError('dot_config_invalid', '本机 Dot 端口或连接路径无效。', 409) from None
            return None
        return port, '/mcp/' + secret_path

    def start(self):
        with self.lock:
            config = self.config()
            if config is None or self.listener is not None:
                return
            try:
                self.launch(*config)
            except DotError:
                return

    def launch(self, port, route, *, persist=False):
        try:
            listener = ThreadingHTTPServer(('127.0.0.1', port), CompanionHandler)
        except OSError:
            raise DotError('dot_port_unavailable', '本机 Dot 端口无法绑定，请检查端口是否已被占用。', 409) from None
        listener.dot_tasks = self
        listener.route = route
        self.route_key = hashlib.sha256(route.encode()).hexdigest()
        try:
            if self.path.is_file():
                with self.db() as db:
                    row = db.execute('SELECT paused FROM dot_preferences WHERE slot = 1').fetchone()
                    self.paused = bool(row and row['paused'])
                if not persist:
                    self.restore_subscription()
            if persist:
                self.save_config(listener.server_address[1], route.rsplit('/', 1)[-1])
        except (DotError, sqlite3.Error) as exc:
            listener.server_close()
            self.route_key = None
            self.subscription = None
            if isinstance(exc, DotError):
                raise
            raise DotError('dot_storage_error', '本机 Dot 存储暂时无法读取。', 503) from None
        self.listener = listener
        threading.Thread(target=listener.serve_forever, daemon=True).start()

    def save_config(self, port, secret_path):
        # Exclusive creation preserves an externally configured file and avoids applying failed binds.
        created = False
        try:
            with self.config_path.open('x', encoding='utf-8') as config:
                created = True
                json.dump({'port': port, 'secret_path': secret_path}, config)
        except OSError:
            if created:
                try:
                    self.config_path.unlink()
                except OSError:
                    pass
            raise DotError('dot_config_write_failed', '无法保存本机 Dot 配置。', 409) from None

    def setup_status(self):
        with self.lock:
            if self.listener:
                endpoint = (self.listener.server_address[1], self.listener.route)
            else:
                endpoint = self.config()
            port, route = endpoint if endpoint else (None, None)
            return {**self.status(), 'port': port, 'secret_path': route.rsplit('/', 1)[-1] if route else None}

    def setup(self, port=None):
        if port is not None and (type(port) is not int or not 1024 <= port <= 65535):
            raise DotError('dot_port_invalid', 'Dot 端口须为 1024 到 65535 的整数。')
        with self.lock:
            if self.listener is None:
                existing = self.config(strict=True)
                if existing:
                    self.launch(*existing)
                else:
                    self.launch(port or 0, '/mcp/' + secrets.token_urlsafe(32), persist=True)
            return self.setup_status()

    def set_enabled(self, enabled):
        if type(enabled) is not bool:
            raise DotError('invalid_dot_enabled', '请选择开启或暂停 Dot。')
        paused = not enabled
        with self.delivery_lock, self.lock:
            if self.listener is None:
                raise DotError('dot_unavailable', '请先配置本机 Dot。', 409)
            if self.paused != paused:
                try:
                    with self.db() as db:
                        db.execute('INSERT OR REPLACE INTO dot_preferences (slot, paused) VALUES (1, ?)',
                                   (int(paused),))
                except sqlite3.Error:
                    raise DotError('dot_storage_error', '本机 Dot 状态暂时无法保存。', 503) from None
                self.paused = paused
            return self.setup_status()

    def stop(self):
        listener = self.listener
        if listener is not None:
            listener.shutdown()
            listener.server_close()
            self.listener = None
        with self.lock:
            self.subscription = None

    def db(self):
        db = sqlite3.connect(self.path, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("""
            CREATE TABLE IF NOT EXISTS dot_tasks (
                id TEXT PRIMARY KEY, cid TEXT NOT NULL, subscription TEXT NOT NULL,
                created_at TEXT NOT NULL, expires REAL NOT NULL,
                status TEXT NOT NULL, prompt TEXT NOT NULL, result TEXT, error TEXT
            )
        """)
        db.execute('CREATE INDEX IF NOT EXISTS dot_tasks_cid ON dot_tasks(cid, expires)')
        db.execute("""CREATE TABLE IF NOT EXISTS dot_subscription (
                      slot INTEGER PRIMARY KEY CHECK (slot = 1), route_key TEXT NOT NULL,
                      id TEXT NOT NULL, url TEXT NOT NULL, key BLOB NOT NULL, expires REAL NOT NULL
                      )""")
        db.execute("""CREATE TABLE IF NOT EXISTS dot_preferences (
                      slot INTEGER PRIMARY KEY CHECK (slot = 1),
                      paused INTEGER NOT NULL CHECK (paused IN (0, 1))
                      )""")
        return closing(db)

    def restore_subscription(self):
        with self.db() as db:
            db.execute('DELETE FROM dot_subscription WHERE route_key!=? OR expires<=?',
                       (self.route_key, time.time()))
            row = db.execute('SELECT id,url,key,expires FROM dot_subscription').fetchone()
            if row is not None:
                self.subscription = dict(row)

    def active_subscription(self):
        with self.lock:
            if self.subscription and self.subscription['expires'] > time.time():
                return self.subscription.copy()
        return None

    def list_tasks(self, cid):
        tasks = []
        if self.path.is_file():
            with self.db() as db:
                db.execute("""UPDATE dot_tasks SET status='error', error='等待 Dot 返回结果超时。'
                              WHERE cid=? AND status='pending' AND expires<=?""", (cid, time.time()))
                tasks = [dict(row) for row in db.execute("""
                    SELECT id, status, prompt, result, error, created_at
                    FROM dot_tasks WHERE cid=? ORDER BY expires DESC LIMIT 50
                """, (cid,))]
        return {'tasks': tasks, **self.status()}

    def status(self):
        with self.lock:
            enabled = self.listener is not None
            return {'enabled': enabled, 'paused': self.paused,
                    'ready': enabled and not self.paused and self.active_subscription() is not None}

    def create_task(self, cid, prompt):
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
            raise DotError('invalid_dot_prompt', '请输入 1–4000 个字符的 Dot 任务。')
        with self.delivery_lock:
            if self.paused:
                raise DotError('dot_paused', 'Dot 已暂停。请在设置中开启后再派发任务。', 409)
            return self.deliver_task(cid, prompt.strip())

    def deliver_task(self, cid, prompt):
        subscription = self.active_subscription()
        if self.listener is None or subscription is None:
            raise DotError('dot_unavailable', 'Dot 尚未订阅本机任务。', 409)
        now = time.time()
        task = {'id': 'task_' + uuid.uuid4().hex, 'status': 'pending', 'prompt': prompt,
                'created_at': iso(now), 'result': None, 'error': None}
        with self.lock, self.db() as db:
            current = db.execute("""SELECT COUNT(*) FROM dot_tasks
                                    WHERE cid=? AND status='pending' AND expires>?""", (cid, now)).fetchone()[0]
            if current >= 3:
                raise DotError('dot_busy', '请等待当前 Dot 任务完成。', 409)
            db.execute("""INSERT INTO dot_tasks
                          (id, cid, subscription, created_at, expires, status, prompt)
                          VALUES (?, ?, ?, ?, ?, ?, ?)""",
                       (task['id'], cid, subscription['id'], task['created_at'], now + TASK_TTL,
                        task['status'], task['prompt']))
        event_id = 'evt_' + uuid.uuid4().hex
        event = {'eventId': event_id, 'name': EVENT, 'timestamp': task['created_at'],
                 'data': {'task_id': task['id'], 'summary': 'A Somnus task is ready.'}, 'cursor': None}
        try:
            status, _ = self.send(subscription, event_id, event)
        except (OSError, ValueError, http.client.HTTPException):
            status = None
        if status is None or not 200 <= status < 300:
            with self.db() as db:
                db.execute("""UPDATE dot_tasks SET status='error', error='Dot 未接收任务，请重新发送。'
                              WHERE id=? AND status='pending'""", (task['id'],))
        with self.db() as db:
            return dict(db.execute("""
                SELECT id, status, prompt, result, error, created_at FROM dot_tasks WHERE id=?
            """, (task['id'],)).fetchone())

    def send(self, subscription, message_id, payload):
        body = json_bytes(payload)
        headers = signed_headers(body, message_id, subscription['id'], subscription['key'])
        return self.sender(subscription['url'], body, headers)

    def subscribe(self, params, *, remove=False):
        delivery = params.get('delivery')
        if (params.get('name') != EVENT or params.get('arguments', {}) != {}
                or not isinstance(delivery, dict) or delivery.get('mode', 'webhook') != 'webhook'
                or not isinstance(delivery.get('url'), str)):
            raise RpcError(-32602, 'Invalid event or webhook delivery')
        url = delivery['url']
        sub_id = 'sub_' + hashlib.sha256((EVENT + '\0' + url).encode()).hexdigest()[:32]
        with self.lock:
            current = self.active_subscription()
            if remove:
                if current and current['id'] == sub_id:
                    if self.route_key is not None:
                        with self.db() as db:
                            db.execute('DELETE FROM dot_subscription WHERE route_key=?', (self.route_key,))
                    self.subscription = None
                return {}
            if current and current['id'] != sub_id:
                raise RpcError(-32000, 'This desktop companion already has an active subscription')
            if self.paused and not current:
                raise RpcError(-32000, 'This desktop companion is paused')
        try:
            raw = delivery['secret']
            if not isinstance(raw, str) or not raw.startswith('whsec_'):
                raise ValueError
            encoded = raw[6:]
            key = base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True)
            if not 24 <= len(key) <= 64:
                raise ValueError
        except (KeyError, ValueError):
            raise RpcError(-32602, 'Invalid webhook signing secret') from None
        ttl = params.get('ttlMs')
        if ttl is not None and (type(ttl) is not int or ttl <= 0):
            raise RpcError(-32602, 'Invalid subscription duration')
        sub = {'id': sub_id, 'url': url, 'key': key}
        if not current or current['key'] != key:
            with self.lock:
                if self.paused:
                    raise RpcError(-32000, 'This desktop companion is paused')
            challenge = secrets.token_urlsafe(24)
            try:
                status, body = self.send(sub, 'msg_verification_' + uuid.uuid4().hex,
                                         {'type': 'verification', 'challenge': challenge})
                echoed = json.loads(body).get('challenge') if 200 <= status < 300 else None
                if not isinstance(echoed, str) or not hmac.compare_digest(echoed, challenge):
                    raise ValueError
            except (OSError, ValueError, AttributeError, http.client.HTTPException):
                raise RpcError(-32015, 'CallbackEndpointError', 'challenge_failed') from None
        sub['expires'] = time.time() + (3600 if ttl is None else min(3600000, ttl) / 1000)
        with self.lock:
            latest = self.active_subscription()
            if self.paused and (not latest or latest['id'] != sub_id or latest['key'] != key):
                raise RpcError(-32000, 'This desktop companion is paused')
            if latest and latest['id'] != sub_id:
                raise RpcError(-32000, 'This desktop companion already has an active subscription')
            if self.route_key is not None:
                with self.db() as db:
                    db.execute("""INSERT OR REPLACE INTO dot_subscription
                                  (slot, route_key, id, url, key, expires) VALUES (1, ?, ?, ?, ?, ?)""",
                               (self.route_key, sub_id, url, key, sub['expires']))
            self.subscription = sub
        return {'id': sub_id, 'refreshBefore': iso(sub['expires']), 'cursor': None, 'truncated': False}

    def call_tool(self, params):
        args, name = params.get('arguments'), params.get('name')
        task_id = args.get('task_id') if isinstance(args, dict) else None
        subscription = self.active_subscription()
        if (not subscription or not isinstance(task_id, str) or name not in ('read_task', 'submit_result')
                or not self.path.is_file()):
            raise RpcError(-32602, 'Unknown or expired task')
        with self.lock, self.db() as db:
            task = db.execute("""SELECT * FROM dot_tasks WHERE id=? AND subscription=?
                                 AND status IN ('pending', 'complete') AND expires>?""",
                              (task_id, subscription['id'], time.time())).fetchone()
            if task is None:
                raise RpcError(-32602, 'Unknown or expired task')
            if name == 'read_task':
                if self.paused and task['status'] != 'pending':
                    raise RpcError(-32602, 'Unknown or expired task')
                output = {'task_id': task_id, 'text': task['prompt']}
            else:
                result = args.get('result')
                if not isinstance(result, str) or not 1 <= len(result.strip()) <= 8000:
                    raise RpcError(-32602, 'Result must be 1–8000 characters')
                result = result.strip()
                if task['status'] == 'pending':
                    db.execute("""UPDATE dot_tasks SET status='complete',result=?
                                  WHERE id=? AND status='pending'""", (result, task_id))
                elif result != task['result']:
                    raise RpcError(-32602, 'A result was already submitted')
                output = {'task_id': task_id, 'recorded': True}
        return {'content': [{'type': 'text', 'text': json_bytes(output).decode()}],
                'structuredContent': output, 'isError': False}

    def dispatch(self, method, params):
        if method == 'initialize':
            requested = params.get('protocolVersion')
            return {'protocolVersion': requested if requested in VERSIONS else '2025-11-25',
                    'capabilities': CAPABILITIES, 'serverInfo': INFO}
        if method == 'server/discover':
            return {'resultType': 'complete', 'supportedVersions': ['2026-07-28'],
                    'capabilities': CAPABILITIES, 'serverInfo': INFO}
        if method == 'ping':
            return {}
        if method == 'events/list':
            return {'events': [{'name': EVENT, 'description': 'A task explicitly sent from Somnus.',
                                'delivery': ['webhook'], 'inputSchema': object_schema(),
                                'payloadSchema': object_schema('task_id', 'summary')}]}
        if method in ('events/subscribe', 'events/unsubscribe'):
            return self.subscribe(params, remove=method == 'events/unsubscribe')
        if method == 'tools/list':
            return {'tools': TOOLS}
        if method == 'tools/call':
            return self.call_tool(params)
        raise RpcError(-32601, 'Method not found')


class CompanionHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def setup(self):
        self.request.settimeout(10)
        super().setup()

    def respond(self, status, payload=None):
        body = json_bytes(payload) if payload is not None else b''
        self.send_response(status)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        if body:
            self.send_header('Content-Type', 'application/json')
        if status == 405:
            self.send_header('Allow', 'POST')
        self.end_headers()
        if body:
            self.wfile.write(body)

    def authorized(self):
        return self.path == self.server.route and not self.headers.get('Origin')

    def do_GET(self):
        self.respond(405 if self.authorized() else 404)

    def do_POST(self):
        if not self.authorized():
            self.respond(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 32768:
                self.respond(413)
                return
            message = json.loads(self.rfile.read(length))
            if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
                raise ValueError
        except (ValueError, OSError):
            self.respond(400, {'jsonrpc': '2.0', 'id': None,
                               'error': {'code': -32600, 'message': 'Invalid request'}})
            return
        if 'id' not in message:
            self.respond(202)
            return
        reply = {'jsonrpc': '2.0', 'id': message['id']}
        try:
            params = message.get('params', {})
            if not isinstance(params, dict):
                raise RpcError(-32602, 'Expected object parameters')
            reply['result'] = self.server.dot_tasks.dispatch(message.get('method'), params)
        except RpcError as error:
            reply['error'] = error.value
        self.respond(200, reply)
