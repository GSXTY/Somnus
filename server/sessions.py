"""Opaque browser chat contexts, not authentication or user-account ownership."""
from http.cookies import SimpleCookie
from pathlib import Path
import re
import secrets
import threading
import time

from ai_assistant.service import AssistantError, AssistantService

COOKIE = 'assistant_session'


class AssistantContexts:
    def __init__(self, folder, max_contexts=32, idle_seconds=3600):
        self.folder = Path(folder) / 'assistant_sessions'
        self.identities = Path(folder) / 'browser_sessions'
        self.lock = threading.RLock()
        self.items = {}
        self.max_contexts = max_contexts
        self.idle_seconds = idle_seconds

    def identity(self, raw):
        if raw and re.fullmatch(r'[a-f0-9]{64}', raw):
            with self.lock:
                if (raw in self.items or (self.folder / (raw + '.sqlite3')).is_file()
                        or (self.identities / (raw + '.session')).is_file()):
                    return raw, False
        owner = secrets.token_hex(32)
        # An identity can be used by deep analysis without creating a chat DB.
        self.identities.mkdir(parents=True, exist_ok=True)
        (self.identities / (owner + '.session')).touch(exist_ok=False)
        return owner, True

    def service_for(self, request):
        owner = request.scope['state']['assistant_context']
        now = time.monotonic()
        with self.lock:
            for key, (service, touched) in list(self.items.items()):
                if now - touched > self.idle_seconds and not service.active:
                    del self.items[key]
            if owner in self.items:
                service = self.items[owner][0]
            else:
                if len(self.items) >= self.max_contexts:
                    raise AssistantError('session_capacity', '会话上下文数量已达上限，请稍后重试。', 503)
                service = AssistantService(self.folder / (owner + '.sqlite3'))
            self.items[owner] = service, now
            return service

    def close(self):
        with self.lock:
            for service, _ in self.items.values():
                for cid in list(service.active):
                    try:
                        service.cancel(cid)
                    except Exception:
                        pass


class AssistantContextMiddleware:
    def __init__(self, app, contexts):
        self.app, self.contexts = app, contexts

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith(('/api/assistant/', '/api/deep-analysis/')):
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])
        cookies = SimpleCookie()
        try:
            cookies.load(headers.get(b'cookie', b'').decode('latin-1'))
            raw = cookies[COOKIE].value if COOKIE in cookies else None
        except Exception:
            raw = None
        owner, fresh = self.contexts.identity(raw)
        scope.setdefault('state', {})['assistant_context'] = owner
        scope['state']['deep_analysis_context'] = owner

        async def attach_cookie(message):
            if fresh and message['type'] == 'http.response.start':
                value = f'{COOKIE}={owner}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'
                if scope.get('scheme') == 'https':
                    value += '; Secure'
                message.setdefault('headers', []).append((b'set-cookie', value.encode('ascii')))
            await send(message)
        await self.app(scope, receive, attach_cookie)
