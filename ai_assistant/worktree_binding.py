"""Read guarded Git worktree registration metadata without invoking Git."""
from contextlib import ExitStack
import os
from pathlib import Path
import re

from .project_files import ProjectFileError, _directories, _locked_directory, _read


def _match(left, right):
    return os.path.normcase(os.path.normpath(left)) == os.path.normcase(os.path.normpath(right))


def _metadata(path):
    return _read(path, limit=4096, allow_hidden=True)[0].strip()


def _path(text, parent):
    if not text or len(text) > 500 or any(ord(char) < 32 for char in text):
        raise ValueError('invalid Git metadata')
    candidate = Path(text)
    if not candidate.is_absolute():
        candidate = parent / candidate
    return Path(os.path.normpath(candidate))


def verify(base, root, *, branch=None, commit=None):
    base, root = Path(base), Path(root)
    try:
        with _directories(base, base), _directories(root, root):
            known_base, known_root = base, root
            base, root = base.resolve(strict=True), root.resolve(strict=True)
            admin_dir = base / '.git' / 'worktrees'
            dotgit = root / '.git'
            pointer = _metadata(dotgit)
            if not pointer.startswith('gitdir: '):
                return False
            admin = _path(pointer[len('gitdir: '):], root)
            if (not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', admin.name)
                    or not any(_match(admin.parent, candidate / '.git' / 'worktrees')
                               for candidate in (base, known_base))):
                return False
            # Guard the Git admin directories individually. Project file policy
            # otherwise deliberately excludes paths starting with a dot.
            with ExitStack() as stack:
                admin = admin_dir / admin.name
                for folder in (base / '.git', admin_dir, admin):
                    stack.enter_context(_locked_directory(folder, allow_hidden=True))
                linked_git = _path(_metadata(admin / 'gitdir'), admin)
                common = _path(_metadata(admin / 'commondir'), admin)
                if (not any(_match(linked_git, candidate / '.git') for candidate in (root, known_root))
                        or not any(_match(common, candidate / '.git') for candidate in (base, known_base))):
                    return False
                if branch is None:
                    return True
                if _metadata(admin / 'HEAD') != 'ref: refs/heads/' + branch:
                    return False
                heads = base / '.git' / 'refs' / 'heads'
                for folder in (heads.parent, heads, heads / 'vvman'):
                    stack.enter_context(_locked_directory(folder, allow_hidden=True))
                return _metadata(heads / branch) == commit
    except (OSError, ValueError, ProjectFileError):
        return False
