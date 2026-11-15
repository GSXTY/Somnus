"""Tool implementations for the respiratory plugin.

Each handler receives (arguments: dict, context: dict) and returns a dict with
``ok``, ``content`` and ``summary`` — the same shape the chat loop expects.
"""
from __future__ import annotations

import json


def _fail(message, summary='执行失败'):
    return dict(ok=False, content=message, summary=summary)


def query_database(args, context):
    try:
        from agent_core.sql_agent import ask
        result = ask(str(args.get('question') or ''))
    except Exception as exc:
        return _fail(f'工具执行失败：{exc}')
    payload = dict(sql=result['sql'], columns=result['columns'], rows=result['rows'][:8],
                   row_count=len(result['rows']), truncated=result['truncated'],
                   note='仅返回前 8 行；需要更多请让用户到数据查询页查看完整结果')
    return dict(ok=True, content=json.dumps(payload, ensure_ascii=False)[:9000],
                summary=f"{len(result['rows'])} 行 · {result['elapsed_ms']} ms")


def list_database_schema(args, context):
    try:
        from agent_core.sql_access import SqlSettings, describe_for_prompt, schema
        tables = schema(SqlSettings.from_env())
    except Exception as exc:
        return _fail(f'工具执行失败：{exc}')
    return dict(ok=True, content=describe_for_prompt(tables)[:6000], summary=f'{len(tables)} 张表')


def create_deep_analysis(args, context):
    from ai_assistant.deep_tools import create_task
    return create_task(context or {}, str(args.get('question') or ''))


def create_deep_analysis_from_query(args, context):
    from ai_assistant.deep_tools import create_from_query
    return create_from_query(context or {}, str(args.get('db_question') or ''),
                             str(args.get('analysis_question') or ''))


HANDLERS = {
    'query_database': query_database,
    'list_database_schema': list_database_schema,
    'create_deep_analysis': create_deep_analysis,
    'create_deep_analysis_from_query': create_deep_analysis_from_query,
}
