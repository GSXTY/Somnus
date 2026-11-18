"""Persistent MCP configurations and lazily connected assistant tools."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
from ai_assistant.permissions import allowed

from mcp_connectors.client import HTTP_HEADER, HTTP_VERSIONS, LEGACY_HTTP, UNSAFE_HEADERS, HttpMcpServer, McpError, McpServer
from server.paths import ROOT


IDENTIFIER = re.compile(r'[A-Za-z0-9_-]{1,48}\Z')
VARIABLE = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,127}\Z')
MODEL_NAME = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')
MAX_SERVERS = 16
MAX_CONFIG = 512 * 1024
DESKTOP_MCP_ID = 'agent-desktop'


def desktop_mcp_command(data_dir=None):
    resources = ROOT.parent.parent if getattr(sys, 'frozen', False) else ROOT / 'dist/electron/win-unpacked/resources'
    candidates = [resources / 'agents/agent-desktop/agent-desktop.exe']
    roaming = os.getenv('SOMNUS_DESKTOP_ROAMING_DIR', '')
    profile = Path(roaming) if roaming and Path(roaming).is_absolute() else Path(data_dir) if data_dir else None
    if profile:
        modules = profile / 'dsh-home/mcp/agent-desktop/node_modules'
        alias = modules / 'agent-desktop/bin/agent-desktop-win32-x64.exe'
        try:
            # pnpm links the public package name to this one versioned package
            # inside the same profile. Validate every canonical component.
            resolved_modules = modules.resolve(strict=True)
            resolved = alias.resolve(strict=True)
            relative = resolved.relative_to(resolved_modules)
            parts = relative.parts
            pnpm = (len(parts) == 6 and parts[0] == '.pnpm'
                    and re.fullmatch(r'agent-desktop@\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?', parts[1], re.I)
                    and parts[2:] == ('node_modules', 'agent-desktop', 'bin', 'agent-desktop-win32-x64.exe'))
            plain = parts == ('agent-desktop', 'bin', 'agent-desktop-win32-x64.exe')
            if resolved_modules == modules and (pnpm or plain):
                current = modules
                for part in parts:
                    current = current / part
                    if current.is_symlink() or current.is_junction():
                        raise OSError('Unexpected desktop MCP path link')
                if resolved.is_file():
                    return str(alias)
        except (OSError, ValueError):
            pass
    for candidate in candidates:
        try:
            if candidate.is_file() and candidate.resolve(strict=True) == candidate:
                return str(candidate)
        except OSError:
            continue
    return None


def _mcp_name(value):
    return value.strip().casefold().replace('_', '-') if isinstance(value, str) else ''


class ConfigError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _strings(values, key_pattern, *, http=False):
    if not isinstance(values, dict) or len(values) > 40:
        raise ConfigError('环境变量或请求头格式无效。')
    lowered = set()
    for key, value in values.items():
        if (not isinstance(key, str) or len(key) > 128 or not key_pattern.fullmatch(key)
                or not isinstance(value, str) or len(value) > 4096 or '\x00' in value
                or key.lower() in lowered):
            raise ConfigError('环境变量或请求头格式无效。')
        if http and (key.lower() in UNSAFE_HEADERS or key.lower().startswith('mcp-param-')
                     or any(not 32 <= ord(char) < 127 for char in value)):
            raise ConfigError('请求头名称或内容无效。')
        lowered.add(key.lower())
    return dict(values)


def _validate(server_id, fields):
    if not isinstance(server_id, str) or not IDENTIFIER.fullmatch(server_id):
        raise ConfigError('服务器标识须由 1 至 48 个英文字母、数字、下划线或连字符组成。')
    if not isinstance(fields, dict):
        raise ConfigError('连接配置须为对象。')
    name = fields.get('name', server_id)
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise ConfigError('服务器名称须为 1 至 100 个字符。')
    transport = fields.get('transport', 'http' if fields.get('url') else 'stdio')
    if transport in ('streamable-http', 'streamable_http'):
        transport = 'http'
    enabled = fields.get('enabled', not fields.get('disabled', False))
    timeout = fields.get('timeout', 25)
    if type(enabled) is not bool or type(timeout) not in (int, float) or not math.isfinite(timeout) or not 1 <= timeout <= 60:
        raise ConfigError('启用状态或请求超时无效（1 至 60 秒）。')
    config = {'name': name.strip(), 'transport': transport, 'enabled': enabled, 'timeout': timeout}
    permissions = fields.get('tool_permissions', {})
    if (not isinstance(permissions, dict) or len(permissions) > 100
            or any(not isinstance(name, str) or not name or len(name) > 128
                   or any(ord(char) < 32 for char in name) or value not in ('read', 'confirm')
                   for name, value in permissions.items())):
        raise ConfigError('MCP 工具权限须按实际工具名指定 read 或 confirm。')
    config['tool_permissions'] = dict(permissions)
    if transport == 'stdio':
        command, args = fields.get('command'), fields.get('args', [])
        if (not isinstance(command, str) or not command.strip() or len(command) > 1024
                or any(ord(char) < 32 for char in command)
                or not isinstance(args, list) or len(args) > 64
                or any(not isinstance(arg, str) or len(arg) > 4096 or '\x00' in arg for arg in args)):
            raise ConfigError('命令或参数无效。每个参数须单独提供。')
        config.update(command=command.strip(), args=list(args), env=_strings(fields.get('env', {}), VARIABLE))
    elif transport == 'http':
        url = fields.get('url')
        try:
            if (not isinstance(url, str) or len(url) > 2048 or any(char.isspace() or ord(char) < 32 for char in url)
                    or '\\' in url):
                raise ValueError
            parts = urlsplit(url)
            if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
                    or parts.query or parts.fragment or parts.port == 0):
                raise ValueError
        except ValueError as exc:
            raise ConfigError('请使用不含凭据、查询参数和片段的 HTTPS MCP 地址。') from exc
        version = fields.get('protocol_version', LEGACY_HTTP)
        if not isinstance(version, str) or version not in HTTP_VERSIONS:
            raise ConfigError('不支持此 Streamable HTTP 协议版本。')
        config.update(url=url, protocol_version=version,
                      headers=_strings(fields.get('headers', {}), HTTP_HEADER, http=True))
    else:
        raise ConfigError('请选择 STDIO 或 HTTPS Streamable HTTP。')
    return config


class Registry:
    def __init__(self, data_dir, *, desktop_builtin=False, data_builtins=None, data_inventory=None):
        isolated = os.getenv('SOMNUS_PROFILE_CONFIG_ONLY')
        override = '' if isolated else os.getenv('MCP_CONFIG', '').strip()
        self.path = Path(override).expanduser().resolve() if override else Path(data_dir).resolve() / 'mcp.json'
        self.legacy = None if override or isolated else ROOT / 'mcp.json'
        self.lock = threading.RLock()
        self.connection_locks = {}
        self.configs = {}
        self.connections = {}
        self.results = {}
        self.pending = set()
        self.closed = False
        self.error = None
        self.desktop_builtin = desktop_builtin
        self.data_builtins = dict(data_builtins or {})
        self.data_inventory = data_inventory
        self.reserved_configs = {}
        self._load()
        if self.desktop_builtin:
            command = desktop_mcp_command(data_dir)
            self.configs[DESKTOP_MCP_ID] = {
                'name': DESKTOP_MCP_ID, 'transport': 'stdio', 'enabled': True, 'command': command,
                'args': ['mcp'], 'env': {}, 'timeout': 25, 'tool_permissions': {},
            }

    def _reserved(self, server_id, name=None):
        ids = {*self.data_builtins, *([DESKTOP_MCP_ID] if self.desktop_builtin else [])}
        return server_id in self.reserved_configs or _mcp_name(server_id) in ids or _mcp_name(name) in ids

    def _assert_editable(self, server_id, name=None):
        if self._reserved(server_id, name):
            raise ConfigError('内置 MCP 无法修改或删除。', 409)

    def _personal_count(self):
        return len(self.configs) + len(self.reserved_configs) - int(self.desktop_builtin)

    def _load(self):
        source = self.path if self.path.exists() else self.legacy
        if source is None or not source.is_file():
            return
        try:
            if source.stat().st_size > MAX_CONFIG:
                raise ConfigError('MCP 配置文件过大。')
            packet = json.loads(source.read_text(encoding='utf-8-sig'))
            entries = packet.get('servers', packet.get('mcpServers'))
            if not isinstance(entries, dict) or len(entries) > MAX_SERVERS:
                raise ConfigError('MCP 配置格式无效。')
            for server_id, entry in entries.items():
                config = _validate(server_id, entry)
                target = self.reserved_configs if self._reserved(server_id, config['name']) else self.configs
                target[server_id] = config
        except (AttributeError, OSError, ValueError, RecursionError):
            self.error = '无法读取 MCP 配置，请检查本机 mcp.json。'
            self.configs = {}

    def _save(self, configs):
        if self.desktop_builtin or self.data_builtins:
            configs = {**self.reserved_configs, **{key: value for key, value in configs.items()
                       if not self.desktop_builtin or key != DESKTOP_MCP_ID}}
        data = json.dumps({'servers': configs}, ensure_ascii=False, indent=2) + '\n'
        if len(data.encode('utf-8')) > MAX_CONFIG:
            raise ConfigError('MCP 配置总大小超过限制。')
        temporary = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(data)
            temporary.replace(self.path)
        except OSError as exc:
            raise ConfigError('无法保存 MCP 配置，请检查本机文件权限。', 500) from exc
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def list(self):
        data = self.data_inventory() if self.data_inventory else self.data_builtins
        with self.lock:
            return {'servers': [*deepcopy(list(data.values())),
                                *(self._public(key, value) for key, value in self.configs.items())],
                    'error': self.error}

    def enabled_states(self):
        with self.lock:
            return {server_id: bool(config['enabled']) for server_id, config in self.configs.items()}

    def _public(self, server_id, config, *, tested=False):
        result = self.results.get(server_id, {})
        visible = {key: deepcopy(value) for key, value in config.items() if key not in ('env', 'headers')}
        # Arguments are needed for editing. Explicit credentials belong in env
        # or headers, which are write-only and never returned.
        status = result.get('status', 'idle') if config['enabled'] or tested else 'disabled'
        if self.desktop_builtin and server_id == DESKTOP_MCP_ID:
            visible.update(builtin=True, command=config['command'] or '')
            if not config['command']:
                status = 'unavailable'
                result = {'error': '未找到本机 DSH agent-desktop 组件。'}
        return {**visible, 'id': server_id, 'status': status,
                'env_names': sorted(config.get('env', {})), 'header_names': sorted(config.get('headers', {})),
                'tools': [{'name': item['name'], 'description': item.get('description', '')[:900],
                           'permission': config['tool_permissions'].get(item['name'], 'confirm')}
                          for item in result.get('tools', [])], 'error': result.get('error')}

    def put(self, server_id, fields, *, create=False):
        if not isinstance(fields, dict):
            raise ConfigError('连接配置须为对象。')
        with self.lock:
            self._assert_editable(server_id, fields.get('name'))
            if self.closed or self.error:
                raise ConfigError(self.error or 'MCP 服务正在关闭。', 503)
            previous = self.configs.get(server_id)
            if create and (previous or self._personal_count() >= MAX_SERVERS):
                raise ConfigError('服务器标识已存在或数量已达上限。', 409)
            if not create and previous is None:
                raise ConfigError('未找到此 MCP 服务器。', 404)
            if previous and 'transport' in fields and fields['transport'] != previous['transport']:
                raise ConfigError('已有服务器的连接方式不能修改。')
            config = _validate(server_id, {**(previous or {'enabled': False}), **fields})
            next_configs = {**self.configs, server_id: config}
            self._save(next_configs)
            self.configs = next_configs
            existing = self.connections.pop(server_id, None)
            self.results.pop(server_id, None)
        self._close(existing)
        return self._public(server_id, config)

    def import_configs(self, packet):
        if ('servers' in packet) == ('mcpServers' in packet):
            raise ConfigError('MCP JSON 须包含 servers 或 mcpServers 对象。')
        entries = packet.get('servers', packet.get('mcpServers'))
        if not isinstance(entries, dict) or not entries or len(entries) > MAX_SERVERS:
            raise ConfigError(f'MCP JSON 须包含 1 至 {MAX_SERVERS} 项连接。')
        imported = {}
        for server_id, fields in entries.items():
            if not isinstance(fields, dict):
                raise ConfigError('连接配置须为对象。')
            fields = dict(fields, enabled=False)
            self._assert_editable(server_id, fields.get('name'))
            if 'transport' not in fields and 'type' in fields:
                fields['transport'] = fields['type']
            imported[server_id] = _validate(server_id, fields)
        with self.lock:
            if self.closed or self.error:
                raise ConfigError(self.error or 'MCP 服务正在关闭。', 503)
            if self._personal_count() + len(imported) > MAX_SERVERS or self.configs.keys() & imported.keys():
                raise ConfigError('服务器标识已存在或数量已达上限，未导入任何连接。', 409)
            next_configs = {**self.configs, **imported}
            self._save(next_configs)
            self.configs = next_configs
            return {'servers': [self._public(server_id, config) for server_id, config in imported.items()]}

    def remove(self, server_id):
        with self.lock:
            self._assert_editable(server_id)
            if self.closed or self.error:
                raise ConfigError(self.error or 'MCP 服务正在关闭。', 503)
            if server_id not in self.configs:
                raise ConfigError('未找到此 MCP 服务器。', 404)
            next_configs = {key: config for key, config in self.configs.items() if key != server_id}
            self._save(next_configs)
            self.configs = next_configs
            existing = self.connections.pop(server_id, None)
            self.results.pop(server_id, None)
        self._close(existing)

    def _make_connection(self, server_id, config):
        if config['transport'] == 'http':
            return HttpMcpServer(server_id, config['url'], config['headers'], config['timeout'], config['protocol_version'])
        return McpServer(server_id, config['command'], config['args'], config['env'], config['timeout'], cwd=ROOT)

    def connect(self, server_id, *, test=False, wait=None):
        with self.lock:
            lock = self.connection_locks.setdefault(server_id, threading.Lock())
        if not lock.acquire(timeout=wait if wait is not None else 65):
            return
        try:
            self._connect(server_id, test=test)
        finally:
            lock.release()

    def _connect(self, server_id, *, test):
        with self.lock:
            config = self.configs.get(server_id)
            if not config or self.closed or (not test and not config['enabled']):
                return
            if self.desktop_builtin and server_id == DESKTOP_MCP_ID and not config['command']:
                return
            existing = self.connections.get(server_id)
            if existing and not test:
                return
            if not test and time.monotonic() - self.results.get(server_id, {}).get('failed_at', 0) < 30:
                return
            existing = self.connections.pop(server_id, None)
            server = self._make_connection(server_id, config)
            self.pending.add(server)
        self._close(existing)
        keep = False
        try:
            tools = []
            for item in server.start().list_tools():
                schema = item.get('inputSchema')
                if not isinstance(schema, dict) or schema.get('type') != 'object':
                    continue
                if len(json.dumps(schema, ensure_ascii=False).encode()) > 24000:
                    continue
                description = item.get('description')
                tools.append({'name': item['name'], 'description': description[:900] if isinstance(description, str) else '',
                              'inputSchema': schema})
            result = {'status': 'ready', 'tools': tools, 'error': None}
        except Exception as exc:
            error = str(exc) if isinstance(exc, McpError) else 'MCP 连接失败，请检查服务器配置。'
            result = {'status': 'error', 'tools': [], 'error': error, 'failed_at': time.monotonic()}
        finally:
            with self.lock:
                self.pending.discard(server)
                if not self.closed and self.configs.get(server_id) is config:
                    self.results[server_id] = result
                    keep = config['enabled'] and result['status'] == 'ready'
                    if keep:
                        self.connections[server_id] = server
            if not keep:
                self._close(server)

    def test(self, server_id):
        if server_id in self.data_builtins:
            data = self.data_inventory() if self.data_inventory else self.data_builtins
            return deepcopy(data[server_id])
        with self.lock:
            if server_id not in self.configs:
                raise ConfigError('未找到此 MCP 服务器。', 404)
        self.connect(server_id, test=True)
        with self.lock:
            if server_id not in self.configs:
                raise ConfigError('未找到此 MCP 服务器。', 404)
            return self._public(server_id, self.configs[server_id], tested=True)

    @staticmethod
    def _tool_name(server_id, name):
        value = f'mcp__{server_id}__{name}'
        if MODEL_NAME.fullmatch(value):
            return value
        digest = hashlib.sha256(value.encode()).hexdigest()[:24]
        return f'mcp__{server_id[:28]}__{digest}'

    def _active_tools(self, server_ids=None):
        for server_id, server in self.connections.items():
            if server_ids is not None and server_id not in server_ids:
                continue
            if not self.configs[server_id]['enabled']:
                continue
            for tool in self.results.get(server_id, {}).get('tools', []):
                policy = self.configs[server_id]['tool_permissions'].get(tool['name'], 'confirm')
                yield self._tool_name(server_id, tool['name']), server, tool, policy

    def tool_policy(self, name):
        with self.lock:
            return next((policy for key, _, _, policy in self._active_tools() if key == name), 'confirm')

    def specs(self, *, server_ids=None):
        with self.lock:
            pending = [server_id for server_id, config in self.configs.items()
                       if config['enabled'] and server_id not in self.connections
                       and (server_id != DESKTOP_MCP_ID or not self.desktop_builtin or config['command'])
                       and (server_ids is None or server_id in server_ids)]
        if pending:
            pool = ThreadPoolExecutor(max_workers=min(4, len(pending)))
            try:
                futures = [pool.submit(self.connect, server_id, wait=3) for server_id in pending]
                # Discovery may finish in the background. A slow connector
                # should not consume the whole assistant turn startup budget.
                from concurrent.futures import wait
                wait(futures, timeout=4)
            finally:
                pool.shutdown(wait=False, cancel_futures=True)
        with self.lock:
            return [{'type': 'function', 'function': {'name': key,
                    'description': tool['description'] or f'{server.name} 提供的工具',
                    'parameters': tool['inputSchema']}} for key, server, tool, _ in self._active_tools(server_ids)]

    def call(self, name, arguments, *, permission_mode='read_only', confirmed=False, server_ids=None):
        with self.lock:
            target = next(((server, tool['name'], policy) for key, server, tool, policy in self._active_tools(server_ids)
                           if key == name), None)
            if target and (not allowed(permission_mode, name, target[2]) or (target[2] == 'confirm' and not confirmed)):
                return {'ok': False, 'content': '此 MCP 工具需要当前权限下的单次确认。', 'summary': '待确认'}
        if target is None:
            return {'ok': False, 'content': 'MCP 工具不存在、未连接或已停用。', 'summary': 'MCP 工具不可用'}
        server, tool_name, _ = target
        try:
            result = server.call_tool(tool_name, arguments)
        except Exception:
            return {'ok': False, 'content': 'MCP 工具调用失败，请检查连接。', 'summary': 'MCP 调用失败'}
        parts = [str(item.get('text', '')) if item.get('type') == 'text' else f"[{item.get('type')}]"
                 for item in result.get('content', []) if isinstance(item, dict)]
        if not parts and 'structuredContent' in result:
            parts.append(json.dumps(result['structuredContent'], ensure_ascii=False))
        return {'ok': not result.get('isError'), 'content': ('\n'.join(parts) or '(无文本返回)')[:9000],
                'summary': f'{server.name} · {tool_name}'}

    def close(self):
        with self.lock:
            self.closed = True
            servers = [*self.connections.values(), *self.pending]
            self.connections.clear()
            self.pending.clear()
        for server in servers:
            self._close(server)

    @staticmethod
    def _close(server):
        if server is not None:
            try:
                server.close()
            except (OSError, McpError):
                pass
