import unittest
from unittest.mock import patch
from tools import platform_gate


class PlatformGateTests(unittest.TestCase):
    def test_current_source_and_complete_groups_are_mandatory(self):
        report = {'schema_version': 1, 'ok': True, 'fingerprint': 'current',
                  'checks': [{'id': suite[0], 'ok': True} for suite in platform_gate.SUITES]}
        with patch.object(platform_gate, 'fingerprint', return_value=('current', {})), patch.object(platform_gate, 'validate_assets', return_value={}):
            self.assertTrue(platform_gate.verify(report))
            with self.assertRaises(ValueError):
                platform_gate.verify(dict(report, checks=[]))
        with patch.object(platform_gate, 'fingerprint', return_value=('changed', {})), patch.object(platform_gate, 'validate_assets', return_value={}):
            with self.assertRaises(ValueError):
                platform_gate.verify(report)

    def test_assets_are_checked_not_only_manifest_presence(self):
        with patch.object(platform_gate, 'validate_assets', side_effect=ValueError('changed assets')):
            report = {'schema_version': 1, 'ok': True, 'fingerprint': 'current',
                      'checks': [{'id': suite[0], 'ok': True} for suite in platform_gate.SUITES]}
            with self.assertRaisesRegex(ValueError, 'changed assets'):
                platform_gate.verify(report)
