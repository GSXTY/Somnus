"""Install the author's bundled Skill defaults in a desktop profile."""

import json
import time
from uuid import NAMESPACE_URL, uuid5

from .plugin_bundles import MAX_BUNDLES
from .skill_library import MAX_SKILLS, parse_upload


PROJECT_HANDOFF = {
    'name': 'Project Handoff',
    'description': '通过简短的项目交接文档保留跨会话、跨工具的工作进展。',
    'version': '1.0.0',
    'slug': 'project-handoff',
}


def install_bundled_defaults(service, assets):
    slug = PROJECT_HANDOFF['slug']
    source_id = uuid5(NAMESPACE_URL, f'https://github.com/GSXTY/Somnus/default/{slug}/source').hex
    plugin_id = uuid5(NAMESPACE_URL, f'https://github.com/GSXTY/Somnus/default/{slug}').hex
    raw = (assets / 'skills' / slug / 'SKILL.md').read_bytes()
    skill = parse_upload('SKILL.md', raw)
    if skill['name'] != slug:
        raise ValueError('Bundled Project Handoff Skill has an unexpected name.')

    with service.db() as db:
        db.execute('BEGIN IMMEDIATE')
        defaults = db.execute('SELECT source_id, name FROM default_plugins').fetchall()
        if len(defaults) >= MAX_BUNDLES or any(
            item['source_id'] == source_id or item['name'].casefold() == PROJECT_HANDOFF['name'].casefold()
            for item in defaults
        ):
            return

        existing = db.execute('SELECT * FROM personal_skills WHERE name=?', (slug,)).fetchone()
        if existing:
            # A locally customized Skill stays under its owner's control.
            if (existing['instructions'] != skill['instructions']
                    or existing['description'] != skill['description']
                    or json.loads(existing['references_json']) != skill['references']):
                return
            skill_id = existing['id']
        else:
            count = db.execute('SELECT COUNT(*) FROM personal_skills').fetchone()[0]
            if count >= MAX_SKILLS:
                return
            skill_id = service.skills.insert(db, skill)['id']

        now = time.time()
        db.execute('''INSERT INTO default_plugins VALUES
            (:id,:source_id,:name,:description,:version,:skill_ids,:mcp_ids,1,:created_at,:published_at)''',
            dict(PROJECT_HANDOFF, id=plugin_id, source_id=source_id,
                 skill_ids=json.dumps([skill_id]), mcp_ids='[]', created_at=now, published_at=now))
