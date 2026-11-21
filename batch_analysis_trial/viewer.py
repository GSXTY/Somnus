"""Independent read-only batch result and source waveform viewer."""
import argparse
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit

import numpy as np
from run_batch import load_recording


def child(root, name):
    path = (root/name).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError('路径超出配置目录')
    return path


class Repository:
    def __init__(self, inputs, results):
        self.inputs = inputs.resolve(strict=True)
        self.results = results.resolve(strict=True)
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def batches(self):
        return sorted([p.name for p in self.results.iterdir()
                       if p.is_dir() and (p/'manifest.json').is_file()], reverse=True)

    def manifest(self, batch):
        folder = child(self.results, batch)
        return json.loads(child(folder, 'manifest.json').read_text(encoding='utf-8'))

    def entry(self, batch, file_id):
        manifest = self.manifest(batch)
        for entry in manifest['files']:
            if entry.get('metadata', {}).get('file_id') == file_id and entry['status'] == 'completed':
                folder = child(self.results, batch)
                result = json.loads(child(folder, entry['result_file']).read_text(encoding='utf-8'))
                return entry, result
        raise ValueError('找不到已完成的记录')

    def waveform(self, batch, file_id, start, end, points):
        entry, _ = self.entry(batch, file_id)
        with self.lock:
            if file_id not in self.cache:
                path = child(self.inputs, entry['filename'])
                # Parse and verify the same bytes before placing data in the cache.
                recording = load_recording(path)
                if recording.meta['file_id'] != file_id:
                    raise ValueError('CSV内容指纹与批次记录不一致')
                self.cache.clear()  # Keep at most one source recording in memory.
                self.cache[file_id] = recording
            recording = self.cache[file_id]
            duration = recording.meta['raw_duration']
            if not np.isfinite([start, end]).all() or not 0 <= start < end <= duration:
                raise ValueError('时间范围无效')
            left = np.searchsorted(recording.x, start, side='left')
            right = np.searchsorted(recording.x, end, side='right')
            x = recording.x[left:right]
            answer = {}
            for name in ('流量', '压力', '漏气量'):
                if name not in recording.channels:
                    continue
                y = recording.channels[name][left:right]
                bucket_count = max(1, min(points//2, len(x)))
                edges = np.linspace(0, len(x), bucket_count+1, dtype=int)
                indices = []
                for lo, hi in zip(edges[:-1], edges[1:]):
                    finite = np.flatnonzero(np.isfinite(y[lo:hi]))
                    if not len(finite):
                        continue
                    indices.extend(sorted({int(lo+finite[np.argmin(y[lo:hi][finite])]),
                                           int(lo+finite[np.argmax(y[lo:hi][finite])])}))
                answer[name] = [[float(x[i]), float(y[i])] for i in indices]
            return dict(start=start, end=end, channels=answer, gaps=recording.gaps,
                        rows_in_view=len(x), source_timestamp_resolution='seconds; repeated timestamps preserved',
                        downsampling='per-bucket min/max; full candidate intervals unchanged')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('D:/VVFLY/analyze_test_data_csv'))
    parser.add_argument('--results', type=Path, default=Path(__file__).parent/'docker_runs')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    repository = Repository(args.input, args.results)
    page = Path(__file__).with_name('viewer.html').read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            try:
                url = urlsplit(self.path)
                query = {key: values[-1] for key, values in parse_qs(url.query).items()}
                if url.path == '/':
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(page)))
                    self.end_headers()
                    self.wfile.write(page)
                    return
                if url.path == '/api/batches':
                    value = repository.batches()
                elif url.path == '/api/manifest':
                    value = repository.manifest(query['batch'])
                elif url.path == '/api/result':
                    value = repository.entry(query['batch'], query['file'])[1]
                elif url.path == '/api/waveform':
                    value = repository.waveform(query['batch'], query['file'], float(query['start']),
                                                 float(query['end']), max(100, min(4000, int(query.get('points', 1800)))))
                else:
                    self.send_error(404)
                    return
                self.respond(200, value)
            except (ValueError, KeyError, OSError) as exc:
                self.respond(400, dict(error=str(exc)))

        def respond(self, status, value):
            body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'READ_ONLY_VIEWER http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
