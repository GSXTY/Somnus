"""Fetch a public web page and reduce it to text for the chat model.

Only http/https, only public addresses, bounded size and time: the assistant is
reachable by colleagues, so this must not become an SSRF gadget for the intranet.
"""
from __future__ import annotations

import html
import ipaddress
import re
import socket
import urllib.parse
import urllib.request

MAX_BYTES = 2 * 1024 * 1024
MAX_TEXT = 20_000
TIMEOUT = 15
USER_AGENT = 'Mozilla/5.0 (compatible; YA70Assistant/1.0)'


class FetchError(ValueError):
    pass


# Local proxies answer DNS with this benchmarking range (fake-ip). It cannot
# route to the intranet, so treating it as public keeps the SSRF guard effective
# while still allowing normal browsing through such a proxy.
PROXY_FAKE_RANGE = ipaddress.ip_network('198.18.0.0/15')


def _assert_public(host):
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        raise FetchError('无法解析该域名。') from None
    for info in infos:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        if ip in PROXY_FAKE_RANGE:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise FetchError('出于安全考虑，不能访问内网或本机地址。')


def _check(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise FetchError('只支持 http 或 https 链接。')
    if not parsed.hostname:
        raise FetchError('链接缺少主机名。')
    _assert_public(parsed.hostname)
    return parsed


def to_text(markup):
    title_match = re.search(r'<title[^>]*>(.*?)</title>', markup, re.S | re.I)
    title = html.unescape(title_match.group(1)).strip() if title_match else ''
    body = re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>', ' ', markup)
    body = re.sub(r'(?s)<[^>]+>', ' ', body)
    body = html.unescape(body)
    body = re.sub(r'[ \t\u00a0]+', ' ', body)
    body = re.sub(r'\s*\n\s*', '\n', body).strip()
    return title, body


def fetch(url, opener=None):
    if not isinstance(url, str) or len(url) > 2000:
        raise FetchError('链接无效。')
    _check(url)
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,text/plain,*/*'})
    try:
        with (opener or urllib.request.urlopen)(request, timeout=TIMEOUT) as response:
            final = response.geturl()
            _check(final)
            raw = response.read(MAX_BYTES + 1)
            content_type = response.headers.get('Content-Type', '')
    except FetchError:
        raise
    except Exception:
        raise FetchError('抓取失败：无法打开该链接（可能需要登录或被限制访问）。') from None
    if len(raw) > MAX_BYTES:
        raise FetchError('页面超过 2MB 限制，未解析。')
    charset = 'utf-8'
    match = re.search(r'charset=([\w-]+)', content_type, re.I)
    if match:
        charset = match.group(1)
    try:
        text = raw.decode(charset, 'replace')
    except LookupError:
        text = raw.decode('utf-8', 'replace')
    if 'html' in content_type or text.lstrip().startswith('<'):
        title, body = to_text(text)
    else:
        title, body = '', text.strip()
    if not body:
        raise FetchError('页面没有可读正文。')
    return dict(url=final, title=title[:200], text=body[:MAX_TEXT], chars=len(body))
