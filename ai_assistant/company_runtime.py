"""Model access for the managed native company DSH Host."""
import hmac
import json
import os
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

from .models import BUILTIN


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


def response_request(body):
    if not response_input(body.get('input')) or body.get('previous_response_id') is not None:
        return None
    tools = body.get('tools', [])
    if not isinstance(tools, list) or len(tools) > 256 or any(
            not isinstance(tool, dict) or tool.get('type') != 'function' for tool in tools):
        return None
    keys = {'model', 'stream', 'input', 'instructions', 'tools', 'tool_choice', 'temperature',
            'top_p', 'parallel_tool_calls', 'reasoning', 'text'}
    request = {key: value for key, value in body.items() if key in keys}
    limit = body.get('max_output_tokens')
    request['max_output_tokens'] = min(limit, MAX_OUTPUT_TOKENS) if type(limit) is int and limit > 0 else MAX_OUTPUT_TOKENS
    request['store'] = False
    return request


def chat_request(body):
    messages = body.get('messages')
    if (not isinstance(messages, list) or not 0 < len(messages) <= 512
            or not all(isinstance(message, dict) and message.get('role') in CHAT_ROLES for message in messages)):
        return None
    keys = {'model', 'stream', 'messages', 'tools', 'tool_choice', 'stream_options', 'temperature',
            'top_p', 'parallel_tool_calls', 'reasoning_effort', 'thinking'}
    request = {key: value for key, value in body.items() if key in keys}
    limit = next((body[key] for key in ('max_tokens', 'max_completion_tokens')
                  if type(body.get(key)) is int and body[key] > 0), MAX_OUTPUT_TOKENS)
    request['max_tokens'] = min(limit, MAX_OUTPUT_TOKENS)
    return request


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
        if not hmac.compare_digest(token.encode(), self.token.encode()):
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


def open_response(opener, lease, payload, responses=False):
    try:
        request = response_http_request(lease.config, payload) if responses else lease.config.request(payload)
        return opener(request, timeout=lease.config.timeout), None
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
