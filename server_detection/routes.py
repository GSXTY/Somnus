"""In-process compatibility boundary for the existing detection handlers.

No legacy HTTP server is started. During one serialized engine operation the
legacy module's globals are bound to a browser context, then always restored.
This is deliberately a single-worker migration boundary, not user authorization.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from email.message import Message
import io
import json
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response, JSONResponse

from event_detection import viewer
from event_detection.event_store import create_store
from event_detection.recording_cache import RecordingCache


COOKIE = 'detection_session'
# Every runtime in this Python process shares the same legacy module globals.
_ENGINE_LOCK = threading.RLock()
GET_PATHS = (
    '/api/meta', '/api/current-csv', '/api/device-summary', '/api/events',
    '/api/scans', '/api/wave', '/api/recording-overview',
    '/api/workbench/detection-context',
)
POST_PATHS = (
    '/api/open', '/api/activate', '/api/cache/release', '/api/close',
    '/api/dynamic-baseline', '/api/analyze', '/api/detect', '/api/events',
    '/api/feedback', '/api/feedback/prepare', '/api/feedback/export',
    '/api/feedback/open-folder', '/api/scans/edit', '/api/scans/match',
)


def _configured_limit(explicit, name, default, maximum, scale=1):
    """Read deployment integers once, before creating any persistent store."""
    if explicit is None:
        raw = os.environ.get(name)
        if raw is None:
            value = default
        else:
            try:
                value = int(raw) * scale
            except (TypeError, ValueError):
                raise ValueError(f'{name} 必须为正整数。') from None
    else:
        value = explicit
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= maximum:
        raise ValueError(f'{name} 超出允许范围（1至{maximum // scale}）。')
    return value


@dataclass
class BrowserContext:
    recording: object = None
    cache: RecordingCache = field(default_factory=RecordingCache)
    touched: float = field(default_factory=time.monotonic)


class MemoryHandler(viewer.Handler):
    """Only the legacy request methods are used, with memory streams."""
    def __init__(self, method, path, headers, body):
        self.command, self.path = method, path
        self.headers = Message()
        for key, value in headers.items():
            if key.lower() not in ('content-length', 'origin'):
                self.headers[key] = value
        self.headers['Content-Length'] = str(len(body))
        self.rfile, self.wfile = io.BytesIO(body), io.BytesIO()
        self.result = None

    def send(self, value, status=200, content_type='application/json; charset=utf-8'):
        raw = value if isinstance(value, bytes) else json.dumps(
            value, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.result = Response(raw, status_code=status,
                               headers={'Content-Type': content_type, 'Cache-Control': 'no-store'})


class DetectionRuntime:
    def __init__(self, data_dir, initial_file=None, *, max_sessions=None,
                 session_ttl_seconds=None, max_upload_bytes=None,
                 max_total_bytes=None, session_mode='isolated', clock=time.monotonic):
        if session_mode not in ('isolated', 'shared'):
            raise ValueError('检测会话模式必须是 isolated 或 shared。')
        max_sessions = _configured_limit(max_sessions, 'AI_AGENT_MAX_SESSIONS', 16, 256)
        session_ttl_seconds = _configured_limit(session_ttl_seconds, 'AI_AGENT_SESSION_TTL_SECONDS', 3600, 7*86400)
        max_upload_bytes = _configured_limit(max_upload_bytes, 'AI_AGENT_MAX_UPLOAD_MB', 128*1024**2, 1024**3, 1024**2)
        max_total_bytes = _configured_limit(max_total_bytes, 'AI_AGENT_MAX_MEMORY_MB', 512*1024**2, 65536*1024**2, 1024**2)
        self.session_mode = session_mode
        viewer.session_mode = session_mode
        self.store = create_store(data_dir)
        self.contexts = OrderedDict()
        self.max_sessions = max_sessions
        self.session_ttl_seconds = session_ttl_seconds
        self.max_upload_bytes = max_upload_bytes
        self.max_total_bytes = max_total_bytes
        self.clock = clock
        self.initial_path = Path(initial_file) if initial_file else None
        if self.initial_path and not self.initial_path.is_file():
            raise ValueError('初始 CSV 文件不存在。')
        self.limits = dict(max_sessions=max_sessions,
                           session_ttl_seconds=session_ttl_seconds,
                           max_upload_bytes=max_upload_bytes,
                           max_total_bytes=max_total_bytes,
                           session_mode=session_mode,
                           single_worker_only=True, identity_isolation=False)

    @staticmethod
    def _size(context):
        records = {id(record): record for record, _ in context.cache.items.values()}
        if context.recording is not None:
            records[id(context.recording)] = context.recording
        return sum(RecordingCache.size(record) for record in records.values())

    def _expire(self):
        cutoff = self.clock() - self.session_ttl_seconds
        if self.session_mode == 'shared':
            return
        for token, context in list(self.contexts.items()):
            if context.touched < cutoff:
                del self.contexts[token]

    def dispatch(self, method, path, headers, body, token):
        """Called in a thread; holds no ASGI event-loop or assistant locks."""
        with _ENGINE_LOCK:
            self._expire()
            if self.session_mode == 'shared':
                token = '__local_shared__'
            fresh = token not in self.contexts
            if fresh:
                if len(self.contexts) >= self.max_sessions:
                    return JSONResponse({'error': '分析会话已达上限，请稍后重试。'}, 503), None
                token = '__local_shared__' if self.session_mode == 'shared' else secrets.token_urlsafe(32)
                context = BrowserContext(touched=self.clock())
                if self.initial_path:
                    if self.initial_path.stat().st_size > self.max_upload_bytes:
                        return JSONResponse({'error': '初始 CSV 超出服务器文件大小限制。'}, 413), None
                    context.recording = viewer.Recording(self.initial_path.read_bytes(), self.initial_path.name)
                    context.cache.put(context.recording)
                if self._size(context) + sum(self._size(item) for item in self.contexts.values()) > self.max_total_bytes:
                    return JSONResponse({'error': '初始文件超出服务器波形内存预算。'}, 507), None
                self.contexts[token] = context
            else:
                context = self.contexts[token]
            context.touched = self.clock()
            self.contexts.move_to_end(token)
            before = (context.recording, context.cache.items.copy(), context.cache.inventory.copy())
            previous = (viewer.recording, viewer.recording_cache, viewer.event_store)
            try:
                viewer.recording = context.recording
                viewer.recording_cache = context.cache
                viewer.event_store = self.store
                handler = MemoryHandler(method, path, headers, body)
                if method == 'GET':
                    handler.do_GET()
                else:
                    handler.do_POST()
                context.recording = viewer.recording
                if sum(self._size(item) for item in self.contexts.values()) > self.max_total_bytes:
                    context.recording, context.cache.items, context.cache.inventory = before
                    return JSONResponse({'error': '服务器波形内存预算不足，请关闭部分文件后重试。'}, 507), token
                return handler.result if handler.result is not None else JSONResponse(
                    {'error': '检测服务未返回响应。'}, 500), token
            finally:
                context.touched = self.clock()
                viewer.recording, viewer.recording_cache, viewer.event_store = previous


def _same_origin(request):
    origin = request.headers.get('origin')
    if not origin:
        return True
    supplied = urlsplit(origin)
    return (supplied.scheme, supplied.netloc) == (request.url.scheme, request.headers.get('host', '')) and not supplied.path and not supplied.query and not supplied.fragment


def install_routes(app, data_dir, initial_file=None, *, session_mode='isolated'):
    runtime = DetectionRuntime(data_dir, initial_file, session_mode=session_mode)
    app.state.detection_runtime = runtime
    router = APIRouter(tags=['Data analysis'])

    async def endpoint(request: Request):
        path = request.url.path
        if request.method == 'POST' and not _same_origin(request):
            return JSONResponse({'error': '不允许跨站请求。'}, 403)
        if path == '/api/feedback/open-folder':
            return JSONResponse({'error': '服务器不支持打开本机文件夹，请下载或复制导出结果。'}, 409)
        maximum = runtime.max_upload_bytes if path == '/api/open' else 10 * 1024**2
        try:
            length = int(request.headers.get('content-length', '0'))
        except ValueError:
            return JSONResponse({'error': '请求长度无效。'}, 400)
        if length < 0 or length > maximum:
            return JSONResponse({'error': '请求超过服务器大小限制。'}, 413)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > maximum:
                return JSONResponse({'error': '请求超过服务器大小限制。'}, 413)
        query = request.url.query
        response, token = await run_in_threadpool(
            runtime.dispatch, request.method, path + ('?' + query if query else ''),
            request.headers, bytes(body), request.cookies.get(COOKIE))
        if token and runtime.session_mode == 'isolated':
            response.set_cookie(COOKIE, token, max_age=runtime.session_ttl_seconds,
                                httponly=True, samesite='lax', secure=request.url.scheme == 'https', path='/')
        return response

    for path in GET_PATHS:
        router.add_api_route(path, endpoint, methods=['GET'], name=path.rsplit('/', 1)[-1])
    for path in POST_PATHS:
        router.add_api_route(path, endpoint, methods=['POST'], name=path.rsplit('/', 1)[-1] + '_write')
    app.include_router(router)
    return runtime
