"""Conversation tool permissions, with explicit local MCP read classifications."""
from __future__ import annotations

READ_ONLY = 'read_only'
WORKSPACE_WRITE = 'workspace_write'
WORKSPACE_DIRECT = 'workspace_direct'
FULL = 'full'
POWERSHELL = 'run_powershell'

MODES = [
    dict(id=READ_ONLY, label='Read Only', hint='只读：不能写入或执行'),
    dict(id=WORKSPACE_WRITE, label='修改前确认', hint='项目修改先生成候选，经审阅后应用'),
    dict(id=WORKSPACE_DIRECT, label='工作区直接修改', hint='允许兼容 Agent 直接修改当前工作区，工作区外操作仍需授权'),
    dict(id=FULL, label='Full access', hint='完全权限'),
]

READ_TOOLS = {'list_database_schema', 'query_database', 'fetch_url', 'list_files', 'read_file',
              'list_project_files', 'search_project_files', 'read_project_file', 'project_git_diff',
              'get_deep_analysis_task'}
WRITE_TOOLS = {'create_deep_analysis', 'create_deep_analysis_from_query', 'write_file', 'create_pptx',
               'create_docx', 'create_xlsx'}


def normalize(mode):
    return mode if mode in (READ_ONLY, WORKSPACE_WRITE, WORKSPACE_DIRECT, FULL) else READ_ONLY


def category(name, mcp_policy=None):
    if name == POWERSHELL:
        return 'full'
    if name in READ_TOOLS:
        return 'read'
    if name in WRITE_TOOLS:
        return 'write'
    if name.startswith('mcp__'):
        return 'read' if mcp_policy == 'read' else 'confirm'
    return 'write'


def allowed(mode, name, mcp_policy=None):
    mode = normalize(mode)
    needs = category(name, mcp_policy)
    if mode == FULL:
        return True
    if mode == READ_ONLY:
        return needs == 'read'
    return needs in ('read', 'write', 'confirm')


def blocked_reason(mode, name):
    mode = normalize(mode)
    if name == POWERSHELL:
        return 'PowerShell 需要当前聊天开启完全访问。'
    if mode == READ_ONLY:
        return f'当前为只读模式。使用 {name} 需要修改权限。'
    return f'使用 {name} 需要该工具的授权。'
