import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from event_detection import viewer
from event_detection.event_store import EventStore


class DashboardTests(unittest.TestCase):
    def test_recording_inventory_is_separate_from_user_dashboard(self):
        old = viewer.recording, viewer.event_store, viewer.recording_cache
        with tempfile.TemporaryDirectory() as folder:
            viewer.recording = None
            viewer.event_store = EventStore(Path(folder) / 'events.db')
            viewer.recording_cache = viewer.RecordingCache(max_items=1)
            server = viewer.ThreadingHTTPServer(('127.0.0.1', 0), viewer.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def get(path):
                with client.open(f'http://127.0.0.1:{server.server_port}{path}') as response:
                    return json.load(response)
            try:
                home_marker=b'/workbench-assets/' if (viewer.PAGE_ASSETS/'web'/'index.html').is_file() else b'dashboard.js'
                for route, marker in (('/', home_marker), ('/dashboard', home_marker), ('/legacy-overview',b'dashboard.css'), ('/events', b'viewer.js'), ('/dashboard.js', b'/api/dashboard'), ('/dashboard.css', b'.sidebar'), ('/ui/bootstrap.min.css', b'Bootstrap'), ('/ui/events.css', b'.events-page')):
                    with client.open(f'http://127.0.0.1:{server.server_port}{route}') as response:
                        self.assertIn(marker, response.read())
                self.assertEqual(get('/api/recording-overview')['summary']['file_count'], 0)
                self.assertIsNone(get('/api/recording-overview')['current_recording'])
                population = get('/api/dashboard')
                self.assertEqual(population['source']['mode'], 'unconfigured')
                self.assertIsNone(population['metrics']['total_users'])
                demo = get('/api/dashboard?source=demo')
                self.assertEqual(demo['source']['mode'], 'demo')
                self.assertFalse(demo['source']['connected'])
                self.assertGreater(demo['metrics']['total_users'], 0)
                self.assertNotIn('files', demo)
                first = viewer.Recording(b'time,flow\n2026-01-01 00:00:00,1\n2026-01-01 00:00:30,2\n', 'one.csv')
                second = viewer.Recording(b'time,flow\n2026-01-01 00:00:00,3\n2026-01-01 00:01:00,4\n', 'two.csv')
                viewer.recording_cache.put(first)
                viewer.recording_cache.put(first)
                viewer.recording_cache.put(second)
                viewer.recording = second
                event = dict(id='checked', start=1, end=10, mode='raw', type='波形异常', source='manual', status='reviewed', channels=['flow'], note='', updated_at='now')
                viewer.event_store.write(second.meta, 0, [event])
                result = get('/api/recording-overview')
                self.assertEqual(result['summary'], dict(file_count=2, total_duration_seconds=90))
                self.assertEqual(len(viewer.recording_cache.items), 1)
                self.assertEqual(sum(f['is_current'] for f in result['files']), 1)
                self.assertEqual(result['current_recording']['event_counts']['confirmed'], 1)
                self.assertEqual(result['current_recording']['sample_count'], 2)
                viewer.recording = None
                self.assertEqual(get('/api/recording-overview')['summary']['file_count'], 2)
                self.assertIsNone(get('/api/recording-overview')['current_recording'])
                self.assertIsNone(get('/api/dashboard')['metrics']['total_users'])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(5)
                viewer.recording, viewer.event_store, viewer.recording_cache = old

if __name__ == '__main__':
    unittest.main()
