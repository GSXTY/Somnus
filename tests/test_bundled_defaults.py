from tempfile import TemporaryDirectory
from unittest import TestCase

from ai_assistant.skill_library import HANDOFF_ID
from server.app import create_app


class BundledDefaultsTests(TestCase):
    def test_managed_desktop_exposes_handoff_as_a_builtin_skill(self):
        with TemporaryDirectory() as data:
            app = create_app(data, session_mode='shared', managed_desktop=True, mcp_management=False)
            service = app.state.assistant_service
            self.assertEqual(service.plugins.defaults(None), [])
            self.assertEqual(service.plugins.list(None), [])
            (skill,) = service.skills.list()
            self.assertEqual(skill['id'], HANDOFF_ID)
            self.assertTrue(skill['enabled'])
            self.assertTrue(skill['builtin'])
            self.assertEqual(service.skills.for_turn([HANDOFF_ID])[0]['name'], 'project-handoff')
