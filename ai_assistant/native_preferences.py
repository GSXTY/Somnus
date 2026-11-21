"""Per-conversation explicit native model/Skill choices; no execution grants."""
import json
import time
from .runtime_tasks import TaskError
from .skill_library import MAX_SELECTED


def initialize(db):
    db.execute('CREATE TABLE IF NOT EXISTS conversation_native_preferences(conversation_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,configuration TEXT NOT NULL,updated_at REAL NOT NULL)')


def read(db,cid):
    row=db.execute('SELECT * FROM conversation_native_preferences WHERE conversation_id=?',(cid,)).fetchone()
    return dict(json.loads(row['configuration']),revision=row['revision']) if row else dict(revision=0,provider_model_id=None,skill_ids=[])


def write(db,cid,fields,model_ids,skill_states):
    if not isinstance(fields,dict) or set(fields)!={'revision','provider_model_id','skill_ids'} or type(fields['revision']) is not int or fields['revision']<0:
        raise TaskError('invalid_native_preferences','请选择有效的模型和Skill配置。',400)
    model=fields['provider_model_id'];skills=fields['skill_ids']
    if model is not None and (not isinstance(model,str) or model not in model_ids):
        raise TaskError('native_preference_model_unavailable','所选Provider模型当前不可用。')
    if not isinstance(skills,list) or len(skills)>MAX_SELECTED or any(not isinstance(item,str) or not skill_states.get(item) for item in skills) or len(set(skills))!=len(skills):
        raise TaskError('native_preference_skill_unavailable','所选Skill不存在或未启用。')
    current=read(db,cid)
    if current['revision']!=fields['revision']:raise TaskError('native_preference_revision_conflict','另一窗口已修改选择，请刷新后重试。')
    config=dict(provider_model_id=model,skill_ids=skills)
    revision=current['revision']+1
    db.execute('INSERT INTO conversation_native_preferences VALUES(?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET revision=excluded.revision,configuration=excluded.configuration,updated_at=excluded.updated_at',(cid,revision,json.dumps(config),time.time()))
    return dict(config,revision=revision)
