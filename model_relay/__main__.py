"""Run the relay on loopback behind a TLS reverse proxy."""
import argparse
import os
from pathlib import Path

import uvicorn

from .app import Settings, create_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8894)
    args = parser.parse_args()
    try:
        settings = Settings(
            upstream_key=os.environ['SOMNUS_MODEL_RELAY_UPSTREAM_KEY'].strip(),
            invites=tuple(os.environ['SOMNUS_MODEL_RELAY_INVITES'].split()),
            models=tuple(os.environ['SOMNUS_MODEL_RELAY_MODELS'].split()),
            database=Path(os.environ['SOMNUS_MODEL_RELAY_DB']).resolve(),
            per_invite_daily=int(os.getenv('SOMNUS_MODEL_RELAY_INVITE_DAILY', '20')),
            total_daily=int(os.getenv('SOMNUS_MODEL_RELAY_TOTAL_DAILY', '100')),
            max_request_bytes=int(os.getenv('SOMNUS_MODEL_RELAY_REQUEST_BYTES', '262144')),
            max_output_tokens=int(os.getenv('SOMNUS_MODEL_RELAY_OUTPUT_TOKENS', '2048')),
        )
    except KeyError as error:
        parser.error(f'Missing environment variable {error.args[0]}.')
    except ValueError:
        parser.error('Invalid model relay settings.')
    uvicorn.run(create_app(settings), host='127.0.0.1', port=args.port,
                access_log=False, proxy_headers=False, limit_concurrency=16)


if __name__ == '__main__':
    main()
