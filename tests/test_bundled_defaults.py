from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from ai_assistant import project_files
from ai_assistant.bundled_defaults import install_bundled_defaults
from ai_assistant.service import AssistantService
from server.app import create_app


ASSETS = Path(__file__).resolve().parents[1]
HANDOFF = ASSETS / 'skills' / 'project-handoff' / 'SKILL.md'


class BundledDefaultsTests(TestCase):
    def test_fresh_desktop_selects_handoff_without_a_personal_plugin(self):
        with TemporaryDirectory() as data:
            app = create_app(data, session_mode='shared', managed_desktop=True, mcp_management=False)
            service = app.state.assistant_service
            (plugin,) = service.plugins.defaults(None)
            self.assertEqual(plugin['name'], 'Project Handoff')
            self.assertTrue(plugin['enabled'])
            self.assertFalse(plugin['missing_skills'])
            self.assertFalse(plugin['missing_mcp'])
            self.assertEqual(service.plugins.list(None), [])
            skill_ids, _ = service.plugins.select([plugin['id']], None)
            self.assertEqual(service.skills.for_turn(skill_ids)[0]['name'], 'project-handoff')
            self.assertIn('本轮用户要求更新项目交接', service._project_handoff(
                {'source_1': project_files.validate_root(data)}, '更新交接', can_propose=False))
            install_bundled_defaults(service, ASSETS)
            self.assertEqual(service.plugins.defaults(None), [plugin])
            self.assertEqual(len(service.skills.list()), 1)

    def test_preexisting_disabled_skill_is_not_reenabled(self):
        with TemporaryDirectory() as data:
            service = AssistantService(Path(data) / 'assistant.sqlite3')
            skill = service.skills.add('SKILL.md', HANDOFF.read_bytes())
            service.skills.set_enabled(skill['id'], False)
            install_bundled_defaults(service, ASSETS)
            (plugin,) = service.plugins.defaults(None)
            self.assertEqual(plugin['skill_ids'], [skill['id']])
            self.assertEqual(plugin['inactive_skills'], [skill['id']])

    def test_local_skill_with_same_name_is_preserved(self):
        with TemporaryDirectory() as data:
            service = AssistantService(Path(data) / 'assistant.sqlite3')
            skill = service.skills.add('SKILL.md', HANDOFF.read_bytes() + b'\nLocal instructions.\n')
            install_bundled_defaults(service, ASSETS)
            self.assertEqual(service.plugins.defaults(None), [])
            self.assertEqual(service.skills.list(), [skill])
