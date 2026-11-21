"""Build the Electron desktop app and its bundled local service on this OS."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

from app_version import APP_VERSION
from storage_paths import artifact_path
from build_macos import copy_notices


ROOT = Path(__file__).resolve().parent
ELECTRON = ROOT / 'electron'
BUILD = artifact_path('build', 'electron')


def build_backend():
    if not (ROOT / 'page_design/web/index.html').is_file():
        raise SystemExit('请先在 page_design/frontend 安装依赖并执行 pnpm build。')
    receipt = BUILD / 'backend' / 'SomnusBackend' / 'somnus-backend-build.json'
    receipt.unlink(missing_ok=True)
    env = {**os.environ, 'PYINSTALLER_CONFIG_DIR': str(BUILD / 'pyinstaller-cache')}
    subprocess.run([
        sys.executable, '-m', 'PyInstaller', '--noconfirm',
        '--distpath', str(BUILD / 'backend'), '--workpath', str(BUILD / 'work'),
        str(ROOT / 'desktop/electron_backend.spec'),
    ], cwd=ROOT, env=env, check=True)
    receipt.write_text(json.dumps({
        'schemaVersion': 1, 'producer': 'SomnusNext PyInstaller', 'sourceVersion': APP_VERSION,
    }, indent=2) + '\n', encoding='utf-8')


def build_shell(directory_only, runtime):
    package = json.loads((ELECTRON / 'package.json').read_text(encoding='utf-8'))
    if package['version'] != APP_VERSION:
        raise SystemExit('electron/package.json 与 app_version.py 的版本不一致。')
    pnpm = shutil.which('pnpm')
    if pnpm is None:
        raise SystemExit('请安装 pnpm，并先在 electron 目录安装打包依赖。')
    backend_name = 'SomnusBackend.exe' if sys.platform == 'win32' else 'SomnusBackend'
    if not (BUILD / 'backend' / 'SomnusBackend' / backend_name).is_file():
        raise SystemExit('请先构建同架构的本地服务。')
    notices = BUILD / 'THIRD_PARTY_LICENSES'
    notices.mkdir(parents=True, exist_ok=True)
    copy_notices(notices)
    command = [pnpm, 'exec', 'electron-builder', '--publish', 'never', '--config', str(ELECTRON / 'electron-builder.config.cjs'),
               '--arm64' if platform.machine() == 'arm64' else '--x64']
    if directory_only:
        command.append('--dir')
    if runtime:
        command.append(f'--config.electronDist={runtime.resolve()}')
    env = {
        **os.environ,
        'ELECTRON_CACHE': str(BUILD / 'electron-cache'),
        'ELECTRON_BUILDER_CACHE': str(BUILD / 'builder-cache'),
        'CSC_IDENTITY_AUTO_DISCOVERY': 'false',
    }
    subprocess.run(command, cwd=ELECTRON, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', action='store_true', help='只打包可运行目录，不生成安装包或 ZIP。')
    parser.add_argument('--backend-only', action='store_true', help='只构建本地服务。')
    parser.add_argument('--shell-only', action='store_true', help='使用之前构建的本地服务，只打包 Electron。')
    parser.add_argument('--runtime', type=Path, help='可选，指定已解压的官方 Electron 运行时目录。')
    parser.add_argument('--next-extracted', type=Path, help='解包后的 DSH Next Windows 应用目录')
    parser.add_argument('--next-installer', type=Path, help='用于比对上游版本和校验值的 DSH Next 安装文件')
    args = parser.parse_args()
    supported = (sys.platform == 'win32' and platform.machine().lower() in ('amd64', 'x86_64')) or (
        sys.platform == 'darwin' and platform.machine() in ('arm64', 'x86_64')
    )
    if not supported:
        parser.error('请使用 64 位 Windows 或对应架构的 macOS Python 构建。')
    if args.backend_only and args.shell_only:
        parser.error('--backend-only 与 --shell-only 只能选择一个。')
    if bool(args.next_extracted) != bool(args.next_installer):
        parser.error('--next-extracted 和 --next-installer 需要一起提供')
    if args.next_extracted and (sys.platform != 'win32' or args.backend_only or args.runtime):
        parser.error('DSH Next 构建需要 Windows，且不能同时使用 --backend-only 或 --runtime')
    subprocess.run([sys.executable, str(ROOT / 'tools/platform_gate.py'), 'check',
                    '--report', str(BUILD / 'platform-gate.json')], cwd=ROOT, check=True)
    if not args.shell_only:
        build_backend()
    if args.next_extracted:
        subprocess.run([
            'node', str(ROOT / 'desktop/dsh_next/stage-next.mjs'),
            str(args.next_extracted.resolve()), str(BUILD / 'backend' / 'SomnusBackend'),
            str(args.next_installer.resolve()),
        ], cwd=ROOT, check=True)
    elif not args.backend_only:
        build_shell(args.dir, args.runtime)


if __name__ == '__main__':
    main()
