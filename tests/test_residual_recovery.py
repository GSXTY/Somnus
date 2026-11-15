import copy
import math
import unittest
from types import SimpleNamespace

import numpy as np

from event_detection.research.residual_recovery import compare


def result(n=60, events=None):
    return dict(settings=dict(min_duration=10, method='detrended_abs', window_seconds=5),
                source=dict(clock=list(range(1, n+1)), valid=[True]*n, segment=[1]*n),
                traces=dict(remaining=[.3]*n), events=events or [], boundary_rejections=[])


class ResidualRecoveryTests(unittest.TestCase):
    def test_real_compute_core_shadow_reproducer(self):
        from event_detection.dynamic_baseline_v3 import compute
        x, flow = [], []
        for second in range(160):
            amplitude = .2 if 96 <= second < 108 else 6 if 80 <= second < 126 else 20
            for row in range(20):
                x.append(second+row/20)
                flow.append(amplitude if row % 2 else -amplitude)
        recording = SimpleNamespace(x=np.asarray(x), channels={'流量': np.asarray(flow)},
                                    meta={'raw_duration': 159.95})
        computed = compute(recording, 'absolute_mean', 1, 10)
        original = copy.deepcopy(computed['events'])
        self.assertEqual([(e['start'], e['end']) for e in original], [(96., 108.)])
        report = compare(computed, 159.95)
        self.assertEqual([(r['start'], r['end']) for r in report['review_differences']],
                         [(81., 96.), (108., 127.)])
        self.assertEqual(computed['events'], original)

    def test_strong_core_preserves_long_weak_residuals_and_original_output(self):
        original = dict(start=17., end=29., type='strong', evidence={'nested': [1]})
        packet = result(45, [original])
        saved = copy.deepcopy(packet)
        report = compare(packet, 46)
        self.assertEqual([(r['start'], r['end']) for r in report['review_differences']],
                         [(1., 17.), (29., 46)])
        self.assertEqual(report['original_events'], [original])
        self.assertEqual(packet, saved)
        report['original_events'][0]['evidence']['nested'].append(2)
        self.assertEqual(packet, saved)
        self.assertTrue(all(r['interpretation'] == 'review_difference_only'
                            and 'id' not in r and 'type' not in r
                            for r in report['review_differences']))

    def test_overlapping_outputs_are_unioned_never_double_counted(self):
        packet = result(50, [dict(start=10, end=25), dict(start=20, end=40)])
        self.assertEqual([(r['start'], r['end']) for r in compare(packet, 51)['review_differences']],
                         [(40., 51)])  # first residual is only nine seconds

    def test_quality_nan_and_segment_changes_split_intervals(self):
        packet = result(60)
        packet['source']['valid'][10] = False
        packet['traces']['remaining'][21] = math.nan
        packet['source']['segment'][33:] = [2]*27
        spans = [(r['start'], r['end']) for r in compare(packet, 61)['review_differences']]
        self.assertEqual(spans, [(1., 11.), (12., 22.), (23., 34.), (34., 61.)])

    def test_clock_gap_and_threshold_equalities_do_not_bridge(self):
        packet = result(31)
        packet['source']['clock'] = list(range(1, 12)) + list(range(20, 40))
        packet['traces']['remaining'][21] = .5
        spans = [(r['start'], r['end']) for r in compare(packet, 40)['review_differences']]
        self.assertEqual(spans, [(1., 12.), (20., 30.)])

    def test_minimum_after_subtraction_and_duration_clipping(self):
        packet = result(30, [dict(start=11, end=21)])
        self.assertEqual([(r['start'], r['end']) for r in compare(packet, 31)['review_differences']],
                         [(1., 11.), (21., 31)])
        self.assertEqual([(r['start'], r['end']) for r in compare(packet, 30.9)['review_differences']],
                         [(1., 11.)])

    def test_rejected_core_retains_weak_evidence_without_promotion(self):
        packet = result(40)
        rejection = dict(original=[15, 25], corrected=[17, 25])
        packet['boundary_rejections'] = [rejection]
        report = compare(packet, 41)
        self.assertEqual(report['original_event_count'], 0)
        self.assertEqual(report['review_difference_count'], 1)
        evidence = report['review_differences'][0]['evidence']
        self.assertEqual(evidence['overlapping_boundary_rejections'], [rejection])
        self.assertEqual(evidence['parent_weak_interval'], [1., 41.])

    def test_invalid_values_and_short_or_empty_runs(self):
        packet = result(9)
        self.assertEqual(compare(packet, 10)['review_differences'], [])
        self.assertEqual(compare(result(0), 0)['review_differences'], [])
        for minimum in (True, 0, math.inf):
            with self.assertRaises(ValueError):
                compare(packet, 10, minimum)
        with self.assertRaises(ValueError):
            compare(packet, math.nan)
        packet['source']['clock'][1] = 1
        with self.assertRaises(ValueError):
            compare(packet, 10)
        packet = result(10)
        packet['source']['valid'].pop()
        with self.assertRaises(ValueError):
            compare(packet, 11)


if __name__ == '__main__':
    unittest.main()
