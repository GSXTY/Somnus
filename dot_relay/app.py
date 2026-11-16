"""Independent FastAPI app hosting only pairing, OAuth, MCP and Dot task routes."""

import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ai_assistant.dot_webhooks import iso, outbound

from .events import Events, RpcError, task_view
from .oauth import install_oauth
from .store import Store


def send_openai_webhook(url, body, headers):
    hostname = (urlsplit(url).hostname or '').rstrip('.').lower()
    if not any(hostname == domain or hostname.endswith('.' + domain)
               for domain in ('chatgpt.com', 'openai.com')):
        raise ValueError('Unrecognized Dot callback domain.')
    return outbound(url, body, headers)


def create_app(database, public_url, *, local_dev=False, sender=send_openai_webhook):
    issuer = public_url.rstrip('/')
    origin = urlsplit(issuer)
    if (not origin.hostname or origin.path or origin.query or origin.fragment
            or origin.username or origin.password or (
                origin.scheme != 'https' and not (
                    local_dev and origin.scheme == 'http' and origin.hostname in ('127.0.0.1', 'localhost')
                ))):
        raise ValueError('Relay public URL must be an HTTPS origin, or an explicit loopback development origin.')
    store = Store(Path(database))
    events = Events(store, sender)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def never_cache(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    async def bounded_body(request, maximum=32768):
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > maximum:
                raise HTTPException(413, 'Request is too large.')
        return bytes(body)

    async def json_body(request):
        raw = await bounded_body(request)
        try:
            data = json.loads(raw) if raw else {}
        except (ValueError, UnicodeError):
            raise HTTPException(400, 'Invalid JSON request.') from None
        if not isinstance(data, dict):
            raise HTTPException(400, 'Expected a JSON object.')
        return data

    async def form_body(request):
        raw = await bounded_body(request, 8192)
        try:
            data = parse_qs(raw.decode('utf-8'), keep_blank_values=True, max_num_fields=30)
        except (ValueError, UnicodeError):
            raise HTTPException(400, 'Invalid OAuth form.') from None
        if any(len(values) != 1 for values in data.values()):
            raise HTTPException(400, 'Duplicate OAuth field.')
        return {key: values[0] for key, values in data.items()}

    def throttle(request, route, maximum):
        address = request.client.host if request.client else 'local'
        if not store.limit(route + ':' + address, maximum, 60):
            raise HTTPException(429, 'Too many requests. Try again shortly.', headers={'Retry-After': '60'})

    install_oauth(app, store, issuer, local_dev, json_body, form_body, throttle)

    def authenticate(request, *, dot=False):
        auth = request.headers.getlist('authorization')
        raw = auth[0] if len(auth) == 1 else ''
        pair = store.actor(raw[7:], dot=dot) if raw.startswith('Bearer ') else None
        if not pair:
            challenge = ('Bearer resource_metadata="' + issuer + '/.well-known/oauth-protected-resource/mcp"'
                         if dot else 'Bearer')
            raise HTTPException(401, 'A valid relay credential is required.',
                                headers={'WWW-Authenticate': challenge})
        return pair

    @app.get('/healthz')
    async def health():
        return {'status': 'ok'}

    @app.post('/api/pairs')
    async def pair_create(request: Request):
        throttle(request, 'pairs', 12)
        if await json_body(request):
            raise HTTPException(400, 'No input fields are accepted.')
        desktop, code, expires = store.create_pair()
        return {'desktop_token': desktop, 'pairing_code': code, 'expires_at': iso(expires)}

    @app.post('/api/pairs/code')
    async def pairing_code(request: Request):
        pair = authenticate(request)
        if not store.limit('pair-renew:' + pair['id'], 5, 60):
            raise HTTPException(429, 'Too many pairing requests.')
        code = store.renew_code(pair['id'])
        if code is None:
            raise HTTPException(409, 'The desktop is already paired.')
        return {'pairing_code': code[0], 'expires_at': iso(code[1])}

    @app.delete('/api/pairs/current')
    async def disconnect(request: Request):
        pair = authenticate(request)
        with store.transaction() as db:
            db.execute('DELETE FROM pairs WHERE id=?', (pair['id'],))
        return {'paired': False, 'ready': False, 'paused': False}

    @app.get('/api/status')
    async def status(request: Request):
        return events.status(authenticate(request))

    @app.post('/api/enabled')
    async def set_enabled(request: Request):
        pair = authenticate(request)
        data = await json_body(request)
        if set(data) != {'enabled'} or type(data['enabled']) is not bool:
            raise HTTPException(400, 'Expected an enabled boolean.')
        with store.transaction() as db:
            saved = db.execute('UPDATE pairs SET paused=? WHERE id=? RETURNING *',
                               (int(not data['enabled']), pair['id'])).fetchone()
        if not saved:
            raise HTTPException(401, 'Pair no longer exists.')
        return events.status(saved)

    @app.get('/api/tasks')
    @app.get('/api/tasks/{task_id}')
    async def tasks(request: Request, task_id: str = None):
        pair = authenticate(request)
        with store.transaction() as db:
            store.cleanup_tasks(db, pair['id'])
            if task_id is None:
                rows = db.execute('SELECT * FROM tasks WHERE pair_id=? ORDER BY expires DESC LIMIT 50',
                                  (pair['id'],))
                return {'tasks': [task_view(row) for row in rows]}
            row = db.execute('SELECT * FROM tasks WHERE pair_id=? AND id=?',
                             (pair['id'], task_id)).fetchone()
        if row is None:
            raise HTTPException(404, 'Task not found.')
        return {'task': task_view(row)}

    @app.post('/api/tasks')
    async def task_create(request: Request):
        pair = authenticate(request)
        data = await json_body(request)
        prompt = data.get('prompt')
        if set(data) != {'prompt'} or not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
            raise HTTPException(400, 'Only an explicit prompt of 1–4000 characters is accepted.')
        try:
            task = await anyio.to_thread.run_sync(events.create_task, pair['id'], prompt.strip())
        except RpcError as exc:
            raise HTTPException(409, exc.value['message']) from None
        if not task:
            raise HTTPException(409, 'Pair disconnected during delivery.')
        return {'task': task}

    @app.get('/mcp')
    async def mcp_stream(request: Request):
        authenticate(request, dot=True)
        return Response(status_code=405, headers={'Allow': 'POST'})

    @app.post('/mcp')
    async def mcp(request: Request):
        pair = authenticate(request, dot=True)
        if request.headers.get('origin') not in (None, 'https://chatgpt.com', issuer):
            raise HTTPException(403, 'Unexpected MCP origin.')
        message = await json_body(request)
        reply = {'jsonrpc': '2.0', 'id': message.get('id')}
        method, params = message.get('method'), message.get('params', {})
        if (message.get('jsonrpc') != '2.0' or not isinstance(method, str)
                or not isinstance(params, dict)):
            return {**reply, 'error': {'code': -32600, 'message': 'Invalid Request'}}
        if 'id' not in message:
            return Response(status_code=202)
        try:
            reply['result'] = await anyio.to_thread.run_sync(events.dispatch, pair, method, params)
        except RpcError as exc:
            reply['error'] = exc.value
        return reply

    return app
