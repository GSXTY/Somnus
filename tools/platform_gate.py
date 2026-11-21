"""Bounded local platform upgrade gate; report and candidate bind exact source/assets."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 1
FOLDERS = ('ai_assistant', 'electron', 'page_design/frontend', 'page_design/web', 'desktop', 'mcp_connectors', 'tools', 'tests', '.github')
EXCLUDED = {'node_modules', '__pycache__', '.git', '.tmp', 'dist', 'build'}
SUITES = [
    ('state_recovery', [sys.executable, '-m', 'unittest', 'tests.test_runtime_tasks', 'tests.test_runtime_tasks_api', 'tests.test_runtime_sessions', 'tests.test_runtime_sessions_api', 'tests.test_fork_history', 'tests.test_fork_history_api', 'tests.test_worktree_native_fork', 'tests.test_native_preferences', 'tests.test_native_child_links', 'tests.test_native_child_links_api', 'tests.test_native_model_fixture', 'tests.test_assistant_external_turns']),
    ('permissions_models_modes', [sys.executable, '-m', 'unittest', 'tests.test_assistant_permission_modes', 'tests.test_model_capabilities', 'tests.test_assistant_agent_modes']),
    ('group_plugin', [sys.executable, '-m', 'unittest', 'tests.test_assistant_group_conversation', 'tests.test_assistant_plugin_bundles', 'tests.test_plugin_contract', 'tests.test_plugin_cards', 'tests.test_plugin_ui_contract', 'tests.test_platform_gate']),
    ('frontend_types', ['node', 'page_design/frontend/node_modules/typescript/bin/tsc', '--noEmit', '--project', 'page_design/frontend/tsconfig.json']),
    ('frontend_chat_state', ['node', '--test', 'page_design/frontend/tests/runtime-task-state.test.mjs', 'page_design/frontend/tests/assistant-ui.test.mjs', 'page_design/frontend/tests/chat-workspace-panel.test.mjs', 'page_design/frontend/tests/ui-preferences.test.mjs', 'page_design/frontend/tests/child-conversation-ui.test.mjs', 'page_design/frontend/tests/plugin-document.test.mjs', 'page_design/frontend/tests/appearance-ui.test.mjs', 'page_design/frontend/tests/child-association-ui.test.mjs', 'page_design/frontend/tests/composer-shortcuts.test.mjs', 'page_design/frontend/tests/inherited-history-ui.test.mjs', 'page_design/frontend/tests/ledger-model.test.mjs', 'page_design/frontend/tests/native-fork-ui.test.mjs', 'page_design/frontend/tests/child-media-ui.test.mjs', 'page_design/frontend/tests/plugin-document-contract.test.mjs']),
    ('runtime_host_boundaries_resources', ['node', '--test', '--test-concurrency=1', *[str(p.relative_to(ROOT)) for p in sorted((ROOT / 'electron/runtime').glob('*.test.cjs'))], 'electron/acp-dsh-package-source.test.cjs', 'electron/acp-deadline.test.cjs', 'electron/acp-agents.test.cjs', 'electron/acp-native-permissions.test.cjs', 'electron/acp-dsh-recovery.test.cjs']),
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint():
    rows = {}
    for folder in FOLDERS:
        for directory, directories, names in os.walk(ROOT / folder):
            directories[:] = sorted(name for name in directories if name not in EXCLUDED)
            for name in sorted(names):
                path = Path(directory) / name
                if path.is_symlink():
                    raise ValueError('Source fingerprint does not follow symlinks')
                rows[path.relative_to(ROOT).as_posix()] = digest(path)
    for name in ('app_version.py', 'build_electron.py', 'build_windows.py', 'build_macos.py', 'requirements.txt', 'requirements-electron.txt', 'requirements-build.txt', 'launcher.py', 'AGENTS.md'):
        path = ROOT / name
        if path.exists():
            rows[name] = digest(path)
    encoded = json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(encoded).hexdigest(), rows


def provenance():
    package = ROOT / 'electron/package.json'
    data = json.loads(package.read_text(encoding='utf-8'))
    locks = list((Path(os.environ.get('APPDATA', '')) / 'RespiratoryViewer/dsh-runtime').glob('*/pnpm-lock.yaml'))
    source = (ROOT / 'electron/acp-dsh-market.cjs').read_text(encoding='utf-8')
    pin = re.search(r"const VERSION = '([^']+)'", source)
    if not pin or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', pin[1]):
        raise ValueError('Runtime must use an exact top-level version')
    return {'electron_version': data.get('version'), 'runtime_package': '@deepseek-ai/dsh', 'runtime_version': pin[1],
            'resolved_runtime_locks': [{'version': p.parent.name, 'sha256': digest(p)} for p in locks],
            'scope': 'Top-level runtime pin and local resolved lock hashes; dependency ranges are not a reproducible fresh-install guarantee.'}



def validate_assets():
    frontend = ROOT / 'page_design/frontend'
    output = ROOT / 'page_design/web'
    manifest = json.loads((output / 'build-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schema_version') != 1 or manifest.get('producer') != 'somnus-frontend':
        raise ValueError('Invalid frontend manifest')
    names = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'build-manifest.mjs']
    for folder in ('src', 'public'):
        for path in (frontend / folder).rglob('*'):
            if path.is_symlink():
                raise ValueError('Frontend input symlinks are forbidden')
            if path.is_file():
                names.append(path.relative_to(frontend).as_posix())
    rows = [{'path': name, 'sha256': digest(frontend / name)} for name in sorted(names)]
    value = hashlib.sha256(''.join(row['path'] + chr(0) + row['sha256'] + '\n' for row in rows).encode()).hexdigest()
    if rows != manifest.get('source_files') or value != manifest.get('source_fingerprint'):
        raise ValueError('Frontend build does not match current source')
    assets = []
    for path in sorted(output.rglob('*')):
        if path.is_symlink():
            raise ValueError('Frontend output symlinks are forbidden')
        if path.is_file() and path.name != 'build-manifest.json':
            assets.append({'path': path.relative_to(output).as_posix(), 'sha256': digest(path), 'size': path.stat().st_size})
    if sorted(assets, key=lambda item: item['path']) != sorted(manifest.get('assets', []), key=lambda item: item['path']):
        raise ValueError('Frontend assets changed or are incomplete')
    upstream = json.loads((ROOT / 'desktop/dsh_next/upstream.json').read_text(encoding='utf-8'))
    release = json.loads((ROOT / 'desktop/dsh_next/next-release.json').read_text(encoding='utf-8'))
    for item in (upstream, release):
        if not re.fullmatch('[a-f0-9]{40}', item.get('commit', '')):
            raise ValueError('Upstream commit must be pinned')
    if not re.fullmatch('[a-f0-9]{64}', release.get('windowsInstallerSha256', '')):
        raise ValueError('Next installer checksum must be pinned')
    return {'frontend_source_fingerprint': value, 'desktop_source': upstream, 'desktop_installer': release}


def verify(report):
    if (report.get('schema_version') != SCHEMA or report.get('ok') is not True
            or not report.get('checks') or not all(c.get('ok') is True for c in report['checks'])
            or {c.get('id') for c in report['checks']} != {s[0] for s in SUITES}):
        raise ValueError('A complete passing platform report is required')
    validate_assets()
    if report.get('fingerprint') != fingerprint()[0]:
        raise ValueError('Source or built assets changed; run the gate again')
    return True


def check():
    before, files = fingerprint()
    pinned = provenance()
    try:
        pinned['assets_and_upstream'] = validate_assets()
        assets_ok = True
    except (OSError, ValueError, KeyError) as error:
        pinned['assets_error'] = str(error)
        assets_ok = False
    checks = []
    for name, command in SUITES:
        try:
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=240)
            checks.append({'id': name, 'ok': result.returncode == 0, 'exit_code': result.returncode,
                           'summary': (result.stdout + result.stderr)[-6000:]})
        except (OSError, subprocess.TimeoutExpired) as error:
            checks.append({'id': name, 'ok': False, 'summary': type(error).__name__})
    after, _ = fingerprint()
    return {'schema_version': SCHEMA, 'created_at': time.time(), 'fingerprint': before,
            'files': files, 'provenance': pinned, 'checks': checks,
            'ok': assets_ok and before == after and all(item['ok'] for item in checks)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'verify', 'candidate'])
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--candidate', type=Path)
    args = parser.parse_args()
    if args.action == 'check':
        report = check()
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'ok': report['ok'], 'report': str(args.report), 'fingerprint': report['fingerprint']}))
        raise SystemExit(0 if report['ok'] else 1)
    report = json.loads(args.report.read_text(encoding='utf-8'))
    verify(report)
    if args.action == 'candidate':
        if args.candidate is None:
            parser.error('--candidate is required')
        value = {'schema_version': SCHEMA, 'fingerprint': report['fingerprint'], 'report_sha256': digest(args.report), 'created_at': time.time()}
        with args.candidate.open('x', encoding='utf-8') as out:
            json.dump(value, out, indent=2)
    elif args.candidate:
        candidate = json.loads(args.candidate.read_text(encoding='utf-8'))
        if candidate.get('schema_version') != SCHEMA or candidate.get('fingerprint') != report['fingerprint'] or candidate.get('report_sha256') != digest(args.report):
            raise ValueError('Candidate is not bound to the current passing report')
    print('Platform gate passed')


if __name__ == '__main__':
    main()
