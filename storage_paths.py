"""Development outputs outside the source tree; never a user-profile location."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def storage_root(project_root=ROOT):
    project_root = Path(project_root).resolve()
    configured = os.environ.get('SOMNUS_DEV_STORAGE')
    result = Path(configured).expanduser().resolve() if configured else project_root.with_name(project_root.name + '-Storage')
    if result == project_root or project_root in result.parents:
        raise ValueError('SOMNUS_DEV_STORAGE must be outside the source tree')
    return result

def artifact_path(*parts, project_root=ROOT):
    return storage_root(project_root) / 'artifacts' / Path(*parts)

def cache_path(*parts, project_root=ROOT):
    return storage_root(project_root) / 'cache' / Path(*parts)

def backups_path(*parts, project_root=ROOT):
    return storage_root(project_root) / 'backups' / 'local' / Path(*parts)
