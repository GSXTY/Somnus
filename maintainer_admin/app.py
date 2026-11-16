"""Loopback-only operator UI. This app must use a port separate from model_relay."""

from dataclasses import asdict
from hmac import compare_digest
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from model_relay.control import RelayControl

from .releases import AdminError, Draft, StandardRelease


ASSETS = Path(__file__).with_name('web')
ASSET_TYPES = {'admin.css': 'text/css', 'admin.js': 'text/javascript'}
DIRECT = build_opener(ProxyHandler({}))
CONTENT_SECURITY = "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


async def read_body(request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 16 * 1024:
            raise AdminError('操作内容过大。')
        body.extend(chunk)
    try:
        return json.loads(body)
    except (ValueError, RecursionError) as exc:
        raise AdminError('操作内容格式无效。') from exc


def relay_running(port):
    try:
        with DIRECT.open(f'http://127.0.0.1:{port}/health', timeout=2) as response:
            return response.status == 200
    except (URLError, OSError):
        return False


def create_app(standard_root, control_path, token, *, port=8895, relay_port=8894):
    standard = StandardRelease(standard_root)
    control = RelayControl(Path(control_path))
    operation = Lock()
    host = f'127.0.0.1:{port}'
    origin = 'http://' + host
    draft_file = Path(control_path).with_name('maintainer-release-draft.json')
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    def read_draft():
        try:
            return Draft.parse(json.loads(draft_file.read_text(encoding='utf-8')))
        except (OSError, ValueError):
            return None

    @app.middleware('http')
    async def authenticate(request: Request, call_next):
        if request.headers.get('host') != host or request.headers.get('origin') not in (None, origin):
            return JSONResponse({'error': '只能从本机后台地址访问。'}, status_code=403)
        if request.url.path.startswith('/api/'):
            supplied = request.headers.get('authorization', '')
            authorized = supplied.isascii() and compare_digest(supplied, 'Bearer ' + token)
            if not authorized:
                return JSONResponse({'error': '请从本机启动入口重新打开后台。'}, status_code=401)
        response = await call_next(request)
        response.headers.update({
            'Cache-Control': 'no-store', 'Content-Security-Policy': CONTENT_SECURITY,
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY',
        })
        return response

    @app.exception_handler(AdminError)
    async def expected_error(_request, exc):
        return JSONResponse({'error': str(exc)}, status_code=400)

    @app.exception_handler(OSError)
    async def filesystem_error(_request, _exc):
        return JSONResponse({'error': '无法读取或写入本机后台配置。'}, status_code=500)

    @app.get('/')
    def index():
        return FileResponse(ASSETS / 'index.html', media_type='text/html')

    @app.get('/static/{name}')
    def asset(name: str):
        if name not in ASSET_TYPES:
            return JSONResponse({'error': '资源不存在。'}, status_code=404)
        return FileResponse(ASSETS / name, media_type=ASSET_TYPES[name])

    @app.get('/api/state')
    def state():
        try:
            release = standard.state()
        except (OSError, ValueError, KeyError, TypeError):
            release = {'error': '无法读取标准版的工作区或发布配置。'}
        with operation:
            draft = read_draft()
            saved = asdict(draft) if draft else None
        return {
            'relay': {'enabled': control.enabled(), 'running': relay_running(relay_port), 'port': relay_port},
            'standard': release, 'draft': saved,
        }

    @app.post('/api/relay')
    async def relay(request: Request):
        value = await read_body(request)
        if not isinstance(value, dict) or set(value) != {'enabled'} or type(value['enabled']) is not bool:
            raise AdminError('共享开关状态无效。')
        await run_in_threadpool(control.set_enabled, value['enabled'])
        return {'enabled': control.enabled()}

    @app.post('/api/draft')
    async def save(request: Request):
        chosen = Draft.parse(await read_body(request))
        # Use a worker so a long-running submit cannot block the event loop.
        def store():
            with operation:
                draft_file.parent.mkdir(parents=True, exist_ok=True)
                payload = asdict(chosen)
                with NamedTemporaryFile(mode='w', encoding='utf-8', dir=draft_file.parent, delete=False) as stream:
                    temporary = Path(stream.name)
                    json.dump(payload, stream, ensure_ascii=False)
                try:
                    temporary.replace(draft_file)
                finally:
                    temporary.unlink(missing_ok=True)
                return payload
        return await run_in_threadpool(store)

    @app.post('/api/submit')
    async def submit(request: Request):
        chosen = Draft.parse(await read_body(request))

        def dispatch():
            with operation:
                if chosen != read_draft():
                    raise AdminError('请先保存并核对发布草稿。')
                return standard.submit(chosen)
        return await run_in_threadpool(dispatch)

    return app
