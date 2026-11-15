"""Per-turn model access for the managed company DSH profile."""
import hmac
import os
import re
import secrets
import threading
from urllib.error import HTTPError, URLError

from .models import BUILTIN


AGENT_ID = 'fbbce833-544a-42a1-8579-cba2a817383e'
PACKAGE = re.compile(r'(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*')
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?')
MODEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}')
RELAY_LIMIT = 12 * 1024 * 1024
MAX_REQUESTS = 24
MAX_OUTPUT_TOKENS = 16384


def info(config):
    if (os.getenv('VV_MAN_COMPANY_DSH', '').strip() != '1' or not config.configured
            or not MODEL.fullmatch(config.model)):
        return None
    packages = {}
    for item in os.getenv('VV_MAN_COMPANY_DSH_PLUGINS', '').split(',')[:32]:
        name, separator, version = item.strip().rpartition('@')
        if separator and PACKAGE.fullmatch(name) and VERSION.fullmatch(version):
            packages[name] = version
    return {'model': config.model, 'vision': config.vision_enabled, 'plugins': packages}


def selected(service, model_id):
    config, _ = service._turn_settings({'project_desktop': True, 'model_id': model_id})
    return info(config) if config.provider_id == BUILTIN else None


class ModelLease:
    def __init__(self, configuration, options):
        self.config = configuration
        self.options = options
        self.token = secrets.token_hex(32)
        self.lock = threading.Lock()
        self.count = 0
        self.in_flight = False

    def authorize(self, token, body):
        if not hmac.compare_digest(token.encode(), self.token.encode()):
            return None
        if (body.get('model') != self.config.model or body.get('stream') is not True
                or not isinstance(body.get('messages'), list) or not 0 < len(body['messages']) <= 512
                or not all(isinstance(message, dict) and message.get('role') in
                           ('system', 'developer', 'user', 'assistant', 'tool') for message in body['messages'])):
            return None
        with self.lock:
            if self.in_flight or self.count >= MAX_REQUESTS:
                return None
            self.in_flight = True
            self.count += 1
        keys = {'model', 'stream', 'messages', 'tools', 'tool_choice', 'stream_options', 'temperature',
                'top_p', 'parallel_tool_calls', 'reasoning_effort', 'thinking'}
        request = {key: value for key, value in body.items() if key in keys}
        limit = next((body[key] for key in ('max_tokens', 'max_completion_tokens')
                      if type(body.get(key)) is int and body[key] > 0), MAX_OUTPUT_TOKENS)
        request['max_tokens'] = min(limit, MAX_OUTPUT_TOKENS)
        return request

    def release(self):
        with self.lock:
            self.in_flight = False


def open_response(opener, lease, payload):
    try:
        return opener(lease.config.request(payload), timeout=lease.config.timeout), None
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
