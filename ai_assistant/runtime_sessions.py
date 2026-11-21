"""Native session identities and two-phase forks; no execution authorization is stored here."""
import json
import re
import time
import uuid
from .runtime_tasks import TaskError

SESSION = re.compile(r'[A-Za-z0-9_.:/-]{1,240}')


def initialize(db):
    db.executescript("""CREATE TABLE IF NOT EXISTS native_sessions(
        conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, session_id TEXT NOT NULL,
        runtime TEXT NOT NULL, updated_at REAL NOT NULL,
        PRIMARY KEY(conversation_id,agent_id), UNIQUE(runtime,session_id));
        CREATE TABLE IF NOT EXISTS native_turn_history(
        turn_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL, last_seq INTEGER NOT NULL, assistant_event_seq INTEGER, start_seq INTEGER NOT NULL DEFAULT 0,
        updated_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS native_fork_reservations(
        id TEXT PRIMARY KEY, source_conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, source_session_id TEXT NOT NULL, at_seq INTEGER NOT NULL,
        conversation_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, child_session_id TEXT,
        created_at REAL NOT NULL, committed_at REAL);
    """)
    db.execute('CREATE INDEX IF NOT EXISTS native_fork_source ON native_fork_reservations(source_conversation_id,turn_id,source_session_id,state,committed_at)')
    db.execute('CREATE TABLE IF NOT EXISTS native_task_scopes(turn_id TEXT PRIMARY KEY,scope_fingerprint TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS native_session_owners(runtime TEXT NOT NULL,session_id TEXT NOT NULL,conversation_id TEXT NOT NULL,PRIMARY KEY(runtime,session_id))')
    db.execute('INSERT OR IGNORE INTO native_session_owners SELECT runtime,session_id,conversation_id FROM native_sessions')
    db.execute("INSERT OR IGNORE INTO native_session_owners SELECT t.runtime,h.session_id,h.conversation_id FROM native_turn_history h JOIN runtime_tasks t ON t.id=h.turn_id")
    if 'scope_fingerprint' not in {row['name'] for row in db.execute('PRAGMA table_info(native_sessions)')}:
        db.execute('ALTER TABLE native_sessions ADD COLUMN scope_fingerprint TEXT')
    db.execute('CREATE TABLE IF NOT EXISTS native_child_sessions(turn_id TEXT NOT NULL,session_id TEXT NOT NULL,parent_session_id TEXT NOT NULL,source_seq INTEGER NOT NULL,last_seq INTEGER NOT NULL,PRIMARY KEY(turn_id,session_id))')
    db.execute("INSERT OR IGNORE INTO native_session_owners SELECT t.runtime,ch.session_id,t.conversation_id FROM native_child_sessions ch JOIN runtime_tasks t ON t.id=ch.turn_id")
    if 'route' not in {row['name'] for row in db.execute('PRAGMA table_info(native_turn_history)')}:
        db.execute("ALTER TABLE native_turn_history ADD COLUMN route TEXT NOT NULL DEFAULT '{}'")
    if 'local_origin_cid' not in {row['name'] for row in db.execute('PRAGMA table_info(native_sessions)')}:
        db.execute('ALTER TABLE native_sessions ADD COLUMN local_origin_cid TEXT')
    if 'route' not in {row['name'] for row in db.execute('PRAGMA table_info(native_sessions)')}:
        db.execute("ALTER TABLE native_sessions ADD COLUMN route TEXT NOT NULL DEFAULT '{}'")
    for name in ('workspace_id','root_fingerprint','worktree_snapshot'):
        if name not in {row['name'] for row in db.execute('PRAGMA table_info(native_fork_reservations)')}:
            db.execute('ALTER TABLE native_fork_reservations ADD COLUMN '+name+' TEXT')
    if 'start_seq' not in {row['name'] for row in db.execute('PRAGMA table_info(native_turn_history)')}:
        db.execute('ALTER TABLE native_turn_history ADD COLUMN start_seq INTEGER NOT NULL DEFAULT 0')


def sequence(value, optional=False):
    if optional and value is None:
        return None
    if type(value) is not int or value < 0 or value > 2**53-1:
        raise TaskError('invalid_native_sequence', '原生会话事件位置无效。', 400)
    return value


def session(value):
    if not isinstance(value, str) or not SESSION.fullmatch(value):
        raise TaskError('invalid_native_session', '原生会话标识无效。', 400)
    return value


def bind(db, task, fields, *, scope_fingerprint=None):
    if set(fields) - {'turn_id','owner_id','session_id','last_seq','assistant_event_seq','start_seq','children'}:
        raise TaskError('invalid_native_binding', '原生会话绑定字段无效。', 400)
    if not task['owner_id'] or task['owner_id'] != fields.get('owner_id'):
        raise TaskError('runtime_task_owner_conflict', '原生会话与任务运行时归属不匹配。')
    sid = session(fields.get('session_id'))
    last = sequence(fields.get('last_seq'))
    start = sequence(fields.get('start_seq',0))
    if start > last:
        raise TaskError('invalid_native_sequence','轨迹起点不能超过终点。',400)
    assistant = sequence(fields.get('assistant_event_seq'), optional=True)
    if assistant is not None and assistant > last:
        raise TaskError('invalid_native_sequence', '回答事件不能超过已观察的事件位置。', 400)
    old = db.execute('SELECT * FROM native_sessions WHERE conversation_id=? AND agent_id=?',
                     (task['conversation_id'], task['agent_id'])).fetchone()
    task_scope = db.execute('SELECT scope_fingerprint FROM native_task_scopes WHERE turn_id=?',(task['id'],)).fetchone()
    current_scope = bool(task_scope and scope_fingerprint and task_scope['scope_fingerprint'] == scope_fingerprint)
    owner = db.execute('SELECT conversation_id FROM native_session_owners WHERE runtime=? AND session_id=?',(task['runtime'],sid)).fetchone()
    if owner and owner['conversation_id'] != task['conversation_id']:
        raise TaskError('native_session_conflict','原生会话属于另一个 Somnus 会话。')
    if current_scope and old and old['scope_fingerprint'] == scope_fingerprint and old['session_id'] != sid:
        raise TaskError('native_session_conflict', '此会话已绑定其他原生会话，不能替换历史。')
    existing = db.execute('SELECT * FROM native_turn_history WHERE turn_id=?', (task['id'],)).fetchone()
    if existing and (existing['session_id'] != sid or existing['start_seq'] != start or last < existing['last_seq']
                     or existing['assistant_event_seq'] is not None and assistant not in (None,existing['assistant_event_seq'])):
        raise TaskError('native_sequence_conflict', '原生会话事件位置不能回退或替换。')
    now = time.time()
    try:
        db.execute('INSERT OR IGNORE INTO native_session_owners VALUES(?,?,?)',(task['runtime'],sid,task['conversation_id']))
        if current_scope:
            if old and old['scope_fingerprint'] != scope_fingerprint:
                db.execute('DELETE FROM native_sessions WHERE conversation_id=? AND agent_id=?',(task['conversation_id'],task['agent_id']))
            db.execute('INSERT OR IGNORE INTO native_sessions(conversation_id,agent_id,session_id,runtime,updated_at,scope_fingerprint) VALUES(?,?,?,?,?,?)',
                       (task['conversation_id'],task['agent_id'],sid,task['runtime'],now,scope_fingerprint))
        db.execute('INSERT INTO native_turn_history(turn_id,conversation_id,agent_id,session_id,last_seq,assistant_event_seq,updated_at,start_seq) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(turn_id) DO UPDATE SET last_seq=excluded.last_seq, assistant_event_seq=COALESCE(native_turn_history.assistant_event_seq,excluded.assistant_event_seq),updated_at=excluded.updated_at',
                   (task['id'],task['conversation_id'],task['agent_id'],sid,last,assistant,now,start))
    except Exception as error:
        if error.__class__.__name__ != 'IntegrityError':
            raise
        raise TaskError('native_session_conflict', '原生会话已属于另一会话。') from None
    entries = fields.get('children', [])
    if not isinstance(entries,list) or len(entries)>64:
        raise TaskError('invalid_native_children','子会话列表无效。',400)
    known = {item['session_id']:item['parent_session_id'] for item in db.execute('SELECT * FROM native_child_sessions WHERE turn_id=?',(task['id'],))}
    parsed = []
    for entry in entries:
        if not isinstance(entry,dict) or set(entry) != {'session_id','parent_session_id','source_seq','last_seq'}:
            raise TaskError('invalid_native_children','子会话范围字段无效。',400)
        child,parent = session(entry['session_id']),session(entry['parent_session_id'])
        child_owner=db.execute('SELECT conversation_id FROM native_session_owners WHERE runtime=? AND session_id=?',(task['runtime'],child)).fetchone()
        if child_owner and child_owner['conversation_id'] != task['conversation_id']:
            raise TaskError('native_session_conflict','此子会话属于另一个会话。')
        source,end = sequence(entry['source_seq']),sequence(entry['last_seq'])
        if child == sid or source>end or child in known and known[child]!=parent:
            raise TaskError('invalid_native_children','子会话归属不能替换。',400)
        known[child]=parent
        parsed.append((task['id'],child,parent,source,end))
    for child in known:
        visited=set(); current=child
        while current != sid:
            if current in visited or current not in known:
                raise TaskError('invalid_native_children','子会话父链无效。',400)
            visited.add(current);current=known[current]
    for item in parsed:
        old = db.execute('SELECT source_seq,last_seq FROM native_child_sessions WHERE turn_id=? AND session_id=?',item[:2]).fetchone()
        if old and (old['source_seq'] != item[3] or old['last_seq'] > item[4]):
            raise TaskError('native_sequence_conflict','子会话范围不能回退。')
        db.execute('INSERT OR IGNORE INTO native_session_owners VALUES(?,?,?)',(task['runtime'],item[1],task['conversation_id']))
        db.execute('INSERT INTO native_child_sessions VALUES(?,?,?,?,?) ON CONFLICT(turn_id,session_id) DO UPDATE SET last_seq=excluded.last_seq',item)
    return dict(db.execute('SELECT * FROM native_turn_history WHERE turn_id=?', (task['id'],)).fetchone())


def reserve_fork(db, task, fields):
    if not {'turn_id','at_seq'} <= set(fields) or set(fields)-{'turn_id','at_seq','child_session_id','worktree_policy'}:
        raise TaskError('invalid_native_fork', '分支参数无效。', 400)
    if task['status'] not in ('completed','failed','cancelled','interrupted'):
        raise TaskError('native_fork_busy', '请等待本轮停止后再创建原生分支。')
    history = db.execute('SELECT * FROM native_turn_history WHERE turn_id=?', (task['id'],)).fetchone()
    if not history:
        raise TaskError('native_history_missing', '此回答还没有经过验证的原生会话记录。')
    at = sequence(fields['at_seq'])
    source_session = history['session_id']
    if fields.get('child_session_id') is not None:
        child = db.execute('SELECT * FROM native_child_sessions WHERE turn_id=? AND session_id=?',(task['id'],session(fields['child_session_id']))).fetchone()
        if not child or not child['source_seq'] <= at <= child['last_seq']:
            raise TaskError('native_child_not_found','该子会话或事件不属于此任务。',404)
        source_session = child['session_id']
    elif at != history['assistant_event_seq'] or at > history['last_seq']:
        raise TaskError('native_fork_checkpoint_mismatch', '只能从本轮已验证的回答事件创建分支。')
    rid, cid = uuid.uuid4().hex, uuid.uuid4().hex
    db.execute("INSERT INTO native_fork_reservations(id,source_conversation_id,turn_id,agent_id,source_session_id,at_seq,conversation_id,state,child_session_id,created_at,committed_at) VALUES(?,?,?,?,?,?,?,'reserved',NULL,?,NULL)",
               (rid,task['conversation_id'],task['id'],task['agent_id'],source_session,at,cid,time.time()))
    return {'reservation_id':rid,'conversation_id':cid,'source_session_id':source_session,'at_seq':at}


def fork_row(db, rid):
    if not isinstance(rid,str) or not re.fullmatch('[a-f0-9]{32}',rid):
        raise TaskError('native_fork_not_found','分支预留不存在。',404)
    row = db.execute('SELECT * FROM native_fork_reservations WHERE id=?',(rid,)).fetchone()
    if row is None:
        raise TaskError('native_fork_not_found','分支预留不存在。',404)
    return row
