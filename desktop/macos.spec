"""PyInstaller configuration for the native macOS window."""
from pathlib import Path
import platform
import runpy


ROOT = Path(SPECPATH).parent
version = runpy.run_path(str(ROOT / 'app_version.py'))['APP_VERSION']
assets = {
    'event_detection': ('index.html', 'viewer.js', 'annotation-model.js'),
    'page_design': (
        'dashboard.html', 'dashboard.js', 'dashboard.css', 'events.css',
        'vendor/bootstrap.min.css', 'vendor/bootstrap.LICENSE', 'web/index.html',
    ),
    'plugins/respiratory': ('plugin.json', 'tools.py'),
    'skills': ('defaults.json',),
    'skills/project-handoff': ('SKILL.md', 'LICENSE', 'agents/openai.yaml'),
}
datas = [
    (str(ROOT / directory / item), str(Path(directory) / Path(item).parent))
    for directory, items in assets.items()
    for item in items
]
datas.append((str(ROOT / 'page_design/web/assets'), 'page_design/web/assets'))

analysis = Analysis(
    [str(ROOT / 'launcher.py')],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=['webview.platforms.cocoa', 'plugins.respiratory.tools'],
    excludes=['matplotlib', 'scipy', 'IPython', 'pytest', 'torch', 'tkinter'],
)
exe = EXE(
    PYZ(analysis.pure), analysis.scripts,
    name='Somnus', exclude_binaries=True, console=False,
    upx=False, target_arch=platform.machine(),
)
app = BUNDLE(
    exe, analysis.binaries, analysis.datas,
    name='Somnus.app', bundle_identifier='com.vvfly.respiratoryviewer',
    version=version.split('-', 1)[0],
    info_plist={
        'CFBundleDisplayName': 'Somnus',
        'NSAppTransportSecurity': {
            'NSAllowsLocalNetworking': True,
            'NSExceptionDomains': {
                '127.0.0.1': {'NSExceptionAllowsInsecureHTTPLoads': True},
            },
        },
    },
)
