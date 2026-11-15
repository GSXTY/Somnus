"""Read the official public MCP Registry without contacting listed MCP servers."""
from collections import OrderedDict
from http.client import HTTPException
import ipaddress
import json
import re
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from mcp_connectors.client import HTTP_HEADER, UNSAFE_HEADERS
from mcp_connectors.registry import ConfigError


REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0.1/servers'
OFFICIAL_METADATA = 'io.modelcontextprotocol.registry/official'
PAGE_SIZE = 24
MAX_BYTES = 1024 * 1024
TIMEOUT = 8
CACHE_TTL = 60
CACHE_SIZE = 32
BEARER = re.compile(r'Bearer \{[A-Za-z_][A-Za-z0-9_]*\}', re.IGNORECASE)
HOST_NAME = re.compile(r'[A-Za-z0-9.-]+\Z')


class NoRegistryRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _text(value, limit):
    if not isinstance(value, str):
        return ''
    return ''.join(char for char in value if char.isprintable() or char in '\n\t').strip()[:limit]


def _url(value, *, endpoint=False):
    if (not isinstance(value, str) or not value or len(value) > 2048 or '\\' in value
            or any(char.isspace() or not char.isprintable() for char in value)):
        return None
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if parsed.scheme != 'https' or not host or parsed.username or parsed.password or parsed.port == 0:
            return None
        if endpoint and ('?' in value or '#' in value or '{' in value or '}' in value):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            bare_host = host.rstrip('.').lower()
            if (not HOST_NAME.fullmatch(bare_host) or '.' not in bare_host
                    or bare_host.endswith(('.local', '.localhost', '.internal'))
                    or not any(char.isalpha() for char in bare_host.rsplit('.', 1)[-1])):
                return None
        return value
    except ValueError:
        return None


def _inputs(rows):
    if not isinstance(rows, list) or len(rows) > 40:
        return None
    seen = set()
    result = []
    for row in rows:
        name = row.get('name') if isinstance(row, dict) else None
        if not isinstance(name, str) or not 0 < len(name) <= 128 or not HTTP_HEADER.fullmatch(name):
            return None
        lowered = name.lower()
        if lowered in UNSAFE_HEADERS or lowered in seen or lowered.startswith('mcp-param-'):
            return None
        seen.add(lowered)
        result.append({
            'id': name, 'label': name, 'target': 'header',
            'description': _text(row.get('description'), 400),
            'required': row.get('isRequired') is True,
            'secret': row.get('isSecret') is True or lowered == 'authorization',
        })
        value = row.get('value')
        if isinstance(value, str) and BEARER.fullmatch(value.strip()):
            result[-1]['template'] = 'Bearer {value}'
    return result


def _normalize(row):
    if not isinstance(row, dict) or not isinstance(row.get('server'), dict):
        return None
    server = row['server']
    metadata = row.get('_meta')
    official = metadata.get(OFFICIAL_METADATA) if isinstance(metadata, dict) else None
    if isinstance(official, dict) and official.get('status') not in (None, 'active'):
        return None
    name = _text(server.get('name'), 255)
    if not name:
        return None
    variants = []
    remotes = server.get('remotes')
    for remote in remotes[:12] if isinstance(remotes, list) else []:
        if not isinstance(remote, dict) or remote.get('type') != 'streamable-http':
            continue
        url = _url(remote.get('url'), endpoint=True)
        inputs = _inputs(remote.get('headers', []))
        if not url or inputs is None:
            continue
        variants.append({'transport': 'http', 'label': 'HTTPS · ' + urlsplit(url).netloc,
                         'url': url, 'inputs': inputs})
    result = {'name': name, 'title': _text(server.get('title'), 100) or name,
              'description': _text(server.get('description'), 800), 'version': _text(server.get('version'), 100),
              'variants': variants}
    repository = server.get('repository')
    website = _url(server.get('websiteUrl'))
    repository_url = _url(repository.get('url')) if isinstance(repository, dict) else None
    if website:
        result['websiteUrl'] = website
    if repository_url:
        result['repositoryUrl'] = repository_url
    return result


class MarketCatalog:
    def __init__(self, *, opener=None):
        self._open = opener or build_opener(NoRegistryRedirect()).open
        self._cache = OrderedDict()
        self._lock = Lock()

    def search(self, query='', cursor=''):
        query = query.strip()
        if len(query) > 160 or (query and (len(query) < 3 or not query.isprintable())):
            raise ConfigError('搜索词须为 3 至 160 个字符。')
        if len(cursor) > 1024 or (cursor and not cursor.isprintable()):
            raise ConfigError('MCP 市场翻页参数无效。')
        key = (query, cursor)
        with self._lock:
            cached = self._cache.get(key)
            if cached and monotonic() - cached[0] < CACHE_TTL:
                return cached[1]
        params = {'limit': PAGE_SIZE, 'version': 'latest'}
        if query:
            params['search'] = query
        if cursor:
            params['cursor'] = cursor
        try:
            request = Request(REGISTRY_URL + '?' + urlencode(params), headers={'Accept': 'application/json'})
            with self._open(request, timeout=TIMEOUT) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError('registry size limit')
            data = json.loads(raw)
            if not isinstance(data, dict) or not isinstance(data.get('servers'), list):
                raise ValueError('registry response')
        except HTTPError as exc:
            exc.close()
            raise ConfigError('暂时无法读取官方 MCP 市场，请稍后重试。', 502) from exc
        except (URLError, TimeoutError, OSError, HTTPException, ValueError, RecursionError) as exc:
            raise ConfigError('暂时无法读取官方 MCP 市场，请检查网络或稍后重试。', 502) from exc
        results = [entry for row in data['servers'][:PAGE_SIZE] if (entry := _normalize(row))]
        meta = data.get('metadata')
        next_cursor = meta.get('nextCursor') if isinstance(meta, dict) else None
        if (not isinstance(next_cursor, str) or not next_cursor or len(next_cursor) > 1024
                or not next_cursor.isprintable() or next_cursor == cursor):
            next_cursor = None
        payload = {'servers': results, 'next_cursor': next_cursor}
        with self._lock:
            self._cache[key] = (monotonic(), payload)
            self._cache.move_to_end(key)
            if len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return payload
