"""The desktop DSH bridge routes identical model names by configured provider ID."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.company_runtime import AGENT_ID
from ai_assistant.service import AssistantError, AssistantService, Config


class ProviderRuntimeTests(unittest.TestCase):
    def test_two_credentials_are_routed_by_provider_id_without_implicit_model(self):
        environment = {
            'SOMNUS_DSH_CONFIGURED_PROVIDERS': '1',
            'SOMNUS_PROFILE_CONFIG_ONLY': '1',
            'RESPIRATORY_VIEWER_PROJECT_TOKEN': 'a' * 64,
            'SHARE_MODE': '0',
        }
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, environment):
            service = AssistantService(Path(folder) / 'assistant.sqlite3', Config(
                'https://legacy.example/v1', 'legacy-model', 'legacy-fixture'))
            service.models.set_company_key({'api_key': 'legacy-saved-fixture'})
            app = FastAPI()
            app.state.session_mode = 'shared'
            app.state.assistant_service = service
            with patch('ai_assistant.project_access.sys.platform', 'win32'):
                app.include_router(create_router())
            with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 42001), headers={
                'X-Data-Agent-Native': environment['RESPIRATORY_VIEWER_PROJECT_TOKEN'],
                'X-Data-Agent-Local': '1',
            }) as client:
                base = '/api/assistant'
                assert client.get(base + '/models').json() == {'active': '', 'providers': [], 'company_models': []}
                assert not client.get(base + '/company-runtime').json()['ready']
                cid = service.create('路由测试')['id']
                with self.assertRaises(AssistantError) as blocked:
                    service.begin(cid, 'fixture', tool_context={'project_desktop': True})
                assert blocked.exception.code == 'dsh_runtime_required'
                model_ids = []
                for number in (1, 2):
                    created = client.post(base + '/models', json={
                        'name': 'Fixture ' + str(number), 'base_url': f'https://provider{number}.example/v1',
                        'model': 'shared-model', 'api_key': f'synthetic-key-{number}',
                    })
                    assert created.status_code == 201, created.text
                    model_ids.append(created.json()['provider']['id'])
                assert len(client.get(base + '/models').json()['providers']) == 2
                for model_id in model_ids:
                    assert client.get(base + '/company-runtime', params={'model_id': model_id}).json()['ready']

                turns = base + f'/conversations/{cid}/external-turns'
                missing = client.post(turns, json={'agent_id': AGENT_ID, 'agent_name': 'ignored', 'content': 'fixture'})
                assert missing.status_code == 409, missing.text
                reply = client.post(turns, json={
                    'agent_id': AGENT_ID, 'agent_name': 'ignored', 'content': 'fixture',
                    'provider_model_id': model_ids[1],
                })
                assert reply.status_code == 201, reply.text
                assert reply.json()['assistant_message']['reply_meta'] == {
                    'provider_id': model_ids[1], 'provider_name': 'Fixture 2',
                    'model': 'shared-model', 'transport': 'dsh-native',
                }
                prepared = client.post(f"{turns}/{reply.json()['turn_id']}/prepare", json={'agent_id': AGENT_ID})
                assert prepared.status_code == 200, prepared.text
                assert prepared.json()['company_model'] == model_ids[1]

                opened = client.post(base + '/company-web-runtime')
                assert opened.status_code == 200, opened.text
                lease = opened.json()
                assert lease['api'] == 'openai-completions'
                assert [item['model'] for item in lease['models']] == model_ids
                with patch('ai_assistant.service.urlopen') as upstream:
                    for number, model_id in enumerate(model_ids, 1):
                        _, _, active = service.open_company_web_stream(lease['id'], lease['token'], {
                            'model': model_id, 'stream': True, 'messages': [{'role': 'user', 'content': 'fixture'}],
                        })
                        request = upstream.call_args.args[0]
                        assert request.full_url == f'https://provider{number}.example/v1/chat/completions'
                        assert request.get_header('Authorization') == f'Bearer synthetic-key-{number}'
                        assert json.loads(request.data)['model'] == 'shared-model'
                        active.release()
                    with self.assertRaises(AssistantError):
                        service.open_company_web_stream(lease['id'], lease['token'], {
                            'model': 'shared-model', 'stream': True, 'messages': [{'role': 'user', 'content': 'fixture'}],
                        })
                    assert upstream.call_count == 2
                assert service.models.company_key()['api_key'] == 'legacy-saved-fixture'


if __name__ == '__main__':
    unittest.main()
