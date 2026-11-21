"""Model access for the managed native company DSH Host."""
import hmac
import hashlib
import json
import os
import re
import secrets
import sys
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request
from urllib.parse import urlsplit

from .models import (BEDROCK_API, BUILTIN, CHAT_API, MESSAGES_API, RESPONSES_API,
                     bedrock_region, connection_configured, credential)


AGENT_ID = 'fbbce833-544a-42a1-8579-cba2a817383e'
MODEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}')
RELAY_LIMIT = 16 * 1024 * 1024
MAX_OUTPUT_TOKENS = 16384
VISION_MODELS = frozenset(('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'))
OFFICIAL_MODELS = ('deepseek-flash', 'deepseek-v4-pro')
OFFICIAL_EFFORTS = ('none', 'low', 'high', 'max')
CHAT_ROLES = ('system', 'developer', 'user', 'assistant', 'tool')
RESPONSE_ITEM_TYPES = frozenset(('reasoning', 'function_call', 'function_call_output',
                                 'custom_tool_call', 'custom_tool_call_output', 'web_search_call'))


def enabled():
    return os.getenv('VV_MAN_COMPANY_DSH', '').strip() == '1'


def configured_providers_only():
    return (sys.platform == 'win32' and getattr(sys, 'frozen', False)
            or os.getenv('SOMNUS_DSH_CONFIGURED_PROVIDERS') == '1')


def configured_roster(service):
    _, entries = service.models.configured_snapshot()
    usable = [entry for entry in entries if connection_configured(entry) and MODEL.fullmatch(entry['model'])]
    effective = [dict(entry, api_key=credential(entry), region=bedrock_region(entry) if entry['api'] == BEDROCK_API else '')
                 for entry in usable]
    revision = hashlib.sha256(json.dumps(effective, sort_keys=True).encode()).hexdigest()[:32]
    return usable, revision


def official_endpoint(config):
    try:
        endpoint = urlsplit(config.base_url)
        return (endpoint.scheme == 'https'
                and endpoint.hostname == 'api.deepseek.com' and endpoint.port in (None, 443)
                and endpoint.username is None and endpoint.password is None
                and not endpoint.query and not endpoint.fragment
                and endpoint.path in ('', '/', '/v1', '/chat/completions', '/v1/chat/completions',
                                      '/responses', '/v1/responses'))
    except ValueError:
        return False


def supports_images(config):
    if official_endpoint(config) and config.model in VISION_MODELS | {'deepseek-v4-pro'}:
        return config.model in VISION_MODELS
    return config.vision_enabled


def catalog(config):
    known_official = official_endpoint(config) and config.model in VISION_MODELS | {'deepseek-v4-pro'}
    models = (config.model, *[model for model in OFFICIAL_MODELS if model != config.model]) if known_official else (config.model,)
    return [dict(model=model, vision=model in VISION_MODELS if known_official else config.vision_enabled,
                 reasoning_efforts=list(OFFICIAL_EFFORTS) if known_official else [],
                 **({'default_reasoning_effort': 'high'} if known_official else {}))
            for model in models if MODEL.fullmatch(model)]


def info(config):
    if (not enabled() or not config.configured
            or not MODEL.fullmatch(config.model)):
        return None
    return {'model': config.model, 'vision': config.vision_enabled}


def selected(service, model_id):
    if configured_providers_only():
        entries, revision = configured_roster(service)
        if not entries or model_id is not None and all(row['id'] != model_id for row in entries):
            return None
        return dict(revision=revision, personal=True)
    config, _ = service._turn_settings({'project_desktop': True, 'model_id': model_id})
    if config.provider_id != BUILTIN:
        return None
    with service.lock:
        selected, revision = service.company_provider()
        options = info(selected)
    return dict(options, revision=revision, models=catalog(selected)) if options else None


def response_input(value):
    if isinstance(value, str):
        return bool(value.strip())
    if not isinstance(value, list) or not 0 < len(value) <= 1536:
        return False
    for item in value:
        if not isinstance(item, dict):
            return False
        kind = item.get('type', 'message')
        if kind == 'message':
            if item.get('role') not in CHAT_ROLES or not isinstance(item.get('content'), (str, list)):
                return False
        elif not isinstance(kind, str) or kind not in RESPONSE_ITEM_TYPES:
            return False
    return True


def output_limit(capabilities):
    settings = capabilities or {}
    context = settings.get('context_window')
    return settings.get('max_output_tokens') or min(MAX_OUTPUT_TOKENS, max(1, context // 4) if context else MAX_OUTPUT_TOKENS)


def cache_parameters(body, capabilities):
    settings = capabilities or {}
    result = {}
    key = body.get('prompt_cache_key')
    if key is not None:
        if not isinstance(key, str) or not 0 < len(key) <= 256 or not key.isprintable():
            return None
        result['prompt_cache_key'] = key
    retention = body.get('prompt_cache_retention')
    options = body.get('prompt_cache_options')
    if retention is not None:
        if retention not in ('in-memory', '24h') or retention == '24h' and settings.get('supports_long_cache_retention') is not True:
            return None
        result['prompt_cache_retention'] = retention
    if options is not None:
        if options == {'mode': 'explicit'}:
            result['prompt_cache_options'] = options
        elif options == {'ttl': '30m'} and settings.get('supports_long_cache_retention') is True:
            result['prompt_cache_options'] = options
        else:
            return None
    if settings.get('cache_retention') == 'none' and (key is not None or retention is not None or options not in (None, {'mode': 'explicit'})):
        return None
    return result


def allowed_roles(messages, capabilities):
    return not ((capabilities or {}).get('supports_developer_role') is False and
                isinstance(messages, list) and any(isinstance(item, dict) and item.get('role') == 'developer' for item in messages))


def allowed_cache_controls(body, capabilities):
    # Anthropic cache markers live inside message/system/tool content, rather than top-level fields.
    pending = [body]
    while pending:
        value = pending.pop()
        if isinstance(value, list):
            pending.extend(value)
        elif isinstance(value, dict):
            control = value.get('cache_control')
            if control is not None and (not isinstance(control, dict) or control.get('type') != 'ephemeral'
                    or set(control) - {'type', 'ttl'} or control.get('ttl') not in (None, '5m', '1h')
                    or control.get('ttl') == '1h' and (capabilities or {}).get('supports_long_cache_retention') is not True
                    or (capabilities or {}).get('cache_retention') == 'none'):
                return False
            pending.extend(item for key, item in value.items() if key not in ('cache_control', 'input_schema', 'parameters', 'schema'))
    return True


def response_request(body, capabilities=None):
    if (not response_input(body.get('input')) or body.get('previous_response_id') is not None
            or not allowed_roles(body.get('input'), capabilities)):
        return None
    tools = body.get('tools', [])
    if not isinstance(tools, list) or len(tools) > 256 or any(
            not isinstance(tool, dict) or tool.get('type') != 'function' for tool in tools):
        return None
    keys = {'model', 'stream', 'input', 'instructions', 'tools', 'tool_choice', 'temperature',
            'top_p', 'parallel_tool_calls', 'reasoning', 'text'}
    request = {key: value for key, value in body.items() if key in keys}
    limit = body.get('max_output_tokens')
    request['max_output_tokens'] = min(limit, output_limit(capabilities)) if type(limit) is int and limit > 0 else output_limit(capabilities)
    if isinstance(body.get('include'), list) and 'reasoning.encrypted_content' in body['include']:
        request['include'] = ['reasoning.encrypted_content']
    cache = cache_parameters(body, capabilities)
    if cache is None:
        return None
    request.update(cache)
    request['store'] = False
    return request


def chat_request(body, capabilities=None):
    messages = body.get('messages')
    if (not isinstance(messages, list) or not 0 < len(messages) <= 512
            or not all(isinstance(message, dict) and message.get('role') in CHAT_ROLES for message in messages)
            or not allowed_roles(messages, capabilities)):
        return None
    keys = {'model', 'stream', 'messages', 'tools', 'tool_choice', 'stream_options', 'temperature',
            'top_p', 'parallel_tool_calls', 'reasoning_effort', 'thinking'}
    request = {key: value for key, value in body.items() if key in keys}
    limit = next((body[key] for key in ('max_tokens', 'max_completion_tokens')
                  if type(body.get(key)) is int and body[key] > 0), MAX_OUTPUT_TOKENS)
    request['max_tokens'] = min(limit, output_limit(capabilities))
    cache = cache_parameters(body, capabilities)
    if cache is None:
        return None
    request.update(cache)
    return request


def messages_request(body, capabilities=None):
    messages = body.get('messages')
    if (not isinstance(messages, list) or not 0 < len(messages) <= 512
            or not all(isinstance(message, dict) and message.get('role') in ('user', 'assistant') for message in messages)):
        return None
    if not allowed_cache_controls(body, capabilities):
        return None
    keys = {'model', 'stream', 'messages', 'system', 'tools', 'tool_choice', 'temperature',
            'top_p', 'top_k', 'stop_sequences', 'thinking', 'output_config'}
    request = {key: value for key, value in body.items() if key in keys}
    limit = body.get('max_tokens')
    request['max_tokens'] = min(limit, output_limit(capabilities)) if type(limit) is int and limit > 0 else output_limit(capabilities)
    return request


def messages_http_request(config, payload):
    base = config.base_url.removesuffix('/messages')
    if not base.endswith('/v1'):
        base += '/v1'
    request = Request(base + '/messages', json.dumps(payload).encode(), headers={
        'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'anthropic-version': '2023-06-01',
    })
    request.add_unredirected_header('x-api-key', config.api_key)
    return request


def probe_messages_stream(response, deadline):
    if 'text/event-stream' not in response.headers.get('Content-Type', ''):
        return 'invalid_response', '接口未返回兼容的 Anthropic Messages 流。'
    text_seen = False
    for _ in range(192):
        if time.monotonic() >= deadline:
            return 'connection_timeout', '模型响应超时。请检查网络和接口可用性。'
        raw = response.readline(32 * 1024 + 1)
        if not raw or len(raw) > 32 * 1024:
            break
        if not raw.startswith(b'data:'):
            continue
        try:
            packet = json.loads(raw[5:])
        except (ValueError, UnicodeError):
            break
        if not isinstance(packet, dict):
            break
        delta = packet.get('delta')
        if packet.get('type') == 'content_block_delta' and isinstance(delta, dict):
            value = delta.get('text')
            text_seen |= isinstance(value, str) and bool(value.strip())
        if packet.get('type') == 'error':
            return 'upstream_error', 'Anthropic 服务已连接，但所选模型拒绝生成。'
        if packet.get('type') == 'message_stop' and text_seen:
            return 'ok', 'Anthropic Messages 连接成功，模型已响应。'
    return 'invalid_response', 'Anthropic Messages 服务未返回完整的模型输出。'


class ModelLease:
    def __init__(self, configuration, options):
        self.config = configuration
        self.token = secrets.token_hex(32)
        self.lock = threading.Lock()
        self.models = {item['model']: item for item in catalog(configuration)}
        subagents = options.get('subagents', {})
        self.max_in_flight = 1 + subagents['maxActiveSubagents'] if subagents.get('maxDepth', 0) > 0 else 1
        self.in_flight = 0

    def authorize(self, token, body, responses=False):
        if responses == MESSAGES_API or not hmac.compare_digest(token.encode(), self.token.encode()):
            return None
        model = body.get('model')
        if not isinstance(model, str) or body.get('stream') is not True:
            return None
        if not responses and model != self.config.model:
            return None
        choice = self.models.get(model)
        if choice is None:
            return None
        if responses and choice['reasoning_efforts'] and 'reasoning' in body:
            reasoning = body['reasoning']
            if not isinstance(reasoning, dict) or reasoning.get('effort') not in (None, *choice['reasoning_efforts']):
                return None
        request = response_request(body) if responses else chat_request(body)
        if request is None:
            return None
        with self.lock:
            if self.in_flight >= self.max_in_flight:
                return None
            self.in_flight += 1
        return request

    def release(self):
        with self.lock:
            self.in_flight = max(0, self.in_flight - 1)


class ProviderRosterLease:
    """One DSH host with isolated credentials for separately selected configured models."""
    def __init__(self, rows, config_from_entry, subagents):
        self.token = secrets.token_hex(32)
        self.revision = None
        self.configs = {row['id']: config_from_entry(row) for row in rows}
        self.efforts = {row['id']: row['reasoning_efforts'] for row in rows}
        self.capabilities = {row['id']: row for row in rows}
        self.lock = threading.Lock()
        self.limit = 16 * (1 + min(subagents['maxActiveSubagents'], 16))
        self.in_flight = 0

    def authorize(self, token, body, responses=False):
        if not hmac.compare_digest(token.encode(), self.token.encode()) or body.get('stream') is not True:
            return None
        selected = body.get('model')
        if not isinstance(selected, str) or selected not in self.configs:
            return None
        config = self.configs[selected]
        api = MESSAGES_API if responses == MESSAGES_API else RESPONSES_API if responses else CHAT_API
        if config.api != api:
            return None
        parser = {CHAT_API: chat_request, RESPONSES_API: response_request, MESSAGES_API: messages_request}[api]
        request = parser(body, self.capabilities[selected])
        if request is None:
            return None
        request['model'] = config.model
        reasoning = request.get('reasoning')
        if reasoning is not None and not isinstance(reasoning, dict):
            return None
        effort = reasoning.get('effort') if reasoning is not None else request.get('reasoning_effort')
        if effort not in (None, *self.efforts[selected]):
            return None
        with self.lock:
            if self.in_flight >= self.limit:
                return None
            self.in_flight += 1
        return config, request

    def release(self):
        with self.lock:
            self.in_flight = max(0, self.in_flight - 1)


def response_http_request(config, payload):
    base = config.base_url.removesuffix('/chat/completions').removesuffix('/responses')
    request = config.request(payload, endpoint=base + '/responses')
    # urllib redirects forward normal headers. Keep the user's key on the configured request only.
    credential = request.get_header('Authorization')
    request.remove_header('Authorization')
    request.add_unredirected_header('Authorization', credential)
    return request


def probe_response_stream(response, deadline):
    if 'text/event-stream' not in response.headers.get('Content-Type', ''):
        return 'invalid_response', '接口未返回兼容的 Responses 流。'
    text_seen = False
    for _ in range(192):
        if time.monotonic() >= deadline:
            return 'connection_timeout', '模型响应超时。请检查网络和接口可用性。'
        raw = response.readline(32 * 1024 + 1)
        if not raw or len(raw) > 32 * 1024:
            break
        if not raw.startswith(b'data:'):
            continue
        try:
            packet = json.loads(raw[5:])
        except (ValueError, UnicodeError):
            break
        if not isinstance(packet, dict):
            break
        kind = packet.get('type')
        if kind == 'response.output_text.delta' and isinstance(packet.get('delta'), str):
            text_seen |= bool(packet['delta'].strip())
        if kind in ('response.failed', 'error'):
            return 'upstream_error', 'Responses 服务已连接，但所选模型拒绝生成。'
        if kind in ('response.completed', 'response.incomplete') and text_seen:
            return 'ok', 'Responses 连接成功，模型已响应。'
    return 'invalid_response', 'Responses 服务未返回完整的模型输出。'


def open_response(opener, lease, payload, responses=False, *, configured=None):
    try:
        config = configured or lease.config
        if configured and not responses and urlsplit(config.endpoint).hostname == 'api.openai.com':
            payload['max_completion_tokens'] = payload.pop('max_tokens')
        if responses == MESSAGES_API:
            request = messages_http_request(config, payload)
        elif responses:
            request = response_http_request(config, payload)
        else:
            request = config.request(payload)
        if not responses:
            credential = request.get_header('Authorization')
            request.remove_header('Authorization')
            request.add_unredirected_header('Authorization', credential)
        return opener(request, timeout=config.timeout), None
    except HTTPError as error:
        status = error.code if error.code in (400, 401, 403, 404, 429) else 502
        error.close()
        return None, status
    except (URLError, OSError, ValueError):
        return None, 502


def read_response(response, cancel):
    if cancel.is_set():
        return b''
    return response.read1(65536)
