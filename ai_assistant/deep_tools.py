"""Bridge from the chat assistant to the DeepAnalyze trial service.

The chat only knows a file id that the browser uploaded; the registry keeps the
service instance injected by the FastAPI host so no second database is opened.
"""
from __future__ import annotations

import json
import os

_registry = {'service': None}


def register(service):
    _registry['service'] = service


def create_task(context, question):
    service = _registry['service']
    if service is None:
        return dict(ok=False, content='深度分析服务未启用。', summary='不可用')
    file_id = (context or {}).get('analysis_file_id')
    owner = (context or {}).get('owner')
    if not file_id:
        return dict(ok=False, content='添加 CSV 后即可创建深度分析任务。', summary='缺少 CSV')
    if not question.strip():
        return dict(ok=False, content='缺少分析问题。', summary='缺少问题')
    task = service.create_task(owner, file_id, question.strip()[:2000])
    payload = dict(task_id=task['id'], status=task['status'], page='/#deep-analysis')
    return dict(ok=True, content=json.dumps(payload, ensure_ascii=False),
                summary=f"任务已创建 · {task['status']}")

def create_from_query(context, db_question, analysis_question):
    """Run a read-only SQL question, turn the rows into a CSV, then start a deep analysis task."""
    service = _registry['service']
    if service is None:
        return dict(ok=False, content='深度分析服务未启用。', summary='不可用')
    owner = (context or {}).get('owner')
    db_question = (db_question or '').strip()
    analysis_question = (analysis_question or '').strip() or db_question
    if not db_question:
        return dict(ok=False, content='指定要查询的数据范围或指标。', summary='缺少查询条件')
    try:
        from dataclasses import replace
        from agent_core.sql_access import SqlSettings
        from agent_core.sql_agent import ask
        limit = int(os.getenv('ANALYTICS_ANALYSIS_MAX_ROWS', '20000'))
        result = ask(db_question, replace(SqlSettings.from_env(), max_rows=limit))
    except Exception as exc:
        return dict(ok=False, content=f'查询失败：{exc}', summary='查询失败')
    rows = result.get('rows') or []
    columns = result.get('columns') or []
    if not rows or not columns:
        return dict(ok=False, content='查询返回 0 行。调整数据范围后可重新分析。', summary='没有数据')
    import csv, io, time
    buffer = io.StringIO(newline='')
    writer = csv.writer(buffer, lineterminator='\n')
    writer.writerow(columns)
    writer.writerows(rows)
    raw = buffer.getvalue().encode('utf-8')
    name = f'db-query-{time.strftime("%Y%m%d-%H%M%S")}.csv'
    try:
        record = service.upload(owner, name, raw)
        task = service.create_task(owner, record['id'], analysis_question[:2000])
    except Exception as exc:
        return dict(ok=False, content=f'创建分析任务失败：{exc}', summary='任务创建失败')
    payload = dict(task_id=task['id'], status=task['status'], rows=len(rows), limit=limit, columns=columns[:10], page='/#deep-analysis')
    return dict(ok=True, content=json.dumps(payload, ensure_ascii=False),
                summary=f"已用 {len(rows)} 行查询结果创建任务 · {task['status']}")
