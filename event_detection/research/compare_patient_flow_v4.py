"""Read-only old/new replay on content-unique CSVs; counts are not accuracy."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

from event_detection.viewer import Recording
from event_detection.dynamic_baseline_v3 import detect as old_detect
from event_detection.patient_flow_v4 import detect as new_detect


def compare(paths):
    paths = [Path(path).resolve(strict=True) for path in paths]
    if any(not path.is_file() for path in paths):
        raise ValueError('Each input must be a CSV file.')
    seen = set()
    records = []
    duplicates = 0
    for candidate in paths:
        path = Path(candidate)
        raw = path.read_bytes()
        identity = hashlib.sha256(raw).hexdigest()
        if identity in seen:
            duplicates += 1
            continue
        seen.add(identity)
        started = time.perf_counter()
        recording = Recording(raw, path.name)
        outputs = {}
        for name, detector, method in [('old_v3', old_detect, 'detrended_abs'), ('patient_v4', new_detect, 'absolute_mean')]:
            before = time.perf_counter()
            result = detector(recording, min_duration=10, dynamic_method=method, window_seconds=5)
            outputs[name] = dict(settings=result['settings'], time_basis='raw',
                                 count_by_type=dict(Counter(e['type'] for e in result['events'])),
                                 candidate_count=len(result['events']), events=result['events'],
                                 elapsed_seconds=time.perf_counter()-before)
        records.append(dict(file_id=identity, name=path.name, rows=recording.meta['rows'],
                            raw_duration=recording.meta['raw_duration'], flow_semantics=recording.meta['flow_semantics'],
                            outputs=outputs, total_elapsed_seconds=time.perf_counter()-started))
    return dict(schema=1, purpose='read_only_patient_flow_comparison', created_at=datetime.now(timezone.utc).isoformat(),
                excluded_duplicate_csv_count=duplicates, records=records,
                source_sha256={name:hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in
                               ('event_detection/patient_flow_v4.py','event_detection/dynamic_baseline_v3.py')},
                clinical_accuracy=None,
                note='Both algorithms only produce candidates. Different rules and labels mean count changes do not establish accuracy. '
                     'CSV flow is user-confirmed patient respiratory flow. No EventStore, scan or annotation is written; '
                     'human review of complete ranges is required for precision/recall.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', action='append', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.csv)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, allow_nan=False, indent=2)
    for record in result['records']:
        print(json.dumps(dict(file_id=record['file_id'][:12],counts={key:value['count_by_type'] for key,value in record['outputs'].items()}),ensure_ascii=True))
    print(args.output.resolve())


if __name__ == '__main__':main()
