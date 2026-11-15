import tempfile
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from deep_analysis.asgi import create_router, sample_csv
from deep_analysis.config import Config
from deep_analysis.service import DeepAnalysisService
from test_deep_analysis_service import FakeExecutor


class DeepAnalysisASGITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = DeepAnalysisService(self.temp.name, Config('', '', ''), executor=FakeExecutor(False))
        self.app = FastAPI()
        self.app.state.deep_analysis_service = self.service
        self.app.state.session_mode = 'isolated'
        @self.app.middleware('http')
        async def test_identity(request, call_next):
            # Synthetic fixture only; real host identity comes from opaque HttpOnly cookie.
            request.scope.setdefault('state', {})['deep_analysis_context'] = request.headers.get('x-test-owner', 'a')
            return await call_next(request)
        self.app.include_router(create_router())
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.service.close()
        self.temp.cleanup()

    def test_upload_blocked_task_and_foreign_owner(self):
        status = self.client.get('/api/deep-analysis/status').json()
        self.assertFalse(status['configured'])
        self.assertFalse(status['execution_ready'])
        raw = self.client.get('/api/deep-analysis/sample.csv').content
        lines = len(raw.decode('utf-8-sig').splitlines())
        self.assertGreater(lines, 1)
        response = self.client.post('/api/deep-analysis/files', content=raw, headers={'X-Filename': 'synthetic.csv'})
        self.assertEqual(response.status_code, 201)
        file = response.json()['file']
        self.assertEqual(file['row_count'], lines - 1)
        response = self.client.post('/api/deep-analysis/tasks', json={'file_id': file['id'], 'question': '分析合成日报'})
        self.assertEqual(response.status_code, 202)
        task = response.json()['task']
        self.assertEqual(task['status'], 'blocked')
        self.assertEqual(self.client.get('/api/deep-analysis/tasks/' + task['id']).status_code, 200)
        self.assertEqual(self.client.get('/api/deep-analysis/tasks/' + task['id'], headers={'x-test-owner': 'b'}).status_code, 404)
        self.assertEqual(self.client.post('/api/deep-analysis/tasks/' + task['id'] + '/cancel', headers={'x-test-owner': 'b'}).status_code, 404)
        self.assertEqual(self.client.get('/api/deep-analysis/artifacts/' + 'a' * 32).status_code, 404)

    def test_invalid_body_limits_and_file_type(self):
        self.assertEqual(self.client.post('/api/deep-analysis/files', content=b'{}', headers={'X-Filename': 'secret.json'}).status_code, 400)
        self.assertEqual(self.client.post('/api/deep-analysis/tasks', content=b'[]').status_code, 400)
        self.assertEqual(self.client.post('/api/deep-analysis/tasks', json={'file_id': [], 'question': 'x'}).status_code, 404)
        self.assertEqual(self.client.post('/api/deep-analysis/tasks', content=b'no-json').status_code, 400)


if __name__ == '__main__':
    unittest.main()
