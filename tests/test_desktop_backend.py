import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import ProxyHandler, build_opener

from app_version import APP_ID


ROOT = Path(__file__).resolve().parents[1]


class DesktopBackendTests(unittest.TestCase):
    def test_port_assignment_owns_listener_and_parent_eof_cleans_up(self):
        for preferred_port in (False, True):
            with self.subTest(preferred_port=preferred_port):
                with tempfile.TemporaryDirectory() as directory, socket.socket() as occupied:
                    occupied.bind(('127.0.0.1', 0))
                    occupied.listen()
                    unavailable = occupied.getsockname()[1]
                    folder = Path(directory)
                    ready_file = folder / 'ready.json'
                    (folder / '.env').touch()
                    process = subprocess.Popen(
                        [sys.executable, str(ROOT / 'launcher.py'), '--host', '127.0.0.1',
                         '--port', str(unavailable if preferred_port else 0), '--no-window', '--no-browser',
                         '--ready-file', str(ready_file), '--shutdown-on-stdin-close',
                         '--data-dir', str(folder / 'data')],
                        cwd=folder, env={**os.environ, 'WEB_CONCURRENCY': '1', 'AI_AGENT_SESSION_MODE': 'shared'},
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    )
                    try:
                        deadline = time.monotonic() + 20
                        while not ready_file.exists() and process.poll() is None and time.monotonic() < deadline:
                            time.sleep(0.05)
                        if not ready_file.exists():
                            self.fail('The Electron backend did not report readiness.')
                        ready = json.loads(ready_file.read_text(encoding='utf-8'))
                        self.assertEqual(ready['pid'], process.pid)
                        self.assertNotEqual(ready['port'], unavailable)
                        client = build_opener(ProxyHandler({}))
                        with client.open(f"http://127.0.0.1:{ready['port']}/api/health", timeout=5) as response:
                            self.assertEqual(json.load(response)['app_id'], APP_ID)
                        process.stdin.close()
                        self.assertEqual(process.wait(timeout=10), 0)
                        self.assertFalse(ready_file.exists())
                    finally:
                        if process.poll() is None:
                            process.kill()
                            process.wait(timeout=5)
                        process.stdin.close()
                        process.stdout.close()


if __name__ == '__main__':
    unittest.main()
