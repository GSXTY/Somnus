"""Exercise personal bundles on the desktop chat and ACP APIs."""
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.plugin_bundles import BundleError, HANDOFF_PLUGIN_ID
from ai_assistant.skill_library import HANDOFF_ID
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
        catalog = self.client.get(defaults, headers=self.desktop).json()
        self.assertFalse(catalog['owner_configured'])
        self.assertEqual(catalog['plugins'], [])
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

    def test_local_preflight_rejects_non_declarative_fields_and_unavailable_dependencies(self):
        path = self.library + '/development'
        self.assertEqual(self.client.get(path + '/template').status_code, 403)
        template = self.client.get(path + '/template', headers=self.desktop).json()['manifest']
        self.assertEqual(template['version'], '1.0.0')
        manifest = dict(template, name='试验插件', version='1.2.0-beta.1', mcp_ids=['not-installed'])
        failed = self.client.post(path + '/preflight', headers=self.desktop, json=manifest).json()['report']
        self.assertFalse(failed['ok'])
        self.assertEqual(failed['checks'][2]['status'], 'fail')
        disallowed = self.client.post(path + '/preflight', headers=self.desktop,
                                      json=dict(manifest, command='untrusted')).json()['report']
        self.assertFalse(disallowed['ok'])
        self.assertEqual(disallowed['checks'][0]['id'], 'invalid_plugin')
        self.assertEqual(self.client.get(path + '/candidates', headers=self.desktop).status_code, 403)

    def test_portable_round_trip_in_fresh_profile_with_real_echo_server(self):
        origin = 'http://127.0.0.1:9876'
        routes = self.library + '/portable'
        descriptor = {'name': 'Portable demo', 'version': '1.1.0',
                      'skill_ids': [self.bundled], 'mcp_ids': ['allowed']}
        exported = self.client.post(routes + '/export', headers=self.desktop, json=descriptor)
        self.assertEqual(exported.status_code, 200, exported.text)
        package = exported.json()['package']
        canonical = json.dumps(package, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        self.assertEqual(exported.json()['sha256'], hashlib.sha256(canonical).hexdigest())
        self.assertNotIn('secret-', json.dumps(package))
        self.assertNotIn(self.bundled, json.dumps(package))
        self.assertIn('BUNDLE_SKILL_MARKER', package['skills'][0]['instructions'])
        with tempfile.TemporaryDirectory() as target, patch.dict(os.environ, {'MCP_CONFIG': ''}):
            folder = Path(target)
            (folder / 'mcp.json').write_text('{"servers":{}}', encoding='utf-8')
            target_registry = Registry(folder)
            app = FastAPI()
            app.state.session_mode = 'shared'
            app.state.mcp_registry = target_registry
            target_service = app.state.assistant_service = AssistantService(folder / 'assistant.sqlite3', self.config)
            with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': self.native['X-Data-Agent-Native']}):
                with patch('ai_assistant.project_access.sys.platform', 'win32'):
                    app.include_router(create_router())
            try:
                with TestClient(app, base_url=origin, client=('127.0.0.1', 30000)) as client:
                    self.assertEqual(client.post(routes + '/preflight', json=package).status_code, 403)
                    report = client.post(routes + '/preflight', headers=self.desktop, json=package).json()['report']
                    self.assertFalse(report['ok'])
                    self.assertEqual(report['references']['mcp_ids']['allowed'], 'missing')
                    rejected = client.post(routes + '/import', headers=self.desktop, json=package)
                    self.assertEqual(rejected.status_code, 409)
                    self.assertEqual([item['id'] for item in target_service.skills.list()], [HANDOFF_ID])
                    self.assertEqual(target_service.plugins.list(target_registry), [])
                    target_registry.put('allowed', {'command': sys.executable, 'enabled': True,
                        'args': [str(Path(__file__).with_name('mcp_echo_server.py'))],
                        'tool_permissions': {'echo': 'read'}}, create=True)
                    too_new = dict(package, minimum_somnus_version='9.0.0')
                    future_report = client.post(routes + '/preflight', headers=self.desktop, json=too_new).json()['report']
                    self.assertFalse(future_report['ok'])
                    self.assertTrue(client.post(routes + '/preflight', headers=self.desktop, json=package).json()['report']['ok'])
                    with patch.object(target_service.plugins, 'insert',
                                      side_effect=BundleError('fixture', 'Atomic rollback fixture.', 409)):
                        self.assertEqual(client.post(routes + '/import', headers=self.desktop, json=package).status_code, 409)
                    self.assertEqual([item['id'] for item in target_service.skills.list()], [HANDOFF_ID])
                    result = client.post(routes + '/import', headers=self.desktop, json=package)
                    self.assertEqual(result.status_code, 201, result.text)
                    plugin = result.json()['plugin']
                    self.assertEqual(target_registry.connections, {})
                    self.assertFalse(plugin['enabled'])
                    self.assertNotEqual(plugin['skill_ids'], [self.bundled])
                    target_service.plugins.set_enabled(plugin['id'], True, target_registry)
                    skill_ids, mcp_ids = target_service.plugins.select([plugin['id']], target_registry)
                    self.assertEqual(mcp_ids, {'allowed'})
                    skills = target_service.skills.for_turn(skill_ids)
                    self.assertIn('BUNDLE_SKILL_MARKER', json.dumps(skills))
                    agent = '21922344-de22-4c5f-87f5-8b58633c37a9'
                    cid = target_service.create()['id']
                    chat = self.library.rsplit('/', 1)[0] + '/conversations/' + cid
                    started = client.post(chat + '/external-turns', headers=self.desktop,
                        json={'content': 'Run a synthetic echo.', 'agent_id': agent,
                              'agent_name': 'Fixture', 'plugin_ids': [plugin['id']]})
                    self.assertEqual(started.status_code, 201, started.text)
                    turn = chat + '/external-turns/' + started.json()['turn_id']
                    prepared = client.post(turn + '/prepare', headers=self.native, json={'agent_id': agent})
                    self.assertEqual(prepared.status_code, 200, prepared.text)
                    self.assertIn('BUNDLE_SKILL_MARKER', prepared.json()['text'])
                    self.assertIn('mcp__allowed__echo', {item['name'] for item in prepared.json()['tools']})
                    echo = client.post(turn + '/tool', headers=self.native,
                                      json={'agent_id': agent, 'name': 'mcp__allowed__echo',
                                            'arguments': {'text': 'portable smoke'}})
                    self.assertEqual(echo.status_code, 200, echo.text)
                    self.assertEqual(echo.json()['content'][0]['text'], 'echo: portable smoke')
            finally:
                target_registry.close()

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

    def test_owner_reviews_immutable_candidates_and_native_access(self):
        path = self.library + '/development/candidates'
        manifest = {'name': '版本候选', 'description': '测试', 'version': '1.2.3-beta.1+local',
                    'skill_ids': [self.bundled], 'mcp_ids': ['disabled']}
        failed = self.client.post(path, headers=self.desktop, json=dict(manifest, version='latest'))
        self.assertEqual(failed.status_code, 409)
        saved = self.client.post(path, headers=self.desktop, json=manifest).json()['candidate']
        self.assertEqual(saved['manifest'], manifest)
        canonical = json.dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
        self.assertEqual(saved['sha256'], hashlib.sha256(canonical).hexdigest())
        repeated = self.client.post(path, headers=self.desktop, json=manifest).json()['candidate']
        self.assertEqual(repeated, saved)
        native_path = path + '/' + saved['id']
        self.assertEqual(self.client.get(native_path, headers=self.desktop).status_code, 403)
        self.assertEqual(self.client.get(native_path, headers=self.native).json()['candidate'], saved)
        self.registry.put('disabled', {'enabled': True})
        updated_review = self.client.post(path, headers=self.desktop, json=manifest).json()['candidate']
        self.assertEqual(updated_review['sha256'], saved['sha256'])
        self.assertNotEqual(updated_review['id'], saved['id'])
        self.assertNotEqual(updated_review['report'], saved['report'])
        self.assertEqual(self.client.get(native_path, headers=self.native).json()['candidate'], saved)
        self.assertEqual(len(self.client.get(path, headers=self.desktop).json()['candidates']), 2)
        self.assertEqual(self.client.get(self.library, headers=self.desktop).json()['plugins'], [])
        self.assertEqual(self.client.get(self.library + '/defaults', headers=self.desktop).json()['plugins'], [])
        self.assertNotIn('secret-', json.dumps(updated_review))
        self.assertEqual(self.tools['allowed'].calls, 0)

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
        self.assertTrue(catalog['owner_configured'])
        self.assertEqual(catalog['plugins'], [])
        self.assertEqual(self.client.delete(defaults + '/' + HANDOFF_PLUGIN_ID,
                                            headers=self.desktop).status_code, 409)
        self.assertEqual(self.client.post(defaults, headers=self.desktop,
                                         json={'plugin_id': HANDOFF_PLUGIN_ID}).status_code, 409)
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

    def test_retired_handoff_bundle_is_ignored_without_removing_saved_records(self):
        old_id = 'a' * 32
        with self.service.db() as db:
            db.execute('INSERT INTO default_plugins VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (old_id, 'b' * 32, 'Project Handoff', 'Legacy', '1.0.0',
                        json.dumps([HANDOFF_ID]), '["allowed"]', 1, 0, 0))
        self.assertEqual(self.service.plugins.defaults(self.registry), [])
        selected, servers = self.service.turn_extensions([], [HANDOFF_PLUGIN_ID, old_id], self.registry)
        self.assertEqual(selected, [])
        self.assertEqual(servers, frozenset())
        with self.service.db() as db:
            self.assertEqual(db.execute('SELECT id FROM default_plugins').fetchone()['id'], old_id)
