import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService, Config
from ai_assistant.skill_library import HANDOFF_ID, MAX_EXPANDED, parse_upload, SkillError


DEFINITION = '''---
name: report-review
description: >-
  Review reports using
  a concise checklist.
allowed-tools: run_shell
---
Check the example marker first.
'''


def archive(items):
    output = io.BytesIO()
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as package:
        for path, content in items:
            package.writestr(path, content)
    return output.getvalue()


class Upstream(io.BytesIO):
    headers = {'Content-Type': 'text/event-stream'}


class SkillTests(unittest.TestCase):
    def test_rejects_zip_traversal_links_duplicates_and_expansion(self):
        symlink = ZipInfo('report-review/references/link.txt')
        symlink.create_system = 3
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        valid = ('report-review/SKILL.md', DEFINITION)
        unsafe_cases = [
            [(r'../hidden.txt', 'secret')],
            [('report-review/references/checklist.txt', 'one'),
             ('report-review/REFERENCES/CHECKLIST.TXT', 'two')],
            [(symlink, 'C:/local')],
            [('oversized.bin', b'a' * (MAX_EXPANDED + 1))],
            [('report-review/references/not-text.txt', b'\xffabc')],
        ]
        for index, items in enumerate(unsafe_cases):
            with self.subTest(index=index), self.assertRaises(SkillError):
                parse_upload('report.zip', archive([valid, *items]))
        raw = archive([valid, ('folder/file.txt', 'unwanted')])
        # zipfile.writestr normalizes Windows separators; simulate untrusted central directory bytes.
        with self.assertRaises(SkillError):
            parse_upload('report.zip', raw.replace(b'folder/file.txt', b'folder\\file.txt'))
        with self.assertRaises(SkillError):
            parse_upload('SKILL.md', b'---\nname: !!python/object:bad {}\ndescription: unsafe\n---\ntext')

    def test_standalone_frontmatter_quotes_and_literal_blocks(self):
        raw = b"""---
name: 'code-review'
description: |-
  Read the patch.
  Identify risks.
---
Follow the checklist.
"""
        parsed = parse_upload('SKILL.md', raw)
        self.assertEqual(parsed['name'], 'code-review')
        self.assertEqual(parsed['description'], 'Read the patch.\nIdentify risks.')
        self.assertEqual(parsed['instructions'], 'Follow the checklist.')

    def test_desktop_crud_and_explicit_turn_context(self):
        with tempfile.TemporaryDirectory() as directory:
            app = FastAPI()
            app.state.session_mode = 'shared'
            path = Path(directory) / 'assistant.sqlite3'
            config = Config('http://127.0.0.1/v1', 'test', 'fake')
            service = app.state.assistant_service = AssistantService(path, config)
            token = 'a' * 64
            with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': token, 'SHARE_MODE': ''}):
                with patch('ai_assistant.project_access.sys.platform', 'win32'):
                    app.include_router(create_router())
            cookie = hmac.digest(token.encode(), b'vvman-project-browser-session', hashlib.sha256).hex()
            origin = 'http://127.0.0.1:9876'
            desktop = {'origin': origin, 'cookie': 'respiratory_desktop=' + cookie}
            root = '/api/assistant'
            payloads = []

            def respond(request, **kwargs):
                payloads.append(json.loads(request.data))
                return Upstream(b'data: {"choices":[{"delta":{"content":"mocked"}}]}\n\ndata: [DONE]\n\n')

            with TestClient(app, base_url=origin, client=('127.0.0.1', 30000)) as client:
                zip_file = archive([('report-review/SKILL.md', DEFINITION),
                                    ('report-review/references/checklist.md', 'REFERENCE marker'),
                                    ('report-review/scripts/test.py', 'SCRIPT marker')])
                upload = {'X-Filename': 'report.zip', 'Content-Type': 'application/octet-stream'}
                route = root + '/skills/import'
                self.assertEqual(client.post(route, headers=upload, content=zip_file).status_code, 403)
                result = client.post(route, headers={**desktop, **upload}, content=zip_file)
                self.assertEqual(result.status_code, 201, result.text)
                skill = result.json()['skill']
                self.assertEqual((skill['reference_count'], skill['ignored_count']), (1, 1))
                self.assertEqual(skill['description'], 'Review reports using a concise checklist.')
                self.assertEqual(client.post(route, headers={**desktop, **upload}, content=zip_file).status_code, 409)
                self.assertEqual(client.get(root + '/skills').status_code, 403)
                reopened = AssistantService(path, config)
                builtin, imported = reopened.skills.list()
                self.assertEqual(imported, skill)
                self.assertEqual(builtin['id'], HANDOFF_ID)
                self.assertTrue(builtin['builtin'])
                builtin_route = root + '/skills/' + HANDOFF_ID
                self.assertEqual(client.patch(builtin_route, json={'enabled': False}, headers=desktop).status_code, 409)
                self.assertEqual(client.delete(builtin_route, headers=desktop).status_code, 409)
                cid = service.create()['id']
                chat = f'{root}/conversations/{cid}/messages'
                selected = {'content': 'Review this report.', 'skill_ids': [skill['id']]}
                self.assertEqual(client.post(chat, json=selected).status_code, 403)
                with patch('ai_assistant.service.urlopen', side_effect=respond):
                    self.assertEqual(client.post(chat, json=selected, headers=desktop).status_code, 200)
                    self.assertEqual(client.post(chat, json={'content': 'Different question.'}, headers=desktop).status_code, 200)
                first = json.dumps(payloads[0], ensure_ascii=False)
                later = json.dumps(payloads[1], ensure_ascii=False)
                self.assertIn('Check the example marker first.', first)
                self.assertIn('REFERENCE marker', first)
                self.assertIn('按系统规则、本轮用户要求和实际授权应用 instructions', first)
                self.assertNotIn('run_shell', first)
                self.assertNotIn('SCRIPT marker', first)
                self.assertNotIn('Check the example marker first.', later)
                skill_route = root + '/skills/' + skill['id']
                self.assertFalse(client.patch(skill_route, json={'enabled': False}, headers=desktop).json()['skill']['enabled'])
                self.assertEqual(client.post(chat, json=selected, headers=desktop).status_code, 409)
                self.assertTrue(client.delete(skill_route, headers=desktop).json()['deleted'])
                self.assertEqual(client.post(chat, json=selected, headers=desktop).status_code, 409)
                self.assertEqual(client.get(root + '/skills', headers=desktop).json()['skills'], [builtin])
