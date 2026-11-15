"""Real Uvicorn trial API smoke; synthetic data, no model calls or code execution."""
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]


def main():
    for mode in ('isolated', 'shared'):
        with tempfile.TemporaryDirectory() as temp:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            env = os.environ.copy()
            env.update(AI_AGENT_DATA_DIR=temp, AI_AGENT_SESSION_MODE=mode, WEB_CONCURRENCY='1',
                       DEEP_ANALYSIS_BASE_URL='', DEEP_ANALYSIS_MODEL='', DEEP_ANALYSIS_API_KEY='',
                       AI_ASSISTANT_BASE_URL='', AI_ASSISTANT_MODEL='', AI_ASSISTANT_API_KEY='')
            env.pop('RESPIRATORY_CSV', None)
            base = f'http://127.0.0.1:{port}'
            first = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
            second = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

            def request(path, *, client=first, packet=None, raw=None, headers=None):
                data = json.dumps(packet).encode() if packet is not None else raw
                request_headers = {'Content-Type': 'application/json' if packet is not None else 'application/octet-stream',
                                   'X-Filename': 'synthetic.csv'}
                request_headers.update(headers or {})
                with client.open(Request(base + path, data=data, headers=request_headers), timeout=25) as response:
                    body = response.read()
                    return json.loads(body) if 'application/json' in response.headers.get('Content-Type', '') else body

            with open(Path(temp) / 'uvicorn.log', 'wb') as logs:
                process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'server.app:create_app', '--factory',
                                            '--host', '127.0.0.1', '--port', str(port), '--workers', '1', '--no-access-log'],
                                           cwd=ROOT, env=env, stdout=logs, stderr=logs,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    deadline = time.monotonic() + 20
                    while True:
                        try:
                            assert request('/api/health')['framework'] == 'fastapi'
                            break
                        except (OSError, URLError):
                            if process.poll() is not None or time.monotonic() > deadline:
                                raise RuntimeError('Temporary trial host did not become healthy')
                            time.sleep(.1)
                    status = request('/api/deep-analysis/status')
                    assert not status['configured'] and not status['ready'] and not status['official_deepanalyze']
                    sample = request('/api/deep-analysis/sample.csv')
                    assert b'SYNTHETIC-' in sample
                    uploaded = request('/api/deep-analysis/files', raw=sample)['file']
                    task = request('/api/deep-analysis/tasks', packet={'file_id': uploaded['id'], 'question': '概述这份合成样例'})['task']
                    assert task['status'] == 'blocked' and task['error_code'] == 'model_not_configured'
                    assert request('/api/deep-analysis/tasks/' + task['id'])['task']['id'] == task['id']
                    if mode == 'isolated':
                        try:
                            request('/api/deep-analysis/tasks/' + task['id'], client=second)
                            raise AssertionError('Another browser read the trial task')
                        except HTTPError as exc:
                            assert exc.code == 404
                    else:
                        assert request('/api/deep-analysis/tasks/' + task['id'], client=second)['task']['id'] == task['id']
                    try:
                        request('/api/deep-analysis/files', raw=sample, headers={'Origin': 'https://unrelated.invalid'})
                        raise AssertionError('Cross-origin upload was allowed')
                    except HTTPError as exc:
                        assert exc.code == 403
                    assert request('/api/assistant/conversations')['conversations'] == []
                    assert request('/api/workbench?source=live')['source']['mode'] == 'unconfigured'
                    assert b'<!doctype html' in request('/').lower()
                    print(f'PASS: real Uvicorn {mode}, independent trial status/sample/upload/blocked task/owner/origin and existing APIs')
                finally:
                    process.terminate()
                    process.wait(timeout=10)


if __name__ == '__main__':
    main()
