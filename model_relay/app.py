"""Bounded OpenAI-compatible streaming relay for the official DeepSeek API."""

from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from hmac import compare_digest
import json
from pathlib import Path
import re
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request as UpstreamRequest, build_opener

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool


UPSTREAM = 'https://api.deepseek.com/chat/completions'
MODEL = re.compile(r'[A-Za-z0-9_.-]{1,100}')
INVITE = re.compile(r'[A-Za-z0-9_-]{43,96}')
MAX_STREAM_BYTES = 4 * 1024 * 1024
MAX_FRAME_BYTES = 256 * 1024
MAX_STREAM_SECONDS = 90
OPTIONS = {'temperature', 'top_p', 'frequency_penalty', 'presence_penalty',
           'tools', 'tool_choice', 'response_format', 'stop', 'reasoning_effort',
           'thinking', 'stream_options'}


class RejectRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class Settings:
    upstream_key: str = field(repr=False)
    invites: tuple[str, ...] = field(repr=False)
    models: tuple[str, ...]
    database: Path
    per_invite_daily: int = 20
    total_daily: int = 100
    max_request_bytes: int = 262_144
    max_output_tokens: int = 2_048

    def __post_init__(self):
        if not self.upstream_key or not self.upstream_key.isascii() or any(
            ord(character) < 33 or ord(character) > 126 for character in self.upstream_key
        ):
            raise ValueError('A valid server-side DeepSeek API key is required.')
        if (not 1 <= len(self.invites) <= 100 or len(set(self.invites)) != len(self.invites)
                or any(not INVITE.fullmatch(token) for token in self.invites)
                or self.upstream_key in self.invites):
            raise ValueError('Use unique, random invite tokens distinct from the upstream key.')
        if not 1 <= len(self.models) <= 8 or any(not MODEL.fullmatch(model) for model in self.models):
            raise ValueError('Configure an explicit DeepSeek model allowlist.')
        if not (1 <= self.per_invite_daily <= self.total_daily <= 10_000
                and 1_024 <= self.max_request_bytes <= 1_048_576
                and 1 <= self.max_output_tokens <= 8_192):
            raise ValueError('Relay quotas or request limits are invalid.')


class DailyQuota:
    def __init__(self, settings):
        self.settings = settings
        with closing(sqlite3.connect(settings.database)) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS quota (
                day TEXT NOT NULL, invite_digest TEXT NOT NULL, requests INTEGER NOT NULL,
                PRIMARY KEY (day, invite_digest)
            )''')

    def reserve(self, digest):
        today = datetime.now(timezone.utc).date().isoformat()
        with closing(sqlite3.connect(self.settings.database)) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            connection.execute('DELETE FROM quota WHERE day < ?', (today,))
            per_invite, total = connection.execute('''
                SELECT COALESCE(SUM(CASE WHEN invite_digest=? THEN requests ELSE 0 END),0),
                       COALESCE(SUM(requests),0)
                FROM quota WHERE day=?
            ''', (digest, today)).fetchone()
            if per_invite >= self.settings.per_invite_daily or total >= self.settings.total_daily:
                return False
            connection.execute('''
                INSERT INTO quota VALUES (?,?,1) ON CONFLICT(day,invite_digest)
                DO UPDATE SET requests=requests+1
            ''', (today, digest))
            return True


def _error(message, status):
    return JSONResponse({'error': {'message': message}},
                        status_code=status, headers={'Cache-Control': 'no-store'})


async def _read_payload(request, settings):
    if request.headers.get('content-type', '').partition(';')[0] != 'application/json':
        return None
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > settings.max_request_bytes:
            return None
        body.extend(chunk)
    try:
        payload = json.loads(body)
    except (ValueError, RecursionError):
        return None
    if (not isinstance(payload, dict) or payload.get('stream') is not True
            or payload.get('model') not in settings.models
            or not isinstance(payload.get('messages'), list)
            or not 1 <= len(payload['messages']) <= 1024
            or any(not isinstance(message, dict) for message in payload['messages'])):
        return None
    requested_output = payload.get('max_tokens', payload.get('max_completion_tokens', settings.max_output_tokens))
    if type(requested_output) is not int or requested_output < 1:
        return None
    return {**{key: value for key, value in payload.items() if key in OPTIONS},
            'model': payload['model'], 'messages': payload['messages'], 'stream': True,
            'max_tokens': min(requested_output, settings.max_output_tokens)}


def _stream(response):
    sent = 0
    deadline = time.monotonic() + MAX_STREAM_SECONDS
    with response:
        while time.monotonic() < deadline:
            line = response.readline(MAX_FRAME_BYTES + 1)
            if not line or len(line) > MAX_FRAME_BYTES or sent + len(line) > MAX_STREAM_BYTES:
                return
            sent += len(line)
            yield line


def create_app(settings, *, open_upstream=None, control=None):
    quota = DailyQuota(settings)
    opener = open_upstream or build_opener(RejectRedirect()).open
    invites = tuple(sha256(token.encode('ascii')).hexdigest() for token in settings.invites)
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    @app.get('/health')
    async def health():
        return JSONResponse({'ok': True}, headers={'Cache-Control': 'no-store'})

    @app.post('/v1/chat/completions')
    async def completion(request: Request):
        values = request.headers.getlist('authorization')
        scheme, _, token = values[0].partition(' ') if len(values) == 1 else ('', '', '')
        if scheme.lower() != 'bearer' or not INVITE.fullmatch(token):
            return _error('Invite token required.', 401)
        digest = sha256(token.encode('ascii')).hexdigest()
        if not sum(compare_digest(digest, allowed) for allowed in invites):
            return _error('Invite token required.', 401)
        if control is not None and not control.enabled():
            return _error('Model sharing is temporarily disabled.', 503)
        payload = await _read_payload(request, settings)
        if payload is None:
            return _error('Unsupported model or invalid streaming request.', 400)
        try:
            encoded = json.dumps(payload, allow_nan=False, ensure_ascii=False).encode('utf-8')
        except (ValueError, RecursionError):
            return _error('Invalid streaming request.', 400)
        try:
            reserved = await run_in_threadpool(quota.reserve, digest)
        except sqlite3.Error:
            return _error('Relay quota service unavailable.', 503)
        if not reserved:
            return _error('Daily relay request quota reached.', 429)
        upstream_request = UpstreamRequest(UPSTREAM, encoded, headers={
            'Authorization': 'Bearer ' + settings.upstream_key,
            'Content-Type': 'application/json', 'Accept': 'text/event-stream',
        })
        try:
            response = await run_in_threadpool(opener, upstream_request, 20)
        except HTTPError as error:
            status = 429 if error.code == 429 else 502
            error.close()
            return _error('The model provider declined the request.', status)
        except (URLError, OSError):
            return _error('The model provider is unavailable.', 502)
        if 'text/event-stream' not in response.headers.get('content-type', '').lower():
            response.close()
            return _error('The model provider did not return a stream.', 502)
        return StreamingResponse(_stream(response), media_type='text/event-stream',
                                 headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'},
                                 background=BackgroundTask(response.close))

    return app
