"""Local Skill imports that retain text and never extract or execute a package."""
import io
import json
import re
import sqlite3
import stat
import time
import unicodedata
import uuid
import zlib
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile


MAX_UPLOAD = 2 * 1024 * 1024
MAX_EXPANDED = 8 * 1024 * 1024
MAX_FILES = 128
MAX_TEXT = 96 * 1024
MAX_SKILLS = 64
MAX_SELECTED = 3
MAX_INSTRUCTIONS = 24_000
REFERENCE_EXCERPT = 1000
MAX_REFERENCE_EXCERPTS = 6
NAME = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
IDENTIFIER = re.compile(r'[a-f0-9]{32}')
INVALID_PATH = re.compile(r'[<>:"\\|?*\x00-\x1f\x7f]')
FIELD = re.compile(r'(name|description):\s*(.*)')
BLOCK_MARKERS = {'|', '|-', '|+', '>', '>-', '>+'}


class SkillError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _text(raw):
    if len(raw) > MAX_TEXT:
        raise SkillError('skill_text_too_large', '技能文本或参考文件过大。', 413)
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise SkillError('invalid_skill_text', '技能与参考文件须为 UTF-8 文本。') from exc
    if '\0' in text:
        raise SkillError('invalid_skill_text', '技能与参考文件须为 UTF-8 文本。')
    return text


def _metadata_value(value):
    if value.startswith('"'):
        try:
            result, end = json.JSONDecoder().raw_decode(value)
            if not re.fullmatch(r'(?:[ \t]+#.*)?', value[end:]):
                raise ValueError('extra content')
        except ValueError as exc:
            raise SkillError('invalid_skill_metadata', '技能元数据的引号格式无效。') from exc
        return result.strip()
    if value.startswith("'"):
        match = re.fullmatch(r"'((?:[^']|'')*)'(?:[ \t]+#.*)?", value)
        if not match:
            raise SkillError('invalid_skill_metadata', '技能元数据的引号格式无效。')
        return match.group(1).replace("''", "'").strip()
    if value.startswith(('[', '{', '&', '*', '!', '>', '|', '@', '\x60')):
        raise SkillError('invalid_skill_metadata', '技能名称与描述须为普通文本。')
    return re.split(r'\s+#', value, maxsplit=1)[0].strip()


def _frontmatter(raw):
    lines = _text(raw).splitlines()
    if not lines or lines[0].strip() != '---':
        raise SkillError('invalid_skill_metadata', 'SKILL.md 开头须包含由 --- 分隔的名称和描述。')
    end = next((i for i, line in enumerate(lines[1:65], 1) if line == '---'), None)
    if end is None or len('\n'.join(lines[:end])) > 8000:
        raise SkillError('invalid_skill_metadata', 'SKILL.md 元数据过长或缺少结束分隔符。')
    metadata = {}
    index = 1
    while index < end:
        match = FIELD.fullmatch(lines[index])
        index += 1
        if not match:
            continue
        key, value = match.groups()
        if key in metadata:
            raise SkillError('invalid_skill_metadata', '技能名称和描述各只能声明一次。')
        value = re.split(r'\s+#', value, maxsplit=1)[0] if value[:1] in ('|', '>') else value
        if value in BLOCK_MARKERS:
            block = []
            while index < end and (not lines[index].strip() or lines[index].startswith(' ')):
                block.append(lines[index].strip())
                index += 1
            metadata[key] = ('\n' if value.startswith('|') else ' ').join(block).strip()
        else:
            metadata[key] = _metadata_value(value)
    name, description = metadata.get('name', ''), metadata.get('description', '')
    if len(name) > 64 or not NAME.fullmatch(name) or not description or len(description) > 1024:
        raise SkillError('invalid_skill_metadata', '技能名称须为 1 至 64 个小写字母、数字或连字符，描述须为 1 至 1024 个字符。')
    instructions = '\n'.join(lines[end + 1:]).strip()
    if not instructions or len(instructions) > MAX_INSTRUCTIONS:
        raise SkillError('invalid_skill_instructions', f'技能须包含 1 至 {MAX_INSTRUCTIONS} 个字符的指令。')
    return name, description, instructions


def _archive_members(archive):
    members = archive.infolist()
    if len(members) > MAX_FILES or sum(item.file_size for item in members) > MAX_EXPANDED:
        raise SkillError('skill_archive_too_large', '技能压缩包展开后过大或包含过多文件。', 413)
    seen = {}
    result = {}
    for item in members:
        raw_name = item.orig_filename
        path = raw_name.removesuffix('/')
        parts = tuple(path.split('/'))
        mode = stat.S_IFMT(item.external_attr >> 16)
        if (not path or len(path) > 300 or INVALID_PATH.search(path)
                or any(part in ('', '.', '..') or part.endswith((' ', '.')) for part in parts)
                or mode not in (0, stat.S_IFDIR if item.is_dir() else stat.S_IFREG)
                or item.external_attr & 0x400 or item.flag_bits & 1):
            raise SkillError('unsafe_skill_archive', '技能压缩包含不安全的文件路径、链接或加密项目。')
        folded = tuple(unicodedata.normalize('NFC', part).casefold() for part in parts)
        if folded in seen:
            raise SkillError('unsafe_skill_archive', '技能压缩包含重复路径。')
        seen[folded] = item.is_dir()
        if not item.is_dir():
            result[parts] = item
    for path in seen:
        if any(seen.get(path[:i]) is False for i in range(1, len(path))):
            raise SkillError('unsafe_skill_archive', '技能压缩包的文件和目录路径发生冲突。')
    return result


def _member_text(archive, member):
    if member.file_size > MAX_TEXT:
        raise SkillError('skill_text_too_large', '技能文本或参考文件过大。', 413)
    with archive.open(member) as stream:
        return stream.read(MAX_TEXT + 1)


def parse_upload(filename, raw):
    if len(raw) > MAX_UPLOAD:
        raise SkillError('skill_file_too_large', '技能文件不能超过 2 MiB。', 413)
    if not isinstance(filename, str) or not filename or len(filename) > 255 or INVALID_PATH.search(filename) or '/' in filename:
        raise SkillError('invalid_skill_file', '请选择 SKILL.md 或包含该文件的 ZIP。')
    if filename.casefold() == 'skill.md':
        name, description, instructions = _frontmatter(raw)
        return dict(name=name, description=description, instructions=instructions, references=[], ignored_count=0)
    if not filename.casefold().endswith('.zip'):
        raise SkillError('invalid_skill_file', '请选择 SKILL.md 或包含该文件的 ZIP。')
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            files = _archive_members(archive)
            definitions = [path for path in files if path[-1].casefold() == 'skill.md']
            if len(definitions) != 1 or len(definitions[0]) > 2:
                raise SkillError('invalid_skill_archive', 'ZIP 根目录或单个顶层目录须包含唯一的 SKILL.md。')
            definition = definitions[0]
            prefix = (*definition[:-1], 'references')
            name, description, instructions = _frontmatter(_member_text(archive, files[definition]))
            references = [dict(path='/'.join(path[len(definition) - 1:]), text=_text(_member_text(archive, item)))
                          for path, item in sorted(files.items())
                          if path[:len(prefix)] == prefix and len(path) > len(prefix)
                          and PurePosixPath(path[-1]).suffix.casefold() in ('.md', '.markdown', '.txt')]
    except (BadZipFile, NotImplementedError, RuntimeError, EOFError, OSError, zlib.error) as exc:
        raise SkillError('invalid_skill_archive', 'ZIP 文件损坏或使用了不支持的压缩方式。') from exc
    return dict(name=name, description=description, instructions=instructions,
                references=references, ignored_count=len(files) - 1 - len(references))


class SkillLibrary:
    def __init__(self, database):
        self.database = database
        with self.database() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS personal_skills(
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
                enabled INTEGER NOT NULL, created_at REAL NOT NULL, instructions TEXT NOT NULL,
                references_json TEXT NOT NULL, reference_count INTEGER NOT NULL, ignored_count INTEGER NOT NULL
            )''')

    @staticmethod
    def _public(row):
        item = {key: row[key] for key in ('id', 'name', 'description', 'created_at', 'reference_count', 'ignored_count')}
        return dict(item, enabled=bool(row['enabled']))

    def list(self):
        with self.database() as db:
            return [self._public(row) for row in db.execute('''SELECT id,name,description,enabled,created_at,
                reference_count,ignored_count FROM personal_skills ORDER BY created_at DESC,id''')]

    def add(self, filename, raw):
        parsed = parse_upload(filename, raw)
        with self.database() as db:
            db.execute('BEGIN IMMEDIATE')
            item = self.insert(db, parsed)
        return self._public(item)

    @staticmethod
    def insert(db, parsed):
        references = parsed['references']
        item = dict(parsed, id=uuid.uuid4().hex, enabled=True, created_at=time.time(), reference_count=len(references))
        if db.execute('SELECT COUNT(*) FROM personal_skills').fetchone()[0] >= MAX_SKILLS:
            raise SkillError('skill_library_full', f'最多保存 {MAX_SKILLS} 个技能。', 409)
        try:
            db.execute('''INSERT INTO personal_skills
                (id,name,description,enabled,created_at,instructions,references_json,reference_count,ignored_count)
                VALUES(:id,:name,:description,:enabled,:created_at,:instructions,:references_json,:reference_count,:ignored_count)''',
                       dict(item, references_json=json.dumps(references, ensure_ascii=False)))
        except sqlite3.IntegrityError as exc:
            raise SkillError('skill_name_conflict', '已存在同名技能，请先移除旧版本或重命名。', 409) from exc
        return item

    @staticmethod
    def _validate_id(skill_id):
        if not isinstance(skill_id, str) or not IDENTIFIER.fullmatch(skill_id):
            raise SkillError('invalid_skill_id', '技能标识无效。')

    def set_enabled(self, skill_id, enabled):
        self._validate_id(skill_id)
        if not isinstance(enabled, bool):
            raise SkillError('invalid_skill_status', '请选择启用或停用技能。')
        with self.database() as db:
            updated = db.execute('''UPDATE personal_skills SET enabled=? WHERE id=? RETURNING
                id,name,description,enabled,created_at,reference_count,ignored_count''', (enabled, skill_id)).fetchone()
            if updated is None:
                raise SkillError('skill_not_found', '技能已移除或不存在。', 404)
        return self._public(updated)

    def remove(self, skill_id):
        self._validate_id(skill_id)
        with self.database() as db:
            deleted = db.execute('DELETE FROM personal_skills WHERE id=?', (skill_id,))
            if not deleted.rowcount:
                raise SkillError('skill_not_found', '技能已移除或不存在。', 404)
        return dict(deleted=True, skill_id=skill_id)

    def for_turn(self, skill_ids, *, supplemental=()):
        if not isinstance(skill_ids, list) or len(skill_ids) > MAX_SELECTED:
            raise SkillError('invalid_skill_selection', f'每轮最多可选择 {MAX_SELECTED} 个技能。')
        result, instruction_chars, remaining_excerpts = [], 0, MAX_REFERENCE_EXCERPTS
        seen = set()
        with self.database() as db:
            db.execute('BEGIN')
            for skill_id, optional in [(value, False) for value in skill_ids] + [(value, True) for value in supplemental]:
                if len(result) >= MAX_SELECTED:
                    break
                self._validate_id(skill_id)
                if skill_id in seen:
                    if optional:
                        continue
                    raise SkillError('invalid_skill_selection', '请勿重复选择同一技能。')
                seen.add(skill_id)
                row = db.execute('SELECT * FROM personal_skills WHERE id=?', (skill_id,)).fetchone()
                if not row or not row['enabled']:
                    if optional:
                        continue
                    raise SkillError('skill_unavailable', '所选技能已经停用或移除，请重新选择。', 409)
                if instruction_chars + len(row['instructions']) > MAX_INSTRUCTIONS:
                    if optional:
                        continue
                    raise SkillError('skill_selection_too_large', '所选技能的指令总量过大，请减少本轮技能数量。', 413)
                instruction_chars += len(row['instructions'])
                references = json.loads(row['references_json'])
                excerpts = [dict(path=ref['path'], excerpt=ref['text'][:REFERENCE_EXCERPT],
                                 truncated=len(ref['text']) > REFERENCE_EXCERPT) for ref in references[:remaining_excerpts]]
                remaining_excerpts -= len(excerpts)
                result.append(dict(name=row['name'], instructions=row['instructions'], references=excerpts,
                                   omitted_references=len(references) - len(excerpts)))
        return result
