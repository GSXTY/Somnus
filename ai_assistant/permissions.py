"""Conversation tool permissions, with explicit local MCP read classifications."""
from __future__ import annotations

READ_ONLY = 'read_only'
WORKSPACE_WRITE = 'workspace_write'
FULL = 'full'

MODES = [
    dict(id=READ_ONLY, label='Read Only', hint='只读：不能写入或执行'),
    dict(id=WORKSPACE_WRITE, label='Workspace Write', hint='只写工作空间目录'),
    dict(id=FULL, label='Full access', hint='完全权限'),
]

READ_TOOLS = {'list_database_schema', 'query_database', 'fetch_url', 'list_files', 'read_file',
              'list_project_files', 'search_project_files', 'read_project_file', 'project_git_diff',
              'get_deep_analysis_task'}
WRITE_TOOLS = {'create_deep_analysis', 'create_deep_analysis_from_query', 'write_file', 'create_pptx',
               'create_docx', 'create_xlsx'}


def normalize(mode):
    return mode if mode in (READ_ONLY, WORKSPACE_WRITE, FULL) else READ_ONLY


def category(name, mcp_policy=None):
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
    if mode == READ_ONLY:
        return f'当前为只读模式。使用 {name} 需要修改权限。'
    return f'使用 {name} 需要该工具的授权。'
