import importlib.util
from io import BytesIO
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from agent_core.sql_access import SqlAccessError, SqlSettings
from data_gateway.app import create_gateway
from server.remote_data import RemoteData


TOKEN = 'local-gateway-test-token-0' * 2
TOKEN_A = 'local-gateway-deep-token-a' * 2
TOKEN_B = 'local-gateway-deep-token-b' * 2
AUTH = {'Authorization': f'Bearer {TOKEN}'}
SETTINGS = SqlSettings('mysql://user:pass@db/test', max_rows=20, allowed_tables=('approved', 'other'))


class GatewayTests(unittest.TestCase):
    def test_only_listed_https_routes_with_bearer_token_are_available(self):
        app = create_gateway((TOKEN,), SETTINGS)
        client = TestClient(app, base_url='https://testserver')
        self.assertEqual(client.get('/api/data-gateway/health').status_code, 401)
        self.assertEqual(client.get('/api/data-gateway/health', headers=AUTH).status_code, 200)
        self.assertEqual(client.get('/api/data-gateway/health', headers=[
            ('authorization', AUTH['Authorization']), ('authorization', AUTH['Authorization'])]).status_code, 401)
        self.assertEqual(TestClient(app).get('/api/data-gateway/health', headers=AUTH).status_code, 404)
        for method, path in (
            ('GET', '/'), ('GET', '/events'), ('GET', '/api/assistant/status'),
            ('GET', '/api/deep-analysis/unknown'), ('GET', '/openapi.json'),
            ('POST', '/api/open'), ('GET', '/api/workbench/'), ('POST', '/api/workbench'),
        ):
            self.assertEqual(client.request(method, path, headers=AUTH).status_code, 404)
        self.assertEqual(client.get('/api/sql/schema', headers=AUTH).status_code, 403)
        disabled = client.get('/api/deep-analysis/status', headers=AUTH)
        self.assertEqual(disabled.status_code, 503)
        self.assertEqual(disabled.json()['error']['code'], 'remote_deep_disabled')
        self.assertEqual(client.get('/api/workbench?source=demo', headers=AUTH).json()['source']['mode'], 'demo')

    def test_live_failure_remains_an_error(self):
        client = TestClient(create_gateway((TOKEN,), SETTINGS), base_url='https://testserver')
        with patch('data_gateway.app.dashboard', return_value={'source': {'mode': 'unconfigured'}}):
            self.assertEqual(client.get('/api/workbench?source=live', headers=AUTH).status_code, 503)

    def test_remote_analysis_requires_separate_grant_and_isolates_all_owned_resources(self):
        from deep_analysis.config import Config
        from deep_analysis.service import DeepAnalysisService
        from test_deep_analysis_service import CSV, FakeExecutor, FakeModel

        with tempfile.TemporaryDirectory() as directory:
            service = DeepAnalysisService(Path(directory) / 'gateway-analysis',
                                          Config('https://synthetic.invalid', 'test', 'test'),
                                          executor=FakeExecutor(), model_client=FakeModel())
            with self.assertRaises(ValueError):
                create_gateway((TOKEN,), SETTINGS, deep_service=service, deep_tokens=(TOKEN_A,))
            app = create_gateway((TOKEN, TOKEN_A, TOKEN_B), SETTINGS, deep_service=service, deep_tokens=(TOKEN_A, TOKEN_B))
            alice = {'Authorization': f'Bearer {TOKEN_A}'}
            bob = {'Authorization': f'Bearer {TOKEN_B}'}
            with TestClient(app, base_url='https://testserver') as client:
                prefix = '/api/deep-analysis'
                self.assertEqual(client.get(prefix + '/status', headers=AUTH).json()['error']['code'], 'remote_deep_denied')
                self.assertEqual(client.get(prefix + '/status').status_code, 401)
                self.assertEqual(client.get(prefix + '/unexpected', headers=alice).status_code, 404)
                self.assertTrue(client.get(prefix + '/status', headers=alice).json()['ready'])
                from openpyxl import Workbook
                workbook = Workbook()
                workbook.active.append(['synthetic', 'value'])
                workbook.active.append(['yes', 42])
                stream = BytesIO()
                workbook.save(stream)
                excel_headers = {**alice, 'X-Filename': 'sample.xlsx', 'Content-Type': 'application/octet-stream'}
                excel = client.post(prefix + '/files', headers=excel_headers, content=stream.getvalue())
                self.assertEqual(excel.status_code, 201)
                self.assertEqual(excel.json()['file']['row_count'], 1)
                rejected = client.post(prefix + '/files', headers=excel_headers, content=b'not a zip archive')
                self.assertEqual(rejected.json()['error']['code'], 'invalid_excel')
                upload = client.post(prefix + '/files', headers={**alice, 'X-Filename': 'test.csv',
                                     'Content-Type': 'text/csv'}, content=CSV)
                self.assertEqual(upload.status_code, 201)
                body = {'file_id': upload.json()['file']['id'], 'question': 'Synthetic'}
                self.assertEqual(client.post(prefix + '/tasks', headers=bob, json=body).status_code, 404)
                created = client.post(prefix + '/tasks', headers=alice, json=body)
                self.assertEqual(created.status_code, 202)
                task = prefix + '/tasks/' + created.json()['task']['id']
                self.assertEqual(client.get(prefix + '/tasks', headers=bob).json(), {'tasks': []})
                self.assertEqual(client.get(task, headers=bob).status_code, 404)
                self.assertEqual(client.post(task + '/cancel', headers=bob).status_code, 404)
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    result = client.get(task, headers=alice).json()['task']
                    if result['status'] not in ('queued', 'running'):
                        break
                    time.sleep(.03)
                self.assertEqual(result['status'], 'complete')
                artifact = next(item['url'] for item in result['artifacts'] if item['name'] == 'chart.png')
                self.assertEqual(client.get(artifact, headers={**bob, 'Range': 'bytes=0-31'}).status_code, 404)
                good = client.get(artifact, headers=alice)
                self.assertEqual(good.headers['content-type'], 'image/png')
                self.assertTrue(good.content.startswith(b'\x89PNG'))
                self.assertEqual(good.headers['x-content-type-options'], 'nosniff')
            self.assertTrue(service.closed)

    @unittest.skipUnless(importlib.util.find_spec('sqlglot'), 'Install requirements-gateway.txt')
    def test_manual_and_model_sql_use_same_restrictions(self):
        client = TestClient(create_gateway((TOKEN,), SETTINGS, sql_enabled=True, sql_tables=('approved',)),
                            base_url='https://testserver')
        with (patch('data_gateway.app.schema', return_value=[]), patch('data_gateway.app.run', return_value={}) as execute,
              patch('data_gateway.app.propose_sql', return_value='SELECT * FROM other') as propose):
            schema_response = client.get('/api/sql/schema', headers=AUTH)
            self.assertEqual(schema_response.status_code, 200)
            self.assertEqual(client.post('/api/sql/ask', headers=AUTH, json={'question': 'test'}).status_code, 400)
            self.assertEqual(client.post('/api/sql/query', headers=AUTH, json={'sql': 'SELECT * FROM other'}).status_code, 400)
            execute.assert_not_called()
            propose.return_value = 'SELECT COUNT(*) FROM approved'
            self.assertEqual(client.post('/api/sql/ask', headers=AUTH, json={'question': 'test'}).status_code, 200)
            self.assertIn('LIMIT 20', execute.call_args.args[0])
            self.assertEqual(client.post('/api/sql/query', headers=AUTH, content=b'0' * 65537).status_code, 400)


@unittest.skipUnless(importlib.util.find_spec('sqlglot'), 'Install requirements-gateway.txt')
class GatewaySQLTests(unittest.TestCase):
    def test_scoped_tables_functions_and_result_limit(self):
        from data_gateway.sql_policy import checked_sql

        settings = SqlSettings(SETTINGS.url, max_rows=20, allowed_tables=('approved',))
        for statement in (
            'SELECT * FROM approved, hidden',
            'SELECT * FROM hidden JOIN (WITH hidden AS (SELECT * FROM approved) SELECT * FROM hidden) h',
            'WITH hidden AS (SELECT * FROM hidden) SELECT * FROM approved',
            'SELECT * FROM approved UNION SELECT * FROM hidden',
            'SELECT * FROM other_db.approved',
            'SELECT * FROM APPROVED',
            'SELECT * FROM hidden AS duplicate JOIN (SELECT * FROM approved) AS duplicate',
            'SELECT * FROM approved INTO OUTFILE \'out\'',
            'SELECT * FROM approved FOR UPDATE',
            'SELECT * FROM approved; SELECT * FROM hidden',
            'SELECT COUNT(*) FROM approved LIMIT 1 /*! bypass */',
        ):
            with self.subTest(statement=statement), self.assertRaises(SqlAccessError):
                checked_sql(statement, settings)
        result = checked_sql('WITH a AS (SELECT * FROM approved) SELECT COUNT(*) FROM a LIMIT 9999', settings)
        self.assertTrue(result.endswith('LIMIT 20'))
        result = checked_sql("SELECT JSON_EXTRACT(payload, '$.value'), custom_stat(value) FROM approved", settings)
        self.assertIn('JSON_EXTRACT', result)
        self.assertIn('CUSTOM_STAT', result.upper())
        self.assertTrue(result.endswith('LIMIT 20'))


class DesktopRelayTests(unittest.TestCase):
    def test_configuration_is_https_only_and_never_reports_token(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(RemoteData.from_env().status(), {'mode': 'local', 'url': None})
            os.environ.update(DATA_AGENT_REMOTE_TOKEN=TOKEN, DATA_AGENT_REMOTE_URL='http://test.invalid')
            self.assertEqual(RemoteData.from_env().status(), {'mode': 'invalid', 'url': None})
            os.environ['DATA_AGENT_REMOTE_URL'] = 'https://test.invalid:8443/'
            remote = RemoteData.from_env()
            self.assertEqual(remote.status(), {'mode': 'remote', 'url': 'https://test.invalid:8443'})
            self.assertNotIn(TOKEN, repr(remote))

    def test_only_configured_origin_receives_generated_token_and_headers(self):
        from email.message import Message
        from io import BytesIO

        response = BytesIO(b'{"rows":[]}')
        response.getcode = lambda: 200
        response.headers = Message()
        response.headers['Content-Type'] = 'application/json'
        opener = Mock()
        opener.open.return_value = response
        remote = RemoteData('remote', 'https://test.invalid:8443', TOKEN, opener)
        app = FastAPI()

        @app.post('/api/sql/query')
        async def route(request: Request):
            return await remote.relay(request)

        result = TestClient(app).post('/api/sql/query?q=%2F%2Fbad.invalid', json={'sql': 'SELECT 1'},
                                      headers={'Authorization': 'Bearer caller', 'Cookie': 'data=private'})
        self.assertEqual(result.json(), {'rows': []})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://test.invalid:8443/api/sql/query?q=%2F%2Fbad.invalid')
        self.assertEqual(request.headers['Authorization'], AUTH['Authorization'])
        self.assertNotIn('Cookie', request.headers)

    def test_deep_artifact_keeps_safe_download_headers_and_drops_range(self):
        from email.message import Message
        from io import BytesIO

        response = BytesIO(b'%PDF-1.4\n')
        response.getcode = lambda: 200
        response.headers = Message()
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = "inline; filename*=utf-8''%E5%88%86%E6%9E%90.pdf"
        response.headers['Set-Cookie'] = 'must-not-pass=yes'
        opener = Mock()
        opener.open.return_value = response
        remote = RemoteData('remote', 'https://test.invalid:8443', TOKEN, opener)
        app = FastAPI()
        path = '/api/deep-analysis/artifacts/' + 'a' * 32

        @app.get(path)
        async def route(request: Request):
            return await remote.relay(request)

        result = TestClient(app).get(path, headers={'Range': 'bytes=0-3'})
        self.assertEqual(result.content, b'%PDF-1.4\n')
        self.assertEqual(result.headers['content-disposition'], "attachment; filename*=utf-8''%E5%88%86%E6%9E%90.pdf")
        self.assertNotIn('set-cookie', result.headers)
        self.assertNotIn('Range', opener.open.call_args.args[0].headers)


if __name__ == '__main__':
    unittest.main()
