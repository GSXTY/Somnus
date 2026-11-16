"""Start Somnus maintainer administration in the local Windows browser."""
from argparse import ArgumentParser
from pathlib import Path
from secrets import token_urlsafe
from threading import Timer
import os
import socket
import webbrowser

import uvicorn

from .app import create_app


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--standard', type=Path, required=True)
    parser.add_argument('--control', type=Path)
    parser.add_argument('--port', type=int, default=8895)
    parser.add_argument('--relay-port', type=int, default=8894)
    args = parser.parse_args()
    if not (1 <= args.port <= 65535 and 1 <= args.relay_port <= 65535 and args.port != args.relay_port):
        parser.error('后台和模型中继必须使用两个独立的端口。')
    control = args.control
    if control is None:
        control = Path(os.environ['LOCALAPPDATA']) / 'VVFLY/Somnus-Model-Relay/sharing.json'
    token = token_urlsafe(32)
    address = f'http://127.0.0.1:{args.port}/#{token}'
    app = create_app(args.standard, control, token, port=args.port, relay_port=args.relay_port)
    server = uvicorn.Server(uvicorn.Config(app, proxy_headers=False, access_log=False))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind(('127.0.0.1', args.port))
        except OSError:
            parser.error('管理后台端口已被占用。')
        browser = Timer(0.7, webbrowser.open, args=[address])
        browser.daemon = True
        browser.start()
        try:
            server.run(sockets=[listener])
        finally:
            browser.cancel()


if __name__ == '__main__':
    main()
