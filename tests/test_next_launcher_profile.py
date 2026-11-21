import unittest
from pathlib import Path

from launcher import configure_product_environment


class NextLauncherProfileTests(unittest.TestCase):
    def test_source_entry_uses_independent_data_and_configuration(self):
        env = {'APPDATA': str(Path('new-profile').absolute())}
        result = configure_product_environment(env)
        self.assertTrue(Path(result['AI_AGENT_DATA_DIR']).as_posix().endswith('/VVFLY/SomnusNext/data'))
        self.assertEqual(result['SOMNUS_PROFILE_CONFIG_ONLY'], '1')
        self.assertEqual(result['SOMNUS_DSH_CONFIGURED_PROVIDERS'], '1')

    def test_explicit_isolated_profile_and_safe_mode_are_preserved(self):
        env = {'AI_AGENT_DATA_DIR': 'explicit-test-data', 'SOMNUS_PROFILE_CONFIG_ONLY': 'safe'}
        result = configure_product_environment(env)
        self.assertEqual(result['AI_AGENT_DATA_DIR'], 'explicit-test-data')
        self.assertEqual(result['SOMNUS_PROFILE_CONFIG_ONLY'], 'safe')


if __name__ == '__main__':
    unittest.main()
