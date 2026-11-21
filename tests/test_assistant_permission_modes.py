import tempfile
from pathlib import Path
import unittest

from ai_assistant.permissions import MODES, allowed, normalize
from ai_assistant.service import AssistantService, Config


class PermissionModeTests(unittest.TestCase):
    def test_four_modes_are_explicit_and_do_not_upgrade_saved_review(self):
        self.assertEqual([row['id'] for row in MODES],
                         ['read_only', 'workspace_write', 'workspace_direct', 'full'])
        with tempfile.TemporaryDirectory() as folder:
            service = AssistantService(Path(folder) / 'assistant.sqlite3', Config('http://model.invalid', 'fixture', 'fixture'))
            for mode in ('read_only', 'workspace_write', 'workspace_direct', 'full'):
                cid = service.create(permission_mode=mode)['id']
                self.assertEqual(service.permission(cid), mode)
                self.assertEqual(service.get(cid)['conversation']['permission_mode'], mode)
            cid = service.create(permission_mode='workspace_write')['id']
            self.assertEqual(service.permission(cid), 'workspace_write')
            service.set_permission(cid, 'workspace_direct')
            self.assertEqual(service.permission(cid), 'workspace_direct')
            service.set_permission(cid, 'workspace_write')
            self.assertEqual(service.permission(cid), 'workspace_write')

    def test_workspace_direct_does_not_grant_full_powershell_or_change_read_classification(self):
        self.assertEqual(normalize('workspace_direct'), 'workspace_direct')
        self.assertEqual(normalize('invented'), 'read_only')
        self.assertFalse(allowed('read_only', 'create_deep_analysis'))
        self.assertTrue(allowed('workspace_direct', 'create_deep_analysis'))
        self.assertFalse(allowed('workspace_direct', 'run_powershell'))
        self.assertTrue(allowed('full', 'run_powershell'))
        self.assertTrue(allowed('workspace_direct', 'query_database'))


if __name__ == '__main__':
    unittest.main()
