import asyncio
from base64 import b64encode
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import anyio
from fastapi.testclient import TestClient

from agent_core.sql_access import SqlSettings
from data_gateway.app import create_gateway
from data_gateway.routes import DEEP_TASKS, HEALTH_PATH, PRESENCE_PATH
from data_gateway.usage import ADMIN_PATH, ADMIN_USAGE_PATH, AUDIT_RETENTION_SECONDS, Usage
from server.app import create_app
from server.remote_data import RemoteData


CLIENT_A = 'gateway-presence-client-a-test-only' * 2
CLIENT_B = 'gateway-presence-client-b-test-only' * 2
PASSWORD = 'independent-gateway-admin-test-only' * 2
VERSION = '0.3.0-beta.4'
AUTH_A = {'Authorization': f'Bearer {CLIENT_A}'}
AUTH_B = {'Authorization': f'Bearer {CLIENT_B}'}
AUTH_ADMIN = {'Authorization': 'Basic ' + b64encode(f'admin:{PASSWORD}'.encode()).decode()}
SETTINGS = SqlSettings('mysql://guest:example@unused.invalid/example', allowed_tables=('approved',))


class GatewayUsageTests(unittest.TestCase):
    def test_admin_and_presence_are_opt_in_and_require_separate_https_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'usage.sqlite3'
            with TestClient(create_gateway((CLIENT_A,), SETTINGS), base_url='https://testserver') as disabled:
                self.assertEqual(disabled.get(ADMIN_PATH, headers=AUTH_ADMIN).status_code, 404)
                self.assertEqual(disabled.post(PRESENCE_PATH, headers=AUTH_A).status_code, 404)
                self.assertFalse(db.exists())
            with self.assertRaises(ValueError):
                create_gateway((CLIENT_A,), SETTINGS, admin_password=CLIENT_A, usage_database=db)
            with self.assertRaises(ValueError):
                create_gateway((CLIENT_A,), SETTINGS, admin_password=PASSWORD, usage_database=db,
                               user_labels={CLIENT_B: 'Unknown'})
            app = create_gateway((CLIENT_A,), SETTINGS, admin_password=PASSWORD, usage_database=db)
            with TestClient(app, base_url='https://testserver') as client:
                result = client.get(ADMIN_PATH)
                self.assertEqual(result.status_code, 401)
                self.assertIn('Basic realm=', result.headers['www-authenticate'])
                self.assertEqual(client.get(ADMIN_USAGE_PATH, headers=AUTH_A).status_code, 401)
                self.assertEqual(client.get(HEALTH_PATH, headers=AUTH_ADMIN).status_code, 401)
                self.assertEqual(client.get(ADMIN_PATH, headers=list(AUTH_ADMIN.items()) * 2).status_code, 401)
                self.assertEqual(client.post(PRESENCE_PATH, headers=AUTH_ADMIN).status_code, 401)
                self.assertEqual(client.post(PRESENCE_PATH, headers=AUTH_A).status_code, 400)
                self.assertEqual(client.post(PRESENCE_PATH, headers=dict(AUTH_A, **{'x-vv-man-version': '<html>'})).status_code, 400)
                self.assertEqual(client.get(PRESENCE_PATH, headers=AUTH_A).status_code, 404)
                self.assertEqual(client.post(ADMIN_USAGE_PATH, headers=AUTH_ADMIN).status_code, 404)
            with TestClient(app) as insecure:
                result = insecure.get(ADMIN_PATH, headers=AUTH_ADMIN)
                self.assertEqual(result.status_code, 404)
                self.assertNotIn('www-authenticate', result.headers)

    def test_distinguishes_desktop_presence_and_legacy_service_request_and_persists_no_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'usage.sqlite3'

            def gateway():
                return create_gateway((CLIENT_A, CLIENT_B), SETTINGS, admin_password=PASSWORD,
                                      usage_database=db, user_labels={CLIENT_A: '<script>开发者指定备注</script>'})

            with TestClient(gateway(), base_url='https://testserver') as client:
                self.assertEqual(client.get(ADMIN_USAGE_PATH, headers=AUTH_ADMIN).json()['online_count'], 0)
                with patch('data_gateway.usage.time', return_value=1_800_000_000):
                    self.assertEqual(client.post(PRESENCE_PATH, headers=dict(AUTH_A, **{'x-vv-man-version': VERSION})).status_code, 200)
                    self.assertEqual(client.get(HEALTH_PATH, headers=AUTH_B).status_code, 200)
                    self.assertEqual(client.get('/api/workbench?source=demo', headers=AUTH_B).status_code, 200)
                    active = client.get(ADMIN_USAGE_PATH, headers=AUTH_ADMIN).json()
                    alice, bob = sorted(active['users'], key=lambda row: row['name'])
                    self.assertEqual(alice['status'], 'online')
                    self.assertEqual(alice['client_version'], VERSION)
                    self.assertEqual(alice['request_count'], 0)
                    self.assertIsNone(alice['last_request'])
                    self.assertEqual(bob['status'], 'recent')
                    self.assertEqual(bob['request_count'], 1)
                    self.assertIsNone(bob['last_presence'])
                    self.assertEqual(active['online_count'], 1)
                    page = client.get(ADMIN_PATH, headers=AUTH_ADMIN)
                    self.assertEqual(page.status_code, 200)
                    self.assertIn('&lt;script&gt;', page.text)
                    self.assertNotIn('<script>', page.text)
                    self.assertIn('no-store', page.headers['cache-control'])
                    self.assertIn("frame-ancestors 'none'", page.headers['content-security-policy'])
                    for secret in (CLIENT_A, CLIENT_B, PASSWORD):
                        self.assertNotIn(secret, page.text)
            with TestClient(gateway(), base_url='https://testserver') as client:
                with patch('data_gateway.usage.time', return_value=1_800_000_950):
                    retained = client.get(ADMIN_USAGE_PATH, headers=AUTH_ADMIN).json()
                self.assertEqual(retained['online_count'], 0)
                self.assertEqual({row['status'] for row in retained['users']}, {'offline'})
                self.assertEqual({row['id'] for row in active['users']}, {row['id'] for row in retained['users']})
                self.assertEqual(sum(row['request_count'] for row in retained['users']), 1)
            database = db.read_bytes()
            for value in (CLIENT_A, CLIENT_B, PASSWORD, 'source=demo', 'unused.invalid', '开发者指定备注'):
                self.assertNotIn(value.encode(), database)

    def test_failed_record_does_not_block_existing_gateway_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_gateway((CLIENT_A,), SETTINGS, admin_password=PASSWORD,
                                 usage_database=Path(directory) / 'usage.sqlite3')
            with TestClient(app, base_url='https://testserver') as client, \
                    patch('data_gateway.usage.Usage.record', side_effect=sqlite3.OperationalError()), \
                    patch('data_gateway.usage.Usage.audit', side_effect=sqlite3.OperationalError()):
                self.assertEqual(client.get('/api/workbench?source=demo', headers=AUTH_A).status_code, 200)
                self.assertEqual(client.post(PRESENCE_PATH, headers=dict(AUTH_A, **{'x-vv-man-version': VERSION})).status_code, 503)

    def test_audit_has_only_broker_operation_status_time_and_pseudonymous_user(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'usage.sqlite3'
            gateway = create_gateway((CLIENT_A, CLIENT_B), SETTINGS, admin_password=PASSWORD, usage_database=db)
            resource_value = 'aa' * 16
            query_value = 'fixture-query-contains-sensitive-input'
            with TestClient(gateway, base_url='https://testserver') as client, \
                    patch('data_gateway.app.perf_counter', side_effect=[1.0, 1.125, 2.0, 2.250]):
                self.assertEqual(client.get('/api/workbench', params={'source': 'demo', 'omit': query_value},
                                            headers=AUTH_A).status_code, 200)
                self.assertEqual(client.post(DEEP_TASKS + '/' + resource_value + '/cancel', json={'value': query_value},
                                             headers=AUTH_B).status_code, 503)
                self.assertEqual(client.get(HEALTH_PATH, headers=AUTH_A).status_code, 200)
                self.assertEqual(client.get('/api/workbench').status_code, 401)
                self.assertEqual(client.get(ADMIN_USAGE_PATH, headers=AUTH_A).status_code, 401)
                report = client.get(ADMIN_USAGE_PATH, headers=AUTH_ADMIN).json()
                self.assertEqual([item['operation'] for item in report['audit']], ['deep_cancel', 'dashboard'])
                self.assertEqual([item['status'] for item in report['audit']], [503, 200])
                self.assertEqual([item['elapsed_ms'] for item in report['audit']], [250, 125])
                ids = {user['id'] for user in report['users']}
                self.assertEqual({item['user_id'] for item in report['audit']}, ids)
                self.assertEqual(sum(user['request_count'] for user in report['users']), 1)
                audit_page = client.get(ADMIN_PATH, headers=AUTH_ADMIN).text
                self.assertIn('最近网关操作', audit_page)
                self.assertIn('取消分析任务', audit_page)
            for item in (query_value, resource_value, CLIENT_A, CLIENT_B, PASSWORD):
                self.assertNotIn(item, str(report))
                self.assertNotIn(item, audit_page)
                self.assertNotIn(item.encode(), db.read_bytes())

    def test_audit_retention_bounds_rows_and_expired_events(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'usage.sqlite3'
            usage = Usage(database, PASSWORD, (CLIENT_A,))
            with patch('data_gateway.usage.AUDIT_LIMIT', 2), patch('data_gateway.usage.time', return_value=1_800_000_000):
                for status in (200, 400, 503):
                    usage.audit(CLIENT_A.encode(), 'sql_query', status, 1)
                self.assertEqual([row['status'] for row in usage.snapshot()['audit']], [503, 400])
            with patch('data_gateway.usage.time', return_value=1_800_000_001 + AUDIT_RETENTION_SECONDS):
                self.assertEqual(usage.snapshot()['audit'], [])
                usage.audit(CLIENT_A.encode(), 'sql_query', 200, 1)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute('SELECT count(*) FROM gateway_audit').fetchone()[0], 1)


class DesktopPresenceTests(unittest.TestCase):
    def test_remote_presence_is_background_only_and_old_gateway_response_is_ignored(self):
        opener = Mock()
        failure = HTTPError('https://testserver' + PRESENCE_PATH, 404, 'old gateway', {}, None)
        opener.open.side_effect = failure
        remote = RemoteData('remote', 'https://testserver', CLIENT_A, opener)
        with patch('server.remote_data.anyio.sleep', side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                anyio.run(remote.report_presence, VERSION)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.full_url, 'https://testserver' + PRESENCE_PATH)
        self.assertEqual(request.get_header('Authorization'), f'Bearer {CLIENT_A}')
        self.assertEqual(request.get_header('X-vv-man-version'), VERSION)
        self.assertEqual(request.data, b'')
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 8)

    def test_only_windows_managed_remote_desktop_reports_presence(self):
        import sys

        if sys.platform != 'win32':
            self.skipTest('native Windows desktop gate')
        opener = Mock()
        remote = RemoteData('remote', 'https://testserver', CLIENT_A, opener)
        for managed, mode, sharing, expected in (
            (True, 'shared', '0', True), (False, 'shared', '0', False),
            (True, 'isolated', '0', False), (True, 'shared', '1', False),
        ):
            with self.subTest(managed=managed, mode=mode, sharing=sharing), tempfile.TemporaryDirectory() as directory, \
                    patch.dict('os.environ', SHARE_MODE=sharing), \
                    patch('server.app.RemoteData.from_env', return_value=remote), \
                    patch('server.remote_data.RemoteData.report_presence', autospec=True) as heartbeat:
                app = create_app(data_dir=directory, session_mode=mode, managed_desktop=managed)
                with TestClient(app) as client:
                    self.assertEqual(client.get('/api/health').status_code, 200)
                self.assertEqual(heartbeat.called, expected)

