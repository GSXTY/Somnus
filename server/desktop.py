"""Loopback API process owned by the Electron desktop shell."""
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading

import uvicorn


def reserve_listener(port):
    # Keep the socket open through Uvicorn startup so another process cannot
    # claim the port between selection and actual startup.
    candidates = [*range(port, min(port + 20, 65536)), 0] if port else [0]
    for candidate in candidates:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if sys.platform == 'win32':
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', candidate))
            listener.listen()
            return listener
        except OSError:
            listener.close()
            if candidate == 0:
                raise


def write_ready_file(path, port):
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
            temp_path = Path(stream.name)
            json.dump({'pid': os.getpid(), 'port': port}, stream)
        temp_path.replace(path)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def run_managed_desktop(app, port, ready_file, shutdown_on_stdin_close):
    """Report readiness only after Uvicorn initializes the bound listener."""
    if ready_file.exists():
        print('Cannot report desktop workspace: ready file already exists.', flush=True)
        return 1
    if shutdown_on_stdin_close and sys.stdin is None:
        print('Cannot start desktop workspace: stdin pipe is unavailable.', flush=True)
        return 1

    class DesktopServer(uvicorn.Server):
        ready_written = False

        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            if self.started and not self.should_exit:
                try:
                    write_ready_file(ready_file, bound_port)
                except OSError as exc:
                    print(f'Cannot report desktop workspace: {exc}', flush=True)
                    self.should_exit = True
                else:
                    self.ready_written = True

    def stop_on_eof(descriptor):
        try:
            while os.read(descriptor, 8192):
                pass
        except OSError:
            pass
        server.should_exit = True

    with reserve_listener(port) as listener:
        bound_port = listener.getsockname()[1]
        config = uvicorn.Config(app, host='127.0.0.1', port=bound_port, workers=1, access_log=False, proxy_headers=False,
                                timeout_graceful_shutdown=4)
        server = DesktopServer(config)
        if shutdown_on_stdin_close:
            threading.Thread(target=stop_on_eof, args=(sys.stdin.fileno(),),
                             name='desktop-parent', daemon=True).start()
        try:
            print(f'Somnus workspace: http://127.0.0.1:{bound_port}', flush=True)
            server.run(sockets=[listener])
        finally:
            if server.ready_written:
                ready_file.unlink(missing_ok=True)
        return 0 if server.ready_written else 1
