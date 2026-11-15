import copy
import hashlib
import json
from types import SimpleNamespace
import unittest

import numpy as np

from event_detection.patient_flow_v4 import (
    CHANNELS, VERSION, compute, detect, names, settings, waveform_channels,
)


def fixture(n=180, ranges=(), missing=(), state_change=None, sinus_period=None, zero=False):
    x, flow, states = [], [], []
    for second in range(n):
        if any(a <= second < b for a, b in missing):
            continue
        amplitude = 0 if zero else 20.
        for a, b, value in ranges:
            if a <= second < b:
                amplitude = value
        for row in range(20):
            x.append(float(second))  # Repeated source timestamps; no fabricated clock.
            flow.append(amplitude*np.sin(2*np.pi*(second+row/20)/sinus_period)
                        if sinus_period else amplitude*(1 if row % 2 else -1))
            states.append(1 if state_change is not None and second >= state_change else 0)
    x.append(float(n)); flow.append(20.); states.append(states[-1] if states else 0)
    x = np.asarray(x)
    gaps = [[float(x[i]), float(x[i+1])] for i in np.flatnonzero(np.diff(x) > 1)]
    values = np.asarray(flow)
    return SimpleNamespace(x=x, channels={'流量': values, '运行状态': np.asarray(states)}, gaps=gaps,
                           meta=dict(raw_duration=float(n), duration=float(n), start='2026-11-09 00:00:00',
                                     file_id=hashlib.sha256(values.tobytes()+x.tobytes()).hexdigest(),
                                     channels=['流量', '运行状态'], name='controlled.csv'))


class PatientFlowV4Tests(unittest.TestCase):
    def test_settings_contract_and_rejections(self):
        config = settings()
        self.assertEqual((config['window_seconds'], config['min_duration'], config['method']),
                         (5, 10, 'absolute_mean'))
        self.assertTrue(config['user_confirmed_patient_flow'])
        self.assertFalse(config['clinical_scoring'])
        self.assertEqual(config['hypopnea_confirmation'], 'unavailable_without_desaturation_or_arousal')
        self.assertEqual(len(CHANNELS), 70)
        for kwargs in ({'min_duration': 9}, {'min_duration': True}, {'min_duration': float('inf')},
                       {'dynamic_method': 'centered_rms'}, {'dynamic_method': 'detrended_abs'},
                       {'window_seconds': 0}, {'window_seconds': True}, {'window_seconds': 2.5},
                       {'event_types': []}, {'event_types': ['旧类型']}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                settings(**kwargs)

    def test_direct_meanabs_units_scale_and_no_leak_subtraction(self):
        recording = fixture()
        recording.channels['漏气量'] = np.full(len(recording.x), 100.)
        computed = compute(recording)
        self.assertAlmostEqual(computed['traces']['fast'][60], 20.)
        self.assertAlmostEqual(computed['traces']['strength'][60], 20.)
        self.assertAlmostEqual(computed['traces']['reference'][60], 20.)
        self.assertEqual(computed['events'], [])

    def test_normal_slow_breathing_has_no_candidates(self):
        for period in (4, 8, 12, 16):
            with self.subTest(period=period):
                self.assertEqual(compute(fixture(n=240, sinus_period=period))['events'], [])

    def test_apnea_exact_ratio_and_ten_complete_source_seconds(self):
        output = compute(fixture(ranges=[(80, 90, 2.)]))['events']
        self.assertEqual([(e['start'], e['end'], e['type']) for e in output],
                         [(80., 90., '呼吸暂停候选')])
        evidence = output[0]['evidence']
        self.assertEqual(evidence['threshold_met_at'], 90.)
        self.assertGreater(evidence['finalized_at'], evidence['threshold_met_at'])
        self.assertEqual(evidence['boundary_basis'], 'source_bin_coverage')
        short = compute(fixture(ranges=[(80, 89, 2.)]))['events']
        self.assertFalse(any(e['type'] == '呼吸暂停候选' for e in short))
        self.assertEqual(short, [])  # Main-window drag cannot manufacture raw duration.
        # An amplitude just above 10% does not become apnea.
        self.assertFalse(any(e['type'] == '呼吸暂停候选' for e in
                             compute(fixture(ranges=[(80, 100, 2.001)]))['events']))

    def test_hypopnea_equal_seventy_percent_has_real_source_bin_boundaries(self):
        output = compute(fixture(ranges=[(80, 110, 14.)]))['events']
        self.assertEqual(len(output), 1)
        self.assertEqual(output[0]['type'], '低通气候选')
        self.assertEqual(output[0]['start'], 80.)  # Past observed buffer recovers actual low bin.
        self.assertEqual(output[0]['end'], 110.)
        self.assertEqual(output[0]['evidence']['threshold_met_at'], 90.)
        self.assertEqual(output[0]['evidence']['boundary_basis'], 'source_bin_coverage')
        self.assertEqual(compute(fixture(ranges=[(80, 110, 14.001)]))['events'], [])
        for window in (1, 5, 10):
            for amplitude in (2., 10., 14.):
                with self.subTest(window=window, amplitude=amplitude):
                    self.assertEqual(compute(fixture(ranges=[(80, 89, amplitude)]), window=window)['events'], [])
                    ten = compute(fixture(ranges=[(80, 90, amplitude)]), window=window)['events']
                    self.assertEqual(len(ten), 1)
                    self.assertEqual((ten[0]['start'], ten[0]['end']), (80., 90.))

    def test_short_apnea_falls_back_to_qualified_hypopnea(self):
        output = compute(fixture(ranges=[(80, 87, 1.), (87, 120, 10.)]))['events']
        self.assertEqual(len(output), 1)
        self.assertEqual(output[0]['type'], '低通气候选')
        evidence = output[0]['evidence']
        self.assertEqual(evidence['apnea_core_intervals'], [[80., 87.]])
        self.assertEqual(evidence['qualified_apnea_intervals'], [])
        self.assertTrue(evidence['qualified_hypopnea_intervals'])

    def test_apnea_shoulders_are_retained_without_additive_outputs(self):
        output = compute(fixture(ranges=[(80, 96, 10.), (96, 108, 1.), (108, 130, 10.)]))['events']
        self.assertEqual(len(output), 1)
        self.assertEqual(output[0]['type'], '呼吸暂停候选')
        evidence = output[0]['evidence']
        self.assertEqual(evidence['qualified_apnea_intervals'], [[96., 108.]])
        self.assertTrue(evidence['qualified_hypopnea_intervals'])
        self.assertLess(evidence['episode_start'], output[0]['start'])
        self.assertGreater(evidence['episode_end'], output[0]['end'])
        self.assertTrue(evidence['mutually_exclusive_episode'])

    def test_sufficient_recovery_produces_two_distinct_episodes(self):
        events = compute(fixture(ranges=[(70, 82, 1.), (110, 122, 1.)]))['events']
        self.assertEqual([(e['start'], e['end']) for e in events], [(70., 82.), (110., 122.)])
        self.assertLess(events[0]['evidence']['finalized_at'], events[1]['start'])

    def test_gap_and_state_changes_never_join_short_parts(self):
        for kwargs in ({'missing': [(87, 89)]}, {'state_change': 87}):
            recording = fixture(ranges=[(80, 96, 1.)], **kwargs)
            self.assertEqual(compute(recording)['events'], [])
        packet = detect(fixture(ranges=[(80, 96, 1.)], missing=[(87, 89)]))
        self.assertTrue(any(e['type'] == '数据缺失' for e in packet['events']))

    def test_invalid_bins_reset_and_quality_report(self):
        recording = fixture(ranges=[(80, 105, 1.)])
        mask = (recording.x >= 86) & (recording.x < 98)
        recording.channels['流量'][mask] = np.nan
        packet = detect(recording)
        self.assertFalse(any(e['type'] in ('呼吸暂停候选', '低通气候选') for e in packet['events']))
        self.assertTrue(any(e['type'] == '信号异常' and e['start'] == 86 for e in packet['events']))

    def test_prefix_traces_are_causal_without_retrospective_backfill(self):
        ranges = [(70, 77, 1.), (90, 105, 1.)]
        full = compute(fixture(n=160, ranges=ranges))
        for stop in (75, 83, 100, 108, 120):
            partial = compute(fixture(n=stop, ranges=ranges))
            for key in full['traces']:
                np.testing.assert_allclose(partial['traces'][key], full['traces'][key][:stop], equal_nan=True)
            for event in partial['events']:
                self.assertLessEqual(event['evidence']['finalized_at'], stop)
                self.assertLessEqual(event['evidence']['threshold_met_at'], event['evidence']['finalized_at'])

    def test_long_event_short_recovery_then_event_uses_held_reference(self):
        ranges = [(70, 240, 10.), (247, 259, 1.)]
        full = compute(fixture(n=320, ranges=ranges))
        self.assertEqual([(e['start'], e['end'], e['type']) for e in full['events']],
                         [(70., 240., '低通气候选'), (247., 259., '呼吸暂停候选')])
        held = full['events'][1]['evidence']
        self.assertTrue(held['reference_from_held_estimate'])
        self.assertGreater(held['reference_age_at_trigger_seconds'], 120)
        for stop in (200, 244, 250, 260, 270):
            partial = compute(fixture(n=stop, ranges=ranges))
            for key in full['traces']:
                np.testing.assert_allclose(partial['traces'][key], full['traces'][key][:stop], equal_nan=True)
            for event in partial['events']:
                self.assertLessEqual(event['evidence']['threshold_met_at'], event['evidence']['finalized_at'])
                self.assertLessEqual(event['evidence']['finalized_at'], stop)
        # The same near-following event may be hypopnea, not only apnea.
        weak = compute(fixture(n=320, ranges=[(70, 240, 10.), (247, 262, 10.)]))['events']
        self.assertEqual(len(weak), 2)
        self.assertTrue(weak[1]['evidence']['reference_from_held_estimate'])

    def test_held_reference_cleared_by_quality_and_segment_reset(self):
        ranges = [(70, 240, 10.), (247, 259, 1.)]
        for kwargs in ({'state_change': 246}, {'missing': [(245, 247)]}):
            result = compute(fixture(n=320, ranges=ranges, **kwargs))
            self.assertEqual(len(result['events']), 1)
            self.assertTrue(np.isnan(result['traces']['remaining'][250]))

    def test_long_fragmented_core_evidence_is_bounded_and_counts_preserved(self):
        ranges = [(70, 450, 10.)] + [(a, a+1, 1.) for a in range(70, 450, 3)]
        event = detect(fixture(n=500, ranges=ranges))['events'][0]
        evidence = event['evidence']
        self.assertEqual(event['type'], '低通气候选')
        self.assertEqual(len(evidence['apnea_core_intervals']), 20)
        self.assertEqual(evidence['apnea_core_intervals_total_count'], len(range(70, 450, 3)))
        self.assertTrue(evidence['apnea_core_intervals_truncated'])
        self.assertLess(len(json.dumps(evidence, ensure_ascii=False)), 10000)
        self.assertNotIn('rows', evidence)

    def test_zero_reference_is_unknown_not_an_event(self):
        recording = fixture(n=100, zero=True)
        result = compute(recording)
        self.assertEqual(result['events'], [])
        self.assertFalse(np.isfinite(result['traces']['remaining']).any())

    def test_scope_identity_cache_and_waveform_channels(self):
        recording = fixture(ranges=[(80, 100, 1.)])
        first = detect(recording)
        selected = detect(recording, start=85, end=90)
        self.assertEqual(first['time_basis'], 'raw')
        self.assertEqual(first['events'][0]['id'], selected['events'][0]['id'])
        self.assertEqual(selected['events'][0]['start'], 80)
        self.assertIn('跨选区，保留完整区间', selected['events'][0]['evidence']['review_flags'])
        self.assertEqual(first['settings']['version'], VERSION)
        self.assertIs(compute(recording), compute(recording))
        self.assertIsNot(compute(recording, window=1), compute(recording, window=5))
        requested = names(5)
        waves = waveform_channels(recording, requested)
        self.assertEqual(set(waves), set(requested))
        self.assertAlmostEqual(waves[requested[0]][np.flatnonzero(recording.x == 60)[0]], 20.)
        # No caller filtering may mutate cached original evidence.
        before = copy.deepcopy(compute(recording)['events'])
        detect(recording, event_types=['低通气候选'])
        self.assertEqual(compute(recording)['events'], before)


if __name__ == '__main__':
    unittest.main()
