"""Restore desktop configuration selections using references to existing entries."""
import hashlib
import json
import sqlite3
import time
import uuid

from .models import BUILTIN, ModelError


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class ConfigurationCheckpoints:
    def __init__(self, service, registry):
        self.service = service
        self.models = service.models
        self.registry = registry

    @staticmethod
    def _prepare(db):
        db.execute('''CREATE TABLE IF NOT EXISTS configuration_checkpoints (
            id TEXT PRIMARY KEY, created_at REAL NOT NULL, configuration TEXT NOT NULL
        )''')

    @staticmethod
    def _plugin_state(plugins):
        return [
            dict(id=plugin['id'], name=plugin['name'], enabled=plugin['enabled'],
                 manifest=_fingerprint({key: plugin[key] for key in ('version', 'skill_ids', 'mcp_ids')}),
                 ready=not any(plugin[key] for key in ('missing_skills', 'inactive_skills', 'missing_mcp', 'inactive_mcp')))
            for plugin in plugins
        ]

    def _current(self, db, data):
        model_id = data['active']
        row = self._model(data)
        plugins = self.service.plugins
        states = plugins._states(self.registry)
        personal = [plugins._public(row, states) for row in db.execute('SELECT * FROM personal_plugins ORDER BY id')]
        return dict(model=dict(id=model_id, name=row['name'], model=row['model'],
                               provider=_fingerprint([row.get('group_id', BUILTIN), row['base_url'],
                                                      row['vision_enabled'], row['reasoning_efforts']])),
                    plugins=self._plugin_state(personal))

    def list(self):
        with self.models.lock, self.service.db() as db:
            self._prepare(db)
            current = self._current(db, self.models._load(db))
            checkpoints = [
                dict(id=row['id'], created_at=row['created_at'], **json.loads(row['configuration']))
                for row in db.execute('SELECT * FROM configuration_checkpoints ORDER BY created_at DESC, id DESC')
            ]
        return dict(current=current, revision=_fingerprint(current), checkpoints=checkpoints)

    @staticmethod
    def _verify_plugins(configuration):
        if any(plugin['enabled'] and not plugin['ready'] for plugin in configuration['plugins']):
            raise ModelError('checkpoint_plugin_unavailable', '请先检查已启用插件的 Skill 和 MCP 依赖。', 409)

    def save(self, agent, revision):
        with self.models.lock, self.service.db() as db:
            data = self.models._load(db)
            starting = self._current(db, data)
            model = self._model(data)
        if revision != _fingerprint(starting):
            raise ModelError('checkpoint_configuration_changed', '配置已变更，请刷新后重新验证。', 409)
        self._verify_plugins(starting)
        if agent is None:
            test = self.service.test_model(starting['model']['id'], provider=model)
            if not test['ok']:
                raise ModelError('checkpoint_model_unavailable', test['message'], 409)
        with self.models.lock, self.service.db() as db:
            self._prepare(db)
            db.execute('BEGIN IMMEDIATE')
            data = self.models._load(db)
            current = self._current(db, data)
            if starting != current or model != self._model(data):
                raise ModelError('checkpoint_configuration_changed', '验证期间配置已变更，请重新验证。', 409)
            checkpoint = dict(current, agent=agent)
            identifier, now = uuid.uuid4().hex, time.time()
            db.execute('INSERT INTO configuration_checkpoints VALUES (?,?,?)',
                       (identifier, now, json.dumps(checkpoint, ensure_ascii=False)))
            db.execute('''DELETE FROM configuration_checkpoints WHERE id NOT IN (
                SELECT id FROM configuration_checkpoints ORDER BY created_at DESC, id DESC LIMIT 5
            )''')
        return dict(id=identifier, created_at=now, **checkpoint)

    def _model(self, data):
        model_id = data['active']
        return self.service.builtin_model() if model_id == BUILTIN else self.models._find(data, model_id)

    def restore(self, identifier):
        try:
            with self.models.lock, self.service.db() as db:
                self._prepare(db)
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT configuration FROM configuration_checkpoints WHERE id=?',
                                 (identifier,)).fetchone()
                if row is None:
                    raise ModelError('checkpoint_not_found', '此配置检查点已不存在，请刷新列表。', 404)
                saved = json.loads(row['configuration'])
                desired = dict(self.models._load(db), active=saved['model']['id'])
                current = self._current(db, desired)
                if any(saved['model'][key] != current['model'][key] for key in ('provider', 'model')):
                    raise ModelError('checkpoint_model_changed', '检查点引用的模型配置已修改，请重新验证。', 409)
                available = {plugin['id']: plugin for plugin in current['plugins']}
                for plugin in saved['plugins']:
                    live = available.get(plugin['id'])
                    if not live or live['manifest'] != plugin['manifest'] or (plugin['enabled'] and not live['ready']):
                        raise ModelError('checkpoint_plugin_changed', f'插件「{plugin["name"]}」已变更或依赖不可用。', 409)
                db.executemany('UPDATE personal_plugins SET enabled=? WHERE id=?',
                               [(plugin['enabled'], plugin['id']) for plugin in saved['plugins']])
                self.models._write_selection(db, desired['active'])
        except sqlite3.Error as exc:
            raise ModelError('checkpoint_store_unavailable', '无法恢复配置检查点，请重试。', 503) from exc
        return dict(restored=True, agent=saved['agent'])
