"""Run the standalone Somnus Dot relay behind an HTTPS reverse proxy."""

import argparse
from pathlib import Path

import uvicorn

from .app import create_app


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--database', type=Path, required=True)
    cli.add_argument('--public-url', required=True)
    cli.add_argument('--bind', default='127.0.0.1')
    cli.add_argument('--port', type=int, default=8893)
    cli.add_argument('--local-dev', action='store_true')
    args = cli.parse_args()
    args.database.parent.mkdir(parents=True, exist_ok=True)
    app = create_app(args.database, args.public_url, local_dev=args.local_dev)
    uvicorn.run(app, host=args.bind, port=args.port, access_log=False, proxy_headers=False)


if __name__ == '__main__':
    main()
