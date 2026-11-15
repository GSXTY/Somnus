"""Exercise the frozen Electron backend and its managed shutdown contract."""
import argparse
from pathlib import Path
import sys
import tempfile

from macos_package_smoke import verify_service


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backend', type=Path)
    args = parser.parse_args()
    backend = args.backend.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='viewer-electron-smoke-') as temp:
        verify_service(backend, Path(temp), managed=True)
    print(f'PASS: packaged {sys.platform} backend, local assets, plugin, synthetic detection and pipe shutdown')


if __name__ == '__main__':
    main()
