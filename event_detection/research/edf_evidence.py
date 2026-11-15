"""Read-only EDF/EDF+ evidence inspection; never derives device events.

Patient and recording identification fields are intentionally not exposed.
All timestamps are naive device-header wall times, with no assigned timezone.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta
import hashlib
import json
import math
from pathlib import Path
import re
import struct


class EDFError(ValueError):
    pass


def _number(text, integer=False):
    try:
        value = int(text) if integer else float(text)
    except (ValueError, TypeError) as exc:
        raise EDFError('Invalid numeric EDF field') from exc
    if not math.isfinite(value):
        raise EDFError('Non-finite EDF field')
    return value


def parse_tal(payload: bytes):
    """Decode complete TALs, preserving separate texts and timekeeping entries."""
    result = []
    if payload and not payload.endswith(b'\x00'):
        raise EDFError('Unterminated TAL')
    for raw in payload.split(b'\x00'):
        if not raw:
            continue
        if b'\x14' not in raw or not raw.endswith(b'\x14'):
            raise EDFError('Malformed TAL text separators')
        timing, *texts = raw.split(b'\x14')
        parts = timing.split(b'\x15')
        if len(parts) > 2 or not re.fullmatch(rb'[+-]\d+(?:\.\d+)?', parts[0]):
            raise EDFError('Malformed TAL onset')
        onset = _number(parts[0])
        duration = None
        if len(parts) == 2:
            if not re.fullmatch(rb'\d+(?:\.\d+)?', parts[1]):
                raise EDFError('Malformed TAL duration')
            duration = _number(parts[1])
        try:
            decoded = [text.decode('utf-8') for text in texts if text]
        except UnicodeDecodeError as exc:
            raise EDFError('Invalid UTF-8 annotation') from exc
        result.append(dict(onset_seconds=onset, duration_seconds=duration, texts=decoded))
    return result


class EDFFile:
    def __init__(self, path):
        self.path = Path(path)
        self.data = self.path.read_bytes()
        if len(self.data) < 256:
            raise EDFError('Truncated EDF fixed header')
        def text(start, end):
            try:
                return self.data[start:end].decode('ascii').strip()
            except UnicodeDecodeError as exc:
                raise EDFError('Non-ASCII EDF header') from exc
        if text(0, 8) != '0':
            raise EDFError('Unsupported EDF version')
        # A discontinuous EDF+ signal needs each record's TAL clock. Never
        # silently assign it the continuous grid used by this S9 example.
        reserved = text(192, 236)
        self.format = 'EDF+D' if reserved.startswith('EDF+D') else 'EDF+C' if reserved.startswith('EDF+C') else 'EDF'
        self.discontinuous = self.format == 'EDF+D'
        self.header_bytes = _number(text(184, 192), True)
        self.record_count = _number(text(236, 244), True)
        self.record_seconds = _number(text(244, 252))
        count = _number(text(252, 256), True)
        if count <= 0 or self.header_bytes != 256 * (count + 1):
            raise EDFError('Invalid EDF header size/channel count')
        if len(self.data) < self.header_bytes:
            raise EDFError('Truncated EDF signal header')
        if self.record_seconds < 0 or self.record_count < -1:
            raise EDFError('Invalid EDF record count/duration')
        raw_date, raw_time = text(168, 176), text(176, 184)
        try:
            day, month, year = map(int, raw_date.split('.'))
            hour, minute, second = map(int, raw_time.split('.'))
            self.start = datetime(1900 + year if year >= 85 else 2000 + year, month, day, hour, minute, second)
        except ValueError as exc:
            raise EDFError('Invalid EDF start date/time') from exc
        self.date_raw, self.time_raw = raw_date, raw_time
        fields = [('name', 16), ('transducer', 80), ('unit', 8), ('physical_min', 8),
                  ('physical_max', 8), ('digital_min', 8), ('digital_max', 8),
                  ('prefilter', 80), ('samples_per_record', 8), ('reserved', 32)]
        self.channels = [dict(index=i) for i in range(count)]
        position = 256
        for name, width in fields:
            for i, channel in enumerate(self.channels):
                value = text(position + i * width, position + (i + 1) * width)
                if name in ('transducer', 'prefilter', 'reserved'):
                    continue
                if name in ('digital_min', 'digital_max', 'samples_per_record'):
                    value = _number(value, True)
                elif name in ('physical_min', 'physical_max'):
                    value = _number(value)
                channel[name] = value
            position += count * width
        offset = 0
        for channel in self.channels:
            samples = channel['samples_per_record']
            if samples <= 0 or not -32768 <= channel['digital_min'] < channel['digital_max'] <= 32767:
                raise EDFError('Invalid channel sample count/digital range')
            channel['is_annotation'] = channel['name'] == 'EDF Annotations'
            channel['sample_rate_hz'] = samples / self.record_seconds if self.record_seconds else None
            channel['byte_offset_in_record'] = offset
            offset += samples * 2
        self.record_bytes = offset
        payload_bytes = len(self.data) - self.header_bytes
        if self.record_count == -1:
            if payload_bytes % self.record_bytes:
                raise EDFError('Truncated EDF record with unknown record count')
            self.record_count = payload_bytes // self.record_bytes
        if payload_bytes != self.record_count * self.record_bytes:
            raise EDFError('EDF data length does not match declared records (truncated or trailing data)')
        if not self.record_seconds and any(not c['is_annotation'] for c in self.channels):
            raise EDFError('Zero record duration on numeric signal')

    def record_payload(self, record_index, channel_index):
        if not 0 <= record_index < self.record_count:
            raise IndexError('Record index outside file')
        c = self.channels[channel_index]
        offset = self.header_bytes + record_index * self.record_bytes + c['byte_offset_in_record']
        return self.data[offset:offset + c['samples_per_record'] * 2]

    def read_signal(self, channel_index, record_start=0, record_stop=None):
        """Calibrated values; channels keep their own sampling grid."""
        if self.discontinuous:
            raise EDFError('EDF+D numeric signals require per-record TAL timing; this continuous S9 reader does not reconstruct that grid')
        c = self.channels[channel_index]
        if c['is_annotation']:
            raise EDFError('Use annotations() for annotation channels')
        stop = self.record_count if record_stop is None else record_stop
        if not 0 <= record_start <= stop <= self.record_count:
            raise IndexError('Invalid record range')
        scale = (c['physical_max'] - c['physical_min']) / (c['digital_max'] - c['digital_min'])
        values = []
        for record in range(record_start, stop):
            raw = struct.unpack('<' + 'h' * c['samples_per_record'], self.record_payload(record, channel_index))
            values.extend((value - c['digital_min']) * scale + c['physical_min'] for value in raw)
        return values

    def annotations(self):
        result = []
        for record in range(self.record_count):
            for c in self.channels:
                if c['is_annotation']:
                    for tal in parse_tal(self.record_payload(record, c['index'])):
                        tal.update(record_index=record, channel_index=c['index'])
                        result.append(tal)
        return result

    def evidence(self):
        annotations = self.annotations()
        events = []
        for tal in annotations:
            for text in tal['texts']:
                events.append(dict(onset_seconds=tal['onset_seconds'], duration_seconds=tal['duration_seconds'],
                                   text=text, record_index=tal['record_index'],
                                   device_wall_time=(self.start + timedelta(seconds=tal['onset_seconds'])).isoformat()))
        return dict(file=self.path.name, type=self.path.stem.rsplit('_', 1)[-1],
                    sha256=hashlib.sha256(self.data).hexdigest(), bytes=len(self.data), edf_format=self.format,
                    numeric_timing_support='unsupported_discontinuous' if self.discontinuous else 'continuous_record_grid',
                    header_start=self.start.isoformat(), header_date_raw=self.date_raw, header_time_raw=self.time_raw,
                    timezone=None, identifiers='patient/recording/transducer/reserved fields omitted',
                    header_bytes=self.header_bytes, record_count=self.record_count, record_seconds=self.record_seconds,
                    duration_seconds=self.record_count * self.record_seconds,
                    numeric_end_exclusive=(self.start + timedelta(seconds=self.record_count * self.record_seconds)).isoformat() if self.record_seconds and not self.discontinuous else None,
                    channels=self.channels, annotations=annotations, annotation_texts=events,
                    annotation_text_counts=dict(Counter(e['text'] for e in events)))


def inspect_tree(root, selected_date='2019-12-28'):
    root = Path(root)
    selected = datetime.strptime(selected_date, '%Y-%m-%d')
    days = {selected.strftime('%Y%m%d'), (selected + timedelta(days=1)).strftime('%Y%m%d')}
    files = [root / 'STR.edf']
    files.extend(sorted(p for p in (root / 'DATALOG').rglob('*') if p.suffix.lower() == '.edf' and p.name[:8] in days))
    evidence = []
    for path in files:
        reader = EDFFile(path)
        item = reader.evidence()
        if path.name.upper() == 'STR.EDF':
            # Daily STR records are dated from the EDF header, not the filename.
            selected_records = []
            for i in range(reader.record_count):
                when = reader.start + timedelta(seconds=i * reader.record_seconds)
                if when.date() in {selected.date(), (selected + timedelta(days=1)).date()}:
                    selected_records.append(dict(record_index=i, device_wall_time=when.isoformat(),
                                                 signals=[dict(name=c['name'], unit=c['unit'], values=reader.read_signal(c['index'], i, i + 1))
                                                          for c in reader.channels if not c['is_annotation']]))
            item['selected_daily_records'] = selected_records
        else:
            item['signal_previews'] = [dict(name=c['name'], unit=c['unit'], first_record_values=reader.read_signal(c['index'], 0, min(1, reader.record_count))[:12])
                                       for c in reader.channels if not c['is_annotation']]
        evidence.append(item)
    device_annotations = [event for file in evidence if file['type'] == 'EVE' for event in file['annotation_texts']]
    clinical_labels = {'Central Apnea', 'Obstructive Apnea', 'Hypopnea', 'Apnea'}
    return dict(selected_date=selected_date, inspected_filename_dates=sorted(days),
                method='Read-only EDF fixed-width header, per-channel calibrated signals and original EDF+ TAL; no event inference',
                time_basis='Naive device header wall time; no timezone assigned. Filenames and different EDF headers may differ by seconds.',
                caution='Device event labels are evidence from EVE files, not a reproduced detection algorithm. STR contains daily device summaries. No source file is modified.',
                files=evidence, eve_annotation_text_counts=dict(Counter(e['text'] for e in device_annotations)),
                recognized_respiratory_event_count=sum(e['text'] in clinical_labels for e in device_annotations))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--date', default='2019-12-28')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = json.dumps(inspect_tree(args.root, args.date), ensure_ascii=False, indent=2, allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as output:
            output.write(result + '\n')
        print(f'Wrote {args.output}')
    else:
        print(result)


if __name__ == '__main__':
    main()
