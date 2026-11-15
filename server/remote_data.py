"""Desktop-side relay for the configured HTTPS data gateway."""
from dataclasses import dataclass, field
import http.client
import json
import os
from pathlib import Path
import ssl
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

import anyio
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from data_gateway.routes import (
    DEEP_ARTIFACT_BYTES, DEEP_ARTIFACT_PATH, DEEP_ARTIFACT_TYPES, DEEP_FILE, DEEP_RASTER_TYPES,
    DEEP_SAMPLE, DEEP_TASK_PATH, DEEP_UPLOAD_BYTES, DEEP_UPLOAD_TYPES,
    MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, PRESENCE_PATH, TOKEN, deep_method_allowed, method_for,
)


FILENAME_DISPOSITION = re.compile(
    r"""(?:attachment|inline)(; filename="[^"\\\r\n]{1,768}"|; filename\*=utf-8''[A-Za-z0-9%._~!$&+\-]{1,768})?\Z""",
    re.IGNORECASE,
)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class RemoteData:
    mode: str = 'local'
    url: str | None = None
    token: str = field(default='', repr=False)
    opener: object | None = field(default=None, repr=False)

    @classmethod
    def from_env(cls):
        url = os.getenv('DATA_AGENT_REMOTE_URL', '').strip()
        token = os.getenv('DATA_AGENT_REMOTE_TOKEN', '').strip()
        ca = os.getenv('DATA_AGENT_REMOTE_CA', '').strip()
        if not (url or token or ca):
            return cls()
        try:
            parts = urlsplit(url)
            if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
                    or parts.path not in ('', '/') or parts.query or parts.fragment
                    or parts.port == 0 or not TOKEN.fullmatch(token)
                    or any(character.isspace() for character in url)):
                return cls('invalid')
            context = ssl.create_default_context()
            if ca:
                context.load_verify_locations(cafile=str(Path(ca).expanduser()))
            opener = build_opener(ProxyHandler({}), HTTPSHandler(context=context), NoRedirects())
        except (OSError, ValueError):
            return cls('invalid')
        return cls('remote', f'https://{parts.netloc}', token, opener)

    def status(self):
        return {'mode': self.mode, 'url': self.url}

    async def report_presence(self, version):
        # The managed desktop shuts down independently of a blocked gateway call.
        while self.mode == 'remote':
            await anyio.to_thread.run_sync(self._send_presence, version, abandon_on_cancel=True)
            await anyio.sleep(60)

    def _send_presence(self, version):
        request = Request(self.url + PRESENCE_PATH, data=b'', method='POST',
                          headers={'Authorization': f'Bearer {self.token}', 'X-VV-MAN-Version': version})
        try:
            with self.opener.open(request, timeout=8):
                pass
        except HTTPError as exc:
            exc.close()
        except (OSError, URLError, ValueError, http.client.HTTPException):
            pass

    async def relay(self, request):
        path = request.url.path
        deep = deep_method_allowed(path, request.method)
        if not deep and request.method != method_for(path):
            return self.error('未找到此网关接口。', 404)
        if self.mode != 'remote':
            return self.error('远程数据配置无效，请检查本机配置并重启。', 503, deep=deep)
        # Reconstruct target from the allowlisted route and validated HTTPS origin.
        query = urlencode(request.query_params.multi_items())
        target = self.url + quote(path, safe='/') + ('?' + query if query else '')
        headers = {'Authorization': f'Bearer {self.token}', 'Accept': 'application/json'}
        body = None
        if request.method == 'POST':
            content_type = request.headers.get('content-type', '').split(';', 1)[0].strip().lower()
            maximum = MAX_REQUEST_BYTES
            if path == DEEP_FILE:
                filename = request.headers.get('x-filename', '')
                if not filename or len(filename) > 1024 or not filename.isascii() or any(ord(char) < 32 for char in filename):
                    return self.error('文件名称无效。', 400, deep=True)
                if content_type not in DEEP_UPLOAD_TYPES:
                    return self.error('请选择 CSV 或 Excel 文件。', 415, deep=True)
                headers['X-Filename'] = filename
                maximum = DEEP_UPLOAD_BYTES
            elif content_type != 'application/json' and not (
                    deep and DEEP_TASK_PATH.fullmatch(path) and path.endswith('/cancel') and not content_type):
                return self.error('请求体必须是 JSON。', 415, deep=deep)
            buffer = bytearray()
            async for chunk in request.stream():
                if len(buffer) + len(chunk) > maximum:
                    return self.error('请求内容过大。', 413, deep=deep)
                buffer.extend(chunk)
            body = bytes(buffer)
            if content_type:
                headers['Content-Type'] = content_type
        download = deep and (path == DEEP_SAMPLE or DEEP_ARTIFACT_PATH.fullmatch(path))
        if download:
            headers['Accept'] = '*/*'
        outbound = Request(target, data=body, headers=headers, method=request.method)
        return await run_in_threadpool(self._send, outbound, deep, bool(download))

    def request_tool_data(self, path, method, *, fields=None, upload=None):
        """Call an existing data route; the upstream credential stays in this service."""
        deep = deep_method_allowed(path, method)
        if not deep and method != method_for(path):
            raise ValueError('未知的数据工具接口。')
        if self.mode != 'remote':
            raise ValueError('远程数据网关未配置或配置无效。')
        headers = {'Authorization': f'Bearer {self.token}', 'Accept': 'application/json'}
        body = None
        if upload is not None:
            name, body = upload
            if path != DEEP_FILE or method != 'POST' or len(body) > DEEP_UPLOAD_BYTES:
                raise ValueError('表格超过网关上传限制。')
            headers.update({'Content-Type': 'text/csv', 'X-Filename': quote(name, safe='')})
        elif fields is not None:
            body = json.dumps(fields, ensure_ascii=False).encode('utf-8')
            if len(body) > MAX_REQUEST_BYTES:
                raise ValueError('数据请求过大。')
            headers['Content-Type'] = 'application/json'
        request = Request(self.url + quote(path, safe='/'), data=body, headers=headers, method=method)
        response = self._send(request, deep)
        packet = json.loads(response.body)
        if response.status_code >= 400:
            # Public status categories only. Do not relay upstream error strings to an Agent.
            status = response.status_code
            if status in (401, 403):
                raise ValueError('数据网关未授权此操作。')
            if status == 404:
                raise ValueError('数据网关没有找到所请求的资源。')
            if status in (400, 413, 415, 422):
                raise ValueError('数据网关拒绝了查询或文件，请检查请求范围和格式。')
            raise ValueError('远程数据工具当前不可用。')
        return packet

    def _send(self, request, deep=False, download=False):
        try:
            try:
                response = self.opener.open(request, timeout=90)
            except HTTPError as exc:
                response = exc
            with response:
                status = response.getcode()
                content_type = response.headers.get_content_type()
                if download and status == 200 and content_type in DEEP_ARTIFACT_TYPES:
                    return self._artifact(response, content_type)
                if status not in (200, 201, 202, 400, 401, 403, 404, 409, 413, 415, 422, 429, 503):
                    return self.error('远程数据网关返回了无效响应。', 502, deep=deep)
                if content_type != 'application/json' or (download and status == 200):
                    return self.error('远程数据网关返回了无效响应。', 502, deep=deep)
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    return self.error('远程数据网关响应过大。', 502, deep=deep)
                packet = json.loads(raw)
                if not isinstance(packet, dict):
                    return self.error('远程数据网关返回了无效响应。', 502, deep=deep)
                if deep and status >= 400 and not isinstance(packet.get('error'), dict):
                    return self.error(packet['error'] if isinstance(packet.get('error'), str)
                                      else '远程深度分析请求失败。', status, deep=True)
                return JSONResponse(packet, status_code=status, headers={'Cache-Control': 'no-store'})
        except (OSError, URLError, ValueError, RecursionError, http.client.HTTPException):
            return self.error('无法连接远程数据网关，请检查网络、地址和证书。', 502, deep=deep)

    def _artifact(self, response, content_type):
        raw = response.read(DEEP_ARTIFACT_BYTES + 1)
        if len(raw) > DEEP_ARTIFACT_BYTES:
            return self.error('远程产物超过下载大小限制。', 502, deep=True)
        source = response.headers.get('Content-Disposition', '')
        disposition = 'inline' if content_type in DEEP_RASTER_TYPES else 'attachment'
        if source.isascii() and FILENAME_DISPOSITION.fullmatch(source) and ';' in source:
            disposition += ';' + source.split(';', 1)[1]
        return Response(raw, media_type=content_type, headers={
            'Cache-Control': 'no-store',
            'Content-Disposition': disposition,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
        })

    @staticmethod
    def error(message, status, *, deep=False):
        error = {'code': 'remote_deep_request_failed', 'message': message} if deep else message
        return JSONResponse({'error': error}, status_code=status, headers={'Cache-Control': 'no-store'})
