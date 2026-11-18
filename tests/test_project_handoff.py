import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from ai_assistant import project_files, project_handoff
from ai_assistant.service import AssistantService, Config
from ai_assistant.skill_library import HANDOFF_ID, SkillError


class ProjectHandoffTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.project = root / 'project'
        self.project.mkdir()
        self.handoff = self.project / project_handoff.PATH
        self.handoff.parent.mkdir()
        self.handoff.write_text('Previous milestone: fixture-only', encoding='utf-8')
        self.service = AssistantService(root / 'assistant.sqlite3', Config('http://127.0.0.1/v1', 'test', 'fake'))
        workspace = self.service.create_workspace('Handoff fixture', str(self.project))
        self.cid = self.service.create(workspace=workspace['id'])['id']
        self.agent = 'aabbccdd-0101-0101-0101-aabbccddeeff'
        self.skill_id = HANDOFF_ID

    def native(self, text, **context):
        response = io.BytesIO(b'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        response.headers = {'Content-Type': 'text/event-stream'}
        with patch('ai_assistant.service.urlopen', return_value=response) as upstream:
            result = list(self.service.stream(self.cid, *self.service.begin(self.cid, text, tool_context=context)))
        self.assertEqual(result[-1][0], 'done')
        messages = json.loads(upstream.call_args.args[0].data)['messages']
        return '\n'.join(message['content'] for message in messages if message['role'] == 'system')

    def test_native_context_uses_current_file_only_in_desktop_project(self):
        selected = self.service.skills.for_turn([self.skill_id])
        unselected = self.native('Continue without selecting a skill', project_desktop=True)
        self.assertNotIn('Previous milestone: fixture-only', unselected)
        first = self.native('Continue', project_desktop=True, selected_skills=selected)
        self.assertIn('Previous milestone: fixture-only', first)
        self.assertNotIn('本轮用户要求更新项目交接', first)
        self.handoff.write_text('New milestone: fixture-only', encoding='utf-8')
        trigger = self.native('请帮我更新交接', project_desktop=True, selected_skills=selected)
        self.assertIn('New milestone: fixture-only', trigger)
        self.assertIn('通过项目文件修改或新建建议工具提交', trigger)
        unauthorized = self.native('Read without desktop authorization', selected_skills=selected)
        self.assertNotIn('New milestone: fixture-only', unauthorized)
        with self.assertRaises(SkillError):
            self.service.skills.set_enabled(self.skill_id, False)
        self.assertIn('New milestone: fixture-only', self.native('Continue', project_desktop=True,
                                                                selected_skills=selected))

    def test_legacy_private_payload_cannot_replace_builtin_skill(self):
        old_id = 'a' * 32
        with self.service.db() as db:
            db.execute('INSERT INTO personal_skills VALUES(?,?,?,?,?,?,?,?,?)',
                       (old_id, 'project-handoff', 'Legacy', 0, 0, 'LEGACY_PAYLOAD', '[]', 0, 0))
        skill, = self.service.skills.list()
        self.assertEqual(skill['id'], HANDOFF_ID)
        self.assertTrue(skill['builtin'])
        instructions, = self.service.skills.for_turn([old_id, HANDOFF_ID])
        self.assertNotIn('LEGACY_PAYLOAD', instructions['instructions'])
        with self.assertRaises(SkillError):
            self.service.skills.remove(old_id)

    def test_external_context_and_pending_project_proposal(self):
        original = self.handoff.read_bytes()
        self.service.set_permission(self.cid, 'workspace_write')
        turn = self.service.begin_external_turn(self.cid, '更新交接', self.agent, 'External fixture',
                                                skill_ids=[self.skill_id])
        prepared = self.service.prepare_external_turn(self.cid, turn['turn_id'], self.agent)
        self.assertIn('Previous milestone: fixture-only', prepared['text'])
        self.assertIn('通过项目文件修改或新建建议工具提交', prepared['text'])
        fields = dict(action='read', source='source_1', path=project_handoff.PATH)
        current = self.service.external_project_file(self.cid, turn['turn_id'], self.agent, fields)
        fields.update(action='propose', content='# Updated handoff\n', expected_sha256=current['sha256'])
        result = self.service.external_project_file(self.cid, turn['turn_id'], self.agent, fields)
        self.assertEqual(result['proposal']['status'], 'pending')
        self.assertEqual(self.handoff.read_bytes(), original)

    def test_long_document_is_bounded_and_noncommand_stays_read_only_context(self):
        self.handoff.write_text('Line\n' * 80 + 'TRUNCATED_TAIL', encoding='utf-8')
        root = project_files.validate_root(str(self.project))
        data = project_handoff.render({'source_1': root}, '能更新交接吗', can_propose=True)
        self.assertIn('只提取事实', data)
        self.assertNotIn('TRUNCATED_TAIL', data)
        self.assertNotIn('本轮用户要求更新项目交接', data)
        self.assertEqual(project_handoff.render({}, '更新交接', can_propose=True), '')


if __name__ == '__main__':
    unittest.main()
