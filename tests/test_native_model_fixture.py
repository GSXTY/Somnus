"""Contract checks for the loopback-only synthetic model acceptance fixture."""
import json
import threading
import unittest
from urllib.request import Request,urlopen
from tests.native_fake_model_fixture import SyntheticModel,KEY


class SyntheticModelFixtureTests(unittest.TestCase):
    def setUp(self):
        self.server=SyntheticModel()
        self.worker=threading.Thread(target=self.server.serve_forever,daemon=True);self.worker.start()
        self.addCleanup(self.server.server_close);self.addCleanup(self.server.shutdown)
        self.origin='http://127.0.0.1:'+str(self.server.server_address[1])
    def post(self,path,body):
        request=Request(self.origin+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
        with urlopen(request,timeout=5) as response:return response.read().decode()
    def test_chat_stream_preserves_context_marker_and_has_no_tool_execution(self):
        result=self.post('/v1/chat/completions',{'model':'synthetic','stream':True,'messages':[{'role':'user','content':'Remember SOMNUS_MEMORY_parent_fixture'},{'role':'assistant','content':'Stored'},{'role':'user','content':'Recall'}]})
        self.assertIn('INHERITED_CONTEXT SOMNUS_MEMORY_parent_fixture',result)
        self.assertIn('data: [DONE]',result)
        self.assertNotIn('tool_calls',result)
        with urlopen(self.origin+'/requests',timeout=5) as response: records=json.load(response)['requests']
        self.assertEqual(records[0]['markers'],['SOMNUS_MEMORY_parent_fixture'])
        self.assertNotIn('Remember',json.dumps(records))
    def test_responses_and_nonstream_chat_are_synthetic_only(self):
        result=json.loads(self.post('/v1/chat/completions',{'model':'synthetic','messages':[{'role':'user','content':'No memory'}]}))
        self.assertIn('MEMORY_MISSING',result['choices'][0]['message']['content'])
        stream=self.post('/v1/responses',{'model':'synthetic','stream':True,'input':[{'role':'user','content':[{'type':'input_text','text':'SOMNUS_MEMORY_response_fixture'}]}]})
        self.assertIn('event: response.completed',stream)
        self.assertIn('INHERITED_CONTEXT SOMNUS_MEMORY_response_fixture',stream)
