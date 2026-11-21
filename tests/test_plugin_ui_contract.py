import json,unittest
from pathlib import Path
from ai_assistant import plugin_cards
class PluginUIContractTests(unittest.TestCase):
 def test_shared_cross_language_documents(self):
  cases=json.loads((Path(__file__).parent/'fixtures/plugin-ui-contract.json').read_text(encoding='utf-8'))['cases']
  for case in cases:
   with self.subTest(case=case['name']):
    if case['valid']:plugin_cards.document(case['document'],case['plugin_id'])
    else:
     with self.assertRaises((ValueError,TypeError)):plugin_cards.document(case['document'],case['plugin_id'])
