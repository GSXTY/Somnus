"""Management routes restricted to the local desktop."""
import ipaddress
import json
import os
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from mcp_connectors.market import MarketCatalog
from mcp_connectors.registry import ConfigError


def _loopback(host):
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def local_access(request, *, require_browser_proof=True):
    if not getattr(request.app.state, 'mcp_registry', None):
        return False
    if os.getenv('SHARE_MODE', '').strip() == '1' or not request.client or not _loopback(request.client.host):
        return False
    if any(request.headers.get(name) for name in ('forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto')):
        return False
    try:
        hosts = request.headers.getlist('host')
        if len(hosts) != 1:
            return False
        host = urlsplit('http://' + hosts[0])
        if (not host.hostname or not _loopback(host.hostname) or host.username or host.password
                or host.path or host.query or host.fragment):
            return False
        origins = request.headers.getlist('origin')
        if origins:
            if len(origins) != 1:
                return False
            origin = urlsplit(origins[0])
            if (origin.scheme != request.url.scheme or origin.netloc.lower() != host.netloc.lower()
                    or origin.path or origin.query or origin.fragment):
                return False
        elif (require_browser_proof and request.method not in ('GET', 'HEAD')
              and request.headers.get('x-data-agent-local') != '1'):
            return False
    except ValueError:
        return False
    return request.headers.get('sec-fetch-site', '') not in ('cross-site', 'same-site')


def create_router():
    router = APIRouter(prefix='/api/mcp', tags=['MCP'])
    catalog = MarketCatalog()

    async def perform(request, action, *, payload=False):
        if not local_access(request):
            return JSONResponse({'error': 'MCP 连接设置仅能从本机桌面访问。'}, status_code=403,
                                headers={'Cache-Control': 'no-store'})
        try:
            fields = await _body(request) if payload else None
            response = await run_in_threadpool(action, request.app.state.mcp_registry, fields)
            return JSONResponse(response, headers={'Cache-Control': 'no-store'})
        except ConfigError as exc:
            return JSONResponse({'error': str(exc)}, status_code=exc.status,
                                headers={'Cache-Control': 'no-store'})

    @router.get('/market')
    async def market(request: Request, query: str = '', cursor: str = ''):
        return await perform(request, lambda _registry, _fields: catalog.search(query, cursor))

    @router.get('/servers')
    async def servers(request: Request):
        return await perform(request, lambda registry, _: registry.list())

    @router.post('/servers')
    async def create(request: Request):
        def action(registry, fields):
            server_id = fields.get('id', 'server-' + uuid4().hex[:12])
            return {'server': registry.put(server_id, fields, create=True)}
        return await perform(request, action, payload=True)

    @router.post('/servers/import')
    async def import_servers(request: Request):
        return await perform(request, lambda registry, fields: registry.import_configs(fields), payload=True)

    @router.put('/servers/{server_id}')
    async def update(server_id: str, request: Request):
        return await perform(request, lambda registry, fields: {'server': registry.put(server_id, fields)}, payload=True)

    @router.delete('/servers/{server_id}')
    async def delete(server_id: str, request: Request):
        def action(registry, _):
            registry.remove(server_id)
            return {'deleted': True}
        return await perform(request, action)

    @router.post('/servers/{server_id}/test')
    async def test(server_id: str, request: Request):
        return await perform(request, lambda registry, _: {'server': registry.test(server_id)})

    return router


async def _body(request):
    if request.headers.get('content-type', '').partition(';')[0].strip().lower() != 'application/json':
        raise ConfigError('请求体必须是 JSON。', 415)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > 64 * 1024:
            raise ConfigError('MCP 配置请求过大。', 413)
        data.extend(chunk)
    try:
        payload = json.loads(data, object_pairs_hook=_unique_items)
    except (ValueError, RecursionError) as exc:
        raise ConfigError('请求体不是有效 JSON。') from exc
    if not isinstance(payload, dict):
        raise ConfigError('请求体须为 JSON 对象。')
    return payload


def _unique_items(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError('duplicate JSON key')
    return result
