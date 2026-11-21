from pathlib import Path
import sys,os,tempfile,subprocess
root=Path(__file__).resolve().parents[1]; selected_backend=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'launcher.py';sys.argv=[str(root/'tests/verify_platform_followup_ui.py'),str(selected_backend)]
assert Path(os.environ['SOMNUS_TEST_WEB'], 'build-manifest.json').is_file(), 'Set SOMNUS_TEST_WEB to the isolated frontend build'
node=os.environ.get('SOMNUS_TEST_NODE') or __import__('shutil').which('node')
sys.path.insert(0,str(root));from storage_paths import cache_path
shots=os.environ.get('SOMNUS_TEST_SCREENSHOTS') or str(cache_path('tmp','sidebar-view-ui',project_root=root))
scope={};exec((root/'tests/verify_platform_followup_ui.py').read_text(encoding='utf8').split("CODEX =")[0],scope)
def verify(origin):
 req=scope['request'];ws=req(origin,'/workspaces',{'name':'Sidebar synthetic project'})['workspace']['id'];other=req(origin,'/workspaces',{'name':'Other synthetic project'})['workspace']['id']
 c=req(origin,'/conversations',{'workspace':ws,'title':'Synthetic source conversation'})['conversation']['id'];b=req(origin,'/conversations',{'workspace':other,'title':'Other project conversation'})['conversation']['id'];arch=req(origin,'/conversations',{'workspace':ws,'title':'Archived fixture'})['conversation']['id']
 req(origin,f'/conversations/{arch}/organize',{'archived':True})
 agent='11111111-1111-4111-8111-111111111111';req(origin,f'/conversations/{b}/agent-members',{'agent_id':agent,'added':True});req(origin,f'/conversations/{b}/external-turns',{'agent_id':agent,'agent_name':'Codex','model':'Synthetic','member_only':True,'group_parallel':True,'content':'Synthetic running navigation task'});req(origin,f'/conversations/{c}/agent-members',{'agent_id':agent,'added':True})
 turn=req(origin,f'/conversations/{c}/external-turns',{'agent_id':agent,'agent_name':'Codex','model':'Synthetic','member_only':True,'group_parallel':True,'content':'Synthetic original input'})['turn_id']
 req(origin,f'/conversations/{c}/external-turns/{turn}/finish',{'content':'Synthetic original reply','status':'complete'})
 subprocess.run([node,str(root/'tests/sidebar_view_renderer.cjs'),origin,c,b,ws,shots],check=True,timeout=120)
with tempfile.TemporaryDirectory(prefix='somnus-sidebar-ui-') as folder:scope['run'](Path(folder),verify)

