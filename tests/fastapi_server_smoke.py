"""Launch real Uvicorn subprocesses against temporary data in both modes."""
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]


def main():
    for mode in ('isolated', 'shared'):
        with tempfile.TemporaryDirectory() as temp:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            env = os.environ.copy()
            env.update(WEB_CONCURRENCY='1', AI_ASSISTANT_BASE_URL='', AI_ASSISTANT_MODEL='', AI_ASSISTANT_API_KEY='')
            env.pop('AI_AGENT_SESSION_MODE', None)
            env.pop('RESPIRATORY_CSV', None)
            base = f'http://127.0.0.1:{port}'
            first = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
            second = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
            no_cookies = build_opener(ProxyHandler({}))

            def request(path, *, client=first, raw=None, packet=None):
                data = json.dumps(packet).encode() if packet is not None else raw
                req = Request(base + path, data=data, headers={'Content-Type': 'application/json', 'X-Filename': 'synthetic.csv'})
                with client.open(req, timeout=10) as response:
                    content = response.read()
                    return json.loads(content) if 'application/json' in response.headers.get('Content-Type', '') else content.decode('utf-8')

            with open(Path(temp) / 'uvicorn.log', 'wb') as logs:
                process = subprocess.Popen([sys.executable, str(ROOT / 'launcher.py'), '--no-browser', '--port', str(port),
                                            '--data-dir', temp, '--session-mode', mode], cwd=ROOT, env=env,
                                           stdout=logs, stderr=logs,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    deadline = time.monotonic() + 20
                    while True:
                        try:
                            health = request('/api/health')
                            break
                        except (OSError, URLError):
                            if process.poll() is not None or time.monotonic() > deadline:
                                raise RuntimeError('FastAPI process did not become healthy')
                            time.sleep(.1)
                    assert health['framework'] == 'fastapi'
                    assert health['runtime']['session_mode'] == mode
                    assert 'swagger-ui' in request('/docs')
                    assert '/api/workbench' in request('/openapi.json')['paths']
                    html = request('/')
                    for asset in re.findall(r'(?:src|href)="(/workbench-assets/[^\"]+)"', html):
                        assert request(asset)
                    assert '<h1>数据分析</h1>' in request('/events?embedded=1')
                    assert request('/api/workbench?source=live')['data_quality']['loss_rate'] is None
                    assert not request('/api/assistant/status')['configured']
                    created = request('/api/assistant/conversations', packet={'title': 'synthetic smoke'})['conversation']
                    if mode == 'isolated':
                        assert request('/api/assistant/conversations', client=second)['conversations'] == []
                    else:
                        assert request('/api/assistant/conversations', client=no_cookies)['conversations'][0]['id'] == created['id']
                    csv = ('time,流量,压力\n2026-01-01 00:00:00,1,400\n2026-01-01 00:00:01,2,400\n'
                           '2026-01-01 00:00:02,3,400\n2026-01-01 00:00:03,1,400\n').encode()
                    meta = request('/api/open', raw=csv)
                    assert request('/api/meta')['file_id'] == meta['file_id']
                    wave = request('/api/wave?' + urlencode(dict(file_id=meta['file_id'], start=0, end=3, pixels=200, mode='raw', channel='流量')))
                    assert wave['series']['流量']
                    if mode == 'isolated':
                        try:
                            request('/api/meta', client=second)
                            raise AssertionError('another browser inherited the first recording')
                        except HTTPError as error:
                            assert error.code == 400
                    else:
                        assert request('/api/meta', client=no_cookies)['file_id'] == meta['file_id']
                    print(f'PASS: real Uvicorn {mode}, docs/assets/dashboard/chat/CSV/wave and browser context semantics')
                finally:
                    process.terminate()
                    process.wait(timeout=10)


if __name__ == '__main__':
    main()
