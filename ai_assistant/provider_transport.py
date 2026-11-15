"""Handle safe errors from OpenAI-compatible model endpoints."""
from urllib.error import HTTPError, URLError
import json
import ssl
import time
from urllib.parse import urlsplit


TRANSIENT = {429, 502, 503, 504}


def official_openai(endpoint):
    url = urlsplit(endpoint)
    return url.scheme == 'https' and url.hostname == 'api.openai.com' and url.port in (None, 443)


def open_stream(open_url, request, timeout, cancel):
    try:
        return open_url(request, timeout=timeout)
    except HTTPError as exc:
        if exc.code not in TRANSIENT:
            raise
        retry_after = exc.headers.get('Retry-After') if exc.headers else None
        if retry_after and not (retry_after.isascii() and retry_after.isdecimal() and len(retry_after) <= 3):
            raise
        delay = float(retry_after) if retry_after else .35
        if delay > 2 or cancel.wait(delay):
            raise
        exc.close()
    return open_url(request, timeout=timeout)


def response_issue(error):
    if isinstance(error, HTTPError):
        code = error.code
        if code == 401:
            return 'authentication_failed', '校验失败。请检查 API 密钥与服务商账户。', code
        if code == 403:
            return 'access_denied', '访问受限。请检查账户权限和所选模型的授权。', code
        if code == 404:
            return 'model_or_endpoint_not_found', '找不到接口或模型。请核对接口地址和模型 ID。', code
        if code in (400, 405, 415, 422):
            return 'request_rejected', '服务拒绝了请求。请核对模型 ID 和 Chat Completions 接口兼容性。', code
        if code == 429:
            return 'rate_limited', '服务达到请求或用量限制。请核对额度，稍后重试。', code
        if 300 <= code < 400:
            return 'redirect_rejected', '接口要求跳转。请填写最终接口地址。', code
        if code >= 500:
            return 'provider_unavailable', '模型服务暂时不可用。请稍后重试。', code
        return 'upstream_error', '模型服务返回错误。请核对配置与服务状态。', code
    cause = error.reason if isinstance(error, URLError) else error
    if isinstance(cause, TimeoutError):
        return 'connection_timeout', '模型响应超时。请检查网络和接口可用性。', None
    if isinstance(cause, ssl.SSLError):
        return 'tls_error', '无法验证接口的 TLS 连接。请检查证书与接口地址。', None
    return 'connection_failed', '无法连接模型。请检查网络、代理设置和接口地址。', None


def probe_stream(response, deadline):
    if 'text/event-stream' not in response.headers.get('Content-Type', ''):
        return 'invalid_response', '接口未返回兼容的 Chat Completions 流。请核对接口地址。'
    responded = False
    stopped = False
    terminal_choice = False
    for _ in range(96):
        if time.monotonic() >= deadline:
            return 'connection_timeout', '模型响应超时。请检查网络和接口可用性。'
        raw = response.readline(32 * 1024 + 1)
        if len(raw) > 32 * 1024 or not raw:
            break
        line = raw.strip()
        if not line.startswith(b'data:'):
            continue
        data = line[5:].strip()
        if data == b'[DONE]':
            stopped = True
            break
        try:
            packet = json.loads(data)
        except (ValueError, UnicodeError):
            break
        if not isinstance(packet, dict):
            break
        if packet.get('error'):
            return 'upstream_error', '服务已连接，但所选模型拒绝生成。请检查模型和账户权限。'
        choices = packet.get('choices')
        if choices is not None and not isinstance(choices, list):
            break
        for choice in choices or ():
            if not isinstance(choice, dict):
                continue
            delta = choice.get('delta')
            responded |= isinstance(delta, dict) and isinstance(delta.get('content'), str) and bool(delta['content'])
            if choice.get('finish_reason') in ('stop', 'length'):
                stopped = True
                terminal_choice = True
    if stopped and (responded or terminal_choice):
        return 'ok', '连接成功，模型已响应。'
    return 'invalid_response', '服务未返回可用的模型响应。请检查兼容性。'
