"""Exercise personal bundles on the desktop chat and ACP APIs."""
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantService, Config
from mcp_connectors.registry import Registry


class Response(io.BytesIO):
    headers = {'Content-Type': 'text/event-stream'}


class Tool:
    name = 'Fixture'

    def __init__(self, marker):
        self.marker, self.calls = marker, 0

    def call_tool(self, name, arguments):
        self.calls += 1
        return {'content': [{'type': 'text', 'text': self.marker}]}

    def close(self):
        pass


class PluginBundleTests(unittest.TestCase):
    owner = False

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        self.database = directory / 'assistant.sqlite3'
        self.config = Config('https://local.invalid/v1', 'fixture', 'no-key')
        self.service = AssistantService(self.database, self.config)
        self.registry = Registry(directory)
        self.addCleanup(self.registry.close)
        self.tools = {}
        for name in ('allowed', 'unrelated', 'disabled'):
            self.registry.put(name, {'command': 'fixture', 'enabled': name != 'disabled',
                                    'env': {'PRIVATE_VALUE': 'secret-' + name},
                                    'tool_permissions': {'fetch': 'read'}}, create=True)
            if name != 'disabled':
                self.tools[name] = self.registry.connections[name] = Tool(name.upper())
                self.registry.results[name] = {'status': 'ready', 'tools': [
                    {'name': 'fetch', 'description': name, 'inputSchema': {'type': 'object'}},
                ]}
        self.manual = self.skill('manual-test', 'MANUAL_SKILL_MARKER')
        self.bundled = self.skill('bundle-test', 'BUNDLE_SKILL_MARKER')
        app = FastAPI()
        app.state.session_mode = 'shared'
        app.state.assistant_service, app.state.mcp_registry = self.service, self.registry
        token = 'b' * 64
        with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': token, 'SHARE_MODE': '',
                                     'VV_MAN_PLUGIN_DEFAULTS_OWNER': '1' if self.owner else ''}):
            with patch('ai_assistant.project_access.sys.platform', 'win32'):
                app.include_router(create_router())
        origin = 'http://127.0.0.1:9876'
        cookie = hmac.digest(token.encode(), b'vvman-project-browser-session', 'sha256').hex()
        self.desktop = {'origin': origin, 'cookie': 'respiratory_desktop=' + cookie}
        self.native = {'X-Data-Agent-Native': token}
        self.client = TestClient(app, base_url=origin, client=('127.0.0.1', 30000))
        self.addCleanup(self.client.close)
        self.library = '/api/assistant/plugins'
        self.chat = '/api/assistant/conversations/' + self.service.create()['id']

    def skill(self, name, marker):
        return self.service.skills.add('SKILL.md', f'---\nname: {name}\ndescription: Test\n---\n{marker}'.encode())['id']

    def create_bundle(self, **changes):
        manifest = {'name': 'My bundle', 'skill_ids': [self.bundled], 'mcp_ids': ['allowed', 'disabled']}
        response = self.client.post(self.library + '/import', headers=self.desktop, json=dict(manifest, **changes))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['plugin']

    def test_plugin_lifecycle_is_local_and_reports_dependencies(self):
        self.assertEqual(self.client.get(self.library).status_code, 403)
        manifest = {'name': 'Bad', 'skill_ids': [self.bundled], 'mcp_ids': ['not-installed']}
        self.assertEqual(self.client.post(self.library + '/import', headers=self.desktop, json=manifest).status_code, 409)
        manifest['command'] = 'invalid'
        self.assertEqual(self.client.post(self.library + '/import', headers=self.desktop, json=manifest).status_code, 400)
        plugin = self.create_bundle()
        defaults = self.library + '/defaults'
        self.assertEqual(self.client.get(defaults, headers=self.desktop).json(),
                         {'plugins': [], 'owner_configured': False})
        denied = self.client.post(defaults, headers=self.desktop, json={'plugin_id': plugin['id']})
        self.assertEqual((denied.status_code, denied.json()['error']['code']), (403, 'plugin_owner_required'))
        self.assertFalse(plugin['enabled'])
        self.assertEqual(plugin['inactive_mcp'], ['disabled'])
        self.assertNotIn('secret-', json.dumps(plugin))
        path = self.library + '/' + plugin['id']
        self.assertEqual(self.client.post(self.chat + '/messages', headers=self.desktop,
                                          json={'content': 'Ask', 'plugin_ids': [plugin['id']]}).status_code, 409)
        allowed = self.client.patch(path, headers=self.desktop, json={'enabled': True}).json()['plugin']
        self.assertTrue(AssistantService(self.database, self.config).plugins.list(self.registry)[0]['enabled'])
        self.assertEqual(allowed['id'], plugin['id'])
        self.service.skills.remove(self.bundled)
        saved = self.client.get(self.library, headers=self.desktop).json()['plugins'][0]
        self.assertEqual(saved['missing_skills'], [self.bundled])
        self.assertEqual(self.client.delete(path, headers=self.desktop).json(), {'removed': True})
        self.assertIsNotNone(self.registry.enabled_states().get('allowed'))

    def test_selected_plugins_scope_models_and_acp_with_standalone_unchanged(self):
        plugin = self.create_bundle()
        other = self.create_bundle(name='Other bundle', skill_ids=[self.manual], mcp_ids=[])
        ids = [plugin['id'], other['id']]
        for item in ids:
            self.client.patch(self.library + '/' + item, headers=self.desktop, json={'enabled': True})
        self.assertEqual(self.client.post(self.chat + '/messages', json={'content': 'Ask', 'plugin_ids': ids}).status_code, 403)
        body = b'data: {"choices":[{"delta":{"content":"mocked"}}]}\n\ndata: [DONE]\n\n'

        for selection in (ids, []):
            with patch('ai_assistant.service.urlopen', return_value=Response(body)) as upstream:
                reply = self.client.post(self.chat + '/messages', headers=self.desktop,
                                         json={'content': 'Ask', 'plugin_ids': selection, 'skill_ids': [self.manual]})
            self.assertEqual(reply.status_code, 200, reply.text)
            sent = json.loads(upstream.call_args.args[0].data)
            names = {spec['function']['name'] for spec in sent['tools']}
            self.assertIn('mcp__allowed__fetch', names)
            self.assertEqual('mcp__unrelated__fetch' in names, not selection)
            raw = json.dumps(sent['messages'])
            self.assertEqual(raw.count('MANUAL_SKILL_MARKER'), 1)
            self.assertEqual('BUNDLE_SKILL_MARKER' in raw, bool(selection))

        agent = '21922344-de22-4c5f-87f5-8b58633c37a9'
        start = self.client.post(self.chat + '/external-turns', headers=self.desktop,
                                 json={'content': 'Ask', 'agent_id': agent, 'agent_name': 'Fixture', 'plugin_ids': ids})
        self.assertEqual(start.status_code, 201, start.text)
        turn = self.chat + '/external-turns/' + start.json()['turn_id']
        message = {'agent_id': agent}
        prepared = self.client.post(turn + '/prepare', headers=self.native, json=message).json()
        self.assertIn('BUNDLE_SKILL_MARKER', prepared['text'])
        catalog = {item['name'] for item in prepared['tools']}
        self.assertIn('mcp__allowed__fetch', catalog)
        self.assertNotIn('mcp__unrelated__fetch', catalog)
        for name in ('allowed', 'unrelated'):
            result = self.client.post(turn + '/tool', headers=self.native,
                                      json=dict(message, name=f'mcp__{name}__fetch', arguments={})).json()
            self.assertEqual(result['isError'], name != 'allowed')
        self.assertEqual((self.tools['allowed'].calls, self.tools['unrelated'].calls), (1, 0))


class DefaultPluginTests(unittest.TestCase):
    owner = True

    setUp = PluginBundleTests.setUp
    skill = PluginBundleTests.skill
    create_bundle = PluginBundleTests.create_bundle

    def test_owner_can_publish_and_remove_for_the_same_profile_only(self):
        personal = self.create_bundle()
        defaults = self.library + '/defaults'
        packet = {'plugin_id': personal['id']}
        self.assertEqual(self.client.get(defaults).status_code, 403)
        self.assertEqual(self.client.post(defaults, json=packet).status_code, 403)
        self.assertEqual(self.client.post(defaults, headers=dict(self.desktop, forwarded='for=127.0.0.1'),
                                          json=packet).status_code, 403)
        with patch.dict(os.environ, {'SHARE_MODE': '1'}):
            self.assertEqual(self.client.post(defaults, headers=self.desktop, json=packet).status_code, 403)
        catalog = self.client.get(defaults, headers=self.desktop).json()
        self.assertEqual(catalog, {'plugins': [], 'owner_configured': True})
        published = self.client.post(defaults, headers=self.desktop, json=packet)
        self.assertEqual(published.status_code, 201, published.text)
        row = published.json()['plugin']
        self.assertEqual(row['source_id'], personal['id'])
        self.assertTrue(row['enabled'])
        self.assertNotEqual(row['id'], personal['id'])
        self.assertEqual(self.client.post(defaults, headers=self.desktop, json=packet).json()['plugin'], row)
        self.assertEqual(self.client.delete(self.library + '/' + row['id'], headers=self.desktop).status_code, 404)
        self.assertEqual(self.client.delete(self.library + '/' + personal['id'], headers=self.desktop).status_code, 200)
        restored = AssistantService(self.database, self.config)
        self.assertEqual(restored.plugins.defaults(self.registry), [row])
        selected, servers = restored.turn_extensions([], [row['id']], self.registry)
        self.assertEqual(selected[0]['instructions'], 'BUNDLE_SKILL_MARKER')
        self.assertEqual(servers, frozenset({'allowed'}))
        other = AssistantService(self.database.with_name('other-profile.sqlite3'), self.config)
        self.assertEqual(other.plugins.defaults(None), [])
        self.assertEqual(self.client.delete(defaults + '/' + row['id'], headers=self.desktop).json(), {'removed': True})
        self.assertEqual(self.client.get(defaults, headers=self.desktop).json()['plugins'], [])
        self.assertTrue(self.registry.enabled_states()['allowed'])
