"""Native host integration using synthetic CSV and a non-executing runtime."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from deep_analysis.config import Config
from deep_analysis.service import DeepAnalysisService
from server.app import create_app


class OfflineExecutor:
    def readiness(self):
        return dict(docker_available=False, image_ready=False, execution_ready=False,
                    execution_reason='Synthetic test: Docker unavailable')

    def execute(self, *args, **kwargs):
        raise AssertionError('Host integration must not execute code')

    def close(self):
        pass


class DeepAnalysisHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(data_dir=self.temp.name, session_mode='isolated')
        self.service = DeepAnalysisService(Path(self.temp.name) / 'deep_analysis',
                                          config=Config('', '', ''), executor=OfflineExecutor())
        self.app.state.deep_analysis_service = self.service
        self.first = TestClient(self.app)
        self.second = TestClient(self.app)
        self.first.__enter__()
        self.second.__enter__()

    def tearDown(self):
        self.second.__exit__(None, None, None)
        self.first.__exit__(None, None, None)
        self.temp.cleanup()

    def upload(self, client):
        response = client.post('/api/deep-analysis/files', content=b'date,value\n2026-01-01,4\n2026-01-02,8\n',
                               headers={'Content-Type': 'application/octet-stream', 'X-Filename': 'synthetic.csv'})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['file']

    def test_status_is_independent_and_deep_only_identity_does_not_create_chat_database(self):
        status = self.first.get('/api/deep-analysis/status')
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json()['configured'])
        self.assertFalse(status.json()['ready'])
        self.assertFalse(status.json()['official_deepanalyze'])
        self.assertIn('assistant_session', self.first.cookies)
        initial_cookie = self.first.cookies['assistant_session']
        self.first.get('/api/deep-analysis/status')
        self.assertEqual(self.first.cookies['assistant_session'], initial_cookie)
        self.assertEqual(list((Path(self.temp.name) / 'assistant_sessions').glob('*.sqlite3')), [])
        schema = self.first.get('/openapi.json').json()
        self.assertIn('/api/deep-analysis/status', schema['paths'])

    def test_owner_cookie_persists_across_upload_task_and_cross_owner_access_is_denied(self):
        file = self.upload(self.first)
        response = self.first.post('/api/deep-analysis/tasks', json={'file_id': file['id'], 'question': '汇总合成数值'})
        self.assertEqual(response.status_code, 202, response.text)
        task = response.json()['task']
        self.assertEqual(task['status'], 'blocked')
        self.assertEqual(task['error_code'], 'model_not_configured')
        self.assertEqual(self.first.get('/api/deep-analysis/tasks/' + task['id']).status_code, 200)
        self.assertEqual(self.second.get('/api/deep-analysis/tasks/' + task['id']).status_code, 404)
        self.assertEqual(self.second.post('/api/deep-analysis/tasks', json={'file_id': file['id'], 'question': 'other'}).status_code, 404)
        self.assertEqual(self.second.post('/api/deep-analysis/tasks/' + task['id'] + '/cancel', json={}).status_code, 404)
        workspace = self.service.tasks_dir / task['id'] / 'work'
        workspace.mkdir(parents=True)
        (workspace / 'synthetic-output.csv').write_text('x,y\n1,2\n', encoding='utf-8')
        artifacts = self.service._collect(self.first.cookies['assistant_session'], task['id'], workspace)
        self.assertTrue(artifacts)
        path = '/api/deep-analysis/artifacts/' + artifacts[0]['id']
        self.assertEqual(self.first.get(path).status_code, 200)
        self.assertEqual(self.second.get(path).status_code, 404)

    def test_cross_origin_rejected_before_upload_and_existing_features_remain_available(self):
        response = self.first.post('/api/deep-analysis/files', content=b'x\n1\n',
                                   headers={'Origin': 'https://unrelated.invalid', 'X-Filename': 'test.csv'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(list(self.service.uploads.glob('*.csv')), [])
        self.assertEqual(self.first.get('/api/health').json()['framework'], 'fastapi')
        self.assertEqual(self.first.get('/api/workbench?source=live').json()['source']['mode'], 'unconfigured')
        self.assertEqual(self.first.get('/api/meta').status_code, 400)
        self.assertEqual(self.first.get('/api/assistant/conversations').json()['conversations'], [])

    def test_shutdown_closes_deep_service(self):
        with patch.object(self.service, 'close') as stop:
            with TestClient(self.app):
                pass
            stop.assert_called_once()

    def test_invalid_trial_config_only_disables_trial_and_never_discloses_config_values(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict('os.environ', {'DEEP_ANALYSIS_MAX_ROWS': 'not-an-integer',
                                           'DEEP_ANALYSIS_API_KEY': 'private-test-value'}):
                app = create_app(data_dir=folder)
            with TestClient(app) as client:
                response = client.get('/api/deep-analysis/status')
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('private-test-value', response.text)
                self.assertEqual(client.get('/api/health').status_code, 200)
                self.assertEqual(client.get('/api/assistant/conversations').status_code, 200)


if __name__ == '__main__':
    unittest.main()
