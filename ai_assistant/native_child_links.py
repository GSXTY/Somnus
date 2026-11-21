"""Read-only child-pane links derived from committed, owned native forks."""
import hashlib
import json
import re
import time
from .runtime_tasks import TaskError


def child_step_id(session_id):
    return 'dsh-child-' + hashlib.sha256(session_id.encode('utf-8')).hexdigest()[:24]


def source_child(db, cid, turn_id, child_id):
    if not isinstance(turn_id,str) or not re.fullmatch('[a-f0-9]{32}',turn_id):
        raise TaskError('invalid_native_child_link','请选择原会话的任务。',400)
    if not isinstance(child_id,str) or not child_id or len(child_id)>240 or any(ord(c)<32 for c in child_id):
        raise TaskError('invalid_native_child_link','子会话标识无效。',400)
    task=db.execute('SELECT * FROM runtime_tasks WHERE id=? AND conversation_id=?',(turn_id,cid)).fetchone()
    if task is None or task['runtime']!='dsh-native' or task['parent_task_id']:
        raise TaskError('native_child_not_found','此子会话不属于选中的原生任务。',404)
    children=db.execute('SELECT * FROM native_child_sessions WHERE turn_id=?',(turn_id,))
    matches=[row for row in children if child_id in (row['session_id'],child_step_id(row['session_id']))]
    if len(matches)!=1:
        raise TaskError('native_child_not_found','此子会话没有经过验证的来源记录。',404)
    child=matches[0]
    owner=db.execute("SELECT conversation_id FROM native_session_owners WHERE runtime='dsh-native' AND session_id=?",(child['session_id'],)).fetchone()
    if not owner or owner['conversation_id']!=cid:
        raise TaskError('native_child_not_found','子会话来源归属无法确认。',404)
    return task,child


def lookup(service, db, cid, turn_id, child_id):
    parent=db.execute('SELECT * FROM conversations WHERE id=?',(cid,)).fetchone()
    if parent is None:
        raise TaskError('not_found','原会话不存在。',404)
    task,child=source_child(db,cid,turn_id,child_id)
    result=dict(status='none',can_open=False,can_send=False,parent_conversation_id=cid,turn_id=turn_id,
                child_id=child_step_id(child['session_id']))
    reservation=db.execute("""SELECT * FROM native_fork_reservations
        WHERE source_conversation_id=? AND turn_id=? AND source_session_id=? AND state='committed'
        ORDER BY committed_at DESC,created_at DESC,id DESC LIMIT 1""",(cid,turn_id,child['session_id'])).fetchone()
    if reservation:
        target=db.execute('SELECT * FROM conversations WHERE id=?',(reservation['conversation_id'],)).fetchone()
        ownership=db.execute("SELECT conversation_id FROM native_session_owners WHERE runtime='dsh-native' AND session_id=?",(reservation['child_session_id'],)).fetchone()
        history=db.execute('SELECT route FROM native_turn_history WHERE turn_id=?',(turn_id,)).fetchone()
        if target is None or not ownership or ownership['conversation_id']!=reservation['conversation_id'] or not history:
            return dict(result,status='unverified')
        try:
            route=json.loads(history['route'])
            if not isinstance(route,dict) or set(route)-{'agentId','providerModelId'} or route.get('agentId',task['agent_id'])!=task['agent_id']:
                return dict(result,status='unverified')
        except (ValueError,TypeError):
            return dict(result,status='unverified')
        continuation=dict(agentId=task['agent_id'])
        if isinstance(route.get('providerModelId'),str):continuation['providerModelId']=route['providerModelId']
        result.update(conversation_id=target['id'],runtime_session_id=reservation['child_session_id'],continuation=continuation,
                      reservation_id=reservation['id'],created_at=reservation['committed_at'])
        if target['deleted_at'] is not None:
            return dict(result,status='deleted')
        result['can_open']=True
    else:
        target=None
    if parent['deleted_at'] is not None:
        return dict(result,status='source_deleted',can_send=False)
    source_workspace=db.execute('SELECT archived FROM workspaces WHERE id=?',(parent['workspace_id'],)).fetchone()
    if parent['archived'] or source_workspace and source_workspace['archived']:
        return dict(result,status='source_archived')
    scope=db.execute('SELECT scope_fingerprint FROM native_task_scopes WHERE turn_id=?',(turn_id,)).fetchone()
    try:
        source_scope=service._native_scope(db,cid)
    except TaskError:
        return dict(result,status='source_scope_changed')
    if not scope or scope['scope_fingerprint']!=source_scope:
        return dict(result,status='source_scope_changed')
    if target is None:
        pending=db.execute("SELECT id FROM native_fork_reservations WHERE source_conversation_id=? AND turn_id=? AND source_session_id=? AND state='reserved' AND created_at>? LIMIT 1",(cid,turn_id,child['session_id'],time.time()-300)).fetchone()
        return dict(result,status='pending' if pending else 'none')
    target_workspace=db.execute('SELECT archived FROM workspaces WHERE id=?',(target['workspace_id'],)).fetchone()
    if target['archived'] or target_workspace and target_workspace['archived']:
        return dict(result,status='archived')
    try:
        target_scope=service._native_scope(db,target['id'])
    except TaskError:
        return dict(result,status='target_scope_changed')
    head=db.execute('SELECT * FROM native_sessions WHERE conversation_id=? AND agent_id=?',(target['id'],task['agent_id'])).fetchone()
    if target_scope!=scope['scope_fingerprint'] or not head or head['scope_fingerprint']!=target_scope or head['session_id']!=reservation['child_session_id']:
        return dict(result,status='target_scope_changed')
    return dict(result,status='linked',can_send=True,conversation=service._conversation(db,target['id']))
