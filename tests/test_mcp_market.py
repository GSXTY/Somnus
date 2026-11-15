import json
from io import BytesIO
import os
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from mcp_connectors.asgi import create_router
from mcp_connectors.market import MAX_BYTES, MarketCatalog
from mcp_connectors.registry import ConfigError


def entry(name, *remotes, status='active'):
    return {
        'server': {
            'name': name, 'title': 'Example', 'description': 'Example MCP',
            'version': '1.0.0', 'repository': {'url': 'https://github.com/org/example'},
            'remotes': remotes, 'packages': [{'transport': {'type': 'stdio'}, 'identifier': 'sample-local'}],
        },
        '_meta': {'io.modelcontextprotocol.registry/official': {'status': status}},
    }


class MarketTests(unittest.TestCase):
    def test_search_cursor_cache_and_connection_prep(self):
        remote = {'type': 'streamable-http', 'url': 'https://mcp.example.org/mcp',
                  'headers': [
                      {'name': 'Authorization', 'isRequired': True, 'value': 'Bearer {token}'},
                      {'name': 'X-Private', 'isSecret': True, 'value': 'do-not-prefill', 'default': 'do-not-return'},
                  ]}
        packet = {'servers': [entry('org/public', remote), entry('org/local')], 'metadata': {'nextCursor': 'opaque&x=1'}}
        opener = Mock(side_effect=lambda *_args, **_kwargs: BytesIO(json.dumps(packet).encode()))
        market = MarketCatalog(opener=opener)
        result = market.search(' public ', 'old&cursor=1')
        self.assertEqual(result['next_cursor'], 'opaque&x=1')
        request = opener.call_args.args[0]
        self.assertEqual(urlsplit(request.full_url).hostname, 'registry.modelcontextprotocol.io')
        self.assertEqual(parse_qs(urlsplit(request.full_url).query),
                         {'limit': ['24'], 'version': ['latest'], 'search': ['public'], 'cursor': ['old&cursor=1']})
        self.assertIsNone(request.get_header('Authorization'))
        first, local = result['servers']
        self.assertEqual(local['variants'], [])
        variant = first['variants'][0]
        self.assertEqual(variant['url'], 'https://mcp.example.org/mcp')
        self.assertEqual(variant['inputs'][0], {'id': 'Authorization', 'label': 'Authorization', 'target': 'header',
                                              'description': '', 'required': True, 'secret': True, 'template': 'Bearer {value}'})
        self.assertNotIn('do-not-', json.dumps(result))
        self.assertEqual(market.search('public', 'old&cursor=1'), result)
        self.assertEqual(opener.call_count, 1)

    def test_no_prefill_for_unsafe_or_incompatible_transport(self):
        remotes = [{'type': 'streamable-http', 'url': url} for url in (
            'https://127.0.0.1/mcp', 'https://127.1/mcp', 'https://192.168.1.1/mcp',
            'https://{host}/mcp', 'https://mcp.example.org/query?key=secret', 'https://user:mypass@mcp.example.org/mcp',
            'http://mcp.example.org/mcp', 'https://mcp.example.local/mcp')]
        remotes += [{'type': 'sse', 'url': 'https://mcp.example.org/sse'},
                    {'type': 'streamable-http', 'url': 'https://mcp.example.org/mcp', 'headers': [{'name': 'Host'}]}]
        payload = {'servers': [entry('org/unsupported', *remotes), entry('org/deleted', status='deleted')],
                   'metadata': {'nextCursor': 'same'}}
        market = MarketCatalog(opener=lambda *_args, **_kwargs: BytesIO(json.dumps(payload).encode()))
        result = market.search('test', 'same')
        self.assertEqual([item['name'] for item in result['servers']], ['org/unsupported'])
        self.assertEqual(result['servers'][0]['variants'], [])
        self.assertIsNone(result['next_cursor'])

    def test_validation_and_upstream_failure_are_bounded(self):
        opener = Mock(side_effect=URLError('private url detail'))
        market = MarketCatalog(opener=opener)
        with self.assertRaises(ConfigError) as short:
            market.search('a')
        self.assertEqual(short.exception.status, 400)
        opener.assert_not_called()
        with self.assertRaises(ConfigError) as unreachable:
            market.search('public')
        self.assertEqual(unreachable.exception.status, 502)
        self.assertNotIn('private url detail', str(unreachable.exception))
        oversize = MarketCatalog(opener=lambda *_args, **_kwargs: BytesIO(b'x' * (MAX_BYTES + 1)))
        with self.assertRaises(ConfigError) as large:
            oversize.search()
        self.assertEqual(large.exception.status, 502)

    def test_route_uses_existing_local_context_and_does_not_mutate(self):
        registry = Mock()
        app = FastAPI()
        app.state.mcp_registry = registry
        with patch.dict(os.environ, {'SHARE_MODE': '0'}), patch('mcp_connectors.asgi.MarketCatalog') as catalog:
            catalog.return_value.search.return_value = {'servers': [], 'next_cursor': None}
            app.include_router(create_router())
            with TestClient(app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 4567)) as client:
                bad = client.get('/api/mcp/market?query=github', headers={'Origin': 'https://external.invalid'})
                self.assertEqual(bad.status_code, 403)
                catalog.return_value.search.assert_not_called()
                valid = client.get('/api/mcp/market?query=github&cursor=opaque')
                self.assertEqual(valid.status_code, 200)
                self.assertEqual(valid.headers['Cache-Control'], 'no-store')
                catalog.return_value.search.assert_called_once_with('github', 'opaque')
                self.assertEqual(registry.mock_calls, [])
