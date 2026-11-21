"""Explicit references to verified, shared worktrees. Never runs Git or deletes files."""
import json
from .runtime_tasks import TaskError

FIELDS=('workspace_id','source','base_path','base_identity','root_path','root_identity','branch','commit_sha')


def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS conversation_worktree_shares(
        conversation_id TEXT PRIMARY KEY,owner_conversation_id TEXT NOT NULL,source_conversation_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,source TEXT NOT NULL,base_path TEXT NOT NULL,base_identity TEXT NOT NULL,
        root_path TEXT NOT NULL,root_identity TEXT NOT NULL,branch TEXT NOT NULL,commit_sha TEXT NOT NULL,created_at REAL NOT NULL)""")
    db.execute("""CREATE VIEW IF NOT EXISTS conversation_worktree_bindings AS
        SELECT conversation_id,workspace_id,source,base_path,base_identity,root_path,root_identity,branch,commit_sha,created_at FROM conversation_worktrees
        UNION ALL SELECT conversation_id,workspace_id,source,base_path,base_identity,root_path,root_identity,branch,commit_sha,created_at FROM conversation_worktree_shares""")


def binding(db,cid):
    row=db.execute('SELECT * FROM conversation_worktrees WHERE conversation_id=?',(cid,)).fetchone()
    if row:return dict(row,shared=False,owner_conversation_id=cid,source_conversation_id=cid,shared_valid=True)
    row=db.execute('SELECT * FROM conversation_worktree_shares WHERE conversation_id=?',(cid,)).fetchone()
    if row is None:return None
    owner=db.execute('SELECT * FROM conversation_worktrees WHERE conversation_id=?',(row['owner_conversation_id'],)).fetchone()
    source=db.execute('SELECT * FROM conversation_worktree_bindings WHERE conversation_id=?',(row['source_conversation_id'],)).fetchone()
    owner_conversation=db.execute('SELECT workspace_id FROM conversations WHERE id=?',(row['owner_conversation_id'],)).fetchone()
    source_conversation=db.execute('SELECT workspace_id FROM conversations WHERE id=?',(row['source_conversation_id'],)).fetchone()
    valid=bool(owner and source and owner_conversation and source_conversation and all(row[key]==owner[key]==source[key] for key in FIELDS)
               and owner_conversation['workspace_id']==row['workspace_id']==source_conversation['workspace_id'])
    return dict(row,shared=True,shared_valid=valid)


def snapshot(db,cid):
    row=binding(db,cid)
    if row is None:return None
    if not row['shared_valid']:raise TaskError('native_fork_worktree_changed','共享工作树来源已变更，请重新选择保存目录。')
    return {key:row[key] for key in (*FIELDS,'owner_conversation_id','source_conversation_id')}


def share(db,new_cid,source_cid,saved,now):
    current=snapshot(db,source_cid)
    if current!=saved:raise TaskError('native_fork_worktree_changed','原工作树绑定已变更，分支未提交。')
    values=[new_cid,saved['owner_conversation_id'],source_cid,*[saved[key] for key in FIELDS],now]
    db.execute('INSERT INTO conversation_worktree_shares VALUES('+','.join('?' for _ in values)+')',values)
