import copy
import unittest
from ai_assistant import plugin_contract, plugin_package
from ai_assistant.plugin_bundles import BundleError
from app_version import APP_VERSION


class PluginContractTests(unittest.TestCase):
    def package(self):
        return {'format': 'somnus.plugin.v1', 'minimum_somnus_version': APP_VERSION,
                'manifest': {'name': 'Synthetic', 'version': '1.0.0', 'mcp_ids': []},
                'skills': [{'name': 'synthetic', 'description': 'Synthetic test', 'instructions': 'Reply OK.', 'references': []}]}

    def test_legacy_and_declared_are_parseable_without_execution(self):
        package = self.package()
        self.assertTrue(plugin_contract.describe(skills=True)['legacy'])
        plugin_package.parse(package)
        package['contract'] = {'schema_version': 1, 'runtime': 'somnus', 'capabilities': ['skills']}
        plugin_package.parse(package)
        for bad in ({'schema_version': 2}, {'schema_version': 1, 'command': 'pwsh'},
                    {'schema_version': 1, 'capabilities': ['ui.sidebar']},
                    {'schema_version': 1, 'runtime': 'unknown'}):
            package['contract'] = bad
            with self.assertRaises(BundleError):
                plugin_package.parse(package)


if __name__ == '__main__':
    unittest.main()
