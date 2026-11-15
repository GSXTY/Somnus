import copy
import unittest

from event_detection.research.evaluate import evaluate, interval_iou, match_events


def event(identity, start, end, kind='weak', status='candidate'):
    return dict(id=identity, start=start, end=end, type=kind, status=status, mode='raw')


def packets(predicted, labelled, mode='complete'):
    return (dict(file_id='same-csv-sha256', time_basis='raw', events=predicted),
            dict(file_id='same-csv-sha256', kind='reviewed', reviewer='tester', review_mode=mode,
                 reviewed_range=[0, 100], reviewed_types=['weak'], events=labelled,
                 training_scope=dict(time_mode='raw', background_labels_allowed=mode == 'complete',
                                     pending_event_ids=[], excluded_boundary_intervals=[])))


class EventEvaluationTests(unittest.TestCase):
    def test_complete_review_counts_duplicate_detections_once(self):
        p, r = packets([event('p1', 10, 20), event('p2', 10, 20), event('p3', 70, 80)],
                       [event('r1', 11, 21, status='reviewed'), event('r2', 40, 50, status='reviewed')])
        before = copy.deepcopy((p, r))
        result = evaluate(p, r)
        self.assertEqual((result['matched_count'], result['false_positive'], result['false_negative']), (1, 2, 1))
        self.assertAlmostEqual(result['precision'], 1 / 3)
        self.assertEqual(result['recall'], .5)
        self.assertAlmostEqual(result['f1'], .4)
        self.assertEqual(result['onset_absolute_error_median_seconds'], 1)
        self.assertEqual((p, r), before)

    def test_matching_uses_augmenting_paths_instead_of_greedy_under_counting(self):
        predicted = [event('p1', 0, 20), event('p2', 0, 8)]
        reference = [event('r1', 0, 10), event('r2', 10, 20)]
        self.assertEqual(match_events(predicted, reference, .3), [(0, 1), (1, 0)])

    def test_spot_review_never_invents_background_or_recall(self):
        p, r = packets([event('p1', 10, 20), event('p2', 50, 60)],
                       [event('r1', 10, 20, status='reviewed')], mode='spot')
        result = evaluate(p, r)
        self.assertEqual(result['matched_count'], 1)
        for field in ('false_positive', 'false_negative', 'precision', 'recall', 'f1', 'false_alarms_per_reviewed_hour'):
            self.assertIsNone(result[field])

    def test_spot_review_allows_unresolved_candidates_without_treating_them_as_truth(self):
        p, r = packets([event('p1', 10, 20), event('p2', 50, 60)],
                       [event('r1', 10, 20, status='reviewed'), event('r2', 50, 60)], mode='spot')
        r['training_scope']['pending_event_ids'] = ['r2']
        result = evaluate(p, r)
        self.assertEqual(result['reference_count'], 1)
        self.assertEqual(result['matched_count'], 1)
        self.assertFalse(result['metrics_enabled'])
        self.assertIsNone(result['precision'])

    def test_exclusions_are_merged_and_boundary_intersections_are_not_scored(self):
        p, r = packets([event('p1', 10, 20), event('p2', 50, 65), event('p3', 101, 120)],
                       [event('r1', 10, 20, status='reviewed'), event('r2', 50, 65, status='reviewed')])
        r['training_scope']['excluded_boundary_intervals'] = [[15, 25], [20, 30], [90, 110]]
        result = evaluate(p, r)
        self.assertEqual(result['reviewed_seconds'], 75)
        self.assertEqual(result['candidate_count'], 1)
        self.assertEqual(result['reference_count'], 1)
        self.assertEqual(result['skipped_prediction_count'], 2)
        self.assertEqual(result['precision'], 1)

    def test_unknown_type_and_ignored_annotations_are_not_reference_positives(self):
        p, r = packets([event('p1', 10, 20), event('p2', 30, 40, 'other')],
                       [event('r1', 10, 20, status='ignored')])
        result = evaluate(p, r)
        self.assertEqual(result['false_positive'], 1)
        self.assertEqual(result['precision'], 0)
        self.assertIsNone(result['recall'])
        self.assertEqual(result['reference_count'], 0)

    def test_pending_or_mismatched_records_fail_closed(self):
        p, r = packets([], [])
        for change in ('fingerprint', 'estimated', 'pending', 'candidate', 'unknown-axis'):
            x, y = copy.deepcopy((p, r))
            if change == 'fingerprint': y['file_id'] = 'different'
            if change == 'estimated': x['time_basis'] = 'engineering'
            if change == 'pending': y['training_scope']['pending_event_ids'] = ['missing']
            if change == 'candidate': y['events'] = [event('not-reviewed', 1, 20)]
            if change == 'unknown-axis': del x['time_basis']
            with self.subTest(change=change), self.assertRaises(ValueError): evaluate(x, y)

    def test_invalid_intervals_and_duplicate_ids_fail(self):
        for events in ([event('x', 10, 5)], [event('x', 1, 3), event('x', 5, 9)], [event('x', float('nan'), 10)]):
            with self.subTest(events=events), self.assertRaises(ValueError): evaluate(*packets(events, []))
        for threshold in (0, -1, 2, True, float('nan')):
            with self.subTest(threshold=threshold), self.assertRaises(ValueError): match_events([], [], threshold)

    def test_type_specific_matching_and_empty_denominators(self):
        self.assertEqual(match_events([event('x', 1, 10, 'a')], [event('y', 1, 10, 'b')]), [])
        result = evaluate(*packets([], []))
        self.assertIsNone(result['precision'])
        self.assertIsNone(result['recall'])
        self.assertIsNone(result['f1'])
        self.assertEqual(result['false_alarms_per_reviewed_hour'], 0)
        self.assertEqual(interval_iou([0, 10], [10, 20]), 0)


if __name__ == '__main__':
    unittest.main()
