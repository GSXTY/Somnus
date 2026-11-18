"""Portable Skill text and explicit references to existing MCP configurations."""

import hashlib
import json
from pathlib import PurePosixPath
import unicodedata

from app_version import APP_VERSION

from . import skill_library
from .plugin_bundles import BundleError, MAX_BUNDLES, _manifest, _release_version


FORMAT = 'somnus.plugin.v1'
MAX_PACKAGE_BYTES = 2 * 1024 * 1024
MAX_SKILL_COUNT = 12


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def version_key(version):
    core, _, preview = version.split('+', 1)[0].partition('-')
    return tuple(map(int, core.split('.'))), not preview, tuple(
        (0, int(part)) if part.isdecimal() else (1, part) for part in preview.split('.') if part)


def stored_skill(row):
    return {'name': row['name'], 'description': row['description'],
            'instructions': row['instructions'], 'references': json.loads(row['references_json'])}


def _utf8_text(value):
    if not isinstance(value, str):
        raise skill_library.SkillError('invalid_skill_text', '技能与参考文件须为 UTF-8 文本。')
    try:
        return skill_library._text(value.encode('utf-8'))
    except UnicodeEncodeError:
        raise skill_library.SkillError('invalid_skill_text', '技能与参考文件须为 UTF-8 文本。') from None


def _skill(fields):
    if not isinstance(fields, dict) or set(fields) != {'name', 'description', 'instructions', 'references'}:
        raise BundleError('invalid_portable_skill', '内置 Skill 必须包含名称、描述、指令和参考文本。')
    name = _utf8_text(fields['name'])
    description = _utf8_text(fields['description']).strip()
    instructions = _utf8_text(fields['instructions']).strip()
    skill_library._validate_fields(name, description, instructions)
    items = fields['references']
    if not isinstance(items, list) or len(items) >= skill_library.MAX_FILES:
        raise BundleError('invalid_portable_references', 'Skill 参考文档数量无效。')
    references, seen = [], set()
    for item in items:
        path = item.get('path') if isinstance(item, dict) else None
        if (not isinstance(path, str) or len(path) > 300 or set(item) != {'path', 'text'}
                or skill_library.INVALID_PATH.search(path)):
            raise BundleError('invalid_portable_references', 'Skill 参考文档路径无效。')
        parts = path.split('/')
        if (len(parts) < 2 or parts[0] != 'references'
                or any(part in ('', '.', '..') or part.endswith((' ', '.')) for part in parts)
                or PurePosixPath(path).suffix.casefold() not in ('.md', '.markdown', '.txt')):
            raise BundleError('invalid_portable_references', 'Skill 参考文档只能是 references 目录中的文本。')
        key = unicodedata.normalize('NFC', path).casefold()
        if key in seen:
            raise BundleError('invalid_portable_references', 'Skill 参考文档路径有重复。')
        seen.add(key)
        references.append({'path': path, 'text': _utf8_text(item['text'])})
    if any('/'.join(path.split('/')[:index]) in seen
           for path in seen for index in range(1, len(path.split('/')))):
        raise BundleError('invalid_portable_references', 'Skill 参考文档的文件和目录路径有冲突。')
    return {'name': name, 'description': description, 'instructions': instructions, 'references': references}


def parse(package):
    if (not isinstance(package, dict) or set(package) != {'format', 'minimum_somnus_version', 'manifest', 'skills'}
            or package.get('format') != FORMAT):
        raise BundleError('invalid_portable_package', '未识别的 Somnus 插件包格式。')
    minimum = package['minimum_somnus_version']
    if not isinstance(minimum, str) or len(minimum) > 48 or not _release_version(minimum):
        raise BundleError('invalid_portable_version', '插件包的最低 Somnus 版本无效。')
    try:
        size = len(canonical(package))
    except UnicodeEncodeError:
        raise BundleError('invalid_portable_package', '插件包必须是 UTF-8 文本。') from None
    if size > MAX_PACKAGE_BYTES:
        raise BundleError('portable_package_too_large', '插件包不能超过 2 MiB。', 413)
    fields, skills = package['manifest'], package['skills']
    if not isinstance(fields, dict) or set(fields) - {'name', 'description', 'version', 'mcp_ids'}:
        raise BundleError('invalid_portable_manifest', '插件包只允许声明已有 MCP ID，不能包含命令或凭据。')
    if not isinstance(skills, list) or len(skills) > MAX_SKILL_COUNT:
        raise BundleError('invalid_portable_skill', f'插件包最多包含 {MAX_SKILL_COUNT} 个 Skill。')
    parsed = [_skill(item) for item in skills]
    if len({item['name'] for item in parsed}) != len(parsed):
        raise BundleError('invalid_portable_skill', '插件包内的 Skill 名称不能重复。')
    manifest = _manifest(fields, embedded_skills=bool(parsed))
    if not _release_version(manifest['version']):
        raise BundleError('invalid_portable_version', '插件版本须使用形如 1.0.0 的版本号。')
    return minimum, manifest, parsed


def export(bundles, fields, registry):
    report = bundles.preflight(fields, registry)
    if not report['ok']:
        raise BundleError('plugin_preflight_failed', '请处理清单预检失败项后再导出插件包。', 409)
    manifest = dict(report['manifest'])
    skill_ids = manifest.pop('skill_ids')
    skills = []
    with bundles.database() as db:
        for skill_id in skill_ids:
            row = bundles.skills.get(db, skill_id)
            if row is None:
                raise BundleError('plugin_reference_missing', '导出过程中有 Skill 被移除，请重新检查。', 409)
            skills.append(stored_skill(row))
    package = {'format': FORMAT, 'minimum_somnus_version': APP_VERSION,
               'manifest': manifest, 'skills': skills}
    parse(package)
    return {'package': package, 'sha256': hashlib.sha256(canonical(package)).hexdigest()}


def _review(db, minimum, manifest, skills, mcp_states, skill_library_instance):
    checks = [{'id': 'manifest', 'status': 'pass', 'message': '已核对插件包格式和文本限制。'}]
    compatible = version_key(APP_VERSION) >= version_key(minimum)
    checks.append({'id': 'somnus_version', 'status': 'pass' if compatible else 'fail',
                   'message': f'要求 Somnus {minimum} 或更新版本，当前为 {APP_VERSION}。'})
    skill_states, mcp_requirements, existing = {}, {}, {}
    for skill in skills:
        name = skill['name']
        if name == 'ppt-master':
            skill_states[name] = 'conflict'
            checks.append({'id': 'skill:' + name, 'status': 'fail', 'message': 'Somnus 不再导入 ppt-master。'})
            continue
        row = skill_library_instance.handoff if name == skill_library.HANDOFF_NAME else db.execute(
            'SELECT * FROM personal_skills WHERE name=?', (name,)).fetchone()
        if row is None:
            state, label, status = 'new', '将导入内置文本', 'pass'
        elif stored_skill(row) == skill:
            state, label, status = ('reused', '复用本机相同内容', 'pass') if row['enabled'] else (
                'disabled', '复用本机内容，请启用此 Skill 后再用', 'warn')
            existing[name] = row['id']
        else:
            state, label, status = 'conflict', '本机存在不同内容的同名 Skill，请重命名或处理原 Skill', 'fail'
        skill_states[name] = state
        checks.append({'id': 'skill:' + name, 'status': status, 'message': f'{name}：{label}。'})
    for server in manifest['mcp_ids']:
        if server not in mcp_states:
            state, label, status = 'missing', '请先在目标设备添加此 MCP ID', 'fail'
        elif mcp_states[server]:
            state, label, status = 'enabled', '已绑定本机 MCP', 'pass'
        else:
            state, label, status = 'disabled', '已绑定，请在配置中心启用', 'warn'
        mcp_requirements[server] = state
        checks.append({'id': 'mcp:' + server, 'status': status, 'message': f'{server}：{label}。'})
    skill_count = db.execute('SELECT COUNT(*) FROM personal_skills').fetchone()[0]
    plugin_count = db.execute('SELECT COUNT(*) FROM personal_plugins').fetchone()[0]
    if skill_count + sum(state == 'new' for state in skill_states.values()) > skill_library.MAX_SKILLS:
        checks.append({'id': 'skill_capacity', 'status': 'fail', 'message': '本机 Skill 库空间不足。'})
    if plugin_count >= MAX_BUNDLES:
        checks.append({'id': 'plugin_capacity', 'status': 'fail', 'message': '本机插件库空间不足。'})
    checks.append({'id': 'backing_tools', 'status': 'warn',
                   'message': '预检只检查配置与依赖，未启动 MCP 或执行 Skill 中的内容。'})
    return {'ok': all(check['status'] != 'fail' for check in checks), 'checks': checks,
            'manifest': manifest, 'references': {'skills': skill_states, 'mcp_ids': mcp_requirements}}, existing


def preflight(bundles, package, registry):
    try:
        parsed = parse(package)
    except (BundleError, skill_library.SkillError) as error:
        return {'ok': False, 'checks': [{'id': error.code, 'status': 'fail', 'message': str(error)}]}
    _, mcp_states = bundles._states(registry)
    with bundles.database() as db:
        report, _ = _review(db, *parsed, mcp_states, bundles.skills)
    return report


def install(bundles, package, registry):
    parsed = parse(package)
    skill_states, mcp_states = bundles._states(registry)
    _, manifest, skills = parsed
    with bundles.database() as db:
        db.execute('BEGIN IMMEDIATE')
        report, existing = _review(db, *parsed, mcp_states, bundles.skills)
        if not report['ok']:
            problem = next(check['message'] for check in report['checks'] if check['status'] == 'fail')
            raise BundleError('plugin_preflight_failed', problem, 409)
        for skill in skills:
            name = skill['name']
            skill_id = existing.get(name)
            if not skill_id:
                inserted = bundles.skills.insert(db, dict(skill, ignored_count=0))
                skill_id = inserted['id']
                skill_states[skill_id] = bool(inserted['enabled'])
            manifest['skill_ids'].append(skill_id)
        row = bundles.insert(db, manifest)
    return bundles._public(row, (skill_states, mcp_states))
