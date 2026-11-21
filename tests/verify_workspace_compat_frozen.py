from contextlib import closing
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


backend = Path(sys.argv[1]).resolve(strict=True)
NATIVE_TOKEN = 'c' * 64


def request(origin, path, body=None):
    raw = None if body is None else json.dumps(body).encode()
    with urlopen(Request(origin + '/api/assistant' + path, data=raw,
                         headers={'Content-Type': 'application/json', 'X-Data-Agent-Local': '1',
                                  'X-Data-Agent-Native': NATIVE_TOKEN}), timeout=10) as response:
        return json.load(response)


def run(folder, callback):
    ready = folder / 'ready.json'
    log = folder / ('backend-'+callback.__name__+'.log')
    started = time.monotonic()
    data = folder / 'data'
    native_token = NATIVE_TOKEN
    env = {**os.environ, 'SOMNUS_PROFILE_CONFIG_ONLY': '1', 'AI_AGENT_DATA_DIR': str(data),
           'RESPIRATORY_VIEWER_PROJECT_TOKEN': native_token, 'ANALYTICS_DB_URL': '',
           'DATA_AGENT_REMOTE_URL': '', 'DATA_AGENT_REMOTE_TOKEN': ''}
    with log.open('wb') as output:
        process = subprocess.Popen([
            *([sys.executable, str(backend)] if backend.suffix == '.py' else [str(backend)]), '--host', '127.0.0.1', '--port', '0', '--no-window', '--no-browser',
            '--session-mode', 'shared', '--ready-file', str(ready), '--shutdown-on-stdin-close',
            '--data-dir', str(data)
        ], cwd=folder, env=env, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            deadline = time.monotonic() + 90
            while not ready.is_file():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(json.dumps(dict(stage=callback.__name__,pid=process.pid,exit_code=process.poll(),elapsed=round(time.monotonic()-started,2),ready_exists=ready.exists(),synthetic_profile=str(folder),log_path=str(log)))+'\n'+log.read_text(encoding='utf-8',errors='replace')[-3000:])
                time.sleep(.1)
            port = json.loads(ready.read_text(encoding='utf-8'))['port']
            callback(f'http://127.0.0.1:{port}')
            process.stdin.close()
            assert process.wait(timeout=25) == 0
            assert not ready.exists()
        finally:
            if process.poll() is None:
                try:
                    process.stdin.close()
                    process.wait(timeout=25)
                except Exception:
                    process.kill()
                    process.wait(timeout=10)



AGENT='11111111-1111-4111-8111-111111111111'
OWNER='synthetic-workspace-compat-owner-12345'
state={}
original_request=request
def request(origin,path,body=None,method=None):
 try:
  if method is None:return original_request(origin,path,body)
  with urlopen(Request(origin+'/api/assistant'+path,data=json.dumps(body).encode(),method=method,headers={'Content-Type':'application/json','X-Data-Agent-Local':'1','X-Data-Agent-Native':NATIVE_TOKEN}),timeout=15) as response:return json.load(response)
 except HTTPError as error:raise RuntimeError(f'{path}: {error.code} '+error.read().decode()) from error

def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.STDOUT,text=True).strip()
def file_hashes(root):return {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('tracked.txt','untracked.txt')}

import hashlib
# Project roots must not sit below hidden .tmp: production file guards are unchanged.
project_temp_parent=Path(os.environ.get('SOMNUS_TEST_PROFILE_PARENT',str(Path(__file__).resolve().parents[1].parent/'Data_Agent'/'acceptance-temp'))).resolve()
project_temp_parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='somnus-workspace-compat-project-',dir=project_temp_parent,delete=False) as project_directory, tempfile.TemporaryDirectory(prefix='somnus-workspace-compat-profile-',dir=project_temp_parent,delete=False) as directory:
 profile=Path(directory);repo=Path(project_directory)/'repo';repo.mkdir()
 assert repo.resolve().is_relative_to(project_temp_parent.resolve())
 git(repo,'init');git(repo,'config','user.email','synthetic@example.invalid');git(repo,'config','user.name','Synthetic')
 (repo/'tracked.txt').write_text('original',encoding='utf-8');git(repo,'add','tracked.txt');git(repo,'commit','-m','synthetic')
 def populate(origin):
  grant=request(origin,'/project-folder-grants',{'path':str(repo)})
  workspace=request(origin,'/workspaces',{'name':'Synthetic workspace compatibility','root_path':str(repo),'folder_grant':grant['folder_grant']})['workspace']['id']
  cid=request(origin,'/conversations',{'workspace':workspace,'title':'Synthetic long fork'})['conversation']['id']
  target=request(origin,f'/conversations/{cid}/worktree-target',{'source':'source_1'})
  tree=Path(target['worktrees_path'])/(cid+'-'+'a'*16);tree.parent.mkdir(exist_ok=True)
  branch='vvman/'+tree.name;git(repo,'worktree','add','-b',branch,str(tree));commit=git(tree,'rev-parse','HEAD')
  request(origin,f'/conversations/{cid}/worktree',dict(source='source_1',base_root_key=target['root_key'],root_path=str(tree),branch=branch,commit=commit))
  (tree/'tracked.txt').write_text('dirty tracked',encoding='utf-8');(tree/'untracked.txt').write_text('untracked 😀',encoding='utf-8');hashes=file_hashes(tree)
  tid=request(origin,f'/conversations/{cid}/external-turns',dict(agent_id=AGENT,agent_name='Synthetic',content='Synthetic model-free request'))['turn_id']
  with closing(sqlite3.connect(profile/'data/assistant.sqlite3')) as db:
   db.execute("UPDATE runtime_tasks SET runtime='dsh-native' WHERE id=?",(tid,));db.execute("UPDATE messages SET transport='dsh-native' WHERE id=?",(tid,));db.commit()
  receipt=request(origin,f'/conversations/{cid}/runtime-tasks/{tid}/state',dict(agent_id=AGENT,owner_id=OWNER,sequence=1,status='running'))['finish_receipt']
  native=dict(session_id='synthetic-worktree-parent',start_seq=0,last_seq=400,assistant_event_seq=399,children=[dict(session_id='synthetic-long-child',parent_session_id='synthetic-worktree-parent',source_seq=0,last_seq=350)])
  request(origin,f'/conversations/{cid}/native-sessions',dict(turn_id=tid,owner_id=OWNER,**native))
  card=dict(pluginId='synthetic-plugin',document=dict(version=1,blocks=[dict(type='table',columns=[dict(key='count',label='Count')],rows=[dict(count='2')]),dict(type='chart',chartType='bar',labels=['day'],series=[dict(label='Count',values=[2])]),dict(type='status',label='Ready',state='success'),dict(type='form',fields=[dict(key='enabled',label='Enabled',kind='boolean',value=True)],submitActionId='save')],actions=[dict(type='save-own-settings',id='save',label='Save',sectionId='synthetic-plugin#settings',revision=0)]))
  request(origin,f'/conversations/{cid}/runtime-tasks/{tid}/finish',dict(agent_id=AGENT,owner_id=OWNER,finish_receipt=receipt,status='complete',content='SYNTHETIC-COMPAT-OK',native_history=native,plugin_cards=[card]))
  reserved=request(origin,f'/conversations/{cid}/native-forks',dict(turn_id=tid,at_seq=349,child_session_id='synthetic-long-child',worktree_policy='share-current'));rid=reserved['reservation_id']
  assert not any(c['id']==reserved['conversation_id'] for c in request(origin,'/conversations')['conversations'])
  records=[dict(seq=i,part=0,role='assistant' if i%2 else 'user',content=f'{i}: '+'Synthetic history 😀 '*200,final=True) for i in range(1,241)]
  expected=hashlib.sha256(''.join(r['content'] for r in records).encode()).hexdigest();assert sum(len(r['content'].encode()) for r in records)>512*1024
  pages=[records[i:i+5] for i in range(0,len(records),5)]
  for index,page in enumerate(reversed(pages)):
   data=dict(source_session_id='synthetic-long-child',page_index=index,records=page,done=index==len(pages)-1)
   request(origin,f'/native-forks/{rid}/history/pages',data)
   if index==0:assert request(origin,f'/native-forks/{rid}/history/pages',data)['accepted'] is False
  child=request(origin,f'/native-forks/{rid}/commit',dict(session_id='synthetic-worktree-fork',source_session_id='synthetic-long-child',at_seq=349,history_archive=True))['conversation']
  assert child['permission_mode']=='read_only' and child['worktree']['shared'] and child['worktree']['owner_conversation_id']==cid
  assert child['inherited_history']['fragment_count']==240 and child['inherited_history']['content_sha256']==expected
  prefs=request(origin,f'/conversations/{child["id"]}/native-preferences',dict(revision=0,provider_model_id=None,skill_ids=[]),method='PUT');assert prefs['revision']==1
  assert file_hashes(tree)==hashes
  state.update(cid=cid,tid=tid,child=child['id'],card=card,expected=expected,tree=tree,hashes=hashes)
 def verify_restart(origin):
  value=request(origin,f'/conversations/{state["cid"]}');reply=next(m for m in value['messages'] if m['id']==state['tid']);assert reply['reply_meta']['plugin_cards']==[state['card']]
  assert request(origin,f'/conversations/{state["child"]}/native-preferences')['revision']==1
  cursor=None;digest=hashlib.sha256();count=0
  while True:
   page=request(origin,f'/conversations/{state["child"]}/inherited-history?limit=7'+('&after='+cursor if cursor else ''))
   for record in page['records']:digest.update(record['content'].encode());count+=1
   cursor=page['next_cursor']
   if not cursor:break
  assert count==240 and digest.hexdigest()==state['expected']
  assert file_hashes(state['tree'])==state['hashes']
  location=request(origin,f'/conversations/{state["child"]}/worktree-location',{});assert location
 run(profile,populate);run(profile,verify_restart)
 import shutil,stat
 def remove_readonly(function,path,error):
  target=Path(path).resolve()
  assert target.is_relative_to(project_temp_parent)
  os.chmod(path,stat.S_IWRITE)
  function(path)
 for candidate in (Path(project_directory),profile):
  assert candidate.resolve().is_relative_to(project_temp_parent) and candidate.name.startswith('somnus-workspace-compat-')
  shutil.rmtree(candidate,onexc=remove_readonly)
print('PASS actual backend HTTP: verified dirty worktree shared read-only fork, >512KiB/240-record staged archive/restart/page hash, independent preferences and new plugin cards; zero model invocation.')
