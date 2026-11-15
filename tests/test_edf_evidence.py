import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('edf_evidence', Path(__file__).parents[1] / 'event_detection/research/edf_evidence.py')
edf = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(edf)


def synthetic_edf(annotation=False, unknown_count=False):
    def field(value, width):
        return str(value).encode('ascii').ljust(width, b' ')
    n = 1 if annotation else 2
    header = (field(0, 8) + field('private patient', 80) + field('private serial', 80)
              + b'28.12.1923.09.53' + field(256 * (n + 1), 8) + field('EDF+C', 44)
              + field(-1 if unknown_count else 2, 8) + field(0 if annotation else 1, 8) + field(n, 4))
    labels = ['EDF Annotations'] if annotation else ['Flow', 'Pressure']
    values = [(labels,16), (['secret']*n,80), (['L/s']*n,8), ([-1]*n,8), ([1]*n,8),
              ([-100]*n,8), ([100]*n,8), (['']*n,80), ([24] if annotation else [2,1],8), (['']*n,32)]
    for entries, width in values:
        header += b''.join(field(value,width) for value in entries)
    if annotation:
        payload = b'+0\x14\x14\x00+12.5\x1510\x14Central Apnea\x14note\x14\x00'.ljust(48,b'\x00') * 2
    else:
        # Record-major: two samples in channel zero, one sample in channel one.
        payload = struct.pack('<hhhhhh', -100,0,100, 100,-50,0)
    return header + payload


class EvidenceTests(unittest.TestCase):
    def read(self, content):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / 'example.edf'
        path.write_bytes(content)
        return edf.EDFFile(path)

    def test_mixed_sampling_and_calibration(self):
        reader = self.read(synthetic_edf())
        self.assertEqual(reader.read_signal(0), [-1,0,1,-.5])
        self.assertEqual(reader.read_signal(1), [1,0])
        self.assertEqual([c['sample_rate_hz'] for c in reader.channels], [2,1])
        self.assertEqual(reader.read_signal(0,1,2), [1,-.5])
        self.assertEqual(reader.evidence()['timezone'], None)
        self.assertNotIn('private', str(reader.evidence()))
        self.assertNotIn('secret', str(reader.evidence()))

    def test_discontinuous_numeric_grid_is_not_silently_invented(self):
        raw = synthetic_edf()
        raw = raw[:192] + b'EDF+D'.ljust(44, b' ') + raw[236:]
        reader = self.read(raw)
        self.assertEqual(reader.evidence()['numeric_timing_support'], 'unsupported_discontinuous')
        self.assertIsNone(reader.evidence()['numeric_end_exclusive'])
        with self.assertRaises(edf.EDFError):
            reader.read_signal(0)

    def test_unknown_record_count(self):
        self.assertEqual(self.read(synthetic_edf(unknown_count=True)).record_count, 2)

    def test_tal_multiple_texts_nonzero_onset(self):
        result = edf.parse_tal(b'+0\x14\x14\x00+12.5\x1510.25\x14Central Apnea\x14note\x14\x00')
        self.assertEqual(result[0]['texts'], [])
        self.assertEqual(result[1], dict(onset_seconds=12.5,duration_seconds=10.25,texts=['Central Apnea','note']))
        self.assertEqual(edf.parse_tal(b'-2\x14test\x14\x00')[0]['onset_seconds'], -2)

    def test_zero_duration_annotation_records(self):
        reader = self.read(synthetic_edf(annotation=True))
        self.assertEqual(reader.record_seconds,0)
        self.assertEqual(len(reader.annotations()),4)
        self.assertEqual(reader.evidence()['annotation_text_counts'], {'Central Apnea':2,'note':2})

    def test_truncation_rejected(self):
        for content in (synthetic_edf()[:100],synthetic_edf()[:300],synthetic_edf()[:-1],synthetic_edf(unknown_count=True)[:-1]):
            with self.subTest(length=len(content)), self.assertRaises(edf.EDFError):
                self.read(content)
        with self.assertRaises(edf.EDFError):
            edf.parse_tal(b'+12\x1510\x14Apnea\x14')

    def test_malformed_tal_rejected(self):
        for content in (b'12\x14test\x14\x00',b'+0\x15-1\x14test\x14\x00',b'+0\x14test\x00'):
            with self.assertRaises(edf.EDFError):
                edf.parse_tal(content)


if __name__ == '__main__':
    unittest.main()
