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
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid


BUILTIN = 'deepseek'
REASONING_EFFORTS = ('low', 'medium', 'high')
MAX_MODELS = 64
MAX_SETTINGS_BYTES = 512 * 1024
MODEL_ID = re.compile(r'm_[0-9a-f]{10,32}')
GROUP_ID = re.compile(r'g_[0-9a-f]{32}')
CHAT_API = 'openai-completions'
RESPONSES_API = 'openai-responses'
MESSAGES_API = 'anthropic-messages'
BEDROCK_API = 'bedrock-converse-stream'
PROVIDER_APIS = (CHAT_API, RESPONSES_API, MESSAGES_API, BEDROCK_API)
BEDROCK_ENV = 'AWS_BEARER_TOKEN_BEDROCK'
AUTH_ENV = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,127}')
AWS_REGION = re.compile(r'[a-z]{2}(?:-[a-z0-9]+){1,4}-[0-9]')
GROUP_FIELDS = {'name', 'base_url', 'api_key', 'api', 'auth_env', 'retry_policy', 'region'}
CAPABILITY_FIELDS = {'context_window', 'max_output_tokens', 'supports_developer_role',
                     'supports_long_cache_retention', 'cache_retention'}
MODEL_FIELDS = {'model', 'vision_enabled', 'reasoning_efforts'} | CAPABILITY_FIELDS
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


def retry_policy(value):
    if value is None:
        return None
    error = ModelError('invalid_retry_policy', '重试策略或退避参数无效。')
    if not isinstance(value, dict) or value.get('mode') not in ('normal', 'always'):
        raise error
    allowed = {'mode', 'backoff'} | ({'maxRetries', 'retryableCodes'} if value['mode'] == 'normal' else set())
    if set(value) - allowed:
        raise error
    if 'maxRetries' in value and (type(value['maxRetries']) is not int or not 0 <= value['maxRetries'] <= 9_007_199_254_740_991):
        raise error
    if 'retryableCodes' in value:
        codes = value['retryableCodes']
        if (not isinstance(codes, list) or not 1 <= len(codes) <= 64
                or not all(isinstance(code, str) and 0 < len(code) <= 100 and code.isprintable() for code in codes)
                or len(set(codes)) != len(codes)):
            raise error
    if 'backoff' in value:
        backoff = value['backoff']
        if (not isinstance(backoff, dict) or set(backoff) - {'initialDelayMs', 'maxDelayMs', 'jitterRatio'}):
            raise error
        initial, maximum, jitter = (backoff.get('initialDelayMs', 500), backoff.get('maxDelayMs', 10000),
                                    backoff.get('jitterRatio', 0.1))
        if (type(initial) not in (int, float) or type(maximum) not in (int, float) or type(jitter) not in (int, float)
                or not 0 < initial <= maximum <= 2_147_483_647 or not 0 <= jitter <= 1):
            raise error
    return value


def model_capabilities(fields):
    result = {field: fields.get(field) for field in CAPABILITY_FIELDS}
    context, output = result['context_window'], result['max_output_tokens']
    default_context = 1_000_000 if fields.get('model') in ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro') else 64_000
    if context is not None and (type(context) is not int or not 1024 <= context <= 10_000_000):
        raise ModelError('invalid_model_capability', '上下文长度须为 1024 至 10000000 的整数。')
    if output is not None and (type(output) is not int or not 1 <= output <= 1_000_000
                               or output > (context if context is not None else default_context) - min(8192, (context if context is not None else default_context) // 2)):
        raise ModelError('invalid_model_capability', '输出上限须为 1 至 1000000 的整数，并为输入至少预留上下文的一半（最多预留 8192）；自定义大窗口请先填写上下文长度。')
    for field in ('supports_developer_role', 'supports_long_cache_retention'):
        if result[field] is not None and type(result[field]) is not bool:
            raise ModelError('invalid_model_capability', '模型兼容能力须为自动、支持或不支持。')
    if result['cache_retention'] not in (None, 'none', 'short', 'long'):
        raise ModelError('invalid_model_capability', '缓存保留策略无效。')
    if result['cache_retention'] == 'long' and result['supports_long_cache_retention'] is not True:
        raise ModelError('invalid_model_capability', '长期缓存须先明确声明服务支持长期缓存。')
    if fields.get('api') in (MESSAGES_API, BEDROCK_API) and result['supports_developer_role'] is True:
        raise ModelError('invalid_model_capability', '此原生接口不使用 developer 角色。')
    if fields.get('api') == BEDROCK_API and result['supports_long_cache_retention'] is True:
        raise ModelError('invalid_model_capability', '当前 Bedrock 适配器未提供长期缓存兼容开关。')
    return result


def auth_environment(entry, environment=None):
    env = os.environ if environment is None else environment
    name = entry.get('auth_env') or (BEDROCK_ENV if entry.get('api') == BEDROCK_API else '')
    value = env.get(name, '').strip() if name else ''
    return value if len(value) <= 4096 and value.isascii() and value.isprintable() else ''


def credential(entry):
    return entry['api_key'] or auth_environment(entry)


def bedrock_region(entry):
    region = entry.get('region') or os.getenv('AWS_REGION') or os.getenv('AWS_DEFAULT_REGION') or ''
    return region if AWS_REGION.fullmatch(region) else ''


def connection_configured(entry):
    if entry.get('api') == BEDROCK_API:
        # AWS SDK owns credential discovery, including profile, SSO and roles.
        return bool(entry['model'] and bedrock_region(entry))
    return bool(entry['model'] and credential(entry) and valid_url(entry['base_url']))


def _validate(fields):
    name = _clean_text(fields.get('name'), 80)
    model = _clean_text(fields.get('model'), 160)
    api = fields.get('api', CHAT_API)
    if api not in PROVIDER_APIS:
        raise ModelError('invalid_model_protocol', '不支持的模型接口协议。')
    base_url = _clean_text(fields.get('base_url', ''), 2048, required=api != BEDROCK_API).rstrip('/')
    auth_env = _clean_text(fields.get('auth_env', ''), 128, required=False)
    if auth_env and not AUTH_ENV.fullmatch(auth_env):
        raise ModelError('invalid_model_auth_env', '环境变量名称无效。')
    region = _clean_text(fields.get('region', ''), 64, required=False)
    if region and (api != BEDROCK_API or not AWS_REGION.fullmatch(region)):
        raise ModelError('invalid_model_region', '请填写有效的 AWS Region。')
    api_key = _clean_text(fields.get('api_key', ''), 4096, required=False)
    if (base_url or api != BEDROCK_API) and not valid_url(base_url):
        raise ModelError('invalid_model_url', '请填写不含凭据、查询参数或片段的 HTTP 或 HTTPS 接口地址。')
    if api_key and (not api_key.isascii() or not api_key.isprintable()):
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
                vision_enabled=vision, reasoning_efforts=efforts, api=api, auth_env=auth_env, region=region,
                retry_policy=retry_policy(fields.get('retry_policy')), **model_capabilities(dict(fields, api=api)))


class ModelStore:
    def __init__(self, folder, database=None):
        self.path = Path(folder).resolve() / 'models.json'
        self.legacy = None if os.getenv('SOMNUS_PROFILE_CONFIG_ONLY') else ROOT / 'data' / 'models.json'
        self.database = database
        self.lock = threading.RLock()
        if self.database is not None:
            with self.database() as db:
                db.execute('''CREATE TABLE IF NOT EXISTS model_selection (
                    singleton INTEGER PRIMARY KEY CHECK (singleton=1), model_id TEXT NOT NULL
                )''')

    def _load(self, db=None):
        source = self.path if self.path.is_file() else self.legacy
        if source is None or not source.is_file():
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
                shared = tuple(config[field] for field in sorted(GROUP_FIELDS))
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
            company_key = data.get('company_key')
            data = dict(active=active if isinstance(active, str) and active in seen else BUILTIN, providers=providers)
            if company_key is not None:
                revision = company_key.get('revision')
                if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{32}', revision):
                    raise ValueError('invalid company key revision')
                key = _clean_text(company_key.get('api_key'), 4096)
                if any(ord(char) > 126 for char in key):
                    raise ValueError('invalid company key')
                data['company_key'] = dict(api_key=key, revision=revision)
        except (AttributeError, OSError, ValueError, RecursionError) as exc:
            raise ModelError('model_store_unavailable', '无法读取本机模型配置，请检查 models.json。', 503) from exc
        if source != self.path or any('group_id' not in entry for entry in entries):
            self._write(data)
        # Existing JSON files provide the initial selection. Subsequent selections
        # live beside personal plugin state so checkpoint restores commit together.
        if db is None and self.database is not None:
            with self.database() as connection:
                selected = self._selection(connection)
        else:
            selected = self._selection(db) if db is not None else None
        if selected is not None:
            data['active'] = selected if selected in seen else BUILTIN
        return data

    @staticmethod
    def _selection(db):
        row = db.execute('SELECT model_id FROM model_selection WHERE singleton=1').fetchone()
        return row[0] if row is not None else None

    def company_key(self):
        with self.lock:
            return self._load().get('company_key')

    def set_company_key(self, fields):
        with self.lock:
            data = self._load()
            current = data.get('company_key')
            if fields is None:
                if current is not None:
                    del data['company_key']
                    self._write(data)
                return None
            if set(fields) != {'api_key'}:
                raise ModelError('invalid_model', '公司连接只允许设置公司分配的 API 密钥。')
            key = _clean_text(fields['api_key'], 4096)
            if any(ord(char) > 126 for char in key):
                raise ModelError('invalid_model_key', '请填写有效的公司 API 密钥。')
            if current and current['api_key'] == key:
                return current
            data['company_key'] = dict(api_key=key, revision=uuid.uuid4().hex)
            self._write(data)
            return data['company_key']

    @staticmethod
    def _write_selection(db, model_id):
        db.execute('''INSERT INTO model_selection VALUES (1, ?)
                      ON CONFLICT(singleton) DO UPDATE SET model_id=excluded.model_id''', (model_id,))

    def _write(self, data):
        if len({entry['group_id'] for entry in data['providers'] if entry['api'] == BEDROCK_API}) > 1:
            raise ModelError('bedrock_provider_limit', '当前可配置一个 Amazon Bedrock 连接。', 409)
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
        configured = connection_configured(entry)
        if not builtin:
            result.update({field: entry[field] for field in ('api', 'auth_env', 'region', 'retry_policy')})
            result.update({field: entry.get(field) for field in CAPABILITY_FIELDS})
            result['auth_env_present'] = bool(auth_environment(entry))
            result['has_api_key'] = bool(entry['api_key'])
        if builtin and not valid_url(result['base_url']):
            result['base_url'] = ''
        return dict(result, builtin=builtin, configured=configured,
                    **({'requires_api_key': True} if builtin and entry.get('requires_api_key') else {}),
                    group_id=BUILTIN if builtin else entry['group_id'],
                    api_key_masked='已配置' if entry['api_key'] else '未配置')

    def list(self, builtin):
        with self.lock:
            data = self._load()
        items = [self._public(builtin, builtin=True), *(self._public(entry) for entry in data['providers'])]
        return dict(active=data['active'], providers=items)

    def configured_snapshot(self):
        with self.lock:
            data = self._load()
        active = data['active'] if data['active'] != BUILTIN else ''
        return active, data['providers']

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
        if model_id is None and group_id is None and not {'name', 'model'} <= set(fields):
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

    def _discovery_config(self, fields):
        allowed = GROUP_FIELDS | {'group_id'}
        if set(fields) - allowed:
            raise ModelError('invalid_provider', '服务商配置字段无效。')
        shared = dict(fields)
        group_id = shared.pop('group_id', None)
        if group_id is not None:
            if shared:
                raise ModelError('invalid_provider', '请使用已保存的供应商连接。')
            shared = self._group(self._load(), group_id)[0]
        return _validate(dict(shared, model='model-discovery'))

    def discover(self, fields):
        with self.lock:
            config = self._discovery_config(fields)
        if config['api'] == BEDROCK_API:
            raise ModelError('model_discovery_unavailable', 'Bedrock 请手工添加可用的模型 ID。')
        key = credential(config)
        if not key:
            raise ModelError('model_discovery_key_required', '请先填写或保存供应商的 API Key。')
        messages = config['api'] == MESSAGES_API
        base = config['base_url'].removesuffix('/chat/completions').removesuffix('/responses').removesuffix('/messages')
        if messages and not base.endswith('/v1'):
            base += '/v1'
        headers = {'x-api-key': key, 'anthropic-version': '2023-06-01'} if messages else {'Authorization': 'Bearer ' + key}
        request = Request(base + '/models', headers={'Accept': 'application/json', **headers})

        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self, request, fp, code, msg, headers, newurl):
                return None

        size_limit = 2 * 1024 * 1024
        try:
            with build_opener(NoRedirect()).open(request, timeout=10) as response:
                raw = response.read(size_limit + 1)
            if len(raw) > size_limit:
                raise ValueError('model catalog too large')
            payload = json.loads(raw)
            if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
                raise ValueError('unexpected model catalog')
        except HTTPError as exc:
            raise ModelError('model_discovery_failed',
                             f'供应商模型列表接口返回 HTTP {exc.code}。请检查地址或手工添加模型。', 502) from None
        except (URLError, OSError, ValueError, RecursionError):
            raise ModelError('model_discovery_failed',
                             '无法读取供应商模型列表。请检查连接或手工添加模型。', 502) from None
        ids = {}
        for item in payload['data']:
            identifier = item.get('id') if isinstance(item, dict) else None
            if isinstance(identifier, str) and 0 < len(identifier) <= 160 and identifier.isprintable():
                identifier = identifier.strip()
                if identifier:
                    ids[identifier] = None
            if len(ids) >= 2000:
                break
        return list(ids)

    def add_discovered(self, fields):
        fields = dict(fields)
        identifiers = fields.pop('models', None)
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= MAX_MODELS:
            raise ModelError('invalid_model', f'请选择 1 至 {MAX_MODELS} 个模型。')
        identifiers = list(dict.fromkeys(_clean_text(model, 160) for model in identifiers))
        with self.lock:
            data = self._load()
            config = self._discovery_config(fields)
            group_id = fields.get('group_id') or ('g_' + uuid.uuid4().hex)
            existing = {row['model']: row for row in data['providers'] if row['group_id'] == group_id}
            missing = [model for model in identifiers if model not in existing]
            if len(data['providers']) + len(missing) > MAX_MODELS:
                raise ModelError('model_store_limit', f'最多可添加 {MAX_MODELS} 个本机模型。', 409)
            for model in missing:
                entry = dict(config, model=model, id='m_' + uuid.uuid4().hex,
                             group_id=group_id, created_at=time.time())
                data['providers'].append(entry)
                existing[model] = entry
            if missing:
                self._write(data)
            return [self._public(existing[model]) for model in identifiers]

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
            if self.database is not None:
                with self.database() as db:
                    self._write_selection(db, model_id)
            else:
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
