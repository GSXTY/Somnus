"""Local paths shared by the desktop launcher and API host."""
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]


def _windows_profile_parent():
    local_app_data = os.getenv('LOCALAPPDATA')
    return (Path(local_app_data) if local_app_data else Path.home()) / 'VVFLY'


def default_data_dir():
    configured = os.getenv('AI_AGENT_DATA_DIR')
    if configured:
        return Path(configured).expanduser().resolve()
    if not getattr(sys, 'frozen', False):
        return ROOT / 'data'
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'VVFLY' / 'RespiratoryViewer'
    if sys.platform == 'win32':
        return _windows_profile_parent() / 'Somnus'
    return _windows_profile_parent() / 'RespiratoryViewer'


def profile_env_dir():
    """Find the first-start config before its explicit data directory is known."""
    target = default_data_dir()
    if (getattr(sys, 'frozen', False) and sys.platform == 'win32'
            and not os.getenv('AI_AGENT_DATA_DIR') and not os.path.lexists(target)):
        return target.with_name('RespiratoryViewer')
    return target


def _reject_directory_links(folder, names):
    # Don't follow links or junctions into unrelated user directories.
    for name in names:
        path = Path(folder) / name
        if path.is_symlink() or path.is_junction():
            raise OSError('旧配置目录包含链接或目录重解析点。')
    return ()


def prepare_default_data_dir():
    """Seed a Windows profile once, leaving the old profile available for rollback."""
    target = default_data_dir()
    if (not getattr(sys, 'frozen', False) or sys.platform != 'win32'
            or os.getenv('AI_AGENT_DATA_DIR') or os.path.lexists(target)):
        return target

    legacy = target.with_name('RespiratoryViewer')
    if not legacy.is_dir():
        return target
    if legacy.is_symlink() or legacy.is_junction():
        raise OSError('旧配置目录是链接或目录重解析点。')

    # The desktop single-instance lock is held in the unchanged roaming profile,
    # so the old desktop backend has already closed when this copy starts.
    with TemporaryDirectory(prefix='.somnus-profile-', dir=target.parent) as temporary:
        staged = Path(temporary) / target.name
        shutil.copytree(legacy, staged, ignore=_reject_directory_links)
        try:
            # A Windows directory rename publishes the complete profile and
            # cannot overwrite a destination another launch already created.
            staged.rename(target)
        except FileExistsError:
            if not target.is_dir():
                raise
    return target
