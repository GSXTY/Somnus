"""Profile-scoped configuration for OpenAI-compatible chat models."""
import json
import hashlib
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from urllib.parse import urlsplit
import uuid


BUILTIN = 'deepseek'
REASONING_EFFORTS = ('low', 'medium', 'high')
MAX_MODELS = 64
MAX_SETTINGS_BYTES = 512 * 1024
MODEL_ID = re.compile(r'm_[0-9a-f]{10,32}')
GROUP_ID = re.compile(r'g_[0-9a-f]{32}')
GROUP_FIELDS = {'name', 'base_url', 'api_key'}
MODEL_FIELDS = {'model', 'vision_enabled', 'reasoning_efforts'}
FIELDS = GROUP_FIELDS | MODEL_FIELDS
ROOT = Path(__file__).resolve().parents[1]


class ModelError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def _clean_text(value, limit, *, required=True):
    if not isinstance(value, str):
        raise ModelError('invalid_model', '模型配置相关字段须为文本。')
    value = value.strip()
    if (required and not value) or len(value) > limit or any(ord(char) < 32 for char in value):
        raise ModelError('invalid_model', '模型配置有必填项缺失或内容无效。')
    return value


def valid_url(base_url):
    try:
        parsed = urlsplit(base_url)
        return (parsed.scheme in ('http', 'https') and bool(parsed.hostname)
                and parsed.username is None and parsed.password is None
                and not parsed.query and not parsed.fragment and parsed.port != 0
                and not any(char.isspace() or ord(char) < 32 for char in base_url)
                and '\\' not in base_url)
    except ValueError:
        return False


def _validate(fields):
    name = _clean_text(fields.get('name'), 80)
    model = _clean_text(fields.get('model'), 160)
    base_url = _clean_text(fields.get('base_url'), 2048).rstrip('/')
    api_key = _clean_text(fields.get('api_key', ''), 4096, required=False)
    if not valid_url(base_url):
        raise ModelError('invalid_model_url', '请填写不含凭据、查询参数或片段的 HTTP 或 HTTPS 接口地址。')
    if not api_key.isascii():
        raise ModelError('invalid_model_key', 'API 密钥包含无效字符。')
    vision = fields.get('vision_enabled', False)
    efforts = fields.get('reasoning_efforts', [])
    if not isinstance(vision, bool):
        raise ModelError('invalid_model', '图片能力设置无效。')
    if (not isinstance(efforts, list) or len(efforts) > len(REASONING_EFFORTS)
            or any(value not in REASONING_EFFORTS for value in efforts)
            or len(set(efforts)) != len(efforts)):
        raise ModelError('invalid_reasoning_effort', '推理强度仅支持已配置的 low、medium 或 high。')
    return dict(name=name, base_url=base_url, api_key=api_key, model=model,
                vision_enabled=vision, reasoning_efforts=efforts)


class ModelStore:
    def __init__(self, folder):
        self.path = Path(folder).resolve() / 'models.json'
        self.legacy = ROOT / 'data' / 'models.json'
        self.lock = threading.RLock()

    def _load(self):
        source = self.path if self.path.is_file() else self.legacy
        if not source.is_file():
            return dict(active=BUILTIN, providers=[])
        try:
            with source.open('rb') as stream:
                raw = stream.read(MAX_SETTINGS_BYTES + 1)
            if len(raw) > MAX_SETTINGS_BYTES:
                raise ValueError('settings too large')
            data = json.loads(raw.decode('utf-8-sig'))
            entries = data.get('providers')
            if not isinstance(entries, list) or len(entries) > MAX_MODELS:
                raise ValueError('invalid provider list')
            providers, seen = [], {BUILTIN}
            groups = {}
            for entry in entries:
                model_id = entry.get('id', '')
                if not isinstance(model_id, str) or not MODEL_ID.fullmatch(model_id) or model_id in seen:
                    raise ValueError('invalid or duplicate model id')
                seen.add(model_id)
                created = entry.get('created_at', 0)
                timestamp = created if type(created) in (float, int) and 0 <= created < 1e12 else 0
                config = _validate(entry)
                shared = tuple(config[field] for field in ('name', 'base_url', 'api_key'))
                group_id = entry.get('group_id')
                if group_id is None:
                    # Only group legacy models that already share the same credentials.
                    # Seed the public opaque ID from the first existing model ID, never the key.
                    group_id = next((key for key, values in groups.items() if values == shared), None)
                    group_id = group_id or 'g_' + hashlib.sha256(model_id.encode('ascii')).hexdigest()[:32]
                if (not isinstance(group_id, str) or not GROUP_ID.fullmatch(group_id)
                        or (group_id in groups and groups[group_id] != shared)):
                    raise ValueError('invalid provider group')
                groups[group_id] = shared
                providers.append(dict(config, id=model_id, group_id=group_id, created_at=timestamp))
            active = data.get('active', BUILTIN)
            data = dict(active=active if isinstance(active, str) and active in seen else BUILTIN, providers=providers)
        except (AttributeError, OSError, ValueError, RecursionError) as exc:
            raise ModelError('model_store_unavailable', '无法读取本机模型配置，请检查 models.json。', 503) from exc
        if source != self.path or any('group_id' not in entry for entry in entries):
            self._write(data)
        return data

    def _write(self, data):
        encoded = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        if len(encoded) > MAX_SETTINGS_BYTES:
            raise ModelError('model_store_limit', '本机模型配置超过大小限制。', 409)
        temporary = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=self.path.parent, prefix='.models-', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.path)
        except OSError as exc:
            raise ModelError('model_store_unavailable', '无法保存本机模型配置，请检查文件权限。', 503) from exc
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    @staticmethod
    def _find(data, model_id):
        if not isinstance(model_id, str) or not MODEL_ID.fullmatch(model_id):
            raise ModelError('model_not_found', '模型不存在，请重新选择。', 404)
        for entry in data['providers']:
            if entry['id'] == model_id:
                return entry
        raise ModelError('model_not_found', '模型不存在，请重新选择。', 404)

    @staticmethod
    def _public(entry, *, builtin=False):
        result = {key: entry[key] for key in ('id', 'name', 'base_url', 'model', 'vision_enabled', 'reasoning_efforts')}
        key = entry['api_key']
        configured = bool(key and key.isascii() and all(ord(char) >= 32 for char in key)
                          and entry['model'] and valid_url(entry['base_url']))
        if builtin and not valid_url(result['base_url']):
            result['base_url'] = ''
        return dict(result, builtin=builtin, configured=configured,
                    group_id=BUILTIN if builtin else entry['group_id'],
                    api_key_masked='已配置' if entry['api_key'] else '未配置')

    def list(self, builtin):
        with self.lock:
            data = self._load()
        items = [self._public(builtin, builtin=True), *(self._public(entry) for entry in data['providers'])]
        return dict(active=data['active'], providers=items)

    def resolve(self, model_id, builtin):
        if model_id == BUILTIN:
            return builtin
        with self.lock:
            data = self._load()
        selected = data['active'] if model_id is None else model_id
        return builtin if selected == BUILTIN else self._find(data, selected)

    @staticmethod
    def _validate_fields(fields):
        if not fields or set(fields) - FIELDS:
            raise ModelError('invalid_model', '模型配置字段无效。')

    def put(self, fields, model_id=None):
        group_id = fields.get('group_id')
        if group_id is not None and model_id is None:
            if set(fields) - (MODEL_FIELDS | {'group_id'}) or 'model' not in fields:
                raise ModelError('invalid_model', '请为服务商填写模型标识。')
        else:
            self._validate_fields(fields)
        if model_id is None and group_id is None and not {'name', 'base_url', 'model'} <= set(fields):
            raise ModelError('invalid_model', '请填写服务商名称、接口地址和模型标识。')
        with self.lock:
            data = self._load()
            if model_id is None:
                if len(data['providers']) >= MAX_MODELS:
                    raise ModelError('model_store_limit', f'最多可添加 {MAX_MODELS} 个本机模型。', 409)
                if group_id is not None:
                    shared = self._group(data, group_id)[0]
                    config = _validate({**{field: shared[field] for field in GROUP_FIELDS}, **fields})
                else:
                    config = _validate(fields)
                    group_id = 'g_' + uuid.uuid4().hex
                entry = dict(config, id='m_' + uuid.uuid4().hex, group_id=group_id, created_at=time.time())
                data['providers'].append(entry)
            else:
                current = self._find(data, model_id)
                config = _validate(dict(current, **fields))
                group_id = current['group_id']
                if any(config[field] != current[field] for field in GROUP_FIELDS):
                    # Preserve legacy per-row editing. An independent connection becomes its own group.
                    if len(self._group(data, group_id)) > 1:
                        group_id = 'g_' + uuid.uuid4().hex
                entry = dict(config, id=model_id, group_id=group_id, created_at=current['created_at'])
                data['providers'] = [entry if row['id'] == model_id else row for row in data['providers']]
            self._write(data)
        return self._public(entry)

    @staticmethod
    def _group(data, group_id):
        if not isinstance(group_id, str) or not GROUP_ID.fullmatch(group_id):
            raise ModelError('provider_not_found', '服务商不存在，请重新选择。', 404)
        rows = [entry for entry in data['providers'] if entry['group_id'] == group_id]
        if not rows:
            raise ModelError('provider_not_found', '服务商不存在，请重新选择。', 404)
        return rows

    def update_group(self, group_id, fields):
        if not fields or set(fields) - GROUP_FIELDS:
            raise ModelError('invalid_provider', '服务商配置字段无效。')
        with self.lock:
            data = self._load()
            changed = []
            rows = self._group(data, group_id)
            for row in rows:
                config = _validate(dict(row, **fields))
                row.update(config)
                changed.append(self._public(row))
            self._write(data)
        return dict(group_id=group_id, providers=changed)

    def set_active(self, model_id):
        with self.lock:
            data = self._load()
            if model_id != BUILTIN:
                self._find(data, model_id)
            data['active'] = model_id
            self._write(data)
        return dict(active=model_id)

    def remove(self, model_id):
        with self.lock:
            data = self._load()
            self._find(data, model_id)
            data['providers'] = [item for item in data['providers'] if item['id'] != model_id]
            if data['active'] == model_id:
                data['active'] = BUILTIN
            self._write(data)
        return dict(removed=True, active=data['active'])
