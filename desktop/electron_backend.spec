"""Freeze the shared local service as a headless Electron child process."""
from pathlib import Path
import platform
import sys


ROOT = Path(SPECPATH).parent
assets = {
    'event_detection': ('index.html', 'viewer.js', 'annotation-model.js'),
    'page_design': (
        'dashboard.html', 'dashboard.js', 'dashboard.css', 'events.css',
        'vendor/bootstrap.min.css', 'vendor/bootstrap.LICENSE', 'web/index.html',
    ),
    'plugins/respiratory': ('plugin.json', 'tools.py'),
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
    hiddenimports=['plugins.respiratory.tools', 'sqlglot.dialects.sqlite', 'sqlglot.dialects.mysql'],
    excludes=['webview', 'matplotlib', 'scipy', 'IPython', 'pytest', 'torch', 'tkinter'],
)
exe = EXE(
    PYZ(analysis.pure), analysis.scripts,
    name='SomnusBackend', exclude_binaries=True, console=True, upx=False,
    target_arch=platform.machine() if sys.platform == 'darwin' else None,
)
bundle = COLLECT(exe, analysis.binaries, analysis.datas, name='SomnusBackend', upx=False)
