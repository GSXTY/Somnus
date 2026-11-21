"""Isolated synthetic UI acceptance. Usage: python tests/verify_platform_continuity_ui.py launcher.py --gui. No model calls."""
from contextlib import closing
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


backend = Path(sys.argv[1]).resolve(strict=True)
NATIVE_TOKEN = 'c' * 64


def request(origin, path, body=None):
    raw = None if body is None else json.dumps(body).encode()
    with urlopen(Request(origin + '/api/assistant' + path, data=raw,
                         headers={'Content-Type': 'application/json', 'X-Data-Agent-Local': '1',
                                  'X-Data-Agent-Native': NATIVE_TOKEN}), timeout=10) as response:
        return json.load(response)


def run(folder, callback):
    ready = folder / 'ready.json'
    log = folder / 'backend.log'
    data = folder / 'data'
    native_token = NATIVE_TOKEN
    env = {**os.environ, 'SOMNUS_PROFILE_CONFIG_ONLY': '1', 'AI_AGENT_DATA_DIR': str(data),
           'RESPIRATORY_VIEWER_PROJECT_TOKEN': native_token, 'ANALYTICS_DB_URL': '',
           'DATA_AGENT_REMOTE_URL': '', 'DATA_AGENT_REMOTE_TOKEN': ''}
    with log.open('wb') as output:
        process = subprocess.Popen([
            *([sys.executable, str(backend)] if backend.suffix == '.py' else [str(backend)]), '--host', '127.0.0.1', '--port', '0', '--no-window', '--no-browser',
            '--session-mode', 'shared', '--ready-file', str(ready), '--shutdown-on-stdin-close',
            '--data-dir', str(data)
        ], cwd=folder, env=env, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            deadline = time.monotonic() + 90
            while not ready.is_file():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(log.read_text(encoding='utf-8', errors='replace')[-3000:])
                time.sleep(.1)
            port = json.loads(ready.read_text(encoding='utf-8'))['port']
            callback(f'http://127.0.0.1:{port}')
            process.stdin.close()
            assert process.wait(timeout=25) == 0
            assert not ready.exists()
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)


CODEX = '11111111-1111-4111-8111-111111111111'
DSH = '22222222-2222-4222-8222-222222222222'
UNKNOWN = '33333333-3333-4333-8333-333333333333'


def member_path():
    return f'/conversations/{ids["conversation"]}/agent-members'


def require_status(status, callback):
    try:
        callback()
    except HTTPError as error:
        assert error.code == status, (status, error.code, error.read()[:300])
    else:
        raise AssertionError(f'Expected HTTP {status}')


ids = {}


def reserve(origin, cid, target, label):
    return request(origin, f'/conversations/{cid}/external-turns', {
        'agent_id': target, 'agent_name': label, 'model': 'Fixture Model',
        'member_only': True, 'group_parallel': True, 'content': label + ' task',
    })['turn_id']


def populate(origin):
    workspace = request(origin, '/workspaces', {'name': 'Group fixture project'})['workspace']['id']
    cid = request(origin, '/conversations', {
        'workspace': workspace, 'title': 'Group fixture chat',
    })['conversation']['id']
    ids.update(workspace=workspace, conversation=cid)
    base = f'/conversations/{cid}/external-turns'
    request(origin, member_path(), {'agent_id': CODEX, 'added': True})
    request(origin, member_path(), {'agent_id': DSH, 'added': True})
    a = reserve(origin, cid, CODEX, 'Codex')
    b = reserve(origin, cid, DSH, 'DSH')
    assert a != b
    require_status(409, lambda: reserve(origin, cid, DSH, 'Duplicate DSH'))
    require_status(409, lambda: request(origin, f'{base}/{a}/prepare', {'agent_id': DSH}))
    require_status(409, lambda: request(origin, f'{base}/{a}/cancel', {'agent_id': DSH}))
    stopped = request(origin, f'{base}/{a}/cancel', {'agent_id': CODEX})
    assert stopped['cancelled'] is True
    assert stopped['conversation']['running'] is True
    execution = {'steps': [{'id': 'dsh-step', 'title': 'DSH synthetic progress',
                            'kind': 'tool', 'status': 'completed'}], 'plan': []}
    request(origin, f'{base}/{b}/finish', {
        'content': 'DSH synthetic reply', 'status': 'complete', 'execution': execution,
    })
    assert not request(origin, f'/conversations/{cid}')['conversation']['running']
    if '--api-only' not in sys.argv:
        with urlopen(origin + '/', timeout=10) as response:
            index = response.read()
        asset = re.search(rb'"(/workbench-assets/assets/index-[\w-]+\.js)"', index)[1].decode()
        with urlopen(origin + asset, timeout=10) as response:
            code = response.read().decode('utf-8')
        assert 'group_parallel' in code and '添加 Agent' in code


def verify(origin):
    cid = ids['conversation']
    history = request(origin, f'/conversations/{cid}')
    assert history['conversation']['agent_members'] == [CODEX, DSH]
    replies = [m for m in history['messages'] if m['role'] == 'assistant']
    assert [(m['reply_meta']['provider_id'], m['status']) for m in replies] == [(CODEX, 'cancelled'), (DSH, 'complete')]
    assert replies[1]['content'] == 'DSH synthetic reply'
    assert replies[1]['reply_meta']['execution']['steps'][0]['title'] == 'DSH synthetic progress'
    if '--gui' in sys.argv:
        ui_cid = request(origin, '/conversations', {
            'workspace': ids['workspace'], 'title': 'Group fixture UI chat',
        })['conversation']['id']
        subprocess.run(['node', str(Path(__file__).with_name('platform_continuity_renderer.cjs')),
                        origin, NATIVE_TOKEN, ids['workspace'], ui_cid], check=True)


with tempfile.TemporaryDirectory(prefix='somnus-group-smoke-', dir=None) as folder:
    profile = Path(folder).resolve()
    run(profile, populate)
    run(profile, verify)

print('PASS: frozen backend holds two group turns at once, rejects wrong ownership and duplicate lanes, cancels independently, and preserves attributed history through restart.')
