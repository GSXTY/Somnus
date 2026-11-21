"""Bounded staged native history pages; only committed archives are visible."""
import base64
import binascii
import hashlib
import json
import time
from .runtime_tasks import TaskError
from .runtime_sessions import fork_row,sequence

MAX_PAGE=64*1024
MAX_BYTES=64*1024*1024
MAX_FRAGMENTS=100000


def initialize(db):
    db.executescript("""CREATE TABLE IF NOT EXISTS native_fork_history_uploads(
        reservation_id TEXT PRIMARY KEY,next_page INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,
        fragment_count INTEGER NOT NULL DEFAULT 0,byte_count INTEGER NOT NULL DEFAULT 0,updated_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS native_fork_history_pages(reservation_id TEXT NOT NULL,page_index INTEGER NOT NULL,
        sha256 TEXT NOT NULL,PRIMARY KEY(reservation_id,page_index));
        CREATE TABLE IF NOT EXISTS native_fork_history_records(reservation_id TEXT NOT NULL,seq INTEGER NOT NULL,part INTEGER NOT NULL,
        role TEXT NOT NULL,content TEXT NOT NULL,final INTEGER NOT NULL,PRIMARY KEY(reservation_id,seq,part));
        CREATE TABLE IF NOT EXISTS native_inherited_histories(conversation_id TEXT PRIMARY KEY,reservation_id TEXT NOT NULL UNIQUE,
        fragment_count INTEGER NOT NULL,byte_count INTEGER NOT NULL,created_at REAL NOT NULL);
    """)
    if 'content_sha256' not in {row['name'] for row in db.execute('PRAGMA table_info(native_inherited_histories)')}:
        db.execute('ALTER TABLE native_inherited_histories ADD COLUMN content_sha256 TEXT')


def touch(db,reservation):
    upload=db.execute('SELECT updated_at FROM native_fork_history_uploads WHERE reservation_id=?',(reservation['id'],)).fetchone()
    return max(reservation['created_at'],upload['updated_at'] if upload else 0)


def append(db,rid,body):
    if not isinstance(body,dict) or set(body)!={'source_session_id','page_index','records','done'}:
        raise TaskError('invalid_native_history_page','继承历史分页格式无效。',400)
    try:raw=json.dumps(body,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode('utf-8')
    except (TypeError,ValueError,UnicodeError):raise TaskError('invalid_native_history_page','历史分页必须是合法UTF-8 JSON。',400) from None
    if len(raw)>MAX_PAGE:raise TaskError('native_history_page_too_large','单页继承历史不得超过64KiB。',413)
    reserved=fork_row(db,rid)
    if reserved['state']!='reserved' or time.time()-touch(db,reserved)>300:
        raise TaskError('native_fork_expired','分支预留已结束或过期。')
    if body['source_session_id']!=reserved['source_session_id'] or type(body['done']) is not bool:
        raise TaskError('native_history_source_mismatch','继承历史来源不匹配。',400)
    page=sequence(body['page_index']);records=body['records']
    if not isinstance(records,list) or len(records)>100 or not records and not body['done']:
        raise TaskError('invalid_native_history_page','单页仅允许100个文本片段。',400)
    digest=hashlib.sha256(raw).hexdigest()
    old=db.execute('SELECT sha256 FROM native_fork_history_pages WHERE reservation_id=? AND page_index=?',(rid,page)).fetchone()
    if old:
        if old['sha256']!=digest:raise TaskError('native_history_page_conflict','同一分页不能替换内容。')
        saved=dict(db.execute('SELECT * FROM native_fork_history_uploads WHERE reservation_id=?',(rid,)).fetchone())
        return dict(saved,done=bool(saved['done']),accepted=False,page_sha256=digest)
    state=db.execute('SELECT * FROM native_fork_history_uploads WHERE reservation_id=?',(rid,)).fetchone()
    if page!=(state['next_page'] if state else 0) or state and state['done']:
        raise TaskError('native_history_page_order','请按page_index顺序发送继承历史。')
    child=db.execute('SELECT source_seq FROM native_child_sessions WHERE turn_id=? AND session_id=?',(reserved['turn_id'],reserved['source_session_id'])).fetchone()
    root=db.execute('SELECT start_seq FROM native_turn_history WHERE turn_id=?',(reserved['turn_id'],)).fetchone()
    lower=child['source_seq'] if child else root['start_seq'] if root else 0
    added_bytes=0
    for item in records:
        if not isinstance(item,dict) or not {'seq','role','content'}<=set(item) or set(item)-{'seq','part','role','content','final'}:
            raise TaskError('invalid_native_history_fragment','继承历史片段格式无效。',400)
        seq=sequence(item['seq']);part=sequence(item.get('part',0));final=item.get('final',True)
        if not lower<seq<=reserved['at_seq'] or item['role'] not in ('user','assistant') or type(final) is not bool or not isinstance(item['content'],str):
            raise TaskError('native_history_source_mismatch','继承历史事件不属于已验证范围。',400)
        try:added_bytes+=len(item['content'].encode('utf-8'))
        except UnicodeError:raise TaskError('invalid_native_history_fragment','历史文本编码无效。',400) from None
        if db.execute('SELECT 1 FROM native_fork_history_records WHERE reservation_id=? AND seq=? AND part=?',(rid,seq,part)).fetchone():
            raise TaskError('native_history_fragment_duplicate','片段已在另一分页中提交。')
        db.execute('INSERT INTO native_fork_history_records VALUES(?,?,?,?,?,?)',(rid,seq,part,item['role'],item['content'],int(final)))
    count=(state['fragment_count'] if state else 0)+len(records);size=(state['byte_count'] if state else 0)+added_bytes
    if count>MAX_FRAGMENTS or size>MAX_BYTES:raise TaskError('native_history_archive_too_large','展示历史超过64MiB或10万个片段；原生会话和原记录均未修改。',413)
    if body['done']:
        invalid=db.execute("""SELECT seq FROM native_fork_history_records WHERE reservation_id=? GROUP BY seq
            HAVING min(part)<>0 OR max(part)+1<>count(*) OR count(distinct role)<>1 OR sum(final)<>1
            OR max(CASE WHEN final=1 THEN part ELSE -1 END)<>max(part) LIMIT 1""",(rid,)).fetchone()
        if invalid:raise TaskError('native_history_incomplete','长消息片段不完整，分支尚未提交。')
    db.execute('INSERT INTO native_fork_history_pages VALUES(?,?,?)',(rid,page,digest))
    db.execute('INSERT INTO native_fork_history_uploads VALUES(?,?,?,?,?,?) ON CONFLICT(reservation_id) DO UPDATE SET next_page=excluded.next_page,done=excluded.done,fragment_count=excluded.fragment_count,byte_count=excluded.byte_count,updated_at=excluded.updated_at',(rid,page+1,int(body['done']),count,size,time.time()))
    return dict(reservation_id=rid,next_page=page+1,done=body['done'],fragment_count=count,byte_count=size,accepted=True,page_sha256=digest)


def commit(db,reserved,cid,now):
    state=db.execute('SELECT * FROM native_fork_history_uploads WHERE reservation_id=?',(reserved['id'],)).fetchone()
    if not state or not state['done']:raise TaskError('native_history_incomplete','继承历史尚未上传完整，分支未提交。')
    content_hash=hashlib.sha256()
    for row in db.execute('SELECT content FROM native_fork_history_records WHERE reservation_id=? ORDER BY seq,part',(reserved['id'],)):
        content_hash.update(row['content'].encode('utf-8'))
    db.execute('INSERT INTO native_inherited_histories(conversation_id,reservation_id,fragment_count,byte_count,created_at,content_sha256) VALUES(?,?,?,?,?,?)',(cid,reserved['id'],state['fragment_count'],state['byte_count'],now,content_hash.hexdigest()))


def metadata(db,cid):
    row=db.execute('SELECT * FROM native_inherited_histories WHERE conversation_id=?',(cid,)).fetchone()
    return dict(row) if row else None


def read(db,cid,after=None,limit=50):
    if type(limit) is not int or not 1<=limit<=100:raise TaskError('invalid_native_history_limit','历史分页大小应为1至100。',400)
    info=metadata(db,cid)
    if not info:return dict(history=None,records=[],next_cursor=None,has_more=False)
    seq,part=-1,-1
    if after is not None:
        try:
            if not isinstance(after,str) or len(after)>512:raise ValueError()
            rid,seq,part=json.loads(base64.b64decode(after.encode('ascii'),altchars=b'-_',validate=True).decode('utf-8'))
            sequence(seq);sequence(part)
            if rid!=info['reservation_id'] or type(seq) is not int or type(part) is not int or seq<0 or part<0:raise ValueError()
        except (ValueError,TypeError,UnicodeError,binascii.Error,OverflowError):raise TaskError('invalid_native_history_cursor','历史游标无效。',400) from None
    rows=db.execute('SELECT seq,part,role,content,final FROM native_fork_history_records WHERE reservation_id=? AND (seq>? OR (seq=? AND part>?)) ORDER BY seq,part LIMIT ?',(info['reservation_id'],seq,seq,part,limit+1)).fetchall()
    selected=rows[:limit];cursor=None
    if selected:
        last=selected[-1];cursor=base64.urlsafe_b64encode(json.dumps([info['reservation_id'],last['seq'],last['part']],separators=(',',':')).encode()).decode()
    return dict(history=info,records=[dict(row,final=bool(row['final'])) for row in selected],next_cursor=cursor if len(rows)>limit else None,has_more=len(rows)>limit)


def abort(db,rid):
    for table in ('native_fork_history_pages','native_fork_history_records','native_fork_history_uploads'):
        db.execute('DELETE FROM '+table+' WHERE reservation_id=?',(rid,))
