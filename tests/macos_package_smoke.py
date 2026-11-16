"""Verify an extracted macOS package using a synthetic recording and isolated storage."""
import argparse
from contextlib import closing
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import runpy
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def recording():
    start = datetime(2026, 1, 1)
    rows = ['时间,流量,压力,漏气量,运行状态,模式']
    for seconds in range(200):
        stamp = (start + timedelta(seconds=seconds)).isoformat(sep=' ')
        amplitude = 0.4 if 80 <= seconds < 100 else 20
        for index in range(20):
            flow = amplitude if index % 2 == 0 else -amplitude
            rows.append(f'{stamp},{flow},600,2,1,1')
    return '\n'.join(rows).encode('utf-8')


def verify_service(exe, folder, *, managed=False):
    port = 0
    if not managed:
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    data_dir = folder / 'data'
    data_dir.mkdir()
    env = {**os.environ, 'AI_AGENT_DATA_DIR': str(data_dir)}

    def read(path, body=None, content_type='application/json'):
        request = urllib.request.Request(base + path, data=body, headers={
            'Content-Type': content_type,
            'X-Filename': 'synthetic.csv',
        })
        with client.open(request, timeout=10) as response:
            return response.read()

    log = folder / 'app.log'
    command = [str(exe), '--no-window', '--no-browser', '--port', str(port), '--data-dir', str(data_dir)]
    ready_file = folder / 'ready.json'
    if managed:
        command.extend(['--ready-file', str(ready_file), '--shutdown-on-stdin-close'])
    with log.open('wb') as output:
        process = subprocess.Popen(command, cwd=folder, env=env, stdin=subprocess.PIPE,
                                   stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 40
            while True:
                try:
                    if managed and port == 0:
                        ready = json.loads(ready_file.read_text(encoding='utf-8'))
                        assert ready['pid'] == process.pid and 1 <= ready['port'] <= 65535
                        port = ready['port']
                        base = f'http://127.0.0.1:{port}'
                    health = json.loads(read('/api/health'))
                    break
                except (FileNotFoundError, urllib.error.URLError) as error:
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('打包应用未成功启动') from error
                    time.sleep(0.25)
            assert health['app_version'] == runpy.run_path(str(ROOT / 'app_version.py'))['APP_VERSION']
            home = read('/').decode('utf-8')
            assets = re.findall(r'(?:src|href)="(/workbench-assets/[^"\s]+)"', home)
            assert assets and all(read(asset) for asset in assets)
            assert b'export-automatic' in read('/events')
            assert b'renderEventModeLabel' in read('/viewer.js')
            assert read('/ui/events.css')
            plugin_info = json.loads(read('/api/plugins'))
            assert not plugin_info['errors'], plugin_info['errors']
            assert 'query_database' in plugin_info['tools']
            metadata = json.loads(read('/api/open', recording(), 'text/csv'))
            assert metadata['channel_units']['压力'] == 'Pa'
            body = json.dumps({'file_id': metadata['file_id'], 'profile': 'patient_flow_v4'}).encode('utf-8')
            detection = json.loads(read('/api/detect', body))
            assert detection['added'] >= 1
            assert detection['packet']['run_id']
            if managed:
                policy = ROOT / 'skills' / 'defaults.json'
                enabled = json.loads(policy.read_text(encoding='utf-8'))['project_handoff'] if policy.exists() else True
                database = (data_dir / 'assistant.sqlite3').as_uri() + '?mode=ro'
                with closing(sqlite3.connect(database, uri=True)) as db:
                    default = db.execute('SELECT enabled, skill_ids FROM default_plugins WHERE name=?',
                                         ('Project Handoff',)).fetchone()
                    if enabled:
                        assert default and default[0] == 1
                        (skill_id,) = json.loads(default[1])
                        skill = db.execute('SELECT name, enabled FROM personal_skills WHERE id=?',
                                           (skill_id,)).fetchone()
                        assert skill == ('project-handoff', 1)
                    else:
                        assert default is None
                process.stdin.close()
                assert process.wait(timeout=15) == 0
                assert not ready_file.exists()
        except Exception:
            print(log.read_text(encoding='utf-8', errors='replace'))
            raise
        finally:
            process.stdin.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--arch', required=True, choices=('arm64', 'x86_64'))
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != args.arch:
        parser.error('Smoke test requires a Mac running the target architecture.')
    archive = args.archive.resolve()
    with archive.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    assert digest == archive.with_name(archive.name + '.sha256').read_text(encoding='ascii').split()[0]
    with zipfile.ZipFile(archive) as package:
        entries = [Path(item.filename) for item in package.infolist()]
        assert not any(
            any(part.startswith('.env') or part == 'data' for part in entry.parts)
            or entry.suffix in ('.csv', '.edf', '.sqlite3') for entry in entries
        ), 'Package contains local data or configuration'
    with tempfile.TemporaryDirectory(prefix='viewer-mac-smoke-') as temp:
        folder = Path(temp)
        extracted = folder / 'extracted'
        subprocess.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(extracted)], check=True)
        bundle = extracted / 'Somnus.app'
        exe = bundle / 'Contents' / 'MacOS' / 'Somnus'
        arch = subprocess.check_output(['/usr/bin/lipo', '-archs', str(exe)], text=True).strip()
        assert arch == args.arch, f'Unexpected executable architecture: {arch}'
        subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)
        verify_service(exe, folder)
    print(f'PASS: macOS {arch} archive, app signature, local service, static assets, plugin and synthetic detection')


if __name__ == '__main__':
    main()
