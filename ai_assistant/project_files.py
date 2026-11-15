"""Bounded project text access and guarded, atomic replacements."""
from collections import deque
from contextlib import ExitStack, contextmanager
import ctypes
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import stat
import tempfile
import time


MAX_TEXT_BYTES = 48 * 1024
MAX_LIST = 200
MAX_SEARCH_QUERY = 200
MAX_SEARCH_ENTRIES = 6000
MAX_SEARCH_PER_DIRECTORY = 1500
MAX_SEARCH_DIRECTORIES = 400
MAX_SEARCH_BYTES = 8 * 1024 * 1024
MAX_SEARCH_FILE_BYTES = 512 * 1024
MAX_SEARCH_MATCHES = 40
MAX_SEARCH_RESULT_BYTES = 24 * 1024
SEARCH_SECONDS = 6
SNIPPET_LENGTH = 240
REPARSE_POINT = 0x400
HIDDEN_OR_SYSTEM = 0x6
SKIP_DIRS = {'__pycache__', 'node_modules', 'vendor', 'dist', 'build', 'secrets', 'credentials'}
TEXT_EXTENSIONS = {
    '.c', '.cc', '.cfg', '.cjs', '.cpp', '.cs', '.css', '.cts', '.go', '.h', '.hpp', '.html',
    '.ini', '.java', '.js', '.json', '.jsx', '.kt', '.md', '.mjs', '.mts', '.ps1', '.py',
    '.pyi', '.r', '.rb', '.rs', '.sh', '.sql', '.swift', '.toml', '.ts', '.tsx', '.txt',
    '.vue', '.xml', '.yaml', '.yml',
}
TEXT_NAMES = {'dockerfile', 'license', 'makefile', 'readme'}
SECRET_NAMES = re.compile(r'(?:^|[_.-])(?:api[-_]?keys?|passwords?|tokens?|secrets?|credentials?|private[-_]?keys?)(?:[_.-]|$)', re.I)
FORBIDDEN_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f\ud800-\udfff]')
IS_RESERVED = getattr(os.path, 'isreserved', None)
SEARCH_PRIVATE_NAMES = {'private', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'}
GENERATED_NAMES = {'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'}
GENERATED_FILE = re.compile(r'\.(?:min|generated)\.[^.]+$', re.I)
GENERATED_HEADER = re.compile(
    r'^\s*(?://|#|/\*|\*|<!--)\s*(?:@generated|code generated[^\n]*do not edit|'
    r'automatically generated[^\n]*do not edit)', re.I | re.M)
BINARY_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


class ProjectFileError(Exception):
    def __init__(self, message, *, code='project_file', status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def _blocked(name):
    return (name.startswith('.') or name.casefold() in SKIP_DIRS or SECRET_NAMES.search(name)
            or FORBIDDEN_CHARS.search(name) or name.endswith((' ', '.'))
            or (IS_RESERVED(name) if IS_RESERVED else PureWindowsPath(name).is_reserved()))


def _text_file(name):
    return Path(name).suffix.casefold() in TEXT_EXTENSIONS or name.casefold() in TEXT_NAMES


def _parts(value, *, allow_root=False):
    if value in (None, '', '.') and allow_root:
        return ()
    if not isinstance(value, str) or not value or len(value) > 500:
        raise ProjectFileError('请提供项目内的相对路径。')
    parts = value.replace('\\', '/').split('/')
    if any(not name or _blocked(name) for name in parts):
        raise ProjectFileError('该路径超出项目文件访问范围。', code='file_access_denied', status=403)
    return tuple(parts)


def _identity(info):
    return f'{info.st_dev}:{info.st_ino}'


def _checked(info, *, directory, allow_hidden=False):
    attributes = getattr(info, 'st_file_attributes', 0)
    valid = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    blocked_attributes = REPARSE_POINT if allow_hidden else REPARSE_POINT | HIDDEN_OR_SYSTEM
    if not valid or attributes & blocked_attributes or (not directory and info.st_nlink != 1):
        raise ProjectFileError('该路径包含链接、隐藏项或不支持的文件类型。', code='file_access_denied', status=403)
    return info


@contextmanager
def _locked_directory(path, *, allow_hidden=False):
    if os.name != 'nt':
        _checked(path.lstat(), directory=True, allow_hidden=allow_hidden)
        yield
        return
    # Hold handles without FILE_SHARE_DELETE. Each ancestor stays in place while a
    # descendant is opened or replaced. Open the reparse point itself for inspection.
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                       wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    create.restype = wintypes.HANDLE
    close = kernel.CloseHandle
    close.argtypes = (wintypes.HANDLE,)
    close.restype = wintypes.BOOL
    handle = create(str(path), 0x80, 3, None, 3, 0x02200000, None)
    if handle in (None, ctypes.c_void_p(-1).value):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        info = path.lstat()
        _checked(info, directory=True, allow_hidden=allow_hidden)
        yield
    finally:
        close(handle)


@contextmanager
def _directories(path, project):
    with ExitStack() as stack:
        current = Path(path.anchor)
        stack.enter_context(_locked_directory(current, allow_hidden=True))
        for name in path.parts[1:]:
            if _blocked(name):
                raise ProjectFileError('该目录不在项目文件访问范围内。', code='file_access_denied', status=403)
            current /= name
            stack.enter_context(_locked_directory(current, allow_hidden=len(current.parts) < len(project.parts)))
        yield


def validate_root(value):
    if not isinstance(value, str) or not value or len(value) > 500:
        raise ProjectFileError('请选择一个有效的本地项目目录。')
    path = Path(value)
    if not path.is_absolute() or len(path.parts) < 2:
        raise ProjectFileError('请选择本地磁盘上的具体项目目录。')
    if os.name == 'nt':
        if not re.fullmatch(r'[A-Za-z]:', path.drive) or ctypes.windll.kernel32.GetDriveTypeW(path.anchor) != 3:
            raise ProjectFileError('项目目录必须位于本地磁盘。')
    try:
        with _directories(path, path):
            return str(path), _identity(path.lstat())
    except OSError as exc:
        raise ProjectFileError('无法访问所选项目目录。', code='project_folder_unavailable', status=409) from exc


@contextmanager
def _inside(root, relative_parts, *, directory):
    root_path, expected = root
    project = Path(root_path)
    target = project.joinpath(*relative_parts)
    locked_path = target if directory else target.parent
    try:
        with _directories(locked_path, project):
            if _identity(project.lstat()) != expected:
                raise ProjectFileError('项目目录已变更，请重新选择目录。', code='project_folder_changed', status=409)
            yield target
    except OSError as exc:
        raise ProjectFileError('项目文件或目录不可访问。', code='file_unavailable', status=409) from exc


def accessible_roots(roots):
    accessible = {}
    for source, root in roots.items():
        try:
            with _inside(root, (), directory=True):
                accessible[source] = root
        except ProjectFileError:
            continue
    return accessible


def list_files(root, path=None):
    parts = _parts(path, allow_root=True)
    entries = []
    with _inside(root, parts, directory=True) as target, os.scandir(target) as children:
        for index, entry in enumerate(children):
            if index >= MAX_LIST * 10 or len(entries) >= MAX_LIST:
                return {'entries': entries, 'truncated': True}
            if _blocked(entry.name):
                continue
            try:
                info = Path(entry.path).lstat()
                directory = stat.S_ISDIR(info.st_mode)
                _checked(info, directory=directory)
            except (OSError, ProjectFileError):
                continue
            if directory or (_text_file(entry.name) and info.st_size <= MAX_TEXT_BYTES):
                entries.append({'path': '/'.join((*parts, entry.name)), 'type': 'folder' if directory else 'file'})
    return {'entries': sorted(entries, key=lambda item: (item['type'] != 'folder', item['path'].casefold())), 'truncated': False}


@contextmanager
def _open_file(target):
    if os.name != 'nt':
        fd = os.open(target, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    else:
        import msvcrt
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        create = kernel.CreateFileW
        create.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                           wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
        create.restype = wintypes.HANDLE
        handle = create(str(target), 0x80000000, 7, None, 3, 0x00200000, None)
        if handle in (None, ctypes.c_void_p(-1).value):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except OSError:
            close = kernel.CloseHandle
            close.argtypes = (wintypes.HANDLE,)
            close(handle)
            raise
    with os.fdopen(fd, 'rb', buffering=0) as stream:
        yield stream


def _read(target, *, limit=MAX_TEXT_BYTES, allow_hidden=False):
    before = _checked(target.lstat(), directory=False, allow_hidden=allow_hidden)
    with _open_file(target) as stream:
        current = _checked(os.fstat(stream.fileno()), directory=False, allow_hidden=allow_hidden)
        if not os.path.samestat(before, current):
            raise ProjectFileError('文件已变更，请重试。', code='file_changed', status=409)
        raw = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    _checked(after, directory=False, allow_hidden=allow_hidden)
    if (current.st_size, current.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ProjectFileError('文件已变更，请重试。', code='file_changed', status=409)
    if len(raw) > limit or b'\0' in raw:
        raise ProjectFileError(f'仅支持不超过 {limit // 1024} KiB 的 UTF-8 文本文件。')
    try:
        return raw.decode('utf-8'), hashlib.sha256(raw).hexdigest(), current
    except UnicodeDecodeError as exc:
        raise ProjectFileError('仅支持 UTF-8 文本文件。') from exc


def read_file(root, path):
    parts = _parts(path)
    if not _text_file(parts[-1]):
        raise ProjectFileError('该文件类型不在项目文本访问范围内。')
    with _inside(root, parts, directory=False) as target:
        content, digest, info = _read(target)
    return '/'.join(parts), content, digest, _identity(info)


def _search_blocked(name):
    return _blocked(name) or name.casefold() in SEARCH_PRIVATE_NAMES


def _searchable_content(name):
    return _text_file(name) and name.casefold() not in GENERATED_NAMES and not GENERATED_FILE.search(name)


def _snippet(line, start, end):
    left = max(0, start - (SNIPPET_LENGTH - (end - start)) // 2)
    right = min(len(line), left + SNIPPET_LENGTH)
    left = max(0, right - SNIPPET_LENGTH)
    return ('…' if left else '') + line[left:right] + ('…' if right < len(line) else '')


def _matching_lines(content, pattern, stopped):
    if BINARY_CONTROL.search(content) or GENERATED_HEADER.search(content[:2048]):
        return
    for number, line in enumerate(content.splitlines(), 1):
        if number % 128 == 0 and stopped():
            return
        match = pattern.search(line)
        if match:
            yield number, _snippet(line, *match.span())


def search_files(roots, query, mode, path, cancelled):
    if (not isinstance(query, str) or not query.strip() or len(query) > MAX_SEARCH_QUERY
            or query.splitlines() != [query] or BINARY_CONTROL.search(query)):
        raise ProjectFileError(f'请输入不超过 {MAX_SEARCH_QUERY} 个字符的单行搜索词。')
    if mode not in ('name', 'content'):
        raise ProjectFileError('搜索方式须为 name 或 content。')
    start_parts = _parts(path, allow_root=True)
    if any(_search_blocked(name) for name in start_parts):
        raise ProjectFileError('该目录不在项目文件访问范围内。', code='file_access_denied', status=403)
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    deadline = time.monotonic() + SEARCH_SECONDS
    pending = deque((source, root, start_parts) for source, root in roots.items())
    result = {'mode': mode, 'matches': [], 'truncated': False}
    entries = directories = bytes_read = 0
    result_bytes = 80

    def stopped():
        return cancelled() or time.monotonic() >= deadline

    while pending:
        if stopped() or directories >= MAX_SEARCH_DIRECTORIES:
            result['truncated'] = True
            break
        source, root, parts = pending.popleft()
        directories += 1
        try:
            with _inside(root, parts, directory=True) as target, os.scandir(target) as children:
                for index, entry in enumerate(children):
                    if stopped() or entries >= MAX_SEARCH_ENTRIES:
                        return dict(result, truncated=True)
                    entries += 1
                    if index >= MAX_SEARCH_PER_DIRECTORY:
                        result['truncated'] = True
                        break
                    if _search_blocked(entry.name):
                        continue
                    relative = (*parts, entry.name)
                    relative_path = '/'.join(relative)
                    if len(relative_path) > 500:
                        result['truncated'] = True
                        continue
                    try:
                        child = target / entry.name
                        info = child.lstat()
                        directory = stat.S_ISDIR(info.st_mode)
                        _checked(info, directory=directory)
                        if directory:
                            pending.append((source, root, relative))
                            continue
                        candidate = {'source': source, 'path': relative_path}
                        if mode == 'name':
                            found = (candidate,) if pattern.search(entry.name) else ()
                        elif _searchable_content(entry.name):
                            if info.st_size > MAX_SEARCH_FILE_BYTES:
                                result['truncated'] = True
                                continue
                            # Limit the actual read even if the file grows since lstat.
                            size = info.st_size
                            if bytes_read + size + 1 > MAX_SEARCH_BYTES:
                                return dict(result, truncated=True)
                            bytes_read += size + 1
                            content, _, _ = _read(child, limit=size)
                            found = (dict(candidate, line=line, snippet=snippet)
                                     for line, snippet in _matching_lines(content, pattern, stopped))
                        else:
                            continue
                        for match in found:
                            result_bytes += len(json.dumps(match, ensure_ascii=False).encode('utf-8')) + 2
                            if result_bytes > MAX_SEARCH_RESULT_BYTES or len(result['matches']) >= MAX_SEARCH_MATCHES:
                                return dict(result, truncated=True)
                            result['matches'].append(match)
                    except (OSError, ProjectFileError):
                        continue
        except (OSError, ProjectFileError) as exc:
            if parts == start_parts:
                if isinstance(exc, ProjectFileError):
                    raise
                raise ProjectFileError('项目目录不可访问。', code='file_unavailable', status=409) from exc
            result['truncated'] = True
    result['truncated'] |= stopped()
    return result


def replacement(value):
    if not isinstance(value, str) or '\0' in value:
        raise ProjectFileError('建议内容必须是 UTF-8 文本。')
    try:
        raw = value.encode('utf-8')
    except UnicodeEncodeError as exc:
        raise ProjectFileError('建议内容必须是 UTF-8 文本。') from exc
    if len(raw) > MAX_TEXT_BYTES:
        raise ProjectFileError('建议内容不能超过 48 KiB。')
    return raw


def apply_file(root, path, new_content, *, expected_hash, expected_identity):
    parts = _parts(path)
    if not _text_file(parts[-1]):
        raise ProjectFileError('该文件类型不在项目文本访问范围内。')
    raw = replacement(new_content)
    with _inside(root, parts, directory=False) as target:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.data-agent-', delete=False) as temporary:
            staged = Path(temporary.name)
            try:
                temporary.write(raw)
                temporary.flush()
                os.fsync(temporary.fileno())
            except BaseException:
                temporary.close()
                staged.unlink(missing_ok=True)
                raise
        try:
            _, current, info = _read(target)
            if current != expected_hash or _identity(info) != expected_identity:
                raise ProjectFileError('文件已变更，请重新生成修改建议。', code='file_changed', status=409)
            os.chmod(staged, stat.S_IMODE(info.st_mode))
            os.replace(staged, target)
        finally:
            staged.unlink(missing_ok=True)
