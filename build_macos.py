"""Build a native macOS .app and package it without local settings or recordings."""
import hashlib
import importlib.metadata
import importlib.util
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

from app_version import APP_VERSION


ROOT = Path(__file__).resolve().parent


def copy_notices(destination):
    packages = (
        'numpy', 'pandas', 'python-dateutil', 'six', 'tzdata', 'Pillow', 'fastapi', 'uvicorn',
        'PyInstaller', 'pywebview', 'pyobjc-core', 'pyobjc-framework-Cocoa',
        'pyobjc-framework-Quartz', 'pyobjc-framework-WebKit', 'pyobjc-framework-security',
        'pyobjc-framework-UniformTypeIdentifiers', 'PyMySQL', 'cryptography', 'pypdf',
        'openpyxl', 'python-docx',
    )
    for package in packages:
        try:
            distribution = importlib.metadata.distribution(package)
        except importlib.metadata.PackageNotFoundError:
            continue
        for entry in distribution.files or ():
            if entry.is_absolute() or '..' in entry.parts:
                continue
            if not any(word in entry.name.lower() for word in ('license', 'copying', 'notice')):
                continue
            source = distribution.locate_file(entry)
            if source.is_file():
                target = destination / package / entry
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
    frontend = ROOT / 'page_design' / 'frontend' / 'node_modules'
    for package in ('react', 'react-dom', 'antd', '@ant-design/icons', 'echarts', 'zrender'):
        for name in ('LICENSE', 'LICENSE.txt', 'NOTICE'):
            source = frontend / package / name
            if source.is_file():
                target = destination / 'frontend' / package / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
    for name in ('LICENSE.txt', 'LICENSE'):
        source = Path(sys.base_prefix) / name
        if source.is_file():
            destination.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination / f'Python-{name}')


def main():
    arch = platform.machine()
    if sys.platform != 'darwin' or arch not in ('arm64', 'x86_64'):
        raise SystemExit('请在 Apple Silicon 或 Intel Mac 上用对应架构的 Python 构建。')
    if not (ROOT / 'page_design/web/index.html').is_file():
        raise SystemExit('请先在 page_design/frontend 安装依赖并执行 pnpm build。')
    if any(importlib.util.find_spec(module) is None for module in ('webview', 'AppKit', 'WebKit')):
        raise SystemExit('缺少 macOS 桌面依赖。请安装 requirements-macos.txt。')

    work = ROOT / 'build' / f'macos-{arch}'
    dist = ROOT / 'dist' / f'macos-{arch}'
    env = {**os.environ, 'PYINSTALLER_CONFIG_DIR': str(work / 'cache')}
    subprocess.run([
        sys.executable, '-m', 'PyInstaller', '--noconfirm',
        '--distpath', str(dist), '--workpath', str(work), str(ROOT / 'desktop/macos.spec'),
    ], cwd=ROOT, env=env, check=True)

    bundle = dist / 'Somnus.app'
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    archive = output / f'Somnus-{APP_VERSION}-macos-{arch}.zip'
    with tempfile.TemporaryDirectory(dir=output, prefix='.macos-build-') as temp:
        staging = Path(temp) / 'package'
        staging.mkdir()
        subprocess.run(['/usr/bin/ditto', str(bundle), str(staging / bundle.name)], check=True)
        shutil.copyfile(ROOT / 'USER_GUIDE.md', staging / '使用说明.txt')
        copy_notices(staging / 'THIRD_PARTY_LICENSES')
        candidate = Path(temp) / archive.name
        # Preserve the framework/resource links and executable modes inside .app.
        subprocess.run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', str(staging), str(candidate)], check=True)
        with candidate.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        checksum = Path(temp) / (archive.name + '.sha256')
        checksum.write_text(f'{digest}  {archive.name}\n', encoding='ascii')
        candidate.replace(archive)
        checksum.replace(output / checksum.name)
    print(archive)


if __name__ == '__main__':
    main()
