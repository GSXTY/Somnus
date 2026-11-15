"""Bounded MCP clients for local stdio and remote Streamable HTTP tools."""
from __future__ import annotations

import base64
from collections import deque
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


MAX_MESSAGE = 1024 * 1024
LEGACY_HTTP = '2025-11-25'
MODERN_HTTP = '2026-07-28'
HTTP_VERSIONS = {LEGACY_HTTP, MODERN_HTTP}
LEGACY_HTTP_VERSIONS = {LEGACY_HTTP, '2025-06-18', '2025-03-26'}
CLIENT_INFO = {'name': 'respiratory-agent', 'version': '1'}
OS_ENV = frozenset({
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
    'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'USERNAME', 'USER', 'LOGNAME', 'LANG',
})
HTTP_HEADER = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+\Z")
UNSAFE_HEADERS = frozenset({
    'host', 'connection', 'content-length', 'transfer-encoding', 'accept', 'accept-encoding',
    'content-type', 'origin', 'referer', 'cookie', 'set-cookie', 'upgrade', 'expect',
    'mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name',
})


class McpError(RuntimeError):
    pass


def _encoded_header(value):
    if value and all(32 <= ord(char) < 127 for char in value) and value == value.strip() and not value.startswith('=?'):
        return value
    return '=?utf-8?b?' + base64.b64encode(value.encode()).decode('ascii') + '?='


class RpcServer:
    def __init__(self, name, timeout):
        self.name = name
        self.timeout = timeout
        self.lock = threading.RLock()
        self._next_id = 0
        self._tools = {}

    def _new_id(self):
        self._next_id += 1
        return self._next_id

    @staticmethod
    def _result(message, request_id):
        if not isinstance(message, dict) or message.get('jsonrpc') != '2.0' or message.get('id') != request_id:
            raise McpError('MCP 服务器返回了不匹配的消息。')
        if 'error' in message:
            raise McpError('MCP 服务器拒绝了请求。')
        if not isinstance(message.get('result'), dict):
            raise McpError('MCP 服务器未返回有效结果。')
        return message['result']

    def list_tools(self):
        tools, cursor = [], None
        for _ in range(5):
            page = self.request('tools/list', {'cursor': cursor} if cursor else {})
            items = page.get('tools')
            if not isinstance(items, list):
                raise McpError('MCP 工具清单格式无效。')
            tools.extend(item for item in items if isinstance(item, dict))
            cursor = page.get('nextCursor')
            if not cursor or len(tools) >= 100:
                break
            if not isinstance(cursor, str) or len(cursor) > 1024:
                raise McpError('MCP 工具清单分页无效。')
        self._tools = {item['name']: item for item in tools[:100] if isinstance(item.get('name'), str)}
        return list(self._tools.values())

    def call_tool(self, name, arguments):
        return self.request('tools/call', {'name': name, 'arguments': arguments or {}})


class McpServer(RpcServer):
    def __init__(self, name, command, args=None, env=None, timeout=25, cwd=None):
        super().__init__(name, timeout)
        self.command = command
        self.args = list(args or [])
        self.extra_env = dict(env or {})
        self.cwd = cwd
        self.process = None
        self._response_ready = threading.Condition()
        self._responses = deque(maxlen=64)
        self._reader = None

    def start(self):
        env = {key: value for key, value in os.environ.items() if key.upper() in OS_ENV}
        env.update(self.extra_env)
        command = shutil.which(self.command, path=env.get('PATH')) or self.command
        if Path(command).suffix.lower() in {'.bat', '.cmd'}:
            raise McpError('请使用可执行文件；npm/npx 可通过 node.exe 加载相应的 JS 入口。')
        try:
            process = subprocess.Popen(
                [command, *self.args], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, env=env, cwd=self.cwd, bufsize=0,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
        except (OSError, ValueError) as exc:
            raise McpError('无法启动 MCP 命令，请检查路径与参数。') from exc
        self.process = process
        self._reader = threading.Thread(target=self._read_loop, args=(process,), daemon=True)
        self._reader.start()
        try:
            result = self.request('initialize', {'protocolVersion': LEGACY_HTTP,
                                  'capabilities': {}, 'clientInfo': CLIENT_INFO})
            if result.get('protocolVersion') not in LEGACY_HTTP_VERSIONS | {'2024-11-05'}:
                raise McpError('本地 MCP 服务使用了不兼容的协议版本。')
            self._write({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
            return self
        except Exception:
            self.close()
            raise

    def _read_loop(self, process):
        try:
            # Wrap the pipe so readline is buffered while the write side stays unbuffered.
            from io import BufferedReader
            with BufferedReader(process.stdout) as reader:
                while True:
                    line = reader.readline(MAX_MESSAGE + 1)
                    if not line:
                        return
                    if len(line) > MAX_MESSAGE:
                        process.kill()
                        return
                    try:
                        message = json.loads(line)
                    except (ValueError, RecursionError):
                        continue
                    if isinstance(message, dict) and isinstance(message.get('id'), int):
                        with self._response_ready:
                            self._responses.append(message)
                            self._response_ready.notify_all()
        except (OSError, ValueError):
            pass
        finally:
            with self._response_ready:
                self._response_ready.notify_all()

    def _write(self, message):
        data = (json.dumps(message, ensure_ascii=False) + '\n').encode()
        if len(data) > MAX_MESSAGE:
            raise McpError('MCP 请求过大。')
        process = self.process
        if process is None:
            raise McpError('MCP 进程已停止。')
        done, errors = threading.Event(), []

        def write():
            try:
                view = memoryview(data)
                while view:
                    sent = process.stdin.write(view)
                    if not sent:
                        raise BrokenPipeError
                    view = view[sent:]
            except (OSError, ValueError):
                errors.append(True)
            finally:
                done.set()

        threading.Thread(target=write, daemon=True).start()
        if not done.wait(self.timeout):
            self.close()
            raise McpError('MCP 进程未接收请求。')
        if errors:
            raise McpError('MCP 进程已停止。')

    def request(self, method, params):
        with self.lock:
            request_id = self._new_id()
            self._write({'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params})
            deadline = time.monotonic() + self.timeout
            with self._response_ready:
                while time.monotonic() < deadline:
                    for message in self._responses:
                        if message['id'] == request_id:
                            self._responses.remove(message)
                            return self._result(message, request_id)
                    if self.process is None or self.process.poll() is not None:
                        raise McpError('MCP 进程已停止。')
                    self._response_ready.wait(min(.1, max(0, deadline - time.monotonic())))
            raise McpError('MCP 服务响应超时。')

    def close(self):
        process = self.process
        self.process = None
        if process is None:
            return
        with self._response_ready:
            self._response_ready.notify_all()
        try:
            process.stdin.close()
        except OSError:
            pass
        try:
            process.wait(timeout=.6)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                try:
                    subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'], timeout=2,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                except (OSError, subprocess.TimeoutExpired):
                    pass
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)
        if self._reader:
            self._reader.join(timeout=.4)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpMcpServer(RpcServer):
    def __init__(self, name, url, headers=None, timeout=25, protocol_version=LEGACY_HTTP):
        super().__init__(name, timeout)
        self.url = url
        self.headers = dict(headers or {})
        self.protocol_version = protocol_version
        self.session = None
        self.closed = False
        self.opener = build_opener(ProxyHandler({}), NoRedirects())

    def start(self):
        if self.protocol_version != MODERN_HTTP:
            result = self.request('initialize', {'protocolVersion': LEGACY_HTTP, 'capabilities': {},
                                  'clientInfo': CLIENT_INFO})
            if result.get('protocolVersion') not in LEGACY_HTTP_VERSIONS:
                raise McpError('远程 MCP 服务使用了不兼容的协议版本。')
            self.protocol_version = result['protocolVersion']
            self._exchange('POST', {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        return self

    def request(self, method, params):
        with self.lock:
            if self.closed:
                raise McpError('MCP 连接已关闭。')
            request_id = self._new_id()
            return self._exchange('POST', {'jsonrpc': '2.0', 'id': request_id,
                                           'method': method, 'params': params})

    def _headers(self, payload):
        headers = {**self.headers, 'Accept': 'application/json, text/event-stream',
                   'MCP-Protocol-Version': self.protocol_version}
        if self.session:
            headers['MCP-Session-Id'] = self.session
        if payload is None:
            return headers
        headers['Content-Type'] = 'application/json'
        if self.protocol_version == MODERN_HTTP:
            payload['params'] = {**payload['params'], '_meta': {
                'io.modelcontextprotocol/protocolVersion': MODERN_HTTP,
                'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
                'io.modelcontextprotocol/clientCapabilities': {},
            }}
            headers['Mcp-Method'] = payload['method']
            if payload['method'] == 'tools/call':
                name = payload['params']['name']
                headers['Mcp-Name'] = _encoded_header(name)
                arguments = payload['params']['arguments']
                definition = self._tools.get(name, {})
                for path, suffix in _tool_headers(definition.get('inputSchema', {})):
                    value = arguments
                    for segment in path:
                        value = value.get(segment) if isinstance(value, dict) else None
                    if isinstance(value, bool):
                        value = str(value).lower()
                    elif isinstance(value, int) and abs(value) < 2**53:
                        value = str(value)
                    if isinstance(value, str) and len(value) <= 4096:
                        headers['Mcp-Param-' + suffix] = _encoded_header(value)
        return headers

    def _exchange(self, verb, payload=None, timeout=None):
        headers = self._headers(payload)
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        if data and len(data) > MAX_MESSAGE:
            raise McpError('MCP 请求过大。')
        request_id = payload.get('id') if payload else None
        deadline = time.monotonic() + (timeout or self.timeout)
        try:
            with self.opener.open(Request(self.url, data=data, headers=headers, method=verb),
                                  timeout=timeout or self.timeout) as response:
                if request_id is None:
                    return None
                session = response.headers.get('Mcp-Session-Id')
                if payload['method'] == 'initialize' and session:
                    if len(session) > 256 or any(not 33 <= ord(char) <= 126 for char in session):
                        raise McpError('MCP 会话标识无效。')
                    self.session = session
                mime = response.headers.get_content_type()
                if mime == 'text/event-stream':
                    message = self._sse_message(response, request_id, deadline)
                elif mime == 'application/json':
                    raw = response.read(MAX_MESSAGE + 1)
                    if len(raw) > MAX_MESSAGE:
                        raise McpError('MCP 响应过大。')
                    message = json.loads(raw)
                else:
                    raise McpError('MCP 服务未返回 JSON 或事件流。')
                return self._result(message, request_id)
        except HTTPError as exc:
            exc.close()
            raise McpError(f'MCP HTTPS 请求失败（HTTP {exc.code}）。') from exc
        except (OSError, URLError, ValueError, RecursionError) as exc:
            raise McpError('无法连接 MCP 服务或读取响应，请检查地址、证书和鉴权。') from exc

    @staticmethod
    def _sse_message(response, request_id, deadline):
        total, event = 0, []
        while time.monotonic() < deadline:
            line = response.readline(MAX_MESSAGE - total + 1)
            if not line:
                break
            total += len(line)
            if total > MAX_MESSAGE:
                raise McpError('MCP 响应过大。')
            stripped = line.rstrip(b'\r\n')
            if stripped.startswith(b'data:'):
                event.append(stripped[5:].lstrip(b' '))
            elif not stripped and event:
                data, event = b'\n'.join(event), []
                if not data.strip():
                    continue
                packet = json.loads(data)
                if isinstance(packet, dict) and packet.get('id') == request_id:
                    return packet
        raise McpError('MCP 服务未返回完整事件结果。')

    def list_tools(self):
        result = super().list_tools()
        if self.protocol_version == MODERN_HTTP:
            valid = []
            for tool in result:
                try:
                    _tool_headers(tool.get('inputSchema', {}))
                    valid.append(tool)
                except McpError:
                    self._tools.pop(tool['name'], None)
            return valid
        return result

    def close(self):
        self.closed = True
        if self.session and self.lock.acquire(blocking=False):
            try:
                self._exchange('DELETE', timeout=2)
            except McpError:
                pass
            finally:
                self.session = None
                self.lock.release()


def _tool_headers(schema):
    result, names, pending = [], set(), [(schema, (), True)]
    while pending:
        node, path, permitted = pending.pop()
        if isinstance(node, list):
            pending.extend((item, path, False) for item in node)
        if not isinstance(node, dict):
            continue
        if 'x-mcp-header' in node:
            name = node['x-mcp-header']
            if (not path or not permitted or not isinstance(name, str) or len(name) > 100
                    or not HTTP_HEADER.fullmatch(name) or name.lower() in names
                    or node.get('type') not in {'integer', 'string', 'boolean'}):
                raise McpError('工具头定义不符合 MCP 协议。')
            names.add(name.lower())
            result.append((path, name))
        for key, child in node.items():
            if key == 'properties' and isinstance(child, dict):
                pending.extend((value, (*path, prop), permitted) for prop, value in child.items())
            elif key not in {'x-mcp-header', 'type', 'examples', 'default', 'const', 'enum'}:
                pending.append((child, path, False))
    return result
