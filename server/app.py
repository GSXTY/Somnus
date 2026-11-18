"""Native ASGI workspace host; no legacy HTTP listener or reverse proxy."""
from contextlib import asynccontextmanager
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

import anyio
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app_version import APP_ID, APP_VERSION
from agent_core.analytics import dashboard as user_dashboard
from agent_core.workbench import dashboard as workbench_dashboard, user_detail
from ai_assistant.service import AssistantService
from ai_assistant.web_data_mcp import data_mcp_inventory
from event_detection.patient_flow_v4 import VERSION as PATIENT_VERSION
from mcp_connectors.asgi import create_router as create_mcp_router
from mcp_connectors.registry import Registry as McpRegistry
from server.paths import ROOT, default_data_dir
from server.remote_data import RemoteData

ASSETS = Path(getattr(sys, '_MEIPASS', ROOT))


class SameOriginWrites:
    """Reject browser cross-origin writes without permissive CORS."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope['method'] in ('POST', 'PUT', 'PATCH', 'DELETE'):
            headers = dict(scope['headers'])
            origin = headers.get(b'origin')
            if origin:
                try:
                    parsed = urlsplit(origin.decode('ascii'))
                    host = headers.get(b'host', b'').decode('ascii')
                    permitted = (parsed.scheme in ('http', 'https') and parsed.netloc.lower() == host.lower()
                                 and parsed.scheme == scope.get('scheme', 'http')
                                 and not parsed.username and not parsed.password
                                 and parsed.path in ('', '/') and not parsed.query and not parsed.fragment)
                except (UnicodeError, ValueError):
                    permitted = False
                if not permitted:
                    await JSONResponse({'error': '不允许跨站写入请求。'}, status_code=403)(scope, receive, send)
                    return
        await self.app(scope, receive, send)


def _query(request):
    return {key: request.query_params.getlist(key) for key in request.query_params}


async def _json_body(request):
    try:
        payload = await request.json()
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def mount_plugin_pages(app):
    """Expose plugins that ship a web/index.html at /module/<key>/."""
    from fastapi.staticfiles import StaticFiles
    from plugins import loader

    mounted_paths = set()
    for plugin in loader.discover()['plugins']:
        key = plugin['key']
        if not plugin.get('has_ui') or not isinstance(key, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+', key):
            continue
        folder = loader.PLUGIN_DIR / key / 'web'
        if folder.is_dir():
            path = f'/module/{key}'
            app.mount(path, StaticFiles(directory=str(folder), html=True),
                      name=f'module-{key}')
            mounted_paths.add(f'{path}/')
    return mounted_paths


def create_app(data_dir=None, initial_file=None, session_mode=None, *, mcp_management=None, managed_desktop=False):
    """Application factory for ``uvicorn server.app:create_app --factory``.

    Detection is session isolated but the transitional compatibility bridge is
    process local, so this release requires exactly one Uvicorn worker.
    """
    workers = os.getenv('WEB_CONCURRENCY', '1')
    if workers not in ('', '1'):
        raise RuntimeError('当前数据分析适配层仅支持单 worker；请将 WEB_CONCURRENCY 设为 1。')
    session_mode = session_mode or os.getenv('AI_AGENT_SESSION_MODE', 'isolated')
    if session_mode not in ('isolated', 'shared'):
        raise ValueError('session_mode 必须为 isolated 或 shared。')
    folder = Path(data_dir).expanduser().resolve() if data_dir else default_data_dir()
    folder.mkdir(parents=True, exist_ok=True)

    def stop_services(app):
        if app.state.mcp_registry:
            app.state.mcp_registry.close()
        deep_service = getattr(app.state, 'deep_analysis_service', None)
        if deep_service:
            try:
                deep_service.close()
            except Exception:
                # Other service cleanup must still run if executor cleanup fails.
                pass
        if getattr(app.state, 'assistant_contexts', None):
            app.state.assistant_contexts.close()
        service = app.state.assistant_service
        if service:
            with service.lock:
                ids = list(service.active)
            for cid in ids:
                try:
                    service.cancel(cid)
                except Exception:
                    pass

    remote_data = RemoteData.from_env()
    report_presence = (managed_desktop and sys.platform == 'win32' and session_mode == 'shared'
                       and remote_data.mode == 'remote' and os.getenv('SHARE_MODE', '').strip() != '1')

    @asynccontextmanager
    async def lifespan(app):
        try:
            if report_presence:
                async with anyio.create_task_group() as tasks:
                    tasks.start_soon(remote_data.report_presence, APP_VERSION)
                    try:
                        yield
                    finally:
                        tasks.cancel_scope.cancel()
            else:
                yield
        finally:
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(stop_services, app)

    app = FastAPI(title='Somnus', version=APP_VERSION, lifespan=lifespan,
                  description='工作台、AI 会话和记录分析的统一服务。当前数据库未连接，检测适配层仅支持单进程。')
    app.state.data_dir = folder
    app.state.analytics_repository = None
    app.state.remote_data = remote_data
    app.state.session_mode = session_mode
    local_windows_desktop = (managed_desktop and sys.platform == 'win32' and session_mode == 'shared'
                             and os.getenv('SHARE_MODE', '').strip() != '1')
    if mcp_management is None:
        mcp_management = session_mode == 'shared'
    app.state.mcp_registry = McpRegistry(
        folder, desktop_builtin=local_windows_desktop,
        data_builtins=data_mcp_inventory(remote_data, probe=False) if local_windows_desktop else None,
        data_inventory=(lambda: data_mcp_inventory(remote_data)) if local_windows_desktop else None,
    ) if mcp_management else None
    app.include_router(create_mcp_router())
    app.state.assistant_service = None
    if session_mode == 'shared':
        try:
            app.state.assistant_service = AssistantService(folder / 'assistant.sqlite3')
        except Exception:
            app.state.assistant_service = None
    else:
        from server.sessions import AssistantContexts, AssistantContextMiddleware
        contexts = AssistantContexts(folder)
        app.state.assistant_contexts = contexts
        app.state.assistant_service_for_request = contexts.service_for
        app.add_middleware(AssistantContextMiddleware, contexts=contexts)
    app.add_middleware(SameOriginWrites)


    def share_mode():
        return os.getenv('SHARE_MODE', '').strip() == '1'

    def share_denied():
        return JSONResponse({'error': {'code': 'share_mode', 'message': '当前为对外演示模式，真实数据查询已关闭。'}}, status_code=403)

    @app.get('/api/remote-data/status', tags=['运行状态'])
    def remote_data_status():
        status = {'mode': 'local', 'url': None} if share_mode() else remote_data.status()
        return JSONResponse(status, headers={'Cache-Control': 'no-store'})

    @app.get('/api/health', tags=['运行状态'])
    def health():
        return dict(app_id=APP_ID, app_version=APP_VERSION, framework='fastapi',
                    entrypoints=dict(workbench='/', events='/events'),
                    detection_profiles=dict(patient_flow_v4=PATIENT_VERSION),
                    runtime=dict(workers=1, session_mode=session_mode,
                                 detection_state='browser_session' if session_mode == 'isolated' else 'local_shared',
                                 authentication=False, database_connected=False,
                                 assistant_scope='browser_session' if session_mode == 'isolated' else 'local_shared',
                                 detection_limits=app.state.detection_runtime.limits))

    @app.get('/api/plugins', tags=['运行状态'])
    def plugins():
        from plugins import loader
        info = loader.discover(force=True)
        plugins = [dict(plugin, workspace_entries=[
            entry for entry in plugin['workspace_entries'] if entry['path'] in workspace_paths
        ]) for plugin in info['plugins']]
        return dict(plugins=plugins, errors=info['errors'],
                    tools=[spec['function']['name'] for spec in info['specs']])

    @app.get('/api/workbench', tags=['工作台'])
    async def workbench(request: Request):
        if share_mode() and _query(request).get('source', ['demo'])[0] == 'live':
            return share_denied()
        if not share_mode() and remote_data.mode != 'local':
            return await remote_data.relay(request)
        try:
            return await anyio.to_thread.run_sync(workbench_dashboard, _query(request))
        except ValueError as exc:
            return JSONResponse({'error': str(exc)}, status_code=400)

    @app.get('/api/workbench/users/{user_id}', tags=['工作台'])
    async def workbench_user(user_id: str, request: Request):
        if share_mode() and _query(request).get('source', ['demo'])[0] == 'live':
            return share_denied()
        if not share_mode() and remote_data.mode != 'local':
            return await remote_data.relay(request)
        try:
            return await anyio.to_thread.run_sync(user_detail, user_id, _query(request))
        except LookupError as exc:
            return JSONResponse({'error': str(exc)}, status_code=404)
        except ValueError as exc:
            return JSONResponse({'error': str(exc)}, status_code=400)

    @app.get('/api/dashboard', tags=['统计'])
    def dashboard(request: Request):
        try:
            return user_dashboard(_query(request), app.state.analytics_repository)
        except ValueError as exc:
            return JSONResponse({'error': str(exc)}, status_code=400)

    @app.get('/api/sql/schema', tags=['数据查询'])
    async def sql_schema(request: Request):
        if share_mode():
            return share_denied()
        if remote_data.mode != 'local':
            return await remote_data.relay(request)
        from agent_core.sql_access import SqlAccessError, SqlSettings, schema as read_schema
        try:
            settings = SqlSettings.from_env()
            return dict(database=settings.description, driver=settings.driver,
                        max_rows=settings.max_rows, tables=await anyio.to_thread.run_sync(read_schema, settings))
        except SqlAccessError as exc:
            return JSONResponse({'error': str(exc)}, status_code=400)

    @app.post('/api/sql/query', tags=['数据查询'])
    async def sql_query(request: Request):
        if share_mode():
            return share_denied()
        if remote_data.mode != 'local':
            return await remote_data.relay(request)
        from agent_core.sql_access import SqlAccessError, SqlSettings, run
        body = await _json_body(request)
        if body is None:
            return JSONResponse({'error': '请求体必须是 JSON。'}, status_code=400)
        try:
            return run(str(body.get('sql') or ''), SqlSettings.from_env())
        except SqlAccessError as exc:
            return JSONResponse({'error': str(exc)}, status_code=400)

    @app.post('/api/sql/ask', tags=['数据查询'])
    async def sql_ask(request: Request):
        if share_mode():
            return share_denied()
        if remote_data.mode != 'local':
            return await remote_data.relay(request)
        from agent_core.sql_access import SqlAccessError
        from agent_core.sql_agent import ask
        body = await _json_body(request)
        if body is None:
            return JSONResponse({'error': '请求体必须是 JSON。'}, status_code=400)
        try:
            return ask(str(body.get('question') or ''))
        except SqlAccessError as exc:
            return JSONResponse({'error': str(exc)}, status_code=400)

    from ai_assistant.asgi import create_router
    app.include_router(create_router())
    from deep_analysis.service import DeepAnalysisService
    from deep_analysis.config import Config as DeepAnalysisConfig
    from deep_analysis.asgi import create_router as create_deep_analysis_router
    app.state.deep_analysis_service = None
    if remote_data.mode == 'local':
        try:
            app.state.deep_analysis_service = DeepAnalysisService(folder / 'deep_analysis', config=DeepAnalysisConfig())
        except Exception:
            # A separate trial's invalid config/storage must not stop existing tools.
            pass
    from ai_assistant.deep_tools import register as register_chat_tools
    register_chat_tools(app.state.deep_analysis_service)
    async def relay_deep_analysis(request):
        if share_mode():
            return remote_data.error('当前为对外演示模式，远程深度分析已关闭。', 403, deep=True)
        return await remote_data.relay(request)

    app.include_router(create_deep_analysis_router(relay=relay_deep_analysis if remote_data.mode != 'local' else None))
    from server_detection import install_routes
    install_routes(app, folder, initial_file=initial_file or os.getenv('RESPIRATORY_CSV') or None,
                   session_mode=session_mode, session_events=managed_desktop and session_mode == 'shared')

    page = ASSETS / 'page_design'
    event = ASSETS / 'event_detection'

    def file(path, media_type=None):
        if not path.is_file():
            return JSONResponse({'error': '资源不存在。'}, status_code=404)
        return FileResponse(path, media_type=media_type, headers={'Cache-Control': 'no-store'})

    @app.get('/', include_in_schema=False)
    @app.get('/dashboard', include_in_schema=False)
    def home():
        built = page / 'web' / 'index.html'
        return file(built if built.is_file() else page / 'dashboard.html', 'text/html')

    @app.get('/legacy-overview', include_in_schema=False)
    def legacy():
        return file(page / 'dashboard.html', 'text/html')

    @app.get('/events', include_in_schema=False)
    @app.get('/index.html', include_in_schema=False)
    def events():
        return file(event / 'index.html', 'text/html')

    static = {'/viewer.js': (event / 'viewer.js', 'text/javascript'),
              '/annotation-model.js': (event / 'annotation-model.js', 'text/javascript'),
              '/dashboard.js': (page / 'dashboard.js', 'text/javascript'),
              '/dashboard.css': (page / 'dashboard.css', 'text/css'),
              '/ui/events.css': (page / 'events.css', 'text/css'),
              '/ui/bootstrap.min.css': (page / 'vendor/bootstrap.min.css', 'text/css')}
    for route, (path, media_type) in static.items():
        def make_file_handler(path, media_type):
            def asset():
                return file(path, media_type)
            return asset
        app.add_api_route(route, make_file_handler(path, media_type), methods=['GET'], include_in_schema=False)
    web = page / 'web'
    if web.is_dir():
        app.mount('/workbench-assets', StaticFiles(directory=web), name='workbench-assets')
    workspace_paths = mount_plugin_pages(app) | {'/events'}
    return app
