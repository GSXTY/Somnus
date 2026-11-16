"""Local declarative bundles and immutable release candidates."""
import hashlib
import json
import re
import time
import uuid

from mcp_connectors.registry import IDENTIFIER as MCP_ID


MAX_BUNDLES = 32
MAX_SELECTED = 3
MAX_MANIFEST_BYTES = 32 * 1024
ITEM_ID = re.compile(r'[a-f0-9]{32}')
MANIFEST_FIELDS = {'name', 'description', 'version', 'skill_ids', 'mcp_ids'}
RELEASE_VERSION = re.compile(r'(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}'
                             r'(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?'
                             r'(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?', re.ASCII)


class BundleError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def _text(value, limit, *, required=False):
    if (not isinstance(value, str) or len(value) > limit
            or any(ord(char) < 32 or 0xd800 <= ord(char) <= 0xdfff for char in value)
            or required and not value.strip()):
        raise BundleError('invalid_plugin', '插件名称、说明或版本格式无效。')
    return value.strip()


def _ids(value, pattern, limit):
    if (not isinstance(value, list) or len(value) > limit
            or not all(isinstance(item, str) and pattern.fullmatch(item) for item in value)
            or len(set(value)) != len(value)):
        raise BundleError('invalid_plugin_references', '插件 ID 列表无效或有重复。')
    return value


def _mcp_states(registry):
    if registry is None:
        return {}
    return registry.enabled_states()


def _manifest(fields, *, embedded_skills=False):
    if not isinstance(fields, dict) or set(fields) - MANIFEST_FIELDS:
        raise BundleError('invalid_plugin', '插件清单只允许名称、说明、版本，以及已安装的 Skill 和 MCP ID。')
    skills = _ids(fields.get('skill_ids', []), ITEM_ID, 12)
    servers = _ids(fields.get('mcp_ids', []), MCP_ID, 16)
    if not skills and not servers and not embedded_skills:
        raise BundleError('invalid_plugin_references', '请至少选择一个已安装的 Skill 或 MCP。')
    return dict(name=_text(fields.get('name'), 80, required=True),
                description=_text(fields.get('description', ''), 500),
                version=_text(fields.get('version', '1.0.0'), 48, required=True),
                skill_ids=skills, mcp_ids=servers)


def _release_version(version):
    match = RELEASE_VERSION.fullmatch(version)
    return bool(match and not any(item.isdecimal() and len(item) > 1 and item.startswith('0')
                                  for item in (match[1] or '').split('.')))


class PluginBundles:
    def __init__(self, database, skills):
        self.database, self.skills = database, skills
        with self.database() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS personal_plugins(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
                version TEXT NOT NULL, skill_ids TEXT NOT NULL, mcp_ids TEXT NOT NULL,
                enabled INTEGER NOT NULL, created_at REAL NOT NULL
            )''')
            db.execute('''CREATE TABLE IF NOT EXISTS default_plugins(
                id TEXT PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                description TEXT NOT NULL, version TEXT NOT NULL, skill_ids TEXT NOT NULL,
                mcp_ids TEXT NOT NULL, enabled INTEGER NOT NULL, created_at REAL NOT NULL,
                published_at REAL NOT NULL
            )''')
            db.execute('''CREATE TABLE IF NOT EXISTS plugin_release_candidates(
                id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, manifest TEXT NOT NULL,
                report TEXT NOT NULL, created_at REAL NOT NULL, UNIQUE(sha256,report)
            )''')

    def _states(self, registry):
        return {skill['id']: skill['enabled'] for skill in self.skills.list()}, _mcp_states(registry)

    @staticmethod
    def _public(row, states):
        skill_states, mcp_states = states
        item = dict(row, enabled=bool(row['enabled']), skill_ids=json.loads(row['skill_ids']),
                    mcp_ids=json.loads(row['mcp_ids']))
        for key, entries, available in (('skills', item['skill_ids'], skill_states),
                                        ('mcp', item['mcp_ids'], mcp_states)):
            item['missing_' + key] = [entry for entry in entries if entry not in available]
            item['inactive_' + key] = [entry for entry in entries if available.get(entry) is False]
        return item

    def list(self, registry):
        states = self._states(registry)
        with self.database() as db:
            return [self._public(row, states) for row in db.execute('SELECT * FROM personal_plugins ORDER BY created_at,id')]

    def defaults(self, registry):
        states = self._states(registry)
        with self.database() as db:
            return [self._public(row, states) for row in db.execute('SELECT * FROM default_plugins ORDER BY published_at,id')]

    def publish_default(self, plugin_id, registry):
        self._require_id(plugin_id)
        states = self._states(registry)
        with self.database() as db:
            db.execute('BEGIN IMMEDIATE')
            personal = db.execute('SELECT * FROM personal_plugins WHERE id=?', (plugin_id,)).fetchone()
            if personal is None:
                raise BundleError('plugin_not_found', '插件不存在。', 404)
            projected = self._public(personal, states)
            if projected['missing_skills'] or projected['missing_mcp']:
                raise BundleError('plugin_reference_missing', '请补齐缺少的 Skill 和 MCP 后再发布为默认插件。', 409)
            previous = db.execute('SELECT * FROM default_plugins WHERE source_id=?', (plugin_id,)).fetchone()
            if previous is not None:
                return self._public(previous, states)
            if db.execute('SELECT COUNT(*) FROM default_plugins').fetchone()[0] >= MAX_BUNDLES:
                raise BundleError('plugin_library_full', f'最多可发布 {MAX_BUNDLES} 个默认插件。', 409)
            now = time.time()
            default = dict(personal, id=uuid.uuid4().hex, source_id=plugin_id, enabled=1, created_at=now, published_at=now)
            db.execute('''INSERT INTO default_plugins VALUES
                (:id,:source_id,:name,:description,:version,:skill_ids,:mcp_ids,:enabled,:created_at,:published_at)''', default)
        return self._public(default, states)

    def remove_default(self, plugin_id):
        self._require_id(plugin_id)
        with self.database() as db:
            if not db.execute('DELETE FROM default_plugins WHERE id=?', (plugin_id,)).rowcount:
                raise BundleError('plugin_not_found', '默认插件不存在。', 404)
        return {'removed': True}

    def add(self, fields, registry):
        manifest = _manifest(fields)
        skills, servers = manifest['skill_ids'], manifest['mcp_ids']
        states = self._states(registry)
        if any(skill not in states[0] for skill in skills) or any(server not in states[1] for server in servers):
            raise BundleError('plugin_reference_missing', '清单引用了未安装的 Skill 或 MCP，请核对 ID。', 409)
        with self.database() as db:
            db.execute('BEGIN IMMEDIATE')
            item = self.insert(db, manifest)
        return self._public(item, states)

    @staticmethod
    def insert(db, manifest):
        if db.execute('SELECT COUNT(*) FROM personal_plugins').fetchone()[0] >= MAX_BUNDLES:
            raise BundleError('plugin_library_full', f'最多可安装 {MAX_BUNDLES} 个插件。', 409)
        item = dict(manifest, id=uuid.uuid4().hex, skill_ids=json.dumps(manifest['skill_ids']),
                    mcp_ids=json.dumps(manifest['mcp_ids']), enabled=0, created_at=time.time())
        db.execute('''INSERT INTO personal_plugins VALUES
                      (:id,:name,:description,:version,:skill_ids,:mcp_ids,:enabled,:created_at)''', item)
        return item

    @staticmethod
    def development_template():
        return {'name': '', 'description': '', 'version': '1.0.0', 'skill_ids': [], 'mcp_ids': []}

    def preflight(self, fields, registry):
        checks = []

        def check(key, status, message):
            checks.append({'id': key, 'status': status, 'message': message})

        try:
            manifest = _manifest(fields)
        except BundleError as exc:
            check(exc.code, 'fail', str(exc))
            return {'ok': False, 'checks': checks}
        check('manifest', 'pass', '清单格式正确。')
        if _release_version(manifest['version']):
            check('version', 'pass', '版本格式正确。')
        else:
            check('version', 'fail', '请使用形如 1.0.0 或 1.0.0-beta.1 的版本号。')
        references = {}
        for key, label, available in zip(('skill_ids', 'mcp_ids'), ('Skill', 'MCP'), self._states(registry)):
            entries = manifest[key]
            states = {entry: ('missing' if entry not in available
                              else 'enabled' if available[entry] else 'disabled') for entry in entries}
            references[key] = states
            missing = sum(state == 'missing' for state in states.values())
            inactive = sum(state == 'disabled' for state in states.values())
            if missing:
                check(key, 'fail', f'{missing} 个 {label} 引用未安装。')
            elif inactive:
                check(key, 'warn', f'{inactive} 个 {label} 引用当前未启用。')
            elif entries:
                check(key, 'pass', f'{len(entries)} 个 {label} 引用已安装并启用。')
        check('portability', 'warn', '候选清单只保存 Skill 和 MCP ID，目标设备需要已安装相同 ID 的依赖。')
        check('static_only', 'warn', '预检只核对清单和依赖状态，未启动 MCP 或运行工具。')
        return {'ok': all(item['status'] != 'fail' for item in checks),
                'manifest': manifest, 'checks': checks, 'references': references}

    @staticmethod
    def _candidate(row):
        return dict(row, manifest=json.loads(row['manifest']), report=json.loads(row['report']))

    def create_candidate(self, fields, registry):
        report = self.preflight(fields, registry)
        if not report['ok']:
            raise BundleError('plugin_preflight_failed', '请处理预检失败项后再创建发布候选。', 409)
        manifest = json.dumps(report['manifest'], ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        sha256 = hashlib.sha256(manifest.encode('utf-8')).hexdigest()
        review = json.dumps(report, ensure_ascii=False, sort_keys=True)
        with self.database() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM plugin_release_candidates WHERE sha256=? AND report=?',
                                  (sha256, review)).fetchone()
            if previous:
                return self._candidate(previous)
            item = dict(id=uuid.uuid4().hex, sha256=sha256, manifest=manifest,
                        report=review, created_at=time.time())
            if db.execute('SELECT COUNT(*) FROM plugin_release_candidates').fetchone()[0] >= MAX_BUNDLES:
                raise BundleError('plugin_candidate_limit', f'最多可保留 {MAX_BUNDLES} 个发布候选。', 409)
            db.execute('''INSERT INTO plugin_release_candidates VALUES
                          (:id,:sha256,:manifest,:report,:created_at)''', item)
        return self._candidate(item)

    def candidates(self):
        with self.database() as db:
            return [self._candidate(row) for row in db.execute(
                'SELECT * FROM plugin_release_candidates ORDER BY created_at DESC,id')]

    def candidate(self, candidate_id):
        self._require_id(candidate_id)
        with self.database() as db:
            row = db.execute('SELECT * FROM plugin_release_candidates WHERE id=?', (candidate_id,)).fetchone()
        if row is None:
            raise BundleError('plugin_candidate_missing', '发布候选不存在。', 404)
        return self._candidate(row)

    @staticmethod
    def _require_id(plugin_id):
        if not isinstance(plugin_id, str) or not ITEM_ID.fullmatch(plugin_id):
            raise BundleError('plugin_not_found', '插件不存在。', 404)

    def set_enabled(self, plugin_id, enabled, registry):
        self._require_id(plugin_id)
        if type(enabled) is not bool:
            raise BundleError('invalid_plugin', '插件启用状态无效。')
        states = self._states(registry)
        with self.database() as db:
            row = db.execute('UPDATE personal_plugins SET enabled=? WHERE id=? RETURNING *',
                             (enabled, plugin_id)).fetchone()
            if not row:
                raise BundleError('plugin_not_found', '插件不存在。', 404)
        return self._public(row, states)

    def remove(self, plugin_id):
        self._require_id(plugin_id)
        with self.database() as db:
            if not db.execute('DELETE FROM personal_plugins WHERE id=?', (plugin_id,)).rowcount:
                raise BundleError('plugin_not_found', '插件不存在。', 404)
        return {'removed': True}

    def select(self, plugin_ids, registry):
        ids = _ids(plugin_ids, ITEM_ID, MAX_SELECTED)
        states = self._states(registry)
        skills, servers = [], set()
        with self.database() as db:
            for plugin_id in ids:
                row = db.execute('SELECT * FROM personal_plugins WHERE id=? AND enabled=1', (plugin_id,)).fetchone()
                if row is None:
                    row = db.execute('SELECT * FROM default_plugins WHERE id=? AND enabled=1', (plugin_id,)).fetchone()
                if not row:
                    raise BundleError('plugin_unavailable', '所选插件已停用或移除，请重新选择。', 409)
                skills.extend(item for item in json.loads(row['skill_ids']) if states[0].get(item))
                servers.update(item for item in json.loads(row['mcp_ids']) if states[1].get(item))
        return list(dict.fromkeys(skills)), frozenset(servers)
