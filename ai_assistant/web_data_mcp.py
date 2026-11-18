"""Read-only data tools for a local, desktop-owned DSH Web process."""
import hmac
import secrets
import sqlite3
import threading

from agent_core.sql_access import SqlSettings
from agent_core.sql_agent import proposal_configured

from . import external_tools


MAX_BODY_BYTES = 128 * 1024
VERSIONS = ('2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05')
TOOL_NAMES = (external_tools.SCHEMA, external_tools.QUERY)
DATABASE_MCP = 'database'
TEXT_TO_SQL_MCP = 'text-to-sql'
DATA_MCP_NAMES = (DATABASE_MCP, TEXT_TO_SQL_MCP)
EXECUTE_SQL = 'execute_read_only_sql'
PROPOSE_SQL = 'propose_sql'


def _sql_only_tools():
    def make(name, field, description, field_description):
        schema = {'type': 'object', 'properties': {field: {'type': 'string', 'description': field_description}},
                  'required': [field], 'additionalProperties': False}
        return {'name': name, 'description': description, 'inputSchema': schema}

    return {
        DATABASE_MCP: make(EXECUTE_SQL, 'sql', '执行数据库授权范围内的只读 SQL，返回有限行数。',
                           '由调用方提供的单条 SELECT 或 WITH 查询'),
        TEXT_TO_SQL_MCP: make(PROPOSE_SQL, 'question', '将问题转为符合数据库策略的 SQL，返回语句供核对。',
                              '需要转换为 SQL 的业务问题'),
    }


SQL_ONLY_TOOLS = _sql_only_tools()
NAMED_TOOLS = {
    DATABASE_MCP: (next(tool for tool in external_tools.SECURE_TOOLS if tool['name'] == external_tools.SCHEMA),
                   SQL_ONLY_TOOLS[DATABASE_MCP]),
    TEXT_TO_SQL_MCP: (SQL_ONLY_TOOLS[TEXT_TO_SQL_MCP],),
}


def data_available(remote):
    return any(tool['name'] == external_tools.SCHEMA
               for tool in external_tools.configured_data_tools(remote, None, attached=False))


def available_data_mcp_names(remote):
    if getattr(remote, 'mode', 'local') == 'remote':
        database, proposal = remote.sql_mcp_capabilities()
    elif data_available(remote):
        settings = SqlSettings.from_env()
        database = (settings.driver == 'mysql' or
                    (settings.driver == 'sqlite' and settings.sqlite_path.is_file()))
        proposal = database and proposal_configured()
    else:
        database = proposal = False
    return tuple(server_id for server_id, ready in zip(DATA_MCP_NAMES, (database, proposal)) if ready)


def data_mcp_inventory(remote, *, probe=True):
    available = available_data_mcp_names(remote) if probe else ()
    return {
        server_id: dict(id=server_id, name=server_id, builtin=True, runtime_managed=True, transport='http',
                        enabled=True, status='idle' if server_id in available else 'unavailable', timeout=60,
                        env_names=[], header_names=[], tools=[], tool_permissions={},
                        error=None if server_id in available else ('数据网关未启用 SQL 生成或模型未配置。'
                              if server_id == TEXT_TO_SQL_MCP else '授权数据连接未配置或不可用。'))
        for server_id in DATA_MCP_NAMES
    }


class WebDataMcp:
    def __init__(self, remote, cancel, server_id=None, running=None):
        self.remote = remote
        self.cancel = cancel
        self.server_id = server_id
        self.token = secrets.token_hex(32)
        self.running = running if running is not None else threading.BoundedSemaphore(4)

    def tools(self):
        if self.server_id is not None:
            return list(NAMED_TOOLS[self.server_id])
        return [tool for tool in external_tools.configured_data_tools(self.remote, None, attached=False)
                if tool['name'] in TOOL_NAMES]

    def allows(self, token):
        return not self.cancel.is_set() and hmac.compare_digest(self.token, token)

    def dispatch(self, body):
        ident, method = body.get('id'), body.get('method')
        packet = {'jsonrpc': '2.0', 'id': ident if type(ident) in (int, str) else None}

        def error(code, message):
            return {**packet, 'error': {'code': code, 'message': message}}

        if body.get('jsonrpc') != '2.0' or not isinstance(method, str):
            return error(-32600, 'Invalid Request')
        if 'id' not in body and method.startswith('notifications/'):
            return None
        if type(ident) not in (int, str):
            return error(-32600, 'Invalid Request')
        params = body.get('params', {})
        if not isinstance(params, dict):
            return error(-32602, 'Invalid params')
        if method == 'initialize':
            version = params.get('protocolVersion')
            result = {'protocolVersion': version if version in VERSIONS else VERSIONS[0],
                      'capabilities': {'tools': {}}, 'serverInfo': {'name': self.server_id or 'vv_man', 'version': '1.0.0'}}
        elif method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': self.tools()}
        elif method == 'tools/call':
            name, args = params.get('name'), params.get('arguments', {})
            if not isinstance(args, dict) or not isinstance(name, str):
                return error(-32602, 'Invalid params')
            result = self.call(name, args)
        else:
            return error(-32601, 'Method not found')
        return {**packet, 'result': result}

    def call(self, name, args):
        if name not in {tool['name'] for tool in self.tools()} or self.cancel.is_set():
            result = external_tools.failure('此数据工具当前未获授权。')
        elif self.server_id is not None and not data_available(self.remote):
            result = external_tools.failure('数据服务未配置或不可用。')
        elif not self.running.acquire(blocking=False):
            result = external_tools.failure('当前数据查询已达到并发上限。请稍后重试。')
        else:
            try:
                if name == PROPOSE_SQL:
                    result = external_tools.propose_data_sql(self.remote, args)
                elif name == EXECUTE_SQL and set(args) != {'sql'}:
                    result = external_tools.failure('请仅提供待执行的只读 SQL。')
                else:
                    result = external_tools.call_data_tool(
                        external_tools.QUERY if name == EXECUTE_SQL else name, args, remote=self.remote,
                        local_deep=None, attached=None, stores=(), known_tasks=(), on_task=None)
            except sqlite3.Error:
                result = external_tools.failure('暂时无法访问授权数据库，请检查数据连接后重试。')
            finally:
                self.running.release()
            if self.cancel.is_set():
                result = external_tools.failure('此 DSH 数据连接已关闭。')
        return {key: result[key] for key in ('content', 'isError')}
