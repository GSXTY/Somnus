"""HTTPS API for authorized LAN clients. No desktop services are mounted."""
from contextlib import asynccontextmanager
from dataclasses import replace
from hashlib import sha256
from hmac import compare_digest
import json
import logging
import sqlite3
from time import perf_counter

import anyio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from agent_core.sql_access import SqlAccessError, SqlSettings, run, schema
from agent_core.sql_agent import propose_sql
from agent_core.workbench import dashboard, user_detail
from app_version import APP_VERSION
from data_gateway.routes import (
    CLIENT_VERSION, DEEP_FILE, DEEP_STATUS, DEEP_SAMPLE, DEEP_TASKS, DEEP_UPLOAD_TYPES,
    DEEP_ARTIFACT_PATH, HEALTH_PATH, PRESENCE_PATH,
    MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, TOKEN,
    deep_method_allowed, method_for,
)
from data_gateway.usage import ADMIN_CHALLENGE, ADMIN_PAGE_HEADERS, ADMIN_PATH, ADMIN_USAGE_PATH, Usage, admin_page


logger = logging.getLogger(__name__)


def _packet(data, status=200, headers=None):
    response = JSONResponse(data, status_code=status, headers={'Cache-Control': 'no-store', **(headers or {})})
    if len(response.body) > MAX_RESPONSE_BYTES:
        return JSONResponse({'error': '网关响应过大，请缩小查询范围。'}, status_code=413,
                            headers={'Cache-Control': 'no-store'})
    return response


def _deep_error(code, message, status):
    return _packet({'error': {'code': code, 'message': message}}, status)


def _audit_operation(path, method, deep_route):
    if deep_route:
        return {
            DEEP_STATUS: 'deep_status', DEEP_SAMPLE: 'deep_sample', DEEP_FILE: 'deep_upload',
            DEEP_TASKS: 'deep_create' if method == 'POST' else 'deep_list',
        }.get(path) or ('deep_artifact' if DEEP_ARTIFACT_PATH.fullmatch(path)
                        else 'deep_cancel' if method == 'POST' else 'deep_task')
    return {
        '/api/workbench': 'dashboard', '/api/sql/schema': 'sql_schema',
        '/api/sql/query': 'sql_query', '/api/sql/ask': 'sql_ask',
    }.get(path) or ('user_detail' if path.startswith('/api/workbench/users/') else None)


def create_gateway(tokens, settings, *, sql_enabled=False, sql_tables=(), deep_service=None, deep_tokens=(),
                   admin_password=None, usage_database=None, user_labels=None):
    if not tokens or any(not TOKEN.fullmatch(token) for token in tokens):
        raise ValueError('网关需要至少一个符合格式的访问令牌。')
    if not settings.allowed_tables:
        raise ValueError('网关需要设置 ANALYTICS_SQL_TABLES。')
    if sql_enabled and (not sql_tables or not set(sql_tables).issubset(settings.allowed_tables)):
        raise ValueError('开启远程 SQL 时必须单独配置已批准的 DATA_AGENT_GATEWAY_SQL_TABLES。')
    if (deep_service is None and deep_tokens) or (deep_service is not None and not deep_tokens):
        raise ValueError('开启远程深度分析时必须配置专用的 DATA_AGENT_GATEWAY_DEEP_TOKENS。')
    if not set(deep_tokens).issubset(tokens):
        raise ValueError('深度分析访问令牌须同时存在于 DATA_AGENT_GATEWAY_TOKENS。')
    if bool(admin_password) != bool(usage_database) or (user_labels and not admin_password):
        raise ValueError('网关管理需要同时配置管理员密码和使用记录路径。')
    usage = Usage(usage_database, admin_password, tokens, user_labels) if admin_password else None
    query_settings = replace(settings, allowed_tables=tuple(sql_tables))
    # SQLGlot checks table references with CTE scope. The legacy regex table
    # guard would mistake CTE aliases for physical tables; retain its other checks.
    execution_settings = replace(query_settings, allowed_tables=())
    # A local desktop or previous gateway may have cached a broader SQL result.
    # The gateway validates each generated statement before every execution.
    if sql_enabled:
        from data_gateway.sql_policy import checked_sql

    keys = tuple(token.encode('ascii') for token in tokens)
    deep_keys = tuple(token.encode('ascii') for token in deep_tokens)

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            if deep_service is not None:
                await run_in_threadpool(deep_service.close)

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False, lifespan=lifespan)
    if deep_service is not None:
        from deep_analysis.asgi import create_router

        app.state.deep_analysis_service = deep_service
        app.include_router(create_router())

    @app.middleware('http')
    async def authenticate(request, call_next):
        path = request.url.path
        if request.url.scheme != 'https':
            return _packet({'error': '未找到此网关接口。'}, 404)
        if path in (ADMIN_PATH, ADMIN_USAGE_PATH):
            if not usage or request.method != 'GET':
                return _packet({'error': '未找到此网关接口。'}, 404)
            if not usage.allows_admin(request.headers):
                return _packet({'error': '需要网关管理员身份验证。'}, 401, ADMIN_CHALLENGE)
            return await call_next(request)
        presence = usage is not None and path == PRESENCE_PATH
        method = 'POST' if presence else 'GET' if path == HEALTH_PATH else method_for(path)
        deep_route = deep_method_allowed(path, request.method)
        if not deep_route and request.method != method:
            return _packet({'error': '未找到此网关接口。'}, 404)
        headers = request.headers.getlist('authorization')
        authorization = headers[0].split(' ', 1) if len(headers) == 1 else []
        candidate = authorization[-1] if len(authorization) == 2 and authorization[0].lower() == 'bearer' else ''
        if not TOKEN.fullmatch(candidate):
            return _packet({'error': '网关访问令牌无效。'}, 401, {'WWW-Authenticate': 'Bearer'})
        encoded = candidate.encode('ascii')
        # Check every configured key before returning to avoid exposing token position.
        if not sum(compare_digest(encoded, key) for key in keys):
            return _packet({'error': '网关访问令牌无效。'}, 401, {'WWW-Authenticate': 'Bearer'})
        if presence:
            versions = request.headers.getlist('x-vv-man-version')
            if len(versions) != 1 or not CLIENT_VERSION.fullmatch(versions[0]):
                return _packet({'error': '桌面版本格式无效。'}, 400)
            try:
                await run_in_threadpool(lambda: usage.record(encoded, version=versions[0]))
            except sqlite3.Error:
                logger.warning('Could not save Somnus desktop heartbeat')
                return _packet({'error': '无法保存桌面状态，请稍后重试。'}, 503)
            return _packet({'ok': True})
        operation = _audit_operation(path, request.method, deep_route) if usage else None
        if not operation:
            return await gateway_request(request, call_next, path, deep_route, encoded)
        started = perf_counter()
        status = 500
        try:
            response = await gateway_request(request, call_next, path, deep_route, encoded)
            status = response.status_code
            return response
        except anyio.get_cancelled_exc_class():
            status = 499
            raise
        finally:
            try:
                with anyio.CancelScope(shield=True):
                    await run_in_threadpool(usage.audit, encoded, operation, status, round((perf_counter() - started) * 1000))
            except sqlite3.Error:
                logger.warning('Could not save Somnus gateway operation audit')

    async def gateway_request(request, call_next, path, deep_route, encoded):
        if deep_route:
            if deep_service is None:
                return _deep_error('remote_deep_disabled', '远程数据网关尚未启用深度分析。', 503)
            if not sum(compare_digest(encoded, key) for key in deep_keys):
                return _deep_error('remote_deep_denied', '当前访问令牌未获准使用远程深度分析。', 403)
            if path == DEEP_FILE:
                content_type = request.headers.get('content-type', '').partition(';')[0].strip().lower()
                if content_type not in DEEP_UPLOAD_TYPES:
                    return _deep_error('invalid_file_type', '请选择 CSV 或 Excel 文件。', 415)
                filename = request.headers.get('x-filename', '')
                if not filename or len(filename) > 1024:
                    return _deep_error('invalid_filename', '文件名称无效。', 400)
                request.state.remote_deep_upload = True
            request.state.deep_analysis_context = sha256(b'data-agent:deep-owner:v1\x00' + encoded).hexdigest()
        if usage and path != HEALTH_PATH:
            try:
                await run_in_threadpool(usage.record, encoded)
            except sqlite3.Error:
                logger.warning('Could not save Somnus gateway usage')
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    if usage:
        @app.get(ADMIN_PATH)
        def admin():
            try:
                return HTMLResponse(admin_page(usage.snapshot()), headers=ADMIN_PAGE_HEADERS)
            except sqlite3.Error:
                return _packet({'error': '无法读取网关使用记录，请稍后重试。'}, 503)

        @app.get(ADMIN_USAGE_PATH)
        def admin_usage():
            try:
                return _packet(usage.snapshot())
            except sqlite3.Error:
                return _packet({'error': '无法读取网关使用记录，请稍后重试。'}, 503)

    @app.get(HEALTH_PATH)
    def health():
        return _packet({'service': 'data-agent-gateway', 'version': APP_VERSION, 'sql_enabled': sql_enabled,
                        'deep_analysis_enabled': deep_service is not None})

    @app.get('/api/workbench')
    def workbench(request: Request):
        query = {key: request.query_params.getlist(key) for key in request.query_params}
        try:
            result = dashboard(query, settings=settings)
            if query.get('source', ['demo'])[0] == 'live' and result['source']['mode'] != 'live':
                return _packet({'error': '网关未能读取已配置的真实数据源。'}, 503)
            return _packet(result)
        except ValueError:
            return _packet({'error': '数据看板请求参数无效。'}, 400)
        except Exception as exc:
            logger.error('Dashboard query failed: %s', type(exc).__name__)
            return _packet({'error': '网关未能读取已配置的真实数据源。'}, 503)

    @app.get('/api/workbench/users/{user_id}')
    def workbench_user(user_id: str, request: Request):
        try:
            return _packet(user_detail(user_id, {key: request.query_params.getlist(key) for key in request.query_params}))
        except LookupError:
            return _packet({'error': '未找到此用户详情。'}, 404)
        except ValueError:
            return _packet({'error': '用户详情请求参数无效。'}, 400)

    @app.get('/api/sql/schema')
    def sql_schema():
        if not sql_enabled:
            return _packet({'error': '远程 SQL 查询未启用。'}, 403)
        try:
            return _packet({'database': '远程只读网关', 'driver': query_settings.driver,
                            'max_rows': query_settings.max_rows, 'tables': schema(query_settings)})
        except Exception as exc:
            logger.error('SQL schema read failed: %s', type(exc).__name__)
            return _packet({'error': '网关未能读取获准的数据表结构。'}, 503)

    async def sql(request, *, model=False):
        if not sql_enabled:
            return _packet({'error': '远程 SQL 查询未启用。'}, 403)
        field = 'question' if model else 'sql'
        value = await _request_text(request, field)
        if value is None or (model and len(value) > 2000):
            return _packet({'error': '请求内容为空、过长或格式无效。'}, 400)
        try:
            if model:
                statement = await run_in_threadpool(lambda: propose_sql(value, schema(query_settings)))
            else:
                statement = value
        except Exception as exc:
            logger.error('SQL proposal failed: %s', type(exc).__name__)
            return _packet({'error': '网关未能生成 SQL，请检查模型连接或使用手动查询。'}, 503)
        try:
            statement = checked_sql(statement, query_settings)
        except SqlAccessError as exc:
            return _packet({'error': str(exc)}, 400)
        try:
            result = await run_in_threadpool(run, statement, execution_settings)
        except Exception as exc:
            logger.error('Remote SQL execution failed: %s', type(exc).__name__)
            return _packet({'error': '远程只读查询执行失败。'}, 400)
        if model:
            result.update(question=value, database='远程只读网关', tables=list(query_settings.allowed_tables), cached=False)
        return _packet(result)

    @app.post('/api/sql/query')
    async def sql_query(request: Request):
        return await sql(request)

    @app.post('/api/sql/ask')
    async def sql_ask(request: Request):
        return await sql(request, model=True)

    return app


async def _request_text(request, field):
    if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
        return None
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            return None
        body.extend(chunk)
    try:
        payload = json.loads(body)
    except (ValueError, RecursionError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get(field), str):
        return None
    return payload[field].strip() or None
