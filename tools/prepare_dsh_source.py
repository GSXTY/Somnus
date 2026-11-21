"""Fetch or inspect the pinned DSH Next source dependency; never change Somnus Git metadata."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / 'desktop/dsh_next/source-lock.json'


def git(source, *arguments):
    return subprocess.check_output(['git', '-C', str(source), *arguments], encoding='utf-8').strip()


def load_lock(path=LOCK_PATH):
    lock = json.loads(Path(path).read_text(encoding='utf-8'))
    if lock.get('schemaVersion') != 1 or len(lock.get('commit', '')) != 40:
        raise ValueError('Invalid DSH source lock')
    if lock.get('repository') != 'https://github.com/xue-ding-e/DSH-Next.git':
        raise ValueError('Unexpected DSH source repository')
    if lock.get('license') != 'MIT':
        raise ValueError('Unexpected DSH source license')
    return lock


def inspect_source(source, lock):
    source = Path(source).resolve()
    if not (source / '.git').exists():
        raise RuntimeError('DSH source checkout is missing; run tools/prepare_dsh_source.py without --check first')
    top = Path(git(source, 'rev-parse', '--show-toplevel')).resolve()
    if top != source:
        raise RuntimeError('DSH source path resolves to a different Git repository')
    if git(source, 'rev-parse', 'HEAD') != lock['commit']:
        raise RuntimeError('DSH source HEAD differs from source-lock.json; existing checkout was left untouched')
    if git(source, 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('DSH dependency has local changes; preserve them before building a clean source snapshot')
    package = json.loads((source / 'package.json').read_text(encoding='utf-8'))
    if package.get('name') != lock['packageName'] or package.get('packageManager') != lock['packageManager']:
        raise RuntimeError('DSH package identity or package manager differs from source-lock.json')
    digest = hashlib.sha256((source / 'pnpm-lock.yaml').read_bytes()).hexdigest()
    if digest != lock['lockfileSha256']:
        raise RuntimeError('DSH dependency lockfile checksum differs from source-lock.json')
    license_text = (source / 'LICENSE').read_text(encoding='utf-8')
    if not license_text.startswith('MIT License') or 'Copyright (c) 2026 DeepSeek' not in license_text:
        raise RuntimeError('DSH source MIT license or attribution is missing')
    required = ['apps/desktop/src/main.ts', 'apps/desktop/scripts/package-target.ts',
                'packages', 'native', 'vendor', 'scripts/build.ts', 'pnpm-workspace.yaml']
    for name in required:
        if not (source / name).exists():
            raise RuntimeError('Incomplete DSH source checkout: ' + name)
    return {'ok': True, 'source': str(source), 'commit': lock['commit'],
            'packageManager': lock['packageManager'], 'lockfileSha256': digest,
            'license': lock['license'], 'originalAsarRequired': False}


def prepare_source(source, lock):
    source = Path(source).resolve()
    if (source / '.git').exists():
        return inspect_source(source, lock)
    if source.exists() and any(source.iterdir()):
        raise RuntimeError('DSH source destination is nonempty; no existing files were changed')
    source.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', 'clone', '--no-checkout', '--depth', '1', lock['repository'], str(source)], check=True)
    subprocess.run(['git', '-C', str(source), 'fetch', '--depth', '1', 'origin', lock['commit']], check=True)
    subprocess.run(['git', '-C', str(source), '-c', 'core.longpaths=true', 'checkout', '--detach', lock['commit']], check=True)
    return inspect_source(source, lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate the local pinned source without network or writes')
    parser.add_argument('--source', type=Path, help='Optional source dependency checkout')
    args = parser.parse_args()
    lock = load_lock()
    source = args.source or ROOT / lock['path']
    result = inspect_source(source, lock) if args.check else prepare_source(source, lock)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
