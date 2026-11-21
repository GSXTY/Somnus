"""Native catalog renewal keeps the live Host and active model requests intact."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from starlette.requests import Request
from starlette.routing import Match
from types import SimpleNamespace

from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService, Config


class LiveCatalogTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.environment = patch.dict(os.environ, {'SOMNUS_DSH_CONFIGURED_PROVIDERS': '1',
            'SOMNUS_PROFILE_CONFIG_ONLY': '1', 'SHARE_MODE': ''})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.service = AssistantService(Path(temporary.name) / 'assistant.sqlite3', Config('', '', ''))
        app = FastAPI()
        app.state.assistant_service = self.service
        app.state.session_mode = 'shared'
        with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': 'b' * 64}):
            with patch('ai_assistant.project_access.sys.platform', 'win32'):
                self.router = create_router()
        self.app = app
        async def immediate(function, *args):
            return function(*args)
        worker = patch('ai_assistant.asgi.anyio.to_thread.run_sync', immediate)
        worker.start()
        self.addCleanup(worker.stop)
        self.client = SimpleNamespace(post=lambda path, **kw: self.request('POST', path, **kw),
            get=lambda path, **kw: self.request('GET', path, **kw),
            patch=lambda path, **kw: self.request('PATCH', path, **kw),
            delete=lambda path, **kw: self.request('DELETE', path, **kw))
        self.headers = {'X-Data-Agent-Native': 'b' * 64, 'X-Data-Agent-Local': '1'}
        response = self.client.post('/api/assistant/dsh-next-runtime', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.opened = response.json()
        self.base = '/api/assistant/dsh-next-runtime/' + self.opened['id']

    def request(self, method, path, *, headers=None, json=None):
        import json as json_module
        body = b'' if json is None else json_module.dumps(json).encode()
        scope = dict(type='http', method=method, scheme='http', path=path, raw_path=path.encode(),
                     query_string=b'', root_path='', server=('127.0.0.1', 9876),
                     client=('127.0.0.1', 30000), app=self.app,
                     headers=[(b'host', b'127.0.0.1:9876'), *[(key.lower().encode(), value.encode())
                              for key, value in (headers or {}).items()]])
        async def receive():
            return dict(type='http.request', body=body, more_body=False)
        for route in self.router.routes:
            match, child_scope = route.matches(scope)
            if match is Match.FULL:
                request = Request(dict(scope, **child_scope), receive)
                operation = route.endpoint(request=request, **child_scope.get('path_params', {}))
                try:
                    operation.send(None)
                except StopIteration as completed:
                    response = completed.value
                    return SimpleNamespace(status_code=response.status_code,
                        text=response.body.decode(), json=lambda: json_module.loads(response.body))
                finally:
                    operation.close()
                raise AssertionError('Endpoint unexpectedly required an event loop')
        raise AssertionError('No endpoint matched ' + path)

    def add_model(self, name):
        result = self.client.post('/api/assistant/models', headers=self.headers, json={
            'name': 'Fixture supplier', 'base_url': 'https://fixture.invalid/v1',
            'api_key': 'fixture-private-secret', 'api': 'openai-responses',
            'model': name, 'vision_enabled': False, 'reasoning_efforts': ['low', 'high']})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()['provider']

    def catalog(self):
        response = self.client.get(self.base + '/catalog', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn('fixture-private-secret', response.text)
        return response.json()

    def test_fresh_host_receives_saved_models_without_reopen_and_keeps_data_capabilities(self):
        self.assertIsNone(self.opened['provider'])
        self.assertEqual(len(self.opened['model_token']), 64)
        original_host = self.service.dsh_next_runtime.host
        original_servers = dict(original_host.servers)
        first = self.add_model('deepseek-flash')
        second = self.add_model('deepseek-v4-pro')
        updated = self.catalog()
        self.assertEqual([model['name'] for model in updated['provider']['models']], ['deepseek-flash', 'deepseek-v4-pro'])
        self.assertEqual({model['api'] for model in updated['provider']['models']}, {'openai-responses'})
        self.assertEqual(updated['provider']['token'], self.opened['model_token'])
        self.assertIs(self.service.dsh_next_runtime.host, original_host)
        self.assertEqual(self.service.dsh_next_runtime.host.id, self.opened['id'])
        for server, previous in original_servers.items():
            self.assertIs(self.service.dsh_next_runtime.server(self.opened['id'], server, previous.token), previous)
        lease, cancel = self.service.dsh_next_runtime.provider(self.opened['id'])
        self.assertIsNotNone(lease.authorize(self.opened['model_token'], {
            'model': first['id'], 'stream': True, 'input': 'Synthetic no-network request'}, True))
        lease.release()
        self.assertFalse(cancel.is_set())

    def test_edits_and_removal_refresh_future_requests_without_cancelling_active_snapshot(self):
        first = self.add_model('deepseek-flash')
        self.catalog()
        old_lease, old_cancel = self.service.dsh_next_runtime.provider(self.opened['id'])
        self.assertIsNotNone(old_lease.authorize(self.opened['model_token'], {
            'model': first['id'], 'stream': True, 'input': 'Synthetic no-network request'}, True))
        update = self.client.patch('/api/assistant/models/' + first['id'], headers=self.headers,
                                   json={'model': 'deepseek-v4-pro'})
        self.assertEqual(update.status_code, 200, update.text)
        self.service.dsh_next_runtime.revoke_model()
        fresh = self.catalog()
        new_lease, new_cancel = self.service.dsh_next_runtime.provider(self.opened['id'])
        self.assertEqual(fresh['provider']['models'][0]['name'], 'deepseek-v4-pro')
        self.assertIsNot(old_lease, new_lease)
        self.assertFalse(old_cancel.is_set())
        self.assertFalse(new_cancel.is_set())
        removed = self.client.delete('/api/assistant/models/' + first['id'], headers=self.headers)
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertIsNone(self.catalog()['provider'])
        self.assertIsNone(self.service.dsh_next_runtime.provider(self.opened['id']))
        self.assertFalse(old_cancel.is_set())
        self.assertTrue(self.service.dsh_next_runtime.close(self.opened['id']))
        self.assertTrue(old_cancel.is_set())
        old_lease.release()

    def test_unchanged_catalog_reuses_generation_and_key_edit_changes_only_future_admissions(self):
        first = self.add_model('deepseek-flash')
        issued = self.catalog()
        before, cancel = self.service.dsh_next_runtime.provider(self.opened['id'])
        self.assertEqual(issued, self.catalog())
        self.assertIs(before, self.service.dsh_next_runtime.provider(self.opened['id'])[0])
        change = self.client.patch('/api/assistant/model-providers/' + first['group_id'],
            headers=self.headers, json={'api_key': 'new-fixture-private-secret'})
        self.assertEqual(change.status_code, 200, change.text)
        updated = self.catalog()
        self.assertNotEqual(issued['revision'], updated['revision'])
        self.assertEqual(issued['provider']['token'], updated['provider']['token'])
        self.assertNotIn('new-fixture-private-secret', json.dumps(updated))
        self.assertIsNot(before, self.service.dsh_next_runtime.provider(self.opened['id'])[0])

    def test_catalog_is_native_authenticated_and_closed_host_is_unavailable(self):
        self.add_model('deepseek-flash')
        for headers in ({}, {'X-Data-Agent-Native': 'c' * 64},
                        {**self.headers, 'Origin': 'https://untrusted.invalid'}):
            response = self.client.get(self.base + '/catalog', headers=headers)
            self.assertEqual(response.status_code, 403)
            self.assertNotIn('deepseek-flash', response.text)
        self.assertEqual(self.client.get('/api/assistant/dsh-next-runtime/' + 'c' * 32 + '/catalog', headers=self.headers).status_code, 404)
        self.service.dsh_next_runtime.close(self.opened['id'])
        self.assertEqual(self.client.get(self.base + '/catalog', headers=self.headers).status_code, 404)


if __name__ == '__main__':
    unittest.main()
