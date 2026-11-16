from dataclasses import replace
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError

from fastapi.testclient import TestClient

from model_relay.app import Settings, UPSTREAM, create_app
from model_relay.control import RelayControl


class ModelRelayTests(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.settings = Settings(
            'synthetic-upstream-key', ('a' * 43, 'b' * 43), ('deepseek-flash',),
            Path(folder) / 'quota.db', per_invite_daily=2, total_daily=3,
            max_request_bytes=1024, max_output_tokens=24)
        self.opened = []

        def fake_upstream(request, timeout):
            self.opened.append((request, timeout))
            response = BytesIO(b'data: {"choices":[]}\n\ndata: [DONE]\n\n')
            response.headers = {'content-type': 'text/event-stream'}
            return response

        self.upstream = fake_upstream
        self.client = TestClient(create_app(self.settings, open_upstream=self.upstream))
        self.body = {'model': 'deepseek-flash', 'stream': True,
                     'messages': [{'role': 'user', 'content': 'Synthetic'}]}

    def post(self, token='a' * 43, **fields):
        return self.client.post('/v1/chat/completions', json={**self.body, **fields},
                                headers={'Authorization': 'Bearer ' + token})

    def test_bounded_stream_uses_upstream_key_and_no_other_service_routes(self):
        result = self.post(max_tokens=500, api_key='injected-key', base_url='https://invalid.example',
                           tools=[{'type': 'function', 'function': {'name': 'demo'}}])
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.headers['content-type'].startswith('text/event-stream'))
        self.assertIn('data: [DONE]', result.text)
        self.assertNotIn(self.settings.upstream_key, result.text)
        request, timeout = self.opened[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url, UPSTREAM)
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + self.settings.upstream_key)
        self.assertEqual(payload['max_tokens'], 24)
        self.assertIn('tools', payload)
        self.assertNotIn('api_key', payload)
        self.assertNotIn('base_url', payload)
        self.assertGreater(timeout, 0)
        self.assertEqual(self.client.get('/api/workbench').status_code, 404)

    def test_auth_allowlist_and_body_limit_before_transmission(self):
        self.assertEqual(self.post(token='c' * 43).status_code, 401)
        self.assertEqual(self.post(model='other-model').status_code, 400)
        self.assertEqual(self.post(stream=False).status_code, 400)
        self.assertEqual(self.post(messages=[{'content': 'x' * 1024}]).status_code, 400)
        self.assertEqual(self.opened, [])

    def test_owner_toggle_takes_effect_without_restarting_or_using_quota(self):
        control = RelayControl(self.settings.database.with_name('sharing.json'))
        self.client = TestClient(create_app(self.settings, open_upstream=self.upstream, control=control))
        self.assertEqual(self.post(token='c' * 43).status_code, 401)
        self.assertEqual(self.post().status_code, 503)
        control.set_enabled(True)
        self.assertEqual(self.post().status_code, 200)
        control.set_enabled(False)
        self.assertEqual(self.post().status_code, 503)
        control.set_enabled(True)
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(len(self.opened), 2)

    def test_invalid_owner_flag_stays_closed(self):
        control = RelayControl(self.settings.database.with_name('sharing.json'))
        for invalid in ('{', '{"enabled":1}', '{"enabled":true,"other":0}', '["enabled"]', ' ' * 128):
            with self.subTest(invalid=invalid):
                control.path.write_text(invalid, encoding='utf-8')
                self.assertFalse(control.enabled())
        control.set_enabled(True)
        self.assertTrue(RelayControl(control.path).enabled())
        self.assertEqual(list(control.path.parent.glob('.sharing-*')), [])

    def test_quota_survives_restart_and_takes_tokens_out_of_circulation(self):
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.post().status_code, 200)
        self.client = TestClient(create_app(self.settings, open_upstream=self.upstream))
        self.assertEqual(self.post().status_code, 429)
        self.assertEqual(self.post(token='b' * 43).status_code, 200)
        self.assertEqual(self.post(token='b' * 43).status_code, 429)
        self.client = TestClient(create_app(replace(self.settings, invites=('b' * 43,)),
                                            open_upstream=self.upstream))
        self.assertEqual(self.post().status_code, 401)
        self.assertEqual(len(self.opened), 3)

    def test_upstream_error_body_is_private(self):
        def rejected(request, timeout):
            raise HTTPError(UPSTREAM, 401, 'private upstream payload', {}, BytesIO())

        self.client = TestClient(create_app(self.settings, open_upstream=rejected))
        result = self.post()
        self.assertEqual(result.status_code, 502)
        self.assertNotIn('private upstream payload', result.text)
