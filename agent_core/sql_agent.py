"""Turn a question into guarded SQL with the configured chat model.

The model only proposes SQL. `agent_core.sql_access.guard` decides whether it may
run, and execution stays read-only with a row cap and an audit record.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.request import Request, urlopen

from agent_core.sql_access import SqlAccessError, SqlSettings, describe_for_prompt, run, schema

SYSTEM = '''You translate a question into ONE read-only SQL query for the schema given below.
Rules:
- Return only SQL, optionally inside a single ```sql fence. No prose, no explanation.
- Use SELECT or WITH only. Never write, lock, or change anything.
- Prefer explicit columns; aggregate when the question asks for totals or trends.
- Use the exact table and column names shown; do not invent columns.
- Keep the result small: aggregate instead of returning raw detail rows.
- Never invent an enum/code value (型号、状态、事件类型). If the notes do not give the code, do not filter on it; return that column instead so the reader can confirm.'''


def _config():
    base = os.getenv('AI_ASSISTANT_BASE_URL', '').strip().rstrip('/')
    model = os.getenv('AI_ASSISTANT_MODEL', '').strip()
    key = os.getenv('AI_ASSISTANT_API_KEY', '').strip()
    timeout = float(os.getenv('ANALYTICS_SQL_MODEL_TIMEOUT', '60'))
    if not (base and model and key):
        raise SqlAccessError('尚未配置分析模型（AI_ASSISTANT_BASE_URL / MODEL / API_KEY）。')
    endpoint = base if base.endswith('/chat/completions') else base + '/chat/completions'
    return endpoint, model, key, timeout


def proposal_configured():
    try:
        _config()
        return True
    except (SqlAccessError, ValueError):
        return False


def business_context() -> str:
    """Optional hand-written notes: table meaning, coded fields, definitions."""
    path = os.getenv('ANALYTICS_SQL_CONTEXT', '').strip()
    if not path:
        default = Path(__file__).resolve().parents[1] / 'docs' / 'SQL_SEMANTICS.md'
        path = str(default) if default.is_file() else ''
    if not path or not Path(path).is_file():
        return ''
    try:
        text = Path(path).read_text(encoding='utf-8').strip()
    except OSError:
        return ''
    return text[:14000]


def extract_sql(text: str) -> str:
    fenced = re.search(r'```(?:sql)?\s*(.+?)```', text or '', re.S | re.I)
    candidate = fenced.group(1) if fenced else (text or '')
    candidate = candidate.strip()
    if not candidate:
        raise SqlAccessError('模型没有返回 SQL。')
    return candidate


def propose_sql(question: str, tables: list[dict]) -> str:
    endpoint, model, key, timeout = _config()
    notes = business_context()
    prompt = f'Schema:\n{describe_for_prompt(tables)}\n'
    if notes:
        prompt += f'\nBusiness notes (authoritative, follow them over guesses):\n{notes}\n'
    prompt += f'\nQuestion:\n{question.strip()[:2000]}'
    payload = dict(model=model, temperature=0, stream=False,
                   messages=[dict(role='system', content=SYSTEM), dict(role='user', content=prompt)])
    request = Request(endpoint, json.dumps(payload).encode(), {'Content-Type': 'application/json',
                                                              'Authorization': 'Bearer ' + key})
    try:
        with urlopen(request, timeout=timeout) as response:
            packet = json.loads(response.read().decode('utf-8'))
    except Exception as exc:
        raise SqlAccessError(f'模型调用失败：{exc}') from None
    choices = packet.get('choices') or []
    if not choices:
        raise SqlAccessError('模型未返回内容。')
    return extract_sql((choices[0].get('message') or {}).get('content') or '')


def ask(question: str, settings: SqlSettings | None = None) -> dict:
    """Question → SQL → guarded execution, returning SQL, rows and the schema used."""
    settings = settings or SqlSettings.from_env()
    question = (question or '').strip()
    if not question:
        raise SqlAccessError('请输入要查询的问题。')
    from agent_core import sql_cache
    cached = sql_cache.get(question, settings.description)
    if cached:
        return dict(cached, cached=True)

    tables = schema(settings)
    if not tables:
        raise SqlAccessError('数据源里没有可查询的表。')
    sql = propose_sql(question, tables)
    result = run(sql, settings)
    payload = dict(question=question, database=settings.description, tables=[t['table'] for t in tables], **result)
    sql_cache.put(question, settings.description, payload)
    return dict(payload, cached=False)
