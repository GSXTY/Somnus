"""ASGI detection compatibility and browser-context separation, without sockets."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from event_detection import viewer
from server_detection import install_routes
from server_detection.routes import COOKIE, DetectionRuntime


RAW = b'time,flow\n2026-01-01 00:00:00,1\n2026-01-01 00:00:30,2\n'


class FastAPIDetectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = FastAPI()
        self.runtime = install_routes(self.app, Path(self.temp.name))
        self.a, self.b = TestClient(self.app), TestClient(self.app)
        self.old = viewer.recording, viewer.recording_cache, viewer.event_store

    def tearDown(self):
        self.a.close()
        self.b.close()
        self.assertEqual((viewer.recording, viewer.recording_cache, viewer.event_store), self.old)
        self.temp.cleanup()

    def open(self, client, raw=RAW):
        response = client.post('/api/open', content=raw, headers={'X-Filename':'fixture.csv'})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_browsers_cannot_read_activate_or_close_each_others_current_file(self):
        meta = self.open(self.a)
        self.assertIn('HttpOnly', self.a.cookies.get(COOKIE) and self.a.post('/api/open', content=RAW).headers['set-cookie'])
        self.assertEqual(self.a.get('/api/meta').json()['file_id'], meta['file_id'])
        self.assertEqual(self.b.get('/api/meta').status_code, 400)
        self.assertFalse(self.b.post('/api/activate', json={'file_id':meta['file_id']}).json()['hit'])
        self.assertEqual(self.b.post('/api/close', json={'file_id':meta['file_id']}).status_code, 409)
        other = self.open(self.b, RAW.replace(b',2\n',b',3\n'))
        self.assertNotEqual(meta['file_id'], other['file_id'])
        self.assertEqual(self.a.get('/api/meta').json()['file_id'], meta['file_id'])
        self.assertEqual(self.b.get('/api/current-csv', params={'file_id':meta['file_id']}).status_code, 409)
        self.assertEqual(self.a.get('/api/current-csv', params={'file_id':meta['file_id']}).content, RAW)
        self.assertEqual(len(self.b.get('/api/recording-overview').json()['files']), 1)

    def test_annotations_and_wave_routes_preserve_existing_contract(self):
        meta = self.open(self.a)
        fid = meta['file_id']
        event = dict(id='manual', start=1, end=10, mode='raw', type='波形异常',
                     source='manual',status='reviewed',channels=['flow'],note='test',updated_at='now')
        response = self.a.post('/api/events', json=dict(file_id=fid,revision=0,events=[event]))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.a.get('/api/events', params={'file_id':fid}).json()['events'], [event])
        self.assertEqual(self.a.get('/api/wave', params=dict(file_id=fid,start=0,end=30,channel='flow')).status_code, 200)
        self.assertEqual(self.a.get('/api/scans', params={'file_id':fid}).json()['total'], 0)
        self.assertEqual(self.a.post('/api/feedback/open-folder',json={'file_id':fid}).status_code,409)
        self.assertTrue(self.a.post('/api/close',json={'file_id':fid}).json()['closed'])
        self.assertEqual(self.a.get('/api/meta').status_code,400)

    def test_origin_size_and_invalid_upload_leave_context_unchanged(self):
        self.runtime.max_upload_bytes = len(RAW)
        meta = self.open(self.a)
        response = self.a.post('/api/open', content=RAW, headers={'Origin':'https://elsewhere.invalid'})
        self.assertEqual(response.status_code,403)
        self.assertEqual(self.a.post('/api/open',content=RAW+b'huge').status_code,413)
        self.assertEqual(self.a.post('/api/open',content=b'bad,csv\ninvalid,1').status_code,400)
        self.assertEqual(self.a.get('/api/meta').json()['file_id'],meta['file_id'])
        self.assertEqual(self.a.post('/api/close',json={'file_id':meta['file_id']},headers={'Origin':'http://testserver'}).status_code,200)

    def test_https_origin_and_cookie(self):
        with TestClient(self.app,base_url='https://testserver') as client:
            response=client.post('/api/open',content=RAW,headers={'Origin':'https://testserver'})
            self.assertEqual(response.status_code,200,response.text)
            self.assertIn('Secure',response.headers['set-cookie'])
            self.assertEqual(client.get('/api/meta').json()['file_id'],hashlib.sha256(RAW).hexdigest())

    def test_context_limit_and_expiry_never_reuse_unknown_tokens(self):
        self.runtime.max_sessions=1
        self.open(self.a)
        self.assertEqual(self.b.get('/api/meta').status_code,503)
        context=next(iter(self.runtime.contexts.values()))
        context.touched=-10000
        self.assertEqual(self.b.get('/api/meta').status_code,400)
        self.assertNotEqual(self.a.cookies.get(COOKIE),self.b.cookies.get(COOKIE))

    def test_local_shared_mode_preserves_cookie_less_mcp_current_file(self):
        app=FastAPI()
        runtime=install_routes(app,Path(self.temp.name)/'shared',session_mode='shared')
        with TestClient(app) as browser, TestClient(app) as cookie_less_mcp:
            meta=self.open(browser)
            self.assertNotIn(COOKIE,browser.cookies)
            self.assertEqual(cookie_less_mcp.get('/api/meta').json()['file_id'],meta['file_id'])
            self.assertEqual(runtime.limits['session_mode'],'shared')
            self.assertEqual(len(runtime.contexts),1)

    def test_upload_memory_budget_rejects_without_replacing_current_file(self):
        meta=self.open(self.a)
        self.runtime.max_total_bytes=self.runtime._size(next(iter(self.runtime.contexts.values())))
        larger=RAW.replace(b',2\n',b',3\n')
        response=self.a.post('/api/open',content=larger)
        self.assertEqual(response.status_code,507,response.text)
        self.assertEqual(self.a.get('/api/meta').json()['file_id'],meta['file_id'])

    def test_real_detector_readonly_scan_history_and_feedback_through_asgi(self):
        from tests.test_patient_flow_v4_integration import fixture
        meta=self.open(self.a,fixture().raw_csv)
        fid=meta['file_id']
        args=dict(file_id=fid,profile='dynamic_baseline_v3',dynamic_method='detrended_abs',
                  window_seconds=8,min_duration=10)
        analyzed=self.a.post('/api/analyze',json=args)
        self.assertEqual(analyzed.status_code,200,analyzed.text)
        self.assertTrue(analyzed.json()['read_only'])
        self.assertEqual(self.a.get('/api/events',params={'file_id':fid}).json()['revision'],0)
        scanned=self.a.post('/api/detect',json=args)
        self.assertEqual(scanned.status_code,200,scanned.text)
        packet=scanned.json()
        self.assertEqual(packet['settings']['profile'],'dynamic_baseline_v3')
        run_id=packet['packet']['run_id']
        self.assertEqual(self.a.get('/api/scans',params={'file_id':fid}).json()['total'],1)
        feedback=self.a.post('/api/feedback',json=dict(file_id=fid,run_id=run_id,kind='automatic'))
        self.assertEqual(feedback.status_code,200,feedback.text)
        self.assertEqual(feedback.json()['run_id'],run_id)
        self.assertEqual(self.b.get('/api/scans',params={'file_id':fid}).status_code,400)

    def test_deployment_limits_are_configurable_and_invalid_values_fail_before_store(self):
        with patch.dict('os.environ', {'AI_AGENT_MAX_UPLOAD_MB':'1024','AI_AGENT_MAX_MEMORY_MB':'8192',
                                      'AI_AGENT_MAX_SESSIONS':'8','AI_AGENT_SESSION_TTL_SECONDS':'7200'}):
            runtime=DetectionRuntime(Path(self.temp.name)/'configured')
            self.assertEqual(runtime.limits['max_upload_bytes'],1024**3)
            self.assertEqual(runtime.limits['max_total_bytes'],8192*1024**2)
            self.assertEqual(runtime.limits['max_sessions'],8)
            self.assertEqual(runtime.limits['session_ttl_seconds'],7200)
        for invalid in ('0','-1','1.5','1025','not-a-number'):
            target=Path(self.temp.name)/('invalid-'+invalid)
            with patch.dict('os.environ',{'AI_AGENT_MAX_UPLOAD_MB':invalid}):
                with self.assertRaisesRegex(ValueError,'AI_AGENT_MAX_UPLOAD_MB'):
                    DetectionRuntime(target)
            self.assertFalse(target.exists())


if __name__=='__main__':
    unittest.main()
