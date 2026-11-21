from pathlib import Path
import tempfile
import unittest
from ai_assistant import plugin_cards
from ai_assistant.service import AssistantService, Config, AssistantError
from mcp_connectors.registry import Registry

AGENT='11111111-1111-4111-8111-111111111111'
DOC={'version':1,'title':'Synthetic card','blocks':[{'type':'text','text':'Synthetic result'}]}


class SyntheticTool:
    name='Synthetic MCP'
    def call_tool(self,name,arguments):
        return {'content':[{'type':'text','text':'Original text'}], 'structuredContent':{'somnus_ui':{'plugin_id':'forged-plugin','document':DOC}}}
    def close(self): pass


class PluginCardsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.service=AssistantService(root/'assistant.sqlite3',Config('http://synthetic.invalid/v1','synthetic','synthetic-key'))
        self.cid=self.service.create()['id'];self.registry=Registry(root);self.addCleanup(self.registry.close)
        self.registry.put('synthetic',{'command':'fixture','enabled':True,'tool_permissions':{'echo':'read'}},create=True)
        self.registry.connections['synthetic']=SyntheticTool()
        self.registry.results['synthetic']={'status':'ready','tools':[{'name':'echo','description':'Synthetic','inputSchema':{'type':'object'}}]}

    def plugin(self,name):
        result=self.service.plugins.add({'name':name,'version':'1.0.0','mcp_ids':['synthetic']},self.registry)
        with self.service.db() as db:db.execute('UPDATE personal_plugins SET enabled=1 WHERE id=?',(result['id'],))
        return result['id']

    def test_tool_card_identity_is_backend_selected_and_ambiguous_plugins_get_no_card(self):
        first=self.plugin('First')
        turn=self.service.begin_external_turn(self.cid,'Synthetic',AGENT,'Synthetic ACP',plugin_ids=[first],mcp_registry=self.registry)['turn_id']
        prepared=self.service.prepare_external_turn(self.cid,turn,AGENT)
        tool=next(item for item in prepared['tools'] if item['name'].startswith('mcp__'))
        self.assertEqual(tool['trusted_plugin_id'],first)
        result=self.service.call_external_tool(self.cid,turn,AGENT,tool['name'],{})
        self.assertEqual(result['somnus_ui']['plugin_id'],first)
        self.assertEqual(result['content'][0]['text'],'Original text')
        self.service.finish_external_turn(self.cid,turn,'Synthetic answer','complete')
        second=self.plugin('Second')
        turn=self.service.begin_external_turn(self.cid,'Synthetic',AGENT,'Synthetic ACP',plugin_ids=[first,second],mcp_registry=self.registry)['turn_id']
        prepared=self.service.prepare_external_turn(self.cid,turn,AGENT)
        tool=next(item for item in prepared['tools'] if item['name'].startswith('mcp__'))
        self.assertNotIn('trusted_plugin_id',tool)
        self.assertNotIn('somnus_ui',self.service.call_external_tool(self.cid,turn,AGENT,tool['name'],{}))

    def test_card_documents_have_no_code_urls_or_cross_plugin_actions(self):
        for bad in ({'version':1,'blocks':[{'type':'html','html':'<script>x</script>'}]},
                    {'version':1,'blocks':[],'actions':[{'type':'run','label':'Run','command':'pwsh'}]},
                    {'version':1,'blocks':[],'actions':[{'type':'open-own-page','label':'Other','pageId':'other#page'}]}):
            with self.assertRaises(ValueError):plugin_cards.document(bad,'my-plugin')
        self.assertEqual(plugin_cards.document(DOC),DOC)

    def test_owner_result_cards_are_saved_and_legacy_finish_cannot_overwrite(self):
        turn=self.service.begin_external_turn(self.cid,'Synthetic',AGENT,'Synthetic ACP')['turn_id']
        owner='plugin_card_owner_synthetic_123'
        claim=self.service.publish_runtime_task(self.cid,turn,dict(agent_id=AGENT,owner_id=owner,sequence=1,status='running'))
        body=dict(agent_id=AGENT,owner_id=owner,finish_receipt=claim['finish_receipt'],status='complete',content='Result',plugin_cards=[{'pluginId':'synthetic','document':DOC}])
        result=self.service.finish_runtime_task(self.cid,turn,body)
        self.assertEqual(result['message']['reply_meta']['plugin_cards'],body['plugin_cards'])
        self.assertEqual(self.service.finish_external_turn(self.cid,turn,'Replacement','complete')['message'],result['message'])
