import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from event_detection.workbench_bridge import build_detection_context


class WorkbenchBridgeTests(unittest.TestCase):
    def setUp(self):
        self.recording = SimpleNamespace(meta={
            'file_id': 'content-fingerprint', 'name': r'C:\private\record.csv',
            'rows': 24, 'raw_duration': 12.0, 'display_duration': 12.8,
            'user_id': 'must-not-bind', 'path': 'must-not-expose',
        }, raw_csv=b'must-not-expose-csv')

    def test_current_recording_counts_and_read_only(self):
        packet = {'revision': 8, 'events': [
            {'status': 'candidate'}, {'status': 'candidate'},
            {'status': 'reviewed'}, {'status': 'ignored'},
        ]}
        before_meta = copy.deepcopy(self.recording.meta)
        before_packet = copy.deepcopy(packet)
        store = Mock()
        store.read.return_value = packet
        result = build_detection_context(self.recording, store)
        self.assertTrue(result['available'])
        self.assertTrue(result['event_counts_available'])
        self.assertEqual(result['event_counts'], {'candidate': 2, 'reviewed': 1, 'ignored': 1})
        self.assertEqual(result['recording']['name'], 'record.csv')
        self.assertEqual(result['recording']['raw_duration'], 12.0)
        self.assertEqual(result['recording']['display_duration'], 12.8)
        self.assertEqual(result['events_url'], '/events')
        self.assertFalse(result['user_binding']['verified'])
        self.assertIsNone(result['user_binding']['user_id'])
        self.assertIn('全历史', result['event_counts_scope'])
        self.assertEqual(store.mock_calls, [unittest.mock.call.read('content-fingerprint')])
        self.assertEqual(self.recording.meta, before_meta)
        self.assertEqual(packet, before_packet)
        serialized = json.dumps(result, ensure_ascii=False)
        for secret in ('private', 'must-not-bind', 'must-not-expose'):
            self.assertNotIn(secret, serialized)
        result['event_counts']['candidate'] = 100
        self.assertEqual(packet, before_packet)

    def test_no_recording_does_not_read_store(self):
        store = Mock()
        result = build_detection_context(None, store)
        self.assertFalse(result['available'])
        self.assertIsNone(result['recording'])
        self.assertFalse(result['event_counts_available'])
        self.assertTrue(any('尚未打开' in note for note in result['limitations']))
        self.assertEqual(store.mock_calls, [])

    def test_missing_store_is_explicitly_unknown(self):
        result = build_detection_context(self.recording)
        self.assertTrue(result['available'])
        self.assertFalse(result['event_counts_available'])
        self.assertEqual(sum(result['event_counts'].values()), 0)
        self.assertTrue(any('占位值' in note for note in result['limitations']))

    def test_empty_store_is_known_zero_and_posix_name_is_safe(self):
        self.recording.meta['name'] = '/private/record.csv'
        store = Mock()
        store.read.return_value = {'events': []}
        result = build_detection_context(self.recording, store)
        self.assertTrue(result['event_counts_available'])
        self.assertEqual(sum(result['event_counts'].values()), 0)
        self.assertEqual(result['recording']['name'], 'record.csv')

    def test_read_failure_is_not_misreported_as_zero(self):
        store = Mock()
        store.read.side_effect = RuntimeError('store unavailable')
        with self.assertRaises(RuntimeError):
            build_detection_context(self.recording, store)


if __name__ == '__main__':
    unittest.main()
