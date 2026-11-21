"""Isolated native session API fixture. No provider/model invocation or user data."""
import json,os,socket,tempfile,subprocess,time
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit
from fastapi import FastAPI
import uvicorn
from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService,Config
home=tempfile.TemporaryDirectory()
root=Path(home.name)/'project';root.mkdir()
worktree_env=os.getenv('SOMNUS_TEST_WORKTREE_ROOT','')
worktree_root=None
if worktree_env:
 worktree_root=Path(worktree_env).resolve(strict=True)
 if not worktree_root.is_relative_to(Path(tempfile.gettempdir()).resolve()):raise ValueError('Fixture worktree must be temporary data')
 common=Path(subprocess.check_output(['git','-C',str(worktree_root),'rev-parse','--git-common-dir'],text=True).strip())
 if not common.is_absolute():common=worktree_root/common
 root=common.resolve(strict=True).parent
 if not root.is_relative_to(Path(tempfile.gettempdir()).resolve()):raise ValueError('Fixture repository must be temporary data')
config=Config('http://synthetic.invalid/v1','synthetic','synthetic-key')
database=Path(home.name)/'assistant.sqlite3'
service=AssistantService(database,config)
workspace=service.create_workspace('Synthetic native project',str(root))['id']
cid=service.create(workspace=workspace)['id'];agent=os.getenv('SOMNUS_TEST_AGENT_ID','11111111-1111-4111-8111-111111111111')
if worktree_root:
 from ai_assistant import project_files,worktree_binding
 base=project_files.validate_root(str(root));binding=project_files.validate_root(str(worktree_root))
 branch=subprocess.check_output(['git','-C',str(worktree_root),'branch','--show-current'],text=True).strip()
 commit=subprocess.check_output(['git','-C',str(worktree_root),'rev-parse','HEAD'],text=True).strip()
 if not worktree_binding.verify(root,worktree_root,branch=branch,commit=commit):raise ValueError('Worktree failed production verification')
 with service.db() as db:db.execute('INSERT INTO conversation_worktrees VALUES(?,?,?,?,?,?,?,?,?,?)',(cid,workspace,'source_1',*base,*binding,branch,commit,time.time()))
 root=worktree_root
doc_id=service.save_document('synthetic-continuation.txt',b'SYNTHETIC-DOCUMENT-CONTINUATION-MARKER')['id']
skill_id=service.skills.add('SKILL.md',b'---\nname: synthetic-continuation\ndescription: Synthetic acceptance only\n---\nSYNTHETIC-SKILL-CONTINUATION-MARKER')['id']
model_origin=os.getenv('SOMNUS_TEST_MODEL_ORIGIN','').rstrip('/')
model_id=None
if model_origin:
 parsed=urlsplit(model_origin)
 if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or parsed.path or parsed.username or parsed.password:
  raise ValueError('Synthetic model origin must be a plain loopback HTTP origin')
 if agent!='fbbce833-544a-42a1-8579-cba2a817383e':
  raise ValueError('Synthetic provider fixture requires native Somnus agent identity')
 os.environ['SOMNUS_DSH_CONFIGURED_PROVIDERS']='1'
 model_id=service.models.put(dict(name='Synthetic local model',base_url=model_origin+'/v1',api_key='synthetic-only',model='synthetic',api='openai-completions'))['id']
app=FastAPI();app.state.session_mode='shared';app.state.assistant_service=service
def reserve(target,content='Synthetic native request',file_ids=None,skill_ids=None):
 service=app.state.assistant_service
 turn=service.begin_external_turn(target,content,agent,'Somnus',provider_model_id=model_id,file_ids=file_ids,skill_ids=skill_ids)['turn_id']
 with service.db() as db:
  db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(turn,))
  db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(turn,))
 return turn
turn=reserve(cid)
token='b'*64
with patch.dict(os.environ,{'RESPIRATORY_VIEWER_PROJECT_TOKEN':token,'SHARE_MODE':''}),patch('ai_assistant.project_access.sys.platform','win32'):
 app.include_router(create_router())
@app.post('/fixture/reserve')
def reserve_route(body:dict): return {'turn_id':reserve(body.get('conversation_id',cid),body.get('content','Synthetic native request'),body.get('file_ids'),body.get('skill_ids'))}
@app.post('/fixture/restart')
def restart():
 app.state.assistant_service=AssistantService(database,config)
 return {'ok':True}
sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(128)
print(json.dumps({'origin':'http://127.0.0.1:'+str(sock.getsockname()[1]),'cid':cid,'agent':agent,'turn_id':turn,'token':token,'root':str(root),'provider_model_id':model_id,'model_origin':model_origin or None,'doc_id':doc_id,'skill_id':skill_id,'worktree':bool(worktree_root)}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='error')).run(sockets=[sock])
