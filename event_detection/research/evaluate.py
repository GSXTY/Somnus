"""Read-only event evaluation against an explicitly scoped human review export.

No unreviewed background is labelled normal. Matches maximize cardinality at a
fixed interval IoU threshold, independently per event type; edge ordering makes
ties deterministic, but does not claim to minimize aggregate boundary error.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from statistics import median


def _number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _interval(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2 or not all(_number(x) for x in value) or not 0 <= value[0] < value[1]:
        raise ValueError('Interval must have finite 0 <= start < end.')
    return float(value[0]), float(value[1])


def interval_iou(left, right):
    a, b = _interval(left)
    c, d = _interval(right)
    overlap = max(0., min(b, d) - max(a, c))
    return overlap / (b - a + d - c - overlap)


def _union(intervals):
    result = []
    for a, b in sorted(intervals):
        if result and a <= result[-1][1]:
            result[-1][1] = max(b, result[-1][1])
        else:
            result.append([a, b])
    return result


def match_events(predictions, references, threshold=.3):
    """One prediction can explain at most one reviewed reference (and vice versa)."""
    if not _number(threshold) or not 0 < threshold <= 1:
        raise ValueError('IoU threshold must be in (0, 1].')
    edges = []
    for prediction in predictions:
        options = []
        for j, reference in enumerate(references):
            score = interval_iou([prediction['start'], prediction['end']], [reference['start'], reference['end']])
            if prediction['type'] == reference['type'] and score >= threshold:
                options.append((j, score))
        edges.append([j for j, score in sorted(options, key=lambda x: (-x[1], x[0]))])
    # Iterative augmenting paths avoid recursion limits on full-night recordings.
    right_to_left = {}
    for start in range(len(predictions)):
        queue = [start]
        parents = {start: None}
        seen_right = set()
        found = None
        for left in queue:
            for right in edges[left]:
                if right in seen_right:
                    continue
                seen_right.add(right)
                owner = right_to_left.get(right)
                if owner is None:
                    found = (left, right)
                    break
                if owner not in parents:
                    parents[owner] = (left, right)
                    queue.append(owner)
            if found is not None:
                break
        if found is not None:
            left, right = found
            while True:
                right_to_left[right] = left
                if parents[left] is None:
                    break
                left, right = parents[left]
    return sorted((left, right) for right, left in right_to_left.items())


def evaluate(prediction_packet, reviewed_packet, threshold=.3):
    """Accepts existing version-2 reviewed feedback; never writes to EventStore."""
    if not isinstance(prediction_packet.get('file_id'), str) or not prediction_packet['file_id'] or prediction_packet['file_id'] != reviewed_packet.get('file_id'):
        raise ValueError('Predictions and review must identify the same CSV content fingerprint.')
    if reviewed_packet.get('kind') != 'reviewed' or reviewed_packet.get('review_mode') not in ('complete', 'spot'):
        raise ValueError('An explicit complete/spot human review export is required.')
    if prediction_packet.get('time_basis') != 'raw':
        raise ValueError('Predictions must use raw source-second coordinates.')
    scope = reviewed_packet.get('training_scope', {})
    if scope.get('time_mode') != 'raw':
        raise ValueError('Review must use raw source-second coordinates.')
    start, end = _interval(reviewed_packet['reviewed_range'])
    kinds = reviewed_packet.get('reviewed_types')
    if not isinstance(kinds, list) or not kinds or any(not isinstance(x, str) or not x for x in kinds):
        raise ValueError('Reviewed event types must be explicitly declared.')
    complete = reviewed_packet['review_mode'] == 'complete' and scope.get('background_labels_allowed') is True
    if complete and (reviewed_packet.get('unresolved_original_ids') or scope.get('pending_event_ids') or reviewed_packet.get('estimated_time_event_ids')):
        raise ValueError('Resolve pending, missing or estimated-time annotations before evaluation.')
    excluded = []
    for interval in scope.get('excluded_boundary_intervals', []):
        a, b = _interval(interval)
        if min(end, b) > max(start, a):
            excluded.append((max(start, a), min(end, b)))
    excluded = _union(excluded)

    def select(events, human=False):
        selected = []
        skipped = 0
        ids = set()
        for ordinal, event in enumerate(events):
            a, b = _interval([event['start'], event['end']])
            identity = str(event.get('id', ordinal))
            if identity in ids:
                raise ValueError('Duplicate event IDs are not independent observations.')
            ids.add(identity)
            if event.get('type') not in kinds or a < start or b > end or any(a < y and b > x for x, y in excluded):
                skipped += 1
                continue
            if event.get('mode', 'raw') != 'raw':
                raise ValueError('Do not mix engineering-time events with raw labels.')
            if human and event.get('status') == 'candidate' and complete:
                raise ValueError('Pending candidates are not human reference labels.')
            if human and event.get('status') != 'reviewed':
                continue
            selected.append(dict(event, id=identity))
        return sorted(selected, key=lambda x: (x['start'], x['end'], x['id'])), skipped

    predictions, skipped_predictions = select(prediction_packet.get('events', []))
    references, skipped_references = select(reviewed_packet.get('events', []), human=True)
    pairs = match_events(predictions, references, threshold)
    seconds = end - start - sum(b - a for a, b in excluded)
    if seconds <= 0:
        raise ValueError('Review exclusions leave no evaluated interval.')
    used_predictions = {a for a, _ in pairs}
    used_references = {b for _, b in pairs}
    matches = []
    for p, r in pairs:
        prediction, reference = predictions[p], references[r]
        matches.append(dict(prediction_id=prediction['id'], reference_id=reference['id'], type=reference['type'],
                            iou=interval_iou([prediction['start'], prediction['end']], [reference['start'], reference['end']]),
                            onset_error_seconds=prediction['start'] - reference['start'],
                            offset_error_seconds=prediction['end'] - reference['end']))
    true_positive = len(matches)
    false_positive = len(predictions) - true_positive if complete else None
    false_negative = len(references) - true_positive if complete else None
    precision = true_positive / len(predictions) if complete and predictions else None
    recall = true_positive / len(references) if complete and references else None
    f1 = 2 * true_positive / (len(predictions) + len(references)) if complete and predictions + references else None
    return dict(schema_version=1, file_id=prediction_packet['file_id'], review_mode=reviewed_packet['review_mode'], metrics_enabled=complete,
                reviewed_range=[start, end], reviewed_types=kinds, excluded_boundary_intervals=excluded,
                reviewed_seconds=seconds, iou_threshold=threshold, candidate_count=len(predictions), reference_count=len(references),
                matched_count=true_positive, false_positive=false_positive, false_negative=false_negative,
                precision=precision, recall=recall, f1=f1,
                false_alarms_per_reviewed_hour=false_positive / (seconds / 3600) if complete else None,
                onset_absolute_error_median_seconds=median(abs(x['onset_error_seconds']) for x in matches) if matches else None,
                offset_absolute_error_median_seconds=median(abs(x['offset_error_seconds']) for x in matches) if matches else None,
                unmatched_prediction_ids=[e['id'] for i, e in enumerate(predictions) if i not in used_predictions],
                unmatched_reference_ids=[e['id'] for i, e in enumerate(references) if i not in used_references],
                skipped_prediction_count=skipped_predictions, skipped_reference_count=skipped_references, matches=matches,
                prediction_configuration=prediction_packet.get('settings'), reference_run_id=reviewed_packet.get('run_id'),
                limitations=['Spot review supports matched examples only; no precision, recall, F1 or false-alarm rate.',
                             'No true-negative count, clinical classification or health accuracy is inferred.',
                             'One-to-one maximum-cardinality IoU matching; ties do not minimize total boundary error.',
                             'Type mapping, review independence and held-out patient/session splits require human agreement.'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--predictions', type=Path, required=True)
    parser.add_argument('--reviewed', type=Path, required=True)
    parser.add_argument('--iou', type=float, default=.3)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    result = evaluate(json.loads(args.predictions.read_text(encoding='utf-8-sig')),
                      json.loads(args.reviewed.read_text(encoding='utf-8-sig')), args.iou)
    # Exclusive creation prevents accidentally replacing a previous result or source export.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, indent=2, allow_nan=False)
    print(str(args.output.resolve()))


if __name__ == '__main__':
    main()
