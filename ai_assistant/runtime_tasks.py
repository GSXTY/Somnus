"""Durable, scoped runtime task state. Connection presence is a separate concern."""
import json
import hashlib
import hmac
import re
import time

ACTIVE = frozenset(('queued', 'connecting', 'running', 'waiting_approval', 'cancelling'))
LIVE = ACTIVE | {'disconnected'}
TERMINAL = frozenset(('completed', 'failed', 'cancelled', 'interrupted'))
PUBLISHABLE = frozenset(('connecting', 'running', 'waiting_approval', 'cancelling', 'disconnected'))
LEASE_SECONDS = 20
EVENT_LIMIT = 1000
EVENT_RETENTION = 20000
TASK_LIMIT = 1000
STAGES = frozenset(('preparing', 'connecting', 'working', 'thinking', 'responding'))


class TaskError(ValueError):
    def __init__(self, code, message, status=409, task=None):
        super().__init__(message)
        self.code, self.message, self.status, self.task = code, message, status, task


def safe_title(value):
    if not isinstance(value, str):
        return None
    value = ' '.join(value.split())
    value = re.sub(r'https?://\S+', '[链接]', value)
    value = re.sub(r'(?i)Bearer\s+[^\s,;]+|\bsk-[\w-]{8,}', '[已隐藏]', value)
    value = re.sub(r'''(?i)(["']?(?:api[_-]?key|token|password|secret|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)''', r'\1[已隐藏]', value)
    value = re.sub(r'[A-Za-z0-9_+/=-]{64,}', '[长内容已省略]', value)
    return value[:160] or None


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def public(row):
    return dict(id=row['id'], task_id=row['id'], message_id=row['id'].split(':', 1)[0],
                conversation_id=row['conversation_id'], agent_id=row['agent_id'], agent_name=row['agent_name'],
                runtime=row['runtime'], parent_task_id=row['parent_task_id'], status=row['status'],
                revision=row['revision'], created_at=row['created_at'], updated_at=row['updated_at'],
                started_at=row['started_at'], ended_at=row['ended_at'],
                progress=json.loads(row['progress']) if row['progress'] else None,
                error=json.loads(row['error']) if row['error'] else None,
                recoverable=False, can_cancel=False, title=row['title'], user_message_id=row['user_message_id'], received_late=bool(row['received_late']), duration_ms=row['duration_ms'])


def _record(db, task_id):
    row = db.execute('SELECT * FROM runtime_tasks WHERE id=?', (task_id,)).fetchone()
    db.execute('INSERT INTO runtime_task_events(task_id,conversation_id,revision,task,at) VALUES(?,?,?,?,?)',
               (task_id, row['conversation_id'], row['revision'], _json(public(row)), time.time()))
    maximum = db.execute('SELECT MAX(cursor) FROM runtime_task_events').fetchone()[0]
    if maximum and maximum % 128 == 0:
        db.execute('DELETE FROM runtime_task_events WHERE cursor<=?', (maximum - EVENT_RETENTION,))


def initialize(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS runtime_tasks(
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL,
        runtime TEXT NOT NULL, parent_task_id TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL, started_at REAL, ended_at REAL,
        progress TEXT, error TEXT, owner_id TEXT, owner_sequence INTEGER NOT NULL DEFAULT 0, lease_until REAL);
        CREATE INDEX IF NOT EXISTS runtime_tasks_conversation ON runtime_tasks(conversation_id,created_at);
        CREATE TABLE IF NOT EXISTS runtime_task_events(
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        revision INTEGER NOT NULL, task TEXT NOT NULL, at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS runtime_task_events_scope ON runtime_task_events(conversation_id,cursor);''')
    columns = {item[1] for item in db.execute('PRAGMA table_info(runtime_tasks)')}
    for name in ('title', 'user_message_id'):
        if name not in columns:
            db.execute('ALTER TABLE runtime_tasks ADD COLUMN ' + name + ' TEXT')
    for name, kind in (('receipt_hash', 'TEXT'), ('receipt_epoch', 'TEXT'), ('received_late', 'INTEGER NOT NULL DEFAULT 0'), ('duration_ms', 'INTEGER')):
        if name not in columns:
            db.execute('ALTER TABLE runtime_tasks ADD COLUMN ' + name + ' ' + kind)
    # Historical replies are projected once; no content, arguments, credentials or results are copied.
    for message in db.execute('''SELECT m.id,m.conversation_id,m.reply_meta,m.transport,m.status,m.created_at
                                 FROM messages m LEFT JOIN runtime_tasks t ON t.id=m.id
                                 WHERE m.role='assistant' AND t.id IS NULL'''):
        try:
            metadata = json.loads(message['reply_meta'] or '{}')
        except (ValueError, TypeError):
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        runtime = message['transport'] if message['transport'] in ('acp', 'dsh-native') else 'python'
        status = {'complete': 'completed', 'cancelled': 'cancelled', 'error': 'failed'}.get(message['status'], 'interrupted')
        reserve(db, message['conversation_id'], message['id'],
                metadata.get('provider_id') or 'somnus',
                metadata.get('provider_name') if runtime == 'acp' else 'Somnus', runtime,
                created_at=message['created_at'], status=status, duration_ms=metadata.get('elapsed_ms'), historic=True)
        try:
            steps = (metadata.get('execution') or {}).get('steps', [])
            current = db.execute('SELECT * FROM runtime_tasks WHERE id=?', (message['id'],)).fetchone()
            children(db, current, [step for step in steps if isinstance(step, dict) and step.get('kind') == 'subagent'])
            if status in TERMINAL:
                for child in db.execute("SELECT id FROM runtime_tasks WHERE parent_task_id=? AND status IN ('queued','running')", (message['id'],)).fetchall():
                    transition(db, child['id'], 'interrupted')
        except (TaskError, TypeError, AttributeError):
            pass
    # Memory-only turn authorization is lost across backend restarts. Never replay execution.
    for row in db.execute("SELECT id FROM runtime_tasks WHERE status IN ('queued','connecting','running','waiting_approval','cancelling','disconnected')").fetchall():
        transition(db, row['id'], 'interrupted', error=dict(code='runtime_restarted', message='应用服务已重启，此任务已中断；不会自动重新执行。'))


def reserve(db, cid, task_id, agent_id, agent_name, runtime, *, created_at=None, status='queued', user_message_id=None, title=None, duration_ms=None, historic=False):
    now = time.time()
    terminal = status in TERMINAL
    agent_id = agent_id if isinstance(agent_id, str) and len(agent_id) <= 160 else 'somnus'
    agent_name = agent_name if isinstance(agent_name, str) else 'Agent'
    db.execute('''INSERT OR IGNORE INTO runtime_tasks(id,conversation_id,agent_id,agent_name,runtime,status,revision,
                  created_at,updated_at,ended_at) VALUES(?,?,?,?,?,?,1,?,?,?)''',
               (task_id, cid, agent_id, (agent_name or 'Agent')[:160], runtime, status, created_at or now, now, now if terminal else None))
    db.execute('UPDATE runtime_tasks SET title=?,user_message_id=? WHERE id=?', (title, user_message_id, task_id))
    if type(duration_ms) is int and 0 <= duration_ms <= 86400000:
        db.execute('UPDATE runtime_tasks SET duration_ms=? WHERE id=?', (duration_ms, task_id))
    if historic and terminal:
        source_time = created_at if type(created_at) in (int, float) and created_at > 0 else 0
        ended = source_time + duration_ms / 1000 if type(duration_ms) is int and source_time else None
        db.execute('UPDATE runtime_tasks SET created_at=?,updated_at=?,ended_at=? WHERE id=?', (source_time, ended or source_time, ended, task_id))
    _record(db, task_id)


def row(db, cid, task_id):
    value = db.execute('SELECT * FROM runtime_tasks WHERE id=? AND conversation_id=?', (task_id, cid)).fetchone()
    if value is None:
        raise TaskError('runtime_task_not_found', '任务不存在。', 404)
    return value


def transition(db, task_id, status, *, progress=None, error=None, now=None, duration_ms=None):
    previous = db.execute('SELECT * FROM runtime_tasks WHERE id=?', (task_id,)).fetchone()
    if previous is None or previous['status'] in TERMINAL:
        return
    now = now or time.time()
    previous_progress = previous['progress']
    rendered = _json(progress) if progress is not None else previous_progress
    problem = _json(error) if error else None
    if previous['status'] == status and previous_progress == rendered and previous['error'] == problem and (duration_ms is None or duration_ms == previous['duration_ms']):
        return
    started = previous['started_at'] or (now if status in ('running', 'waiting_approval') else None)
    db.execute('''UPDATE runtime_tasks SET status=?,revision=revision+1,updated_at=?,started_at=?,ended_at=?,
                  progress=?,error=? WHERE id=?''',
               (status, now, started, now if status in TERMINAL else None, rendered, problem, task_id))
    if duration_ms is not None:
        db.execute('UPDATE runtime_tasks SET duration_ms=? WHERE id=?', (duration_ms, task_id))
    _record(db, task_id)


def message_finished(db, cid, message):
    status = {'complete': 'completed', 'cancelled': 'cancelled', 'error': 'failed'}.get(message.get('status'))
    if message.get('reply_meta', {}).get('runtime_interrupted'):
        status = 'interrupted'
    if status:
        current = db.execute('SELECT * FROM runtime_tasks WHERE id=?', (message['id'],)).fetchone()
        if current:
            steps = (message.get('reply_meta') or {}).get('execution', {}).get('steps', [])
            children(db, current, [step for step in steps if step.get('kind') == 'subagent'], late=message.get('reply_meta', {}).get('received_late') is True)
            for item in db.execute("SELECT id FROM runtime_tasks WHERE id LIKE ? AND status IN ('queued','connecting','running','waiting_approval','cancelling','disconnected')", (message['id'] + ':%',)).fetchall():
                transition(db, item['id'], 'interrupted', error=dict(code='parent_task_ended', message='父任务已结束，未确认此子任务完整完成。'))
        if message.get('reply_meta', {}).get('received_late') is True and not message.get('reply_meta', {}).get('runtime_interrupted'):
            late_terminal(db, message['id'], status)
        duration = message.get('reply_meta', {}).get('elapsed_ms')
        if type(duration) is not int or not 0 <= duration <= 86400000:
            duration = None
        transition(db, message['id'], status, duration_ms=duration, error=dict(code='task_failed', message='任务未正常完成，请查看原回复。') if status == 'failed' else dict(code='runtime_execution_interrupted', message='运行已中断，已保留实际收到的内容；不会自动重放。') if status == 'interrupted' else None)


def _progress(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {'stage', 'title'}:
        raise TaskError('invalid_runtime_progress', '任务进度格式无效。', 400)
    stage = value.get('stage')
    title = value.get('title')
    if stage is not None and stage not in STAGES:
        raise TaskError('invalid_runtime_progress', '任务阶段无效。', 400)
    if title is not None and (not isinstance(title, str) or len(title) > 160 or any(ord(c) < 32 for c in title)):
        raise TaskError('invalid_runtime_progress', '任务说明无效。', 400)
    if title:
        title = re.sub(r'(?i)Bearer\s+[^\s,;]+|\bsk-[\w-]{8,}|(?:api[_-]?key|token|password|secret)\s*[=:]\s*[^\s,;]+', '[已隐藏]', title)
    return {**({'stage': stage} if stage else {}), **({'title': title} if title else {})}


def publish(db, cid, task_id, value):
    if not isinstance(value, dict) or set(value) - {'agent_id', 'owner_id', 'sequence', 'status', 'progress', 'heartbeat', 'children'}:
        raise TaskError('invalid_runtime_state', '任务状态参数无效。', 400)
    owner, sequence, status = value.get('owner_id'), value.get('sequence'), value.get('status')
    if not isinstance(owner, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', owner) or type(sequence) is not int or not 1 <= sequence <= 9007199254740991:
        raise TaskError('invalid_runtime_state', '任务拥有者或事件序号无效。', 400)
    if status is not None and status not in PUBLISHABLE:
        raise TaskError('invalid_runtime_state', '任务状态无效。', 400)
    progress = _progress(value.get('progress'))
    current = row(db, cid, task_id)
    if value.get('agent_id') != current['agent_id']:
        raise TaskError('runtime_task_mismatch', 'Agent 与此任务不匹配。', task=public(current))
    if current['status'] in TERMINAL:
        raise TaskError('runtime_task_closed', '此任务已结束或无法恢复。', task=public(current))
    now = time.time()
    if current['owner_id'] and current['owner_id'] != owner:
        raise TaskError('runtime_task_owner_conflict', '此任务由另一个运行时管理。', task=public(current))
    if current['owner_id'] == owner and sequence <= current['owner_sequence']:
        return public(current), False
    db.execute('UPDATE runtime_tasks SET owner_id=?,owner_sequence=?,lease_until=? WHERE id=?', (owner, sequence, now + LEASE_SECONDS, task_id))
    if status is not None or progress is not None:
        transition(db, task_id, status or current['status'], progress=progress)
    children(db, current, value.get('children', []))
    return public(row(db, cid, task_id)), True


def check_owner(db, cid, task_id, agent_id, owner, receipt):
    current = row(db, cid, task_id)
    if current['agent_id'] != agent_id or current['owner_id'] != owner:
        raise TaskError('runtime_task_owner_conflict', '此任务的运行时归属不匹配。', task=public(current))
    if (not isinstance(receipt, str) or len(receipt) > 128 or not current['receipt_hash']
            or not hmac.compare_digest(hashlib.sha256(receipt.encode()).hexdigest(), current['receipt_hash'])):
        raise TaskError('runtime_task_receipt_invalid', '任务结果凭据无效。', task=public(current))
    if current['status'] == 'interrupted' and (json.loads(current['error'] or '{}').get('code') != 'runtime_restarted'):
        raise TaskError('runtime_task_closed', '此任务已中断，不能覆盖原记录。', task=public(current))
    return current


def expire(db, cid=None):
    now = time.time()
    query = "SELECT id FROM runtime_tasks WHERE ((owner_id IS NOT NULL AND lease_until<?) OR (owner_id IS NULL AND updated_at<?)) AND status IN ('queued','connecting','running','waiting_approval','cancelling')"
    args = [now, now - LEASE_SECONDS]
    if cid:
        query += ' AND conversation_id=?'
        args.append(cid)
    for item in db.execute(query, args).fetchall():
        transition(db, item['id'], 'disconnected', error=dict(code='runtime_presence_lost', message='暂时无法确认运行时状态；不会自动重新执行。'), now=now)
        for child in db.execute("SELECT id FROM runtime_tasks WHERE id LIKE ? AND status IN ('queued','connecting','running','waiting_approval','cancelling')", (item['id'] + ':%',)).fetchall():
            transition(db, child['id'], 'disconnected', error=dict(code='parent_presence_lost', message='暂时无法确认父任务状态。'), now=now)


def summaries(db, cid=None):
    now = time.time()
    scope = ' AND c.id=?' if cid else ''
    sql = """WITH states AS (
        SELECT conversation_id,created_at,
        CASE WHEN ((owner_id IS NOT NULL AND lease_until<?) OR (owner_id IS NULL AND updated_at<?)) AND status IN ('queued','connecting','running','waiting_approval','cancelling')
             THEN 'disconnected' ELSE status END AS status
        FROM runtime_tasks WHERE parent_task_id IS NULL),
        latest AS (SELECT conversation_id,status,ROW_NUMBER() OVER(PARTITION BY conversation_id ORDER BY created_at DESC) AS position FROM states),
        pending AS (SELECT conversation_id,COUNT(*) AS count FROM project_file_proposals WHERE status='pending' GROUP BY conversation_id)
        SELECT c.id,l.status AS latest_status,COALESCE(p.count,0) AS pending_count,
        SUM(CASE WHEN s.status IN ('queued','connecting','running','waiting_approval','cancelling') THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN s.status IN ('waiting_approval','disconnected') THEN 1 ELSE 0 END) AS attention_count,
        MIN(CASE s.status WHEN 'waiting_approval' THEN 0 WHEN 'cancelling' THEN 1 WHEN 'running' THEN 2 WHEN 'connecting' THEN 3 WHEN 'queued' THEN 4 WHEN 'disconnected' THEN 5 ELSE 99 END) AS live_rank
        FROM conversations c LEFT JOIN states s ON s.conversation_id=c.id
        LEFT JOIN latest l ON l.conversation_id=c.id AND l.position=1 LEFT JOIN pending p ON p.conversation_id=c.id
        WHERE c.deleted_at IS NULL""" + scope + ' GROUP BY c.id'
    order = ['waiting_approval', 'cancelling', 'running', 'connecting', 'queued', 'disconnected']
    result = []
    for row in db.execute(sql, (now, now - LEASE_SECONDS, cid) if cid else (now, now - LEASE_SECONDS)):
        status = order[row['live_rank']] if row['live_rank'] < len(order) else row['latest_status']
        attention = row['attention_count'] + row['pending_count'] + (row['latest_status'] in ('failed', 'interrupted'))
        result.append(dict(conversation_id=row['id'],status=status,active_count=row['active_count'],
                           attention_count=attention,pending_action_count=row['pending_count']))
    return result


def conversation_summary(db, cid):
    return summaries(db, cid)[0]


def snapshot(db, cid=None, after=None, allow_unchanged=False):
    expire(db, cid)
    cursor = db.execute('SELECT COALESCE(MAX(cursor),0) FROM runtime_task_events').fetchone()[0]
    if allow_unchanged and after == cursor:
        count = db.execute('SELECT COUNT(*) FROM runtime_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE c.deleted_at IS NULL' + (' AND t.conversation_id=?' if cid else ''), (cid,) if cid else ()).fetchone()[0]
        return dict(tasks=[],events=[],cursor=cursor,reset=False,unchanged=True,truncated=count > TASK_LIMIT,conversations=summaries(db,cid))
    condition = 'c.deleted_at IS NULL' + (' AND t.conversation_id=?' if cid else '')
    params = (cid,) if cid else ()
    rows = db.execute('SELECT t.* FROM runtime_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE ' + condition + " ORDER BY CASE WHEN t.status IN ('queued','connecting','running','waiting_approval','cancelling','disconnected') THEN 0 ELSE 1 END,t.created_at DESC LIMIT ?", (*params, TASK_LIMIT)).fetchall()
    tasks = [public(item) for item in rows]
    cursor = db.execute('SELECT COALESCE(MAX(cursor),0) FROM runtime_task_events').fetchone()[0]
    first = db.execute('SELECT MIN(cursor) FROM runtime_task_events').fetchone()[0] or 0
    reset = after is None or after > cursor or first > 0 and after < first - 1
    events = []
    if not reset:
        event_query = '''SELECT e.* FROM runtime_task_events e JOIN conversations c ON c.id=e.conversation_id
                         WHERE c.deleted_at IS NULL AND e.cursor>?'''
        event_params = [after]
        if cid:
            event_query += ' AND e.conversation_id=?'
            event_params.append(cid)
        found = db.execute(event_query + ' ORDER BY e.cursor LIMIT ?', (*event_params, EVENT_LIMIT + 1)).fetchall()
        reset = len(found) > EVENT_LIMIT
        if not reset:
            events = [dict(cursor=item['cursor'], task_id=item['task_id'], conversation_id=item['conversation_id'],
                           revision=item['revision'], task=json.loads(item['task'])) for item in found]
    conversation_states = summaries(db, cid)
    return dict(tasks=tasks, events=events, cursor=cursor, reset=reset, unchanged=False, truncated=len(rows) == TASK_LIMIT, conversations=conversation_states)


def children(db, root, entries, late=False):
    if not isinstance(entries, list) or len(entries) > 100:
        raise TaskError('invalid_runtime_children', '子任务状态格式无效。', 400)
    parents = {item['id']: item['parent_task_id'] for item in db.execute('SELECT id,parent_task_id FROM runtime_tasks WHERE id LIKE ?', (root['id'] + ':%',))}
    for item in entries:
        if isinstance(item, dict) and isinstance(item.get('id'), str):
            parents[root['id'] + ':' + item['id']] = root['id'] + ':' + item['parent_id'] if isinstance(item.get('parent_id'), str) else root['id']
    for ident in parents:
        seen = set()
        current = ident
        while current in parents:
            if current in seen:
                raise TaskError('invalid_runtime_children', '子任务父级关系存在循环。', 400)
            seen.add(current)
            current = parents[current]
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - {'id', 'title', 'status', 'parent_id', 'duration_ms', 'kind', 'failure_reason'}:
            raise TaskError('invalid_runtime_children', '子任务状态字段无效。', 400)
        ident = entry.get('id')
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', ident):
            raise TaskError('invalid_runtime_children', '子任务标识无效。', 400)
        status = {'pending': 'queued', 'in_progress': 'running', 'completed': 'completed', 'failed': 'failed', 'interrupted': 'interrupted'}.get(entry.get('status'))
        if not status:
            raise TaskError('invalid_runtime_children', '子任务状态无效。', 400)
        title = entry.get('title', '子任务')
        if not isinstance(title, str) or len(title) > 500:
            raise TaskError('invalid_runtime_children', '子任务说明无效。', 400)
        duration = entry.get('duration_ms')
        if duration is not None and (type(duration) is not int or not 0 <= duration <= 86400000):
            raise TaskError('invalid_runtime_children', '子任务耗时无效。', 400)
        progress = _progress(dict(title=title[:160]))
        parent = entry.get('parent_id')
        if parent is not None and (not isinstance(parent, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', parent) or parent == ident):
            raise TaskError('invalid_runtime_children', '子任务父级无效。', 400)
        ident = root['id'] + ':' + ident
        parent = root['id'] + ':' + parent if parent else root['id']
        existing = db.execute('SELECT * FROM runtime_tasks WHERE id=?', (ident,)).fetchone()
        if existing is None:
            reserve(db, root['conversation_id'], ident, root['agent_id'], 'Somnus 子 Agent', 'dsh-subagent', status='queued', title=progress.get('title'), created_at=root['created_at'] if root['status'] in TERMINAL else None)
            db.execute('UPDATE runtime_tasks SET parent_task_id=? WHERE id=?', (parent, ident))
        if late and status in TERMINAL:
            late_terminal(db, ident, status)
        transition(db, ident, status, progress=progress, duration_ms=duration,
                   error=dict(code='subagent_failed', message='子任务未正常完成，请查看原回复中的详情。') if status == 'failed' else None)


def issue_receipt(db, task_id, epoch, receipt):
    db.execute('UPDATE runtime_tasks SET receipt_hash=?,receipt_epoch=? WHERE id=?',
               (hashlib.sha256(receipt.encode()).hexdigest(), epoch, task_id))


def late_terminal(db, task_id, status):
    current = db.execute('SELECT * FROM runtime_tasks WHERE id=?', (task_id,)).fetchone()
    if (current and current['status'] == 'interrupted' and status in ('completed', 'failed', 'cancelled')
            and json.loads(current['error'] or '{}').get('code') == 'runtime_restarted'):
        db.execute('UPDATE runtime_tasks SET status=?,received_late=1,revision=revision+1,updated_at=?,ended_at=?,error=NULL WHERE id=?',
                   (status, time.time(), time.time(), task_id))
        _record(db, task_id)
