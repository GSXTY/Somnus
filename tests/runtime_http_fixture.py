"""Isolated actual ASGI fixture for Node host contract tests; synthetic data only."""
import json,os,socket,tempfile
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
import uvicorn
from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService,Config
home=tempfile.TemporaryDirectory()
config=Config('http://synthetic.invalid/v1','synthetic','synthetic-key')
db=Path(home.name)/'assistant.sqlite3'
service=AssistantService(db,config)
cid=service.create()['id'];agent='11111111-1111-4111-8111-111111111111'
turns=[service.begin_external_turn(cid,'Synthetic request',agent,'Synthetic agent')['turn_id'] for _ in range(1)]
app=FastAPI();app.state.session_mode='shared';app.state.assistant_service=service
token='b'*64
with patch.dict(os.environ,{'RESPIRATORY_VIEWER_PROJECT_TOKEN':token,'SHARE_MODE':''}),patch('ai_assistant.project_access.sys.platform','win32'):
 app.include_router(create_router())
@app.post('/fixture/reserve')
def reserve():
 return {'turn_id': app.state.assistant_service.begin_external_turn(cid,'Synthetic request',agent,'Synthetic agent')['turn_id']}
@app.post('/fixture/restart')
def restart():
 app.state.assistant_service=AssistantService(db,config)
 return {'ok':True}
sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(128)
print(json.dumps({'origin':'http://127.0.0.1:'+str(sock.getsockname()[1]),'cid':cid,'agent':agent,'turns':turns,'token':token}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='error')).run(sockets=[sock])
