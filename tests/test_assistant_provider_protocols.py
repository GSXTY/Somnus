from contextlib import closing
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from ai_assistant.asgi import create_router
from ai_assistant.models import BEDROCK_API, CHAT_API, MESSAGES_API, RESPONSES_API
from ai_assistant.service import AssistantService, Config


class ProviderProtocolTests(unittest.TestCase):
    def test_authorized_protocol_routes_keep_keys_and_public_metadata_separate(self):
        env = {'SOMNUS_DSH_CONFIGURED_PROVIDERS': '1', 'SOMNUS_PROFILE_CONFIG_ONLY': '1', 'SHARE_MODE': '0',
               'RESPIRATORY_VIEWER_PROJECT_TOKEN': 'a' * 64, 'SOMNUS_TEST_MESSAGES_KEY': 'messages-fixture',
               'AWS_REGION': 'us-west-2', 'AWS_BEARER_TOKEN_BEDROCK': 'bedrock-fixture'}
        policy = {'mode': 'normal', 'maxRetries': 2, 'retryableCodes': ['SERVER'],
                  'backoff': {'initialDelayMs': 50, 'maxDelayMs': 200, 'jitterRatio': 0}}
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, env):
            path = Path(folder) / 'assistant.sqlite3'
            service = AssistantService(path, Config())
            app = FastAPI()
            app.state.session_mode = 'shared'
            app.state.assistant_service = service
            with patch('ai_assistant.project_access.sys.platform', 'win32'):
                app.include_router(create_router())
            with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 42001), headers={
                'X-Data-Agent-Native': env['RESPIRATORY_VIEWER_PROJECT_TOKEN'], 'X-Data-Agent-Local': '1',
            }) as client:
                base = '/api/assistant'
                ids = {}
                for api, address, extra in (
                    (CHAT_API, 'https://chat.example/v1', {'api_key': 'chat-fixture'}),
                    (RESPONSES_API, 'https://responses.example/v1/responses', {'api_key': 'responses-fixture'}),
                    (MESSAGES_API, 'https://messages.example', {'auth_env': 'SOMNUS_TEST_MESSAGES_KEY'}),
                    (BEDROCK_API, '', {}),
                ):
                    response = client.post(base + '/models', json={'name': api, 'api': api, 'model': 'vendor-model',
                                                                'base_url': address, 'retry_policy': policy, **extra})
                    self.assertEqual(response.status_code, 201, response.text)
                    row = response.json()['provider']
                    self.assertEqual(row['api'], api)
                    self.assertTrue(row['configured'])
                    self.assertEqual(row['retry_policy'], policy)
                    self.assertNotIn('-fixture', response.text)
                    ids[api] = row['id']
                private = client.post(base + '/company-web-runtime')
                self.assertEqual(private.status_code, 200, private.text)
                lease = private.json()
                bedrock = next(row for row in lease['models'] if row['api'] == BEDROCK_API)
                self.assertEqual(bedrock['region'], 'us-west-2')
                self.assertEqual(bedrock['native_bedrock_token'], 'bedrock-fixture')
                self.assertNotIn('bedrock-fixture', client.get(base + '/models').text)
                endpoint = base + f"/company-web-runtime/{lease['id']}/provider"
                with patch('ai_assistant.service.urlopen') as upstream:
                    response = upstream.return_value
                    response.headers = {'Content-Type': 'text/event-stream'}
                    response.read1.side_effect = lambda size: b''
                    for api, suffix, target, header, secret, common in (
                        (CHAT_API, '/chat/completions', 'https://chat.example/v1/chat/completions', 'Authorization', 'Bearer chat-fixture',
                         {'messages': [{'role': 'user', 'content': 'fixture'}]}),
                        (RESPONSES_API, '/responses', 'https://responses.example/v1/responses', 'Authorization', 'Bearer responses-fixture',
                         {'input': 'fixture', 'store': True}),
                        (MESSAGES_API, '/v1/messages', 'https://messages.example/v1/messages', 'X-api-key', 'messages-fixture',
                         {'messages': [{'role': 'user', 'content': 'fixture'}]}),
                    ):
                        headers = {'x-api-key': lease['token']} if api == MESSAGES_API else {'Authorization': 'Bearer ' + lease['token']}
                        result = client.post(endpoint + suffix, headers=headers, json={'model': ids[api], 'stream': True, **common})
                        self.assertEqual(result.status_code, 200, result.text)
                        request = upstream.call_args.args[0]
                        self.assertEqual(request.full_url, target)
                        self.assertEqual(request.get_header(header), secret)
                        payload = json.loads(request.data)
                        self.assertEqual(payload['model'], 'vendor-model')
                        if api == RESPONSES_API:
                            self.assertFalse(payload['store'])
                        wrong = client.post(endpoint + suffix, headers=headers,
                                            json={'model': ids[BEDROCK_API], 'stream': True, **common})
                        self.assertEqual(wrong.status_code, 403)
                    self.assertEqual(upstream.call_count, 3)
            reloaded = AssistantService(path, Config())
            _, roster = reloaded.models.configured_snapshot()
            self.assertEqual({row['api'] for row in roster}, {CHAT_API, RESPONSES_API, MESSAGES_API, BEDROCK_API})
            self.assertEqual(next(row for row in roster if row['api'] == MESSAGES_API)['api_key'], '')

