"""Source-only CI checks. Never build, stage, package, or publish the application."""
import argparse
import ast
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PYTHON_FOLDERS = (
    'agent_core', 'ai_assistant', 'batch_analysis_trial', 'data_gateway',
    'deep_analysis', 'desktop', 'dot_relay', 'event_detection',
    'mcp_connectors', 'plugins', 'server', 'server_detection', 'tests', 'tools',
)


def run(*args):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(args, cwd=ROOT, check=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', action='store_true', help='Also test against the verified, pinned local upstream ASAR.')
    args = parser.parse_args()
    files = list(ROOT.glob('*.py'))
    for folder in PYTHON_FOLDERS:
        for directory, folders, names in os.walk(ROOT / folder, followlinks=False):
            folders[:] = [name for name in folders if name not in ('node_modules', '__pycache__', 'runs', 'docker_runs', 'local_output_check')
                          and not (Path(directory) / name).is_symlink()]
            files.extend(Path(directory) / name for name in names if name.endswith('.py'))
    for file in files:
        ast.parse(file.read_text(encoding='utf-8-sig'), filename=str(file))
    print(f'Python syntax: {len(files)} source files', flush=True)
    run(sys.executable, '-B', 'tools/check_source_layout.py')
    run(sys.executable, '-B', 'tools/prepare_dsh_source.py', '--check')
    run(sys.executable, '-B', '-m', 'unittest', 'tests.test_storage_paths', 'tests.test_dsh_source', 'tests.test_backend_build_receipt')
    run('node', '--test', 'electron/dsh-config-bridge.test.cjs', 'desktop/dsh_next/host/native-api-bridge.test.mjs')
    run('node', '--test', 'desktop/dsh_next/source-build.test.mjs', 'desktop/dsh_next/source-overlay.test.mjs')
    tsc = 'page_design/frontend/node_modules/typescript/bin/tsc'
    run('node', tsc, '--noEmit', '--project', 'page_design/frontend/tsconfig.json')
    run('node', tsc, '--noEmit', '--project', 'desktop/dsh_next/client/tsconfig.native-ui.json')
    tests = sorted((ROOT / 'page_design/frontend/tests').glob('*.test.mjs'))
    run('node', '--test', *[str(path.relative_to(ROOT)) for path in tests])
    if args.native:
        # Fail if the archive is absent or different; do not silently skip native validation.
        import hashlib
        import json
        upstream = ROOT / 'desktop/dsh_next/upstream'
        expected = json.loads((upstream / 'manifest.json').read_text(encoding='utf-8'))['sha256']
        with (upstream / 'app.asar').open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != expected:
            raise RuntimeError('Upstream ASAR checksum does not match the pinned manifest')
        run('node', '--test', 'desktop/dsh_next/client/native-ui.test.mjs')
    print('Source checks passed. No application build or package was produced.', flush=True)


if __name__ == '__main__':
    main()
