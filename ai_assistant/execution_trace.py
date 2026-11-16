"""Persist a scoped execution trace without recording inputs or results."""

import json
import re
import time
import uuid

from . import token_usage

LIMIT = 300
TOOL_KINDS = {
    'read': '读取文件', 'edit': '编辑文件', 'delete': '删除文件', 'move': '移动文件',
    'search': '搜索', 'execute': '执行命令', 'think': '分析', 'fetch': '获取内容',
    'switch_mode': '切换模式',
}
APPROVAL_KINDS = {'mcp': 'MCP 工具确认', 'edit': '文件编辑确认', 'test': '项目测试确认'}
TOOL_FAILURES = {
    '参数错误': '工具参数无效。',
    '权限不足': '当前会话权限不足。',
    '工具不可用': '当前会话未启用此工具。',
    '缺少项目目录': '当前项目没有已授权的目录。',
    '项目文件操作失败': '项目文件操作失败。请检查文件是否存在、权限或版本。',
    'MCP 工具不可用': '当前会话未启用 MCP 工具。',
    '演示模式已限制': '对外演示模式禁用了此工具。',
    '请在本机桌面版确认': '此操作需要从本机桌面版确认。',
    '抓取失败': '无法抓取网页。请检查地址和网络。',
    '已达到委派上限': '本轮已达到委派次数上限。',
    '权限不可用': '当前权限模式无法执行此操作。',
    '项目不可用': '当前项目目录不可用。',
    '请求已取消': '项目工具请求已取消。',
    '请求已结束': '项目工具请求已取消或超时。',
}


def clean_failure_reason(value):
    if (not isinstance(value, str) or not 0 < len(value) <= 180
            or any(ord(char) < 32 or 0x202a <= ord(char) <= 0x202e
                   or 0x2066 <= ord(char) <= 0x2069 or 0xd800 <= ord(char) <= 0xdfff for char in value)):
        return None
    return value.strip() or None


def tool_failure_reason(result):
    # Registry and model error content can contain arguments, credentials or file paths.
    summary = result.get('summary')
    return (TOOL_FAILURES.get(summary) if isinstance(summary, str) else None) or '工具未返回可显示的失败原因。'


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS execution_trace(
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
        at REAL NOT NULL, duration_ms INTEGER, failure_reason TEXT)''')
    if 'failure_reason' not in {row[1] for row in db.execute('PRAGMA table_info(execution_trace)')}:
        db.execute('ALTER TABLE execution_trace ADD COLUMN failure_reason TEXT')
    db.execute('''CREATE INDEX IF NOT EXISTS execution_trace_conversation
                  ON execution_trace(conversation_id, at)''')
    db.execute("UPDATE execution_trace SET status='interrupted' WHERE status='pending'")


def start(db, cid, turn_id, kind, title, *, event_id=None):
    event_id = event_id or uuid.uuid4().hex
    db.execute('''INSERT INTO execution_trace(id,conversation_id,turn_id,kind,title,status,at)
                  VALUES(?,?,?,?,?,'pending',?)''', (event_id, cid, turn_id, kind, title, time.time()))
    return event_id


def finish(db, event_id, status, *, failure_reason=None):
    reason = clean_failure_reason(failure_reason) if status == 'failed' else None
    db.execute('''UPDATE execution_trace SET status=?, failure_reason=?,
                  duration_ms=MAX(0,ROUND((?-at)*1000))
                  WHERE id=? AND status='pending' ''', (status, reason, time.time(), event_id))


def finish_turn(db, cid, turn_id, status):
    db.execute('''UPDATE execution_trace SET status=?,
                  duration_ms=MAX(0,ROUND((?-at)*1000))
                  WHERE conversation_id=? AND turn_id=? AND status='pending' ''',
               (status, time.time(), cid, turn_id))


def tool_title(name, advertised):
    return name if advertised and re.fullmatch(r'[a-zA-Z0-9_-]{1,120}', name or '') else '会话工具'


def approvals(items):
    if not isinstance(items, list):
        return []
    result = {}
    for item in items[:40]:
        if not isinstance(item, dict):
            continue
        key, kind, status, at = (item.get(field) for field in ('id', 'kind', 'status', 'at'))
        if (isinstance(key, str) and re.fullmatch(r'[a-zA-Z0-9_.:-]{1,120}', key)
                and isinstance(kind, str) and kind in APPROVAL_KINDS
                and isinstance(status, str) and status in {'approved', 'rejected', 'closed', 'pending'}
                and type(at) in (float, int) and 0 <= at <= 4102444800):
            result[key] = dict(id=key, kind=kind, status=status, at=at)
    return list(result.values())


def _reply_events(row):
    try:
        meta = json.loads(row['reply_meta'])
    except (TypeError, ValueError):
        return
    if not isinstance(meta, dict):
        return
    turn_id, at = row['id'], row['created_at']
    duration = meta.get('elapsed_ms')
    valid_duration = type(duration) is int and 0 <= duration <= 86400000
    common = dict(turn_id=turn_id, at=(at or 0) + (duration / 1000 if valid_duration else 0))
    usage = meta.get('usage')
    if isinstance(usage, dict):
        counts = {field: usage.get(field) for field in ('input_tokens', 'output_tokens')}
        if all(token_usage.valid_count(count) for count in counts.values()):
            cached = usage.get('cached_input_tokens')
            if token_usage.valid_cached_count(cached, counts['input_tokens']):
                counts['cached_input_tokens'] = cached
            counts['partial'] = usage.get('partial') is True
            event = dict(common, id=f'{turn_id}:usage', kind='usage', title='Token 用量',
                         status='partial' if counts['partial'] else 'completed', usage=counts)
            if valid_duration:
                event['duration_ms'] = duration
            yield event
    execution = meta.get('execution')
    if not isinstance(execution, dict):
        return
    steps = execution.get('steps')
    if isinstance(steps, list):
        for index, step in enumerate(steps[:40]):
            if not isinstance(step, dict):
                continue
            kind, status = step.get('kind'), step.get('status')
            if status not in ('pending', 'in_progress', 'completed', 'failed'):
                continue
            event = dict(common, id=f'{turn_id}:step:{index}', kind='tool',
                         title=TOOL_KINDS.get(kind, '外接 Agent 工具') if isinstance(kind, str) else '外接 Agent 工具',
                         status='interrupted' if status in ('pending', 'in_progress') else status)
            duration = step.get('duration_ms')
            if type(duration) is int and 0 <= duration <= 86400000:
                event['duration_ms'] = duration
            if status == 'failed':
                reason = clean_failure_reason(step.get('failure_reason'))
                if reason:
                    event['failure_reason'] = reason
            yield event
    for index, approval in enumerate(approvals(execution.get('approvals'))):
        yield dict(id=f'{turn_id}:approval:{index}', kind='approval', turn_id=turn_id,
                   title=APPROVAL_KINDS[approval['kind']], at=approval['at'], status=approval['status'])


def conversation(db, cid):
    events = [dict(row) for row in db.execute('''SELECT id,turn_id,kind,title,status,at,duration_ms,failure_reason
        FROM execution_trace WHERE conversation_id=? ORDER BY at DESC, id DESC LIMIT ?''', (cid, LIMIT + 1))]
    rows = db.execute('''SELECT id,created_at,reply_meta FROM messages
                         WHERE conversation_id=? AND role='assistant' AND reply_meta IS NOT NULL
                         ORDER BY created_at DESC, id DESC LIMIT ?''', (cid, LIMIT + 1)).fetchall()
    for row in rows:
        events.extend(_reply_events(row))
    files = db.execute('''SELECT id,operation,status,created_at,decided_at FROM project_file_proposals
                          WHERE conversation_id=? ORDER BY COALESCE(decided_at,created_at) DESC, id DESC LIMIT ?''',
                       (cid, LIMIT + 1)).fetchall()
    for row in files:
        events.append(dict(id=f"file:{row['id']}", kind='file', status=row['status'],
                           title='新建项目文件' if row['operation'] == 'create' else '修改项目文件',
                           at=row['decided_at'] if row['decided_at'] is not None else row['created_at']))
    events.sort(key=lambda event: (event['at'] or 0, event['id']))
    return dict(events=[{key: value for key, value in event.items() if value is not None}
                        for event in events[-LIMIT:]], truncated=len(events) > LIMIT or len(rows) > LIMIT)
