"""Read-only main-window residuals for review, never additional scored events.

Run: python -m event_detection.research.residual_recovery --csv recording.csv
This module does not import EventStore or expose a save/detect integration.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
import time

import numpy as np


def _union(intervals):
    merged = []
    for a, b in sorted(intervals):
        if b <= a:
            continue
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def compare(result, raw_duration, min_duration=None):
    """Subtract original output from valid contiguous main-window weak spans.

    Clock-end intervals follow v3's weak representation [clock, clock+1).
    Original outputs are copied intact; residuals have no event id or label.
    An invalid/nonfinite bin or a source segment transition always splits runs.
    """
    minimum = result['settings']['min_duration'] if min_duration is None else min_duration
    if (isinstance(minimum, bool) or not isinstance(minimum, (int, float))
            or not math.isfinite(minimum) or minimum <= 0):
        raise ValueError('min_duration must be finite and positive')
    if (isinstance(raw_duration, bool) or not isinstance(raw_duration, (int, float))
            or not math.isfinite(raw_duration) or raw_duration < 0):
        raise ValueError('raw_duration must be finite and nonnegative')
    source = result['source']
    clock = np.asarray(source['clock'], dtype=float)
    remaining = np.asarray(result['traces']['remaining'], dtype=float)
    valid = np.asarray(source['valid'], dtype=bool)
    segments = np.asarray(source['segment'])
    if not (clock.ndim == remaining.ndim == valid.ndim == segments.ndim == 1
            and len(clock) == len(remaining) == len(valid) == len(segments)):
        raise ValueError('source arrays must be aligned and one dimensional')
    if not np.isfinite(clock).all() or np.any(np.diff(clock) <= 0):
        raise ValueError('source clocks must be finite and increasing')

    original = copy.deepcopy(result['events'])
    occupied = []
    for event in original:
        a, b = float(event['start']), float(event['end'])
        if not math.isfinite(a) or not math.isfinite(b) or b <= a:
            raise ValueError('original event boundaries must be finite and increasing')
        occupied.append([max(0., a), min(raw_duration, b)])
    occupied = _union(occupied)
    runs = []
    active = None
    for i, tick in enumerate(clock):
        a, b = max(0., float(tick)), min(raw_duration, float(tick) + 1)
        eligible = valid[i] and np.isfinite(remaining[i]) and 0 <= remaining[i] < .5 and b > a
        continuous = (active is not None and a == active['end']
                      and segments[i] == active['segment'])
        if not eligible or not continuous:
            if active is not None:
                runs.append(active)
                active = None
        if eligible:
            if active is None:
                active = dict(start=a, end=b, segment=segments[i].item()
                              if hasattr(segments[i], 'item') else segments[i], indices=[i])
            else:
                active['end'] = b
                active['indices'].append(i)
    if active is not None:
        runs.append(active)

    residuals = []
    rejected = result.get('boundary_rejections', [])
    for run in runs:
        fragments = [[run['start'], run['end']]]
        for left, right in occupied:
            next_fragments = []
            for a, b in fragments:
                if right <= a or left >= b:
                    next_fragments.append([a, b])
                else:
                    if a < left:
                        next_fragments.append([a, left])
                    if right < b:
                        next_fragments.append([right, b])
            fragments = next_fragments
        for a, b in fragments:
            if b - a < minimum:
                continue
            indices = [i for i in run['indices'] if clock[i] < b and clock[i]+1 > a]
            ratios = remaining[indices]
            rejections = [copy.deepcopy(r) for r in rejected
                          if r['original'][0] < b and r['original'][1] > a]
            overlaps = [i for i, event in enumerate(original)
                        if event['start'] < run['end'] and event['end'] > run['start']]
            residuals.append(dict(start=a, end=b, duration_seconds=b-a,
                                  interpretation='review_difference_only',
                                  time_basis='main_window_end', segment=run['segment'],
                                  evidence=dict(parent_weak_interval=[run['start'], run['end']],
                                                minimum_duration=minimum,
                                                remaining_min=float(np.min(ratios)),
                                                remaining_max=float(np.max(ratios)),
                                                all_bins_valid=True, same_segment=True,
                                                excluded_original_event_indices=overlaps,
                                                overlapping_boundary_rejections=rejections)))
    return dict(schema=1, experiment='main_window_residual_review_v1',
                settings=copy.deepcopy(result['settings']),
                original_events=original, review_differences=residuals,
                original_event_count=len(original), review_difference_count=len(residuals),
                valid_weak_run_count=len(runs),
                note='Differences are unverified review intervals, not additional clinical events. '
                     'Do not add counts, infer accuracy, or write them to annotations automatically.')


def replay(path):
    """Parse and run default v3 in memory; never touch annotations or scan APIs."""
    from event_detection.viewer import Recording
    from event_detection.dynamic_baseline_v3 import compute
    path = Path(path)
    started = time.perf_counter()
    recording = Recording(path.read_bytes(), path.name)
    parsed = time.perf_counter()
    result = compute(recording, 'detrended_abs', 5, 10)
    computed = time.perf_counter()
    report = compare(result, recording.meta['raw_duration'])
    report.update(file_id=recording.meta['file_id'], name=path.name,
                  rows=recording.meta['rows'], raw_duration=recording.meta['raw_duration'],
                  elapsed_seconds=dict(parse=parsed-started, compute=computed-parsed,
                                       total=time.perf_counter()-started))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', action='append', required=True)
    args = parser.parse_args()
    # stdout only: the caller chooses whether and where to retain the report.
    reports = [replay(path) for path in args.csv]
    print(json.dumps(reports, ensure_ascii=True, allow_nan=False, indent=2))


if __name__ == '__main__':
    main()
