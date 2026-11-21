"""Read-only shared documents and owner-controlled personal documents."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import shutil
import sys
import time


ROOT = Path(__file__).resolve().parents[1]


MAX_FOLDER_ENTRIES = 2000
MAX_IMPORT_FILES = 16
MAX_IMPORT_BYTES = 40 * 1024 * 1024
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PATH_LENGTH = 1024
MAX_PATH_PARTS = 21
NEW_FILE_SUFFIXES = {'.txt', '.md', '.markdown', '.csv', '.tsv'}
TEXT_SUFFIXES = {
    '.txt', '.md', '.markdown', '.log', '.json', '.yaml', '.yml', '.csv', '.tsv',
    '.py', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.go',
    '.rs', '.sql', '.sh', '.bat', '.ps1', '.ini', '.toml', '.conf', '.html', '.htm', '.xml',
}
FILE_TYPES = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docm': 'application/vnd.ms-word.document.macroenabled.12',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsm': 'application/vnd.ms-excel.sheet.macroenabled.12',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
}
NAME = re.compile(r'^[^<>:"/\\|?*\u0000-\u001f.][^<>:"/\\|?*\u0000-\u001f]*$')
RESERVED = re.compile(r'^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9]|lpt[1-9])(?:\s*\.|$)', re.I)


class DocumentLibraryError(ValueError):
    def __init__(self, message, code='document_error', status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def _valid_name(name):
    return (isinstance(name, str) and 1 <= len(name) <= 180 and name.strip() == name
            and not name.startswith('.') and not name.endswith('.')
            and NAME.fullmatch(name) is not None and RESERVED.match(name) is None)


def _parts(relative):
    if relative in ('', None):
        return []
    if not isinstance(relative, str) or len(relative) > MAX_PATH_LENGTH:
        raise DocumentLibraryError('无效的文档库路径。')
    parts = relative.split('/')
    if len(parts) > MAX_PATH_PARTS or not all(_valid_name(part) for part in parts):
        raise DocumentLibraryError('无效的文档库路径。')
    return parts


def _within(base, target):
    try:
        target.relative_to(base)
        return True
    except ValueError:
        return False


def _file_type(name):
    suffix = Path(name).suffix.lower()
    mime = FILE_TYPES.get(suffix) or ('text/plain' if suffix in TEXT_SUFFIXES else None)
    if not mime:
        return None
    return mime, (5 * 1024 * 1024 if mime.startswith('image/') else MAX_FILE_BYTES)


def _shared_root():
    configured = Path(__file__).resolve().parents[1] / 'shared-documents'
    if getattr(sys, 'frozen', False):
        beside = Path(sys.executable).resolve().parent.parent / 'shared-documents'
        return beside if beside.is_dir() else configured
    return configured


class DocumentLibrary:
    def __init__(self, personal=None, shared=None):
        configured = personal or os.getenv('SOMNUS_DOCUMENTS_DIR')
        self.personal = Path(configured).expanduser().resolve() if configured else ROOT / 'data' / 'documents'
        configured_shared = shared or os.getenv('SOMNUS_SHARED_DOCUMENTS_DIR')
        self.shared = Path(configured_shared).expanduser().resolve() if configured_shared else _shared_root()

    def _root(self, scope, missing_shared=False):
        if scope == 'private':
            self.personal.mkdir(parents=True, exist_ok=True)
            return self.personal
        if scope != 'shared':
            raise DocumentLibraryError('请选择有效的文档区。')
        root = self.shared
        if not root.exists():
            if missing_shared:
                return None
            raise DocumentLibraryError('尚未配置共享文档库。', 'shared_unavailable', 404)
        if root.is_symlink() or not root.is_dir():
            raise DocumentLibraryError('共享文档目录无法访问。', 'shared_unavailable', 503)
        return root

    def _locate(self, scope, relative, kind, missing_shared=False):
        parts = _parts(relative)
        root = self._root(scope, missing_shared)
        if root is None:
            return None
        canonical = root.resolve()
        target = canonical
        for part in parts:
            target = target / part
            if target.is_symlink():
                raise DocumentLibraryError('文档区无法读取链接或区外路径。')
            if not _within(canonical, target.resolve()):
                raise DocumentLibraryError('文档区无法读取链接或区外路径。')
        if kind == 'folder' and not target.is_dir():
            raise DocumentLibraryError('请选择有效的文件夹。', 'invalid_document_path', 404)
        if kind == 'file' and not target.is_file():
            raise DocumentLibraryError('请选择有效的文件。', 'invalid_document_path', 404)
        return target

    def list(self, scope, folder=''):
        target = self._locate(scope, folder, 'folder', missing_shared=True)
        if target is None:
            return {'folder': folder, 'entries': [], 'configured': False}
        entries = []
        for item in target.iterdir():
            if len(entries) >= MAX_FOLDER_ENTRIES:
                raise DocumentLibraryError('文件夹中的项目太多，请分到子文件夹。')
            if item.name.startswith('.') or item.is_symlink() or not _valid_name(item.name):
                continue
            relative = f'{folder}/{item.name}' if folder else item.name
            if item.is_dir():
                entries.append({'name': item.name, 'path': relative, 'kind': 'folder'})
            elif item.is_file() and _file_type(item.name):
                info = item.stat()
                entries.append({'name': item.name, 'path': relative, 'kind': 'file',
                                'size': info.st_size,
                                'modifiedAt': datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat()})
        entries.sort(key=lambda entry: (entry['kind'] != 'folder', entry['name']))
        return {'folder': folder, 'entries': entries, 'configured': True}

    def create_folder(self, folder, name):
        if not _valid_name(name):
            raise DocumentLibraryError('请输入可用的文件夹名称。')
        parent = self._locate('private', folder, 'folder')
        if len(_parts(folder)) >= 20:
            raise DocumentLibraryError('文档库的文件夹层级已达上限。')
        try:
            (parent / name).mkdir()
        except FileExistsError:
            raise DocumentLibraryError('当前目录已有同名文件或文件夹。')
        return self.list('private', folder)

    def create_file(self, folder, name, content=''):
        if not isinstance(name, str) or not _valid_name(name) or Path(name).suffix.lower() not in NEW_FILE_SUFFIXES:
            raise DocumentLibraryError('请输入有效的文件名，格式支持 TXT、Markdown、CSV 和 TSV。')
        parent = self._locate('private', folder, 'folder')
        raw = content.encode('utf-8') if isinstance(content, str) else b''
        if len(raw) > MAX_FILE_BYTES:
            raise DocumentLibraryError('文件大小不得超过 10 MiB。')
        try:
            with (parent / name).open('x', encoding='utf-8') as handle:
                handle.write(content if isinstance(content, str) else '')
        except FileExistsError:
            raise DocumentLibraryError('当前目录已有同名文件或文件夹。')
        return self.list('private', folder)

    def import_files(self, folder, files):
        parent = self._locate('private', folder, 'folder')
        if not isinstance(files, list) or len(files) > MAX_IMPORT_FILES:
            raise DocumentLibraryError('每次最多导入 16 个文档。')
        total = 0
        prepared = []
        for item in files:
            if not isinstance(item, dict):
                raise DocumentLibraryError('导入内容无效。')
            name = item.get('name')
            if not _valid_name(name) or not _file_type(name):
                raise DocumentLibraryError('选择中包含暂不支持的文件格式或路径。')
            try:
                raw = base64.b64decode(item.get('dataBase64', ''), validate=True)
            except (ValueError, TypeError):
                raise DocumentLibraryError('导入内容无效。')
            total += len(raw)
            if len(raw) > MAX_FILE_BYTES:
                raise DocumentLibraryError('文档超过 10 MiB 限制。')
            if total > MAX_IMPORT_BYTES:
                raise DocumentLibraryError('每次最多导入 40 MiB 文档。')
            prepared.append((name, raw))
        created = []
        try:
            for name, raw in prepared:
                suffix = Path(name).suffix
                stem = Path(name).stem
                for index in range(1, 2001):
                    candidate = name if index == 1 else f'{stem} ({index}){suffix}'
                    destination = parent / candidate
                    try:
                        with destination.open('xb') as handle:
                            handle.write(raw)
                        created.append(destination)
                        break
                    except FileExistsError:
                        continue
                else:
                    raise DocumentLibraryError('同名文档太多，请先更改文件名。')
        except Exception:
            for file in created:
                file.unlink(missing_ok=True)
            raise
        return self.list('private', folder)

    def delete_entry(self, entry_path):
        target = self._locate('private', entry_path, None)
        if not _parts(entry_path):
            raise DocumentLibraryError('请选择要删除的文件或文件夹。')
        trash = self.personal / '.trash'
        trash.mkdir(exist_ok=True)
        destination = trash / f'{time.time_ns()}-{target.name}'
        shutil.move(str(target), str(destination))
        return self.list('private', '/'.join(_parts(entry_path)[:-1]))

    def read_file(self, scope, file):
        target = self._locate(scope, file, 'file')
        format_info = _file_type(target.name)
        if not format_info:
            raise DocumentLibraryError('暂不支持读取此文件类型。', 'unsupported_format', 415)
        mime, limit = format_info
        size = target.stat().st_size
        if size > limit:
            raise DocumentLibraryError('文档超过可读取的大小限制。', 'file_too_large', 413)
        raw = target.read_bytes()
        return {'name': target.name, 'size': len(raw), 'mimeType': mime,
                'dataBase64': base64.b64encode(raw).decode('ascii')}
