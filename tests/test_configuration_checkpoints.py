import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService, Config


class ConfigurationCheckpointTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        folder = Path(temporary.name)
        self.service = AssistantService(folder / 'assistant.sqlite3', Config('https://builtin.invalid', 'builtin', 'builtin-secret'))
        self.service.models.legacy = folder / 'missing.json'
        self.model = self.service.models.put(dict(name='Private provider', base_url='https://api.invalid/v1',
                                                  model='fixture', api_key='private-model-key'))
        self.service.models.set_active(self.model['id'])
        self.skill = self.service.skills.add('SKILL.md', b'---\nname: test-skill\ndescription: Test\n---\nTest instructions')['id']
        self.plugin = self.service.plugins.add(dict(name='Personal plugin', skill_ids=[self.skill]), None)['id']
        self.service.plugins.set_enabled(self.plugin, True, None)
        self.conversation = self.service.create()['id']
        app = FastAPI()
        app.state.session_mode = 'shared'
        app.state.assistant_service = self.service
        self.token = 'a' * 64
        with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': self.token, 'SHARE_MODE': ''}):
            with patch('ai_assistant.project_access.sys.platform', 'win32'):
                app.include_router(create_router())
        origin = 'http://127.0.0.1:9876'
        cookie = hmac.digest(self.token.encode(), b'vvman-project-browser-session', hashlib.sha256).hex()
        self.desktop = {'origin': origin, 'cookie': 'respiratory_desktop=' + cookie}
        self.client = TestClient(app, base_url=origin, client=('127.0.0.1', 30000))
        self.addCleanup(self.client.close)
        self.route = '/api/assistant/configuration-checkpoints'

    def read(self):
        response = self.client.get(self.route, headers=self.desktop)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def save(self, headers=None, **fields):
        return self.client.post(self.route, headers=headers or self.desktop,
                                json={'revision': self.read()['revision'], **fields})

    def restore(self, checkpoint_id):
        return self.client.post(self.route + f'/{checkpoint_id}/restore', headers=self.desktop, json={})

    def test_verified_checkpoint_references_and_atomic_restore(self):
        with patch.object(self.service, 'test_model', return_value={'ok': True}) as probe:
            response = self.save()
        self.assertEqual(response.status_code, 201, response.text)
        probe.assert_called_once()
        checkpoint = response.json()
        self.assertNotIn('private-model-key', response.text)
        self.assertNotIn('builtin-secret', response.text)
        self.assertNotIn('Test instructions', json.dumps(self.read()))

        self.service.models.set_active('deepseek')
        self.service.plugins.set_enabled(self.plugin, False, None)
        with patch.object(self.service.models, '_write_selection', side_effect=sqlite3.OperationalError):
            self.assertEqual(self.restore(checkpoint['id']).status_code, 503)
        self.assertFalse(self.service.plugins.list(None)[0]['enabled'])
        self.assertEqual(self.service.models.list(self.service.builtin_model())['active'], 'deepseek')

        restored = self.restore(checkpoint['id'])
        self.assertEqual(restored.status_code, 200, restored.text)
        reopened = AssistantService(self.service.path, self.service.config)
        self.assertEqual(reopened.models.list(reopened.builtin_model())['active'], self.model['id'])
        self.assertTrue(reopened.plugins.list(None)[0]['enabled'])
        self.assertEqual(reopened.get(self.conversation)['conversation']['id'], self.conversation)

    def test_validation_and_desktop_boundary(self):
        self.assertEqual(self.client.get(self.route).status_code, 403)
        with patch.object(self.service, 'test_model', return_value={'ok': False, 'message': '连接失败'}):
            self.assertEqual(self.save().status_code, 409)
        self.assertEqual(self.read()['checkpoints'], [])
        agent = dict(id='local-agent', name='Local Agent')
        self.assertEqual(self.save(agent=agent).status_code, 403)
        native = {'X-Data-Agent-Native': self.token, 'X-Data-Agent-Local': '1'}
        response = self.save(headers=native, agent=agent)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['agent'], agent)

        preview = self.read()
        self.service.models.set_active('deepseek')
        stale = self.client.post(self.route, headers=self.desktop, json={'revision': preview['revision']})
        self.assertEqual(stale.status_code, 409)
        self.service.plugins.remove(self.plugin)
        denied = self.restore(response.json()['id'])
        self.assertEqual(denied.status_code, 409)
        self.assertEqual(self.read()['current']['model']['id'], 'deepseek')


if __name__ == '__main__':
    unittest.main()
