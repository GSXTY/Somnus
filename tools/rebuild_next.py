"""Rebuild the local SomnusNext desktop overlays without another project's files."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from storage_paths import storage_root


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def build_environment(storage):
    env = dict(os.environ, SOMNUS_DEV_STORAGE=str(storage), PYTHONDONTWRITEBYTECODE='1')
    paths = []
    for module_root in (ROOT / 'electron/node_modules', ROOT / 'page_design/frontend/node_modules'):
        paths.append(str(module_root))
        paths.extend(str(path) for path in sorted((module_root / '.pnpm').glob('*/node_modules')))
    env['NODE_PATH'] = os.pathsep.join(paths)
    return env


def inspect():
    baseline = ROOT / 'desktop/dsh_next/upstream/app.asar'
    manifest = json.loads((baseline.parent / 'manifest.json').read_text(encoding='utf-8'))
    if not baseline.is_file() or sha256(baseline) != manifest['sha256']:
        raise RuntimeError('The local pinned DSH Next build input is missing or has changed.')
    for relative in ('app/Somnus.exe', 'app/resources/app.asar', 'electron/runtime/resources.cjs',
                     'desktop/dsh_next/stage-next.mjs', 'launcher.py'):
        if not (ROOT / relative).is_file():
            raise RuntimeError('Missing local project file: ' + relative)
    return baseline, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify local build inputs without modifying files.')
    parser.add_argument('--storage', type=Path, help='Optional build/backup location outside the source tree.')
    parser.add_argument('--frontend', action='store_true', help='Also build and deploy the configuration/workbench frontend.')
    args = parser.parse_args()
    baseline, manifest = inspect()
    if args.check:
        print(json.dumps({'ok': True, 'baseline': str(baseline), 'sha256': manifest['sha256'],
                          'runtime': str(ROOT / 'app/Somnus.exe'), 'other_project_required': False}))
        return
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is required to rebuild the desktop overlays.')
    storage = args.storage.expanduser().resolve() if args.storage else storage_root(ROOT)
    if storage == ROOT or ROOT in storage.parents:
        raise RuntimeError('Build and backup storage must be outside the source tree.')
    env = build_environment(storage)
    work = storage / 'cache/next-rebuild'
    work.mkdir(parents=True, exist_ok=True)
    archive = work / 'app.asar'
    subprocess.run([node, str(ROOT / 'desktop/dsh_next/stage-next.mjs'), '--archive-only',
                    str(baseline), str(archive)], cwd=ROOT, env=env, check=True)
    resources = ROOT / 'app/resources'
    frontend = ROOT / 'page_design/frontend'
    if args.frontend:
        # Use the project's local tools, avoiding copied .cmd shims or a global package manager.
        for script, arguments in (
            (frontend / 'node_modules/typescript/bin/tsc', ['--noEmit']),
            (frontend / 'node_modules/vite/bin/vite.js', ['build']),
        ):
            subprocess.run([node, str(script), *arguments], cwd=frontend, env=env, check=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = storage / 'backups/local' / ('next-' + stamp)
    backup.mkdir(parents=True)
    shutil.copy2(resources / 'app.asar', backup / 'app.asar')
    # Only source-owned host modules are deployed; user configuration and data are untouched.
    host_copy = "require(process.argv[1]).copyHostFiles(process.argv[2],process.argv[3]).then(x=>console.log(JSON.stringify(x)))"
    subprocess.run([node, '-e', host_copy, str(ROOT / 'electron/runtime/resources.cjs'),
                    str(ROOT / 'electron'), str(resources / 'somnus')], cwd=ROOT, env=env, check=True)
    if args.frontend:
        shutil.copytree(ROOT / 'page_design/web', resources / 'backend/_internal/page_design/web', dirs_exist_ok=True)
    # Keep the working archive until every overlay and resource operation has succeeded.
    shutil.copy2(archive, resources / 'app.asar')
    print(json.dumps({'ok': True, 'runtime': str(ROOT / 'app/Somnus.exe'),
                      'archive_sha256': sha256(resources / 'app.asar'), 'backup': str(backup)}))


if __name__ == '__main__':
    main()
