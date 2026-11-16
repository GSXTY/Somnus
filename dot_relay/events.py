"""Provider callback verification and relay task methods."""

import base64
import hmac
import http.client
import json
import secrets
import time

from ai_assistant.dot_tasks import CAPABILITIES, EVENT, TOOLS, VERSIONS, RpcError, object_schema
from ai_assistant.dot_webhooks import iso, json_bytes, signed_headers

from .store import digest, token


def send(sender, subscription, name, body):
    wire = json_bytes(body)
    return sender(subscription['callback'], wire,
                  signed_headers(wire, name, subscription['subscription_id'], subscription['signing_key']))


def task_view(row):
    return {key: row[key] for key in ('id', 'status', 'prompt', 'result', 'error', 'created_at')}


class Events:
    def __init__(self, store, sender):
        self.store = store
        self.sender = sender

    @staticmethod
    def status(pair):
        now = time.time()
        paired = bool(pair['dot'] and pair['refresh_expires'] > now)
        return {'paired': paired,
                'ready': bool(paired and not pair['paused'] and pair['subscription_id']
                              and pair['subscription_expires'] > now),
                'paused': bool(pair['paused'])}

    def create_task(self, pair_id, prompt):
        task, message = token('task_'), token('evt_')
        now = time.time()
        with self.store.transaction() as db:
            self.store.cleanup_tasks(db, pair_id)
            pair = db.execute('SELECT * FROM pairs WHERE id=?', (pair_id,)).fetchone()
            if not pair or not self.status(pair)['ready']:
                raise RpcError(-32000, 'Dot has not subscribed or is paused.')
            active = db.execute('SELECT COUNT(*) FROM tasks WHERE pair_id=? AND status=\'pending\'',
                                (pair_id,)).fetchone()[0]
            if active >= 3:
                raise RpcError(-32000, 'Wait for the current Dot tasks to finish.')
            db.execute("""INSERT INTO tasks
                          (id,pair_id,subscription_id,expires,created_at,status,prompt)
                          VALUES (?,?,?,?,?,'pending',?)""",
                       (task, pair_id, pair['subscription_id'], now + 1800, iso(now), prompt))
        event = {'eventId': message, 'name': EVENT, 'timestamp': iso(now),
                 'data': {'task_id': task, 'summary': 'A Somnus task is ready.'}, 'cursor': None}
        try:
            response, _ = send(self.sender, pair, message, event)
        except (OSError, ValueError, http.client.HTTPException):
            response = 0
        with self.store.transaction() as db:
            if not 200 <= response < 300:
                db.execute("""UPDATE tasks SET status='error',prompt=NULL,error='Dot did not acknowledge delivery.'
                              WHERE id=? AND status='pending'""", (task,))
            result = db.execute('SELECT * FROM tasks WHERE pair_id=? AND id=?', (pair_id, task)).fetchone()
            return task_view(result) if result else None

    def subscribe(self, pair, params, unsubscribe=False):
        delivery = params.get('delivery')
        if (params.get('name') != EVENT or params.get('arguments', {}) != {}
                or not isinstance(delivery, dict) or delivery.get('mode', 'webhook') != 'webhook'
                or not isinstance(delivery.get('url'), str) or len(delivery['url']) > 2048):
            raise RpcError(-32602, 'Invalid event or webhook')
        callback = delivery['url']
        sub_id = 'sub_' + digest(pair['id'] + '\0' + EVENT + '\0' + callback)[:32]
        if unsubscribe:
            with self.store.transaction() as db:
                db.execute("""UPDATE pairs SET subscription_id=NULL,callback=NULL,signing_key=NULL,
                              subscription_expires=NULL WHERE id=? AND subscription_id=?""",
                           (pair['id'], sub_id))
            return {}
        try:
            encoded = delivery['secret']
            if not isinstance(encoded, str) or not encoded.startswith('whsec_'):
                raise ValueError
            encoded = encoded[6:]
            key = base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True)
            ttl = params.get('ttlMs')
            if not 24 <= len(key) <= 64 or (ttl is not None and (type(ttl) is not int or ttl <= 0)):
                raise ValueError
        except (KeyError, ValueError):
            raise RpcError(-32602, 'Invalid webhook secret or duration') from None
        active = pair['subscription_expires'] and pair['subscription_expires'] > time.time()
        if active and pair['subscription_id'] != sub_id:
            raise RpcError(-32000, 'An active subscription already exists for this pair')
        known = active and pair['subscription_id'] == sub_id and hmac.compare_digest(pair['signing_key'], key)
        if not known:
            if pair['paused']:
                raise RpcError(-32000, 'The paired desktop has paused Dot')
            challenge = secrets.token_urlsafe(24)
            subscription = {'subscription_id': sub_id, 'callback': callback, 'signing_key': key}
            try:
                status, body = send(self.sender, subscription, token('msg_verification_'),
                                    {'type': 'verification', 'challenge': challenge})
                echo = json.loads(body).get('challenge') if 200 <= status < 300 else None
                if not isinstance(echo, str) or not hmac.compare_digest(echo, challenge):
                    raise ValueError
            except (ValueError, OSError, AttributeError, http.client.HTTPException):
                raise RpcError(-32015, 'CallbackEndpointError', 'challenge_failed') from None
        expires = time.time() + (3600 if ttl is None else min(3600000, ttl) / 1000)
        with self.store.transaction() as db:
            updated = db.execute("""UPDATE pairs SET subscription_id=?,callback=?,signing_key=?,
                                     subscription_expires=?
                                     WHERE id=? AND dot=? AND (paused=0 OR ?=1)
                                     AND (subscription_id IS NULL OR subscription_expires<=?
                                          OR subscription_id=?)""",
                                 (sub_id, callback, key, expires, pair['id'], pair['dot'],
                                  int(bool(known)), time.time(), sub_id)).rowcount
            if not updated:
                raise RpcError(-32000, 'Subscription state changed')
        return {'id': sub_id, 'refreshBefore': iso(expires), 'cursor': None, 'truncated': False}

    def call_tool(self, pair, params):
        args = params.get('arguments')
        name = params.get('name')
        task_id = args.get('task_id') if isinstance(args, dict) else None
        if (not isinstance(task_id, str) or len(task_id) > 64
                or name not in ('read_task', 'submit_result')):
            raise RpcError(-32602, 'Unknown task or tool')
        with self.store.transaction() as db:
            task = db.execute("""SELECT * FROM tasks WHERE pair_id=? AND id=? AND subscription_id=?
                                 AND expires>? AND status IN ('pending','complete')""",
                              (pair['id'], task_id, pair['subscription_id'], time.time())).fetchone()
            if not task:
                raise RpcError(-32602, 'Unknown or expired task')
            if name == 'read_task':
                if task['status'] != 'pending':
                    raise RpcError(-32602, 'Task already completed')
                response = {'task_id': task_id, 'text': task['prompt']}
            else:
                result = args.get('result')
                if not isinstance(result, str) or not 1 <= len(result.strip()) <= 8000:
                    raise RpcError(-32602, 'Result must be 1–8000 characters')
                result = result.strip()
                if task['status'] == 'complete' and result != task['result']:
                    raise RpcError(-32602, 'A result was already provided')
                db.execute("UPDATE tasks SET status='complete',prompt=NULL,result=? WHERE id=?", (result, task_id))
                response = {'task_id': task_id, 'recorded': True}
        return {'content': [{'type': 'text', 'text': json_bytes(response).decode()}],
                'structuredContent': response, 'isError': False}

    def dispatch(self, pair, method, params):
        server = {'name': 'somnus-dot-relay', 'version': '1.0.0'}
        if method == 'initialize':
            version = params.get('protocolVersion')
            return {'protocolVersion': version if version in VERSIONS else '2025-11-25',
                    'capabilities': CAPABILITIES, 'serverInfo': server}
        if method == 'server/discover':
            return {'supportedVersions': ['2026-07-28'], 'capabilities': CAPABILITIES,
                    'resultType': 'complete', 'serverInfo': server}
        if method == 'ping':
            return {}
        if method == 'events/list':
            return {'events': [{'name': EVENT, 'description': 'A task explicitly sent from paired Somnus.',
                                'delivery': ['webhook'], 'inputSchema': object_schema(),
                                'payloadSchema': object_schema('task_id', 'summary')}]}
        if method in ('events/subscribe', 'events/unsubscribe'):
            return self.subscribe(pair, params, method == 'events/unsubscribe')
        if method == 'tools/list':
            return {'tools': TOOLS}
        if method == 'tools/call':
            return self.call_tool(pair, params)
        raise RpcError(-32601, 'Method not found')
