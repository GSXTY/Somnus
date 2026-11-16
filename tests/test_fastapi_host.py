"""ASGI host acceptance with isolated storage; never opens user CSV or APIs."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from ai_assistant.service import AssistantService, Config
from server.app import create_app, default_data_dir
from server.cli import parser


class FastAPIHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(data_dir=self.temp.name, session_mode='shared')
        # Explicitly disable any model settings in the caller's environment.
        self.app.state.assistant_service = AssistantService(Path(self.temp.name) / 'assistant.sqlite3', Config('', '', ''))
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def test_native_fastapi_health_and_documentation(self):
        health = self.client.get('/api/health').json()
        self.assertEqual(health['framework'], 'fastapi')
        self.assertEqual(health['entrypoints']['events'], '/events')
        self.assertFalse(health['runtime']['authentication'])
        schema = self.client.get('/openapi.json').json()
        self.assertIn('/api/workbench', schema['paths'])
        self.assertIn('/api/assistant/conversations', schema['paths'])
        self.assertIn('swagger-ui', self.client.get('/docs').text)

    def test_built_shell_embedded_analysis_and_fixed_static_assets(self):
        for route, marker in [('/', 'id="root"'), ('/dashboard', 'id="root"'),
                              ('/events?embedded=1', '<h1>波形分析</h1>'),
                              ('/viewer.js', 'embeddedAnalysis'), ('/ui/events.css', '.events-page')]:
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200, route)
            self.assertIn(marker, response.text, route)
        import re
        assets = re.findall(r'(?:src|href)="(/workbench-assets/[^\"]+)"', self.client.get('/').text)
        self.assertGreaterEqual(len(assets), 2)
        for asset in assets:
            self.assertEqual(self.client.get(asset).status_code, 200, asset)

    def test_static_traversal_and_unknown_routes_do_not_disclose_files(self):
        for route in ['/workbench-assets/%2e%2e/%2e%2e/requirements.txt',
                      '/workbench-assets/..%5c..%5crequirements.txt', '/api/not-a-route']:
            self.assertEqual(self.client.get(route).status_code, 404, route)

    def test_plugin_registry_exposes_explicit_record_workspace(self):
        registry = self.client.get('/api/plugins').json()
        plugin = next(plugin for plugin in registry['plugins'] if plugin['key'] == 'respiratory')
        entry, = plugin['workspace_entries']
        self.assertEqual(entry, dict(id='analysis', title='波形分析', slot='sidebar',
                                     path='/events', mode='embedded', access='selected-record'))
        page = self.client.get(entry['path'])
        self.assertIn('href="/" class="events-return-link"', page.text)
        self.assertIsNone(self.client.get('/api/workbench/users/unknown?source=live').json()['user'])
        self.assertEqual(self.client.get('/api/meta').status_code, 400)

    def test_workbench_nulls_validation_and_population_stay_separate(self):
        demo = self.client.get('/api/workbench?source=demo&model=all').json()
        self.assertGreater(demo['kpis']['active_users']['value'], 0)
        live = self.client.get('/api/workbench?source=live').json()
        self.assertIsNone(live['kpis']['active_users']['value'])
        self.assertIsNone(live['data_quality']['loss_rate'])
        self.assertEqual(self.client.get('/api/workbench?model=not-ya70').status_code, 400)
        self.assertIsNone(self.client.get('/api/workbench/users/unknown?source=live').json()['user'])
        self.assertEqual(self.client.get('/api/workbench/users/unknown?source=demo').status_code, 404)
        self.assertIsNone(self.client.get('/api/dashboard').json()['metrics']['total_users'])
        self.assertEqual(self.client.get('/api/meta').status_code, 400)

    def test_cross_origin_writes_blocked_before_changes(self):
        endpoint = '/api/assistant/conversations'
        self.assertEqual(self.client.post(endpoint, json={}, headers={'Origin': 'https://unrelated.invalid'}).status_code, 403)
        self.assertEqual(self.client.get(endpoint).json()['conversations'], [])
        created = self.client.post(endpoint, json={'title': 'same origin'}, headers={'Origin': 'http://testserver'})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(self.client.post(endpoint, json={}, headers={'Origin': 'https://testserver'}).status_code, 403)

    def test_unconfigured_assistant_retains_original_local_history(self):
        service = self.app.state.assistant_service
        old = service.create('existing local history')
        response = self.client.get('/api/assistant/conversations')
        self.assertEqual(response.json()['conversations'][0]['id'], old['id'])
        status = self.client.get('/api/assistant/status').json()
        self.assertFalse(status['configured'])
        response = self.client.post(f"/api/assistant/conversations/{old['id']}/messages", json={'content': 'test'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(service.get(old['id'])['messages'], [])


class FastAPIConfigurationTests(unittest.TestCase):
    def test_plugin_manifest_cannot_publish_untrusted_or_unmounted_routes(self):
        from plugins.loader import workspace_entries

        path = Path('local-tool')
        entry = dict(id='tool', title='本机工具', slot='tools', path='/module/local-tool/',
                     mode='standalone', access='plugin-managed')
        errors = []
        self.assertEqual(workspace_entries({'workspace_entries': [entry]}, path, True, errors), [entry])
        self.assertEqual(errors, [])
        for target in ('//example.com/', '/events?recording_id=fake', '/module/local-tool/../', '/api/meta'):
            with self.subTest(target=target):
                errors = []
                self.assertEqual(workspace_entries({'workspace_entries': [dict(entry, path=target)]},
                                                   path, True, errors), [])
                self.assertTrue(errors)
        self.assertEqual(workspace_entries({'workspace_entries': [entry]}, path, False, []), [])

    def test_cli_keeps_local_defaults_and_original_options(self):
        args = parser().parse_args(['--no-browser', '--data-dir', 'data-test', '--port', '8870'])
        self.assertEqual(args.host, '127.0.0.1')
        self.assertEqual(args.port, 8870)
        self.assertTrue(args.no_browser)
        self.assertEqual(args.data_dir, Path('data-test'))

    def test_environment_data_directory_and_worker_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {'AI_AGENT_DATA_DIR': folder}):
                self.assertEqual(default_data_dir(), Path(folder).resolve())
            with patch.dict(os.environ, {'WEB_CONCURRENCY': '2'}):
                with self.assertRaisesRegex(RuntimeError, 'worker'):
                    create_app(data_dir=folder)

    def test_factory_isolates_chat_and_preserves_unclaimed_legacy_history(self):
        with tempfile.TemporaryDirectory() as folder:
            original = AssistantService(Path(folder) / 'assistant.sqlite3', Config('', '', ''))
            legacy = original.create('legacy local')
            app = create_app(data_dir=folder)
            with TestClient(app) as first, TestClient(app) as second:
                self.assertEqual(first.get('/api/assistant/conversations').json()['conversations'], [])
                created = first.post('/api/assistant/conversations', json={'title': 'private browser'}).json()['conversation']
                self.assertEqual(second.get('/api/assistant/conversations').json()['conversations'], [])
                self.assertEqual(second.get(f"/api/assistant/conversations/{created['id']}").status_code, 404)
                self.assertEqual(first.get('/api/assistant/conversations').json()['conversations'][0]['id'], created['id'])
            self.assertEqual(original.conversations()[0]['id'], legacy['id'])


if __name__ == '__main__':
    unittest.main()
