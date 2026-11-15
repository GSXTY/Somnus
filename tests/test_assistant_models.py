import hashlib
from contextlib import closing
import hmac
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant.models import ModelStore
from ai_assistant.service import AssistantService, Config, urlopen


class Upstream(io.BytesIO):
    headers = {'Content-Type': 'text/event-stream'}


class AssistantModelTests(unittest.TestCase):
    def test_grouping_legacy_rows_and_adding_shared_credential_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = AssistantService(root / 'assistant.sqlite3', Config('https://builtin.invalid', 'default', 'fake'))
            config = dict(name='Supplier', base_url='https://api.invalid/v1', api_key='private', model='base')
            rows = [dict(config, id='m_a123456789'), dict(config, id='m_b123456789', model='second'),
                    dict(config, id='m_c123456789', model='third', api_key='other')]
            service.models.path.write_text(json.dumps(dict(providers=rows, active=rows[1]['id'])), encoding='utf-8')
            original = service.models.list(service.builtin_model())
            a, b, c = original['providers'][1:]
            self.assertEqual(original['active'], b['id'])
            self.assertEqual(a['group_id'], b['group_id'])
            self.assertNotEqual(a['group_id'], c['group_id'])
            added = service.models.put(dict(group_id=a['group_id'], model='extra', vision_enabled=True))
            self.assertEqual(added['group_id'], a['group_id'])
            self.assertNotIn('private', str(added))
            group = service.models.update_group(a['group_id'], dict(name='Shared', api_key='updated'))
            self.assertEqual({row['id'] for row in group['providers']}, {a['id'], b['id'], added['id']})
            reopened = AssistantService(service.path, service.config)
            shared = reopened.models.resolve(added['id'], reopened.builtin_model())
            self.assertEqual((shared['name'], shared['api_key']), ('Shared', 'updated'))
            edited = reopened.models.put(dict(api_key='per-model'), b['id'])
            self.assertNotEqual(edited['group_id'], a['group_id'])
            self.assertEqual(reopened.models.resolve(a['id'], reopened.builtin_model())['api_key'], 'updated')

    def test_model_connection_probe_and_retry_before_stream_only(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AssistantService(Path(directory) / 'assistant.sqlite3',
                                       Config('https://builtin.invalid/v1', 'default', 'api-key'))
            content = b'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'
            auth = HTTPError('https://builtin.invalid', 401, 'sensitive invalid key', {}, None)
            with patch('ai_assistant.service.urlopen', side_effect=[auth, Upstream(content)]) as open_url:
                failed = service.test_model('deepseek')
                self.assertEqual((failed['ok'], failed['code'], failed['status']), (False, 'authentication_failed', 401))
                self.assertNotIn('sensitive', json.dumps(failed))
                self.assertTrue(service.test_model('deepseek')['ok'])
                payload = json.loads(open_url.call_args.args[0].data)
                self.assertEqual(payload['max_tokens'], 32)
                self.assertEqual(len(payload['messages']), 1)
            self.assertEqual(service.status()['connection_status'], 'verified')
            busy = HTTPError('https://builtin.invalid', 503, 'temporarily unavailable', {'Retry-After': '0'}, None)
            cid = service.create()['id']
            with patch('ai_assistant.service.urlopen', side_effect=[busy, Upstream(content)]) as open_url:
                events = list(service.stream(cid, *service.begin(cid, 'retry test')))
                self.assertEqual(events[-1][0], 'done')
                self.assertEqual(open_url.call_count, 2)
            incomplete = Upstream(content.split(b'data: [DONE]')[0])
            with patch('ai_assistant.service.urlopen', return_value=incomplete) as open_url:
                events = list(service.stream(cid, *service.begin(cid, 'do not retry response')))
                self.assertEqual(events[-1][0], 'error')
                self.assertEqual(open_url.call_count, 1)
            too_early = HTTPError('https://builtin.invalid', 429, 'rate', {'Retry-After': '75'}, None)
            with patch('ai_assistant.service.urlopen', side_effect=too_early) as open_url:
                events = list(service.stream(cid, *service.begin(cid, 'large retry after')))
                self.assertEqual(events[-1][1]['code'], 'rate_limited')
                self.assertEqual(open_url.call_count, 1)

    def test_profiles_control_real_requests_and_history(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'profile' / 'chat.sqlite3'
            service = AssistantService(database, Config('https://builtin.invalid/v1', 'fallback-model', 'fallback-key'))
            service.models.legacy = Path(directory) / 'not-present.json'
            app = FastAPI()
            app.state.session_mode = 'shared'
            app.state.assistant_service = service
            token = 'a' * 64
            with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': token, 'SHARE_MODE': ''}):
                with patch('ai_assistant.project_access.sys.platform', 'win32'):
                    app.include_router(create_router())
            cookie = hmac.digest(token.encode(), b'vvman-project-browser-session', hashlib.sha256).hex()
            origin = 'http://127.0.0.1:9876'
            desktop = {'origin': origin, 'cookie': 'respiratory_desktop=' + cookie}
            root = '/api/assistant'
            models = root + '/models'
            payloads = []

            def respond(request, **kwargs):
                payloads.append((request.full_url, request.get_header('Authorization'), json.loads(request.data)))
                return Upstream(b'data: {"choices":[{"delta":{"content":"mocked"}}]}\n\ndata: [DONE]\n\n')

            with TestClient(app, base_url=origin, client=('127.0.0.1', 30000)) as client:
                self.assertEqual(client.get(models).status_code, 403)
                config_a = dict(name='Provider A', base_url='https://a.invalid/v1', api_key='key-a', model='text-a')
                config_b = dict(name='Provider B', base_url='https://b.invalid/v1/chat/completions', api_key='key-b',
                                model='reasoning-b', reasoning_efforts=['low', 'high'], vision_enabled=True)
                for payload in (config_a, config_b):
                    self.assertEqual(client.post(models, json=payload).status_code, 403)
                created_a = client.post(models, json=config_a, headers=desktop)
                created_b = client.post(models, json=config_b, headers=desktop)
                self.assertEqual((created_a.status_code, created_b.status_code), (201, 201))
                a = created_a.json()['provider']['id']
                b = created_b.json()['provider']['id']
                listed = client.get(models, headers=desktop)
                self.assertNotIn('key-a', listed.text)
                self.assertNotIn('key-b', listed.text)
                self.assertNotIn('fallback-key', listed.text)
                self.assertTrue((database.parent / 'models.json').is_file())
                self.assertEqual(client.post(models + '/active', json={'id': a}, headers=desktop).json()['active'], a)
                self.assertEqual(client.get(root + '/status', headers=desktop).json()['provider_id'], a)
                self.assertTrue(client.get(root + '/status', params={'model_id': b}, headers=desktop).json()['capabilities']['vision'])
                self.assertEqual(client.get(root + '/status').json()['provider_id'], 'deepseek')
                self.assertEqual(client.get(root + '/status', params={'model_id': a}).status_code, 403)
                cid = service.create()['id']
                chat = f'{root}/conversations/{cid}'
                turn = chat + '/messages'
                text = {'content': 'test'}
                self.assertEqual(client.post(turn, json=dict(text, model_id=b)).status_code, 403)
                self.assertEqual(client.post(turn, json=dict(text, model_id=b, reasoning_effort='medium'),
                                             headers=desktop).status_code, 400)
                self.assertEqual(service.get(cid)['messages'], [])
                with patch('ai_assistant.service.urlopen', side_effect=respond):
                    self.assertEqual(client.post(turn, json=text, headers=desktop).status_code, 200)
                    response = client.post(turn, json=dict(text, model_id=b, reasoning_effort='high'), headers=desktop)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('reasoning-b', response.text)
                    self.assertIn('elapsed_ms', response.text)
                    self.assertEqual(client.post(turn, json=dict(text, model_id=b), headers=desktop).status_code, 200)
                    self.assertEqual(client.post(turn, json=text).status_code, 200)
                self.assertEqual([(url, key, body['model'], body.get('reasoning_effort')) for url, key, body in payloads], [
                    ('https://a.invalid/v1/chat/completions', 'Bearer key-a', 'text-a', None),
                    ('https://b.invalid/v1/chat/completions', 'Bearer key-b', 'reasoning-b', 'high'),
                    ('https://b.invalid/v1/chat/completions', 'Bearer key-b', 'reasoning-b', None),
                    ('https://builtin.invalid/v1/chat/completions', 'Bearer fallback-key', 'fallback-model', None),
                ])
                self.assertEqual(client.get(root + '/status', headers=desktop).json()['connection_status'], 'verified')
                self.assertEqual(client.get(root + '/status', params={'model_id': b}, headers=desktop).json()['connection_status'], 'verified')
                history = AssistantService(database, service.config).get(cid)['messages']
                self.assertEqual([row['reply_meta']['provider_id'] for row in history if row['role'] == 'assistant'], [a, b, b, 'deepseek'])
                self.assertEqual(history[3]['reply_meta']['reasoning_effort'], 'high')
                self.assertNotIn('key-a', json.dumps(history))
                updated = client.patch(models + '/' + a, json={'model': 'renamed-a'}, headers=desktop)
                self.assertEqual(updated.json()['provider']['api_key_masked'], '已配置')
                self.assertEqual(client.get(root + '/status', headers=desktop).json()['connection_status'], 'unverified')
                self.assertTrue(client.delete(models + '/' + a, headers=desktop).json()['removed'])
                self.assertEqual(ModelStore(database.parent).list(service.builtin_model())['active'], 'deepseek')

    def test_turn_is_snapshot_when_default_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AssistantService(Path(directory) / 'chat.sqlite3', Config('', '', ''))
            service.models.legacy = Path(directory) / 'ignore.json'
            a = service.models.put(dict(name='A', base_url='https://a.invalid/v1', model='a', api_key='a-token'))['id']
            b = service.models.put(dict(name='B', base_url='https://b.invalid/v1', model='b', api_key='b-token'))['id']
            service.models.set_active(a)
            cid = service.create()['id']
            turn = service.begin(cid, 'message', tool_context={'project_desktop': True})
            service.models.set_active(b)
            service.models.remove(a)
            body = Upstream(b'data: {"choices":[{"delta":{"content":"mocked"}}]}\n\ndata: [DONE]\n\n')
            with patch('ai_assistant.service.urlopen', return_value=body) as provider:
                self.assertEqual(list(service.stream(cid, *turn))[-1][0], 'done')
            request = provider.call_args.args[0]
            self.assertEqual(request.full_url, 'https://a.invalid/v1/chat/completions')
            self.assertEqual(request.get_header('Authorization'), 'Bearer a-token')
            self.assertEqual(json.loads(request.data)['model'], 'a')

    def test_legacy_profile_and_old_reply_migrations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy = root / 'legacy.json'
            config = dict(id='m_a123456789', name='Migrated', base_url='https://example.invalid', api_key='legacy-key', model='stored')
            legacy.write_text(json.dumps(dict(active=config['id'], providers=[config])), encoding='utf-8')
            store = ModelStore(root / 'profile')
            store.legacy = legacy
            database = store.path.with_name('chat.sqlite3')
            database.parent.mkdir()
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript('''CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT,created_at REAL,updated_at REAL);
                    INSERT INTO conversations VALUES('old','Old',0,0);
                    CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,status TEXT,created_at REAL);
                    INSERT INTO messages VALUES('reply','old','assistant','History','complete',0);''')
            service = AssistantService(database, Config('', '', ''))
            items = store.list(service.builtin_model())
            self.assertEqual(items['active'], config['id'])
            self.assertEqual(items['providers'][1]['reasoning_efforts'], [])
            self.assertNotIn('legacy-key', json.dumps(items))
            self.assertTrue(legacy.is_file())
            self.assertEqual(service.status(True)['model'], 'stored')
            self.assertNotIn('reply_meta', service.get('old')['messages'][0])

    def test_model_redirect_does_not_forward_key(self):
        seen = []

        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                seen.append(self.path)
                self.send_response(302)
                self.send_header('Location', '/forwarded')
                self.end_headers()

            do_GET = do_POST

        server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(f'http://127.0.0.1:{server.server_port}/v1/chat/completions', data=b'{}',
                              headers={'Authorization': 'Bearer must-not-forward'})
            with self.assertRaises(HTTPError) as raised:
                urlopen(request, timeout=5)
            self.assertEqual(raised.exception.code, 302)
            self.assertEqual(seen, ['/v1/chat/completions'])
        finally:
            server.shutdown()
            server.server_close()
