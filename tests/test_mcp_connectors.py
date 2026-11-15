from email.message import Message
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.service import run_chat_tool
from ai_assistant.service import AssistantService, Config
from mcp_connectors.asgi import create_router
from mcp_connectors.client import HttpMcpServer, LEGACY_HTTP, MODERN_HTTP, McpError
from mcp_connectors.registry import Registry


ROOT = Path(__file__).resolve().parents[1]
LOCAL = {'X-Data-Agent-Local': '1'}


class McpRegistryTests(unittest.TestCase):
    def test_non_desktop_approval_reports_entry_without_dispatch_or_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            service = AssistantService(Path(directory) / 'assistant.sqlite3', Config('https://model.invalid/v1', 'mock', 'key'))
            cid = service.create()['id']
            service.set_permission(cid, 'workspace_write')
            tool = 'mcp__fixture__change'
            registry = Mock()
            registry.specs.return_value = [{'type': 'function', 'function': {
                'name': tool, 'description': 'Change fixture', 'parameters': {'type': 'object'},
            }}]
            registry.tool_policy.return_value = 'confirm'
            tool_call = {'index': 0, 'id': 'fixture', 'function': {
                'name': tool, 'arguments': '{"key":"unpublished-secret"}',
            }}
            frames = [{'choices': [{'delta': {'tool_calls': [tool_call]}}]},
                      {'choices': [{'delta': {'content': '说明见工具状态。'}}]}]

            def make_response(frame):
                content = ('data: ' + json.dumps(frame) + '\n\ndata: [DONE]\n\n').encode()
                response = BytesIO(content)
                response.headers = {'Content-Type': 'text/event-stream'}
                return response

            with patch('ai_assistant.service.urlopen', side_effect=map(make_response, frames)) as provider:
                events = list(service.stream(cid, *service.begin(cid, 'test', tool_context={'mcp_registry': registry})))
            registry.call.assert_not_called()
            blocked = [packet for name, packet in events if name == 'mcp_approval_blocked']
            self.assertEqual(len(blocked), 1)
            self.assertEqual(blocked[0]['tool_name'], tool)
            self.assertEqual(blocked[0]['desktop_entry'], 'dist/electron/win-unpacked/Somnus.exe')
            self.assertNotIn('unpublished-secret', json.dumps(events))
            self.assertEqual(service.get(cid)['messages'][-1]['reply_meta']['mcp_approval_blocked'], blocked[0])
            outbound = json.loads(provider.call_args.args[0].data)
            self.assertIn(blocked[0]['reason'], outbound['messages'][-1]['content'])

    def test_name_cannot_grant_read_and_approval_is_once_for_current_call(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MCP_CONFIG': ''}):
            folder = Path(directory)
            (folder / 'mcp.json').write_text('{"servers":{}}', encoding='utf-8')
            registry = Registry(folder)
            self.addCleanup(registry.close)
            server = type('FakeServer', (), {'name': 'Fake'})()
            server.call_tool = lambda name, args: {'content': [{'type': 'text', 'text': args['choice']}]}
            server.close = lambda: None
            registry.configs['test'] = {'tool_permissions': {}, 'enabled': True}
            registry.connections['test'] = server
            name = 'mcp__test__read_and_erase'
            registry.results['test'] = {'tools': [{'name': 'read_and_erase', 'description': 'Fixture tool', 'inputSchema': {'type': 'object'}}]}
            self.assertFalse(registry.call(name, {'choice': 'blocked'}, confirmed=True)['ok'])
            self.assertFalse(registry.call(name, {'choice': 'blocked'}, permission_mode='workspace_write')['ok'])
            service = AssistantService(folder / 'assistant.sqlite3', Config('https://model.invalid/v1', 'mock', 'key'))
            cid = service.create()['id']
            service.set_permission(cid, 'workspace_write')
            frames = [{'choices': [{'delta': {'tool_calls': [{'index': 0, 'id': 'fixture', 'function': {
                'name': name, 'arguments': '{"choice":"approved output"}',
            }}]}}]}, {'choices': [{'delta': {'content': 'completed'}}]}]

            def make_response(frame):
                raw = ('data: ' + json.dumps(frame) + '\n\ndata: [DONE]\n\n').encode()
                response = BytesIO(raw)
                response.headers = {'Content-Type': 'text/event-stream'}
                return response

            with patch('ai_assistant.service.urlopen', side_effect=map(make_response, frames)):
                stream = service.stream(cid, *service.begin(cid, 'test', tool_context={
                    'mcp_registry': registry, 'project_desktop': True,
                }))
                self.assertEqual(next(stream)[0], 'start')
                self.assertEqual(next(stream)[0], 'tool_call')
                event, approval = next(stream)
                self.assertEqual(event, 'mcp_approval')
                self.assertEqual(service.list_mcp_approvals(cid), [approval])
                service.decide_mcp_approval(cid, approval['id'], 'approve')
                events = list(stream)
                self.assertTrue(any(event == 'tool_result' and packet['ok'] for event, packet in events))
                self.assertEqual(events[-1][0], 'done')
                self.assertEqual(service.list_mcp_approvals(cid), [])
            self.assertFalse(registry.call(name, {'choice': 'blocked'}, permission_mode='workspace_write')['ok'])

    def test_import_configs_is_atomic_and_disabled(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MCP_CONFIG': ''}):
            folder = Path(directory)
            (folder / 'mcp.json').write_text('{"servers":{}}', encoding='utf-8')
            registry = Registry(folder)
            self.addCleanup(registry.close)
            app = FastAPI()
            app.state.mcp_registry = registry
            app.include_router(create_router())
            client = TestClient(app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 4567))
            self.addCleanup(client.close)
            route = '/api/mcp/servers/import'
            good = {'type': 'stdio', 'command': 'test-command', 'enabled': True,
                    'env': {'SECRET_TOKEN': 'do-not-echo'}}
            self.assertEqual(client.post(route, json={'mcpServers': {'good': good}}).status_code, 403)
            malformed = {'mcpServers': {'good': good, 'invalid': {'type': 'sse'}}}
            self.assertEqual(client.post(route, json=malformed, headers=LOCAL).status_code, 400)
            self.assertEqual(registry.list()['servers'], [])
            imported = client.post(route, json={'mcpServers': {'good': good}}, headers=LOCAL)
            self.assertEqual(imported.status_code, 200, imported.text)
            self.assertNotIn('do-not-echo', imported.text)
            self.assertEqual(imported.json()['servers'][0]['status'], 'disabled')
            self.assertEqual(registry.specs(), [])
            collision = {'servers': {'good': good, 'extra': good}}
            self.assertEqual(client.post(route, json=collision, headers=LOCAL).status_code, 409)
            self.assertEqual([server['id'] for server in registry.list()['servers']], ['good'])
            self.assertEqual(Registry(folder).list()['servers'][0]['enabled'], False)

    def test_enabled_stdio_tool_is_advertised_and_called_during_assistant_turn(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MCP_CONFIG': ''}):
            folder = Path(directory)
            (folder / 'mcp.json').write_text('{"servers":{}}', encoding='utf-8')
            registry = Registry(folder)
            self.addCleanup(registry.close)
            registry.put('echo', {'enabled': True, 'command': sys.executable, 'tool_permissions': {'echo': 'read'},
                                  'args': [str(ROOT / 'tests' / 'mcp_echo_server.py')]}, create=True)
            service = AssistantService(folder / 'chat.sqlite3', Config('https://test.invalid/v1', 'fake', 'fake'))
            cid = service.create()['id']
            service.set_permission(cid, 'workspace_write')
            payloads = []

            def upstream(request, timeout):
                payloads.append(json.loads(request.data))
                choice = {'delta': {'content': 'done'}, 'finish_reason': 'stop'}
                if len(payloads) == 1:
                    choice = {'delta': {'tool_calls': [{'index': 0, 'id': 'echo-1', 'function': {
                        'name': 'mcp__echo__echo', 'arguments': '{"text":"live"}',
                    }}]}, 'finish_reason': 'tool_calls'}
                raw = ('data: ' + json.dumps({'choices': [choice]}) + '\n\ndata: [DONE]\n\n').encode()
                response = BytesIO(raw)
                response.headers = {'Content-Type': 'text/event-stream'}
                return response

            with patch('ai_assistant.service.urlopen', side_effect=upstream):
                turn = service.begin(cid, 'use echo', tool_context={'mcp_registry': registry})
                events = list(service.stream(cid, *turn))
            self.assertIn('mcp__echo__echo', [tool['function']['name'] for tool in payloads[0]['tools']])
            self.assertIn({'role': 'tool', 'tool_call_id': 'echo-1', 'content': 'echo: live'}, payloads[1]['messages'])
            self.assertTrue(any(name == 'done' for name, _ in events))
            registry.close()

    def test_local_crud_disabled_test_live_tools_secret_redaction_and_shutdown(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MCP_CONFIG': ''}):
            folder = Path(directory)
            (folder / 'mcp.json').write_text('{"servers":{}}', encoding='utf-8')
            registry = Registry(folder)
            self.addCleanup(registry.close)
            app = FastAPI()
            app.state.mcp_registry = registry
            app.include_router(create_router())
            client = TestClient(app, base_url='http://127.0.0.1:8765', client=('127.0.0.1', 4567))
            base = '/api/mcp/servers'
            config = {'id': 'echo', 'name': 'Echo', 'transport': 'stdio', 'command': sys.executable,
                      'tool_permissions': {'echo': 'read'},
                      'args': [str(ROOT / 'tests' / 'mcp_echo_server.py')], 'env': {'MY_TOKEN': 'write-only'}}
            self.assertEqual(client.post(base, json=config).status_code, 403)
            self.assertEqual(client.get(base, headers={'Host': 'evil.invalid'}).status_code, 403)
            self.assertEqual(client.get(base, headers={'Forwarded': 'for=192.0.2.10'}).status_code, 403)
            self.assertEqual(client.post(base, json=config, headers={**LOCAL, 'Origin': 'http://evil.invalid'}).status_code, 403)
            generated = client.post(base, json={key: value for key, value in config.items() if key != 'id'}, headers=LOCAL)
            self.assertEqual(generated.status_code, 200)
            self.assertRegex(generated.json()['server']['id'], r'^server-[0-9a-f]{12}$')
            client.delete(base + '/' + generated.json()['server']['id'], headers=LOCAL)
            created = client.post(base, json=config, headers=LOCAL).json()['server']
            self.assertEqual(created['status'], 'disabled')
            self.assertEqual(created['env_names'], ['MY_TOKEN'])
            self.assertNotIn('write-only', client.get(base).text)
            tested = client.post(base + '/echo/test', headers=LOCAL).json()['server']
            self.assertEqual(tested['status'], 'ready')
            self.assertEqual(tested['tools'][0]['name'], 'echo')
            self.assertEqual(registry.specs(), [])
            enabled = client.put(base + '/echo', json={'enabled': True}, headers=LOCAL).json()['server']
            self.assertTrue(enabled['enabled'])
            self.assertEqual(registry.specs()[0]['function']['name'], 'mcp__echo__echo')
            process = registry.connections['echo'].process
            write_context = {'mcp_registry': registry, 'permission_mode': 'workspace_write'}
            self.assertEqual(run_chat_tool('mcp__echo__echo', '{"text":"ok"}', write_context)['content'], 'echo: ok')
            self.assertFalse(run_chat_tool('mcp__echo__echo', '{}', {'mcp_registry': registry, 'share': True})['ok'])
            self.assertEqual(client.put(base + '/echo', json={'enabled': False}, headers=LOCAL).status_code, 200)
            self.assertIsNotNone(process.poll())
            self.assertEqual(registry.specs(), [])
            restored = Registry(folder)
            self.assertEqual(restored.list()['servers'][0]['env_names'], ['MY_TOKEN'])
            self.assertEqual(client.delete(base + '/echo', headers=LOCAL).json(), {'deleted': True})
            self.assertEqual(client.get(base).json()['servers'], [])

    def test_stdio_does_not_inherit_host_database_or_model_secrets(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
                'MCP_CONFIG': '', 'ANALYTICS_DB_URL': 'must-not-inherit', 'AI_ASSISTANT_API_KEY': 'must-not-inherit'}):
            folder = Path(directory)
            script = folder / 'inspect_env.py'
            script.write_text(
                "import json,os,sys\nfor line in sys.stdin:\n"
                " p=json.loads(line)\n"
                " if 'id' not in p: continue\n"
                " result={'protocolVersion':'2025-11-25'} if p['method']=='initialize' else "
                "{'found':[os.getenv(k) for k in ('ANALYTICS_DB_URL','AI_ASSISTANT_API_KEY','EXPLICIT_TEST')]}\n"
                " print(json.dumps({'jsonrpc':'2.0','id':p['id'],'result':result}),flush=True)\n",
                encoding='utf-8')
            from mcp_connectors.client import McpServer
            server = McpServer('env', sys.executable, [str(script)], {'EXPLICIT_TEST': 'yes'})
            try:
                self.assertEqual(server.start().request('test', {})['found'], [None, None, 'yes'])
            finally:
                server.close()


class McpHttpTests(unittest.TestCase):
    def test_modern_metadata_and_legacy_session_handshake(self):
        for version in (LEGACY_HTTP, MODERN_HTTP):
            with self.subTest(version=version):
                requests = []

                def open_request(request, timeout):
                    packet = json.loads(request.data) if request.data else {}
                    requests.append((request, packet))
                    result = {}
                    if packet.get('method') == 'initialize':
                        result = {'protocolVersion': LEGACY_HTTP}
                    if packet.get('method') == 'tools/list':
                        result = {'tools': [{'name': 'echo', 'inputSchema': {'type': 'object', 'properties': {
                            'message': {'type': 'string', 'x-mcp-header': 'Message'},
                        }}}]}
                    if packet.get('method') == 'tools/call':
                        result = {'content': [{'type': 'text', 'text': 'ok'}]}
                    raw = json.dumps({'jsonrpc': '2.0', 'id': packet.get('id'), 'result': result}).encode()
                    response = BytesIO(b'data: ' + raw + b'\n\n' if packet.get('method') == 'tools/call' else raw)
                    response.headers = Message()
                    response.headers['Content-Type'] = 'text/event-stream' if packet.get('method') == 'tools/call' else 'application/json'
                    if packet.get('method') == 'initialize':
                        response.headers['Mcp-Session-Id'] = 'safe-test-session'
                    return response

                server = HttpMcpServer('echo', 'https://example.invalid/mcp', {'Authorization': 'Bearer sample'},
                                       protocol_version=version)
                with patch.object(server.opener, 'open', side_effect=open_request):
                    self.assertEqual(server.start().list_tools()[0]['name'], 'echo')
                    self.assertEqual(server.call_tool('echo', {'message': 'hi'})['content'][0]['text'], 'ok')
                    request, payload = requests[-1]
                    headers = {key.lower(): value for key, value in request.headers.items()}
                    self.assertEqual(headers['authorization'], 'Bearer sample')
                    if version == MODERN_HTTP:
                        self.assertEqual(headers['mcp-method'], 'tools/call')
                        self.assertEqual(headers['mcp-name'], 'echo')
                        self.assertEqual(headers['mcp-param-message'], 'hi')
                        self.assertEqual(payload['params']['_meta']['io.modelcontextprotocol/protocolVersion'], version)
                        self.assertEqual(requests[0][1]['method'], 'tools/list')
                    else:
                        self.assertEqual(headers['mcp-session-id'], 'safe-test-session')
                        self.assertEqual(requests[0][1]['method'], 'initialize')
                    server.close()
                    if version == LEGACY_HTTP:
                        self.assertEqual(requests[-1][0].method, 'DELETE')
                    with self.assertRaises(McpError):
                        server.list_tools()


if __name__ == '__main__':
    unittest.main()
