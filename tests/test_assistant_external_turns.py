"""Exercise desktop ACP transcript endpoints without launching an external Agent."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from threading import Event
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant import company_runtime, external_context, project_files
from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantError, AssistantService, Config
from deep_analysis.config import Config as DeepConfig
from deep_analysis.service import DeepAnalysisService


class Upstream(io.BytesIO):
    headers = {'Content-Type': 'text/event-stream'}


class ExternalTurnsTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / 'assistant.sqlite3'
        self.config = Config('http://model.invalid/v1', 'internal-model', 'secret')
        self.service = AssistantService(self.path, self.config)
        self.individual_key = "company-individual-key-fixture"
        self.service.models.set_company_key(dict(api_key=self.individual_key))
        app = FastAPI()
        self.app = app
        app.state.session_mode = 'shared'
        app.state.assistant_service = self.service
        token = 'b' * 64
        with patch.dict(os.environ, {'RESPIRATORY_VIEWER_PROJECT_TOKEN': token, 'SHARE_MODE': ''}):
            with patch('ai_assistant.project_access.sys.platform', 'win32'):
                app.include_router(create_router())
        origin = 'http://127.0.0.1:9876'
        cookie = hmac.digest(token.encode(), b'vvman-project-browser-session', 'sha256').hex()
        self.desktop = {'origin': origin, 'cookie': 'respiratory_desktop=' + cookie}
        self.native = {'X-Data-Agent-Native': token}
        self.client = TestClient(app, base_url=origin, client=('127.0.0.1', 30000))
        self.addCleanup(self.client.close)
        self.cid = self.service.create()['id']
        self.chat = f'/api/assistant/conversations/{self.cid}'
        self.external = self.chat + '/external-turns'
        self.input = {'content': 'ACP_PRIVATE_QUESTION', 'agent_id': '21922344-de22-4c5f-87f5-8b58633c37a9',
                      'agent_name': 'Test ACP Agent', 'model': 'selectable-model'}

    def begin(self):
        response = self.client.post(self.external, json=self.input, headers=self.desktop)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_queue_reservation_rejects_duplicate_across_repository_reopen(self):
        self.input['queue_id'] = '4' * 32
        self.begin()
        reopened = AssistantService(self.path, self.config)
        self.app.state.assistant_service = reopened
        retry = self.client.post(self.external, headers=self.desktop, json=self.input)
        self.assertEqual(retry.status_code, 409, retry.text)
        self.assertIn('queue_already_submitted', retry.text)
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute('SELECT role FROM messages WHERE id=?', (self.input['queue_id'],)).fetchall()
        self.assertEqual(rows, [('user',)])

    def test_provider_queue_reservation_rejects_duplicate_across_repository_reopen(self):
        context = {'queue_id': '5' * 32}
        user, _, _ = self.service.begin(self.cid, 'queued provider request', tool_context=context)
        self.assertEqual(user['id'], context['queue_id'])
        reopened = AssistantService(self.path, self.config)
        with self.assertRaises(AssistantError) as duplicate:
            reopened.begin(self.cid, 'queued provider request', tool_context=context)
        self.assertEqual(duplicate.exception.code, 'queue_already_submitted')

    def test_native_steer_reserves_and_commits_exact_authorized_turn_text(self):
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            self.input['agent_id'] = company_runtime.AGENT_ID
            turn = self.begin()['turn_id']
            route = f'{self.external}/{turn}/steers'
            self.assertEqual(self.client.post(route, json={'content': 'denied'}).status_code, 403)
            reserved = self.client.post(route, headers=self.desktop, json={'content': 'Focus on the test results'})
            self.assertEqual(reserved.status_code, 201, reserved.text)
            steer_id = reserved.json()['steer_id']
            endpoint = f'{route}/{steer_id}'
            body = {'agent_id': company_runtime.AGENT_ID}
            self.assertEqual(self.client.post(endpoint + '/prepare', headers=self.desktop, json=body).status_code, 403)
            self.assertEqual(self.client.post(endpoint + '/finish', headers=self.native,
                json={**body, 'accepted': True}).status_code, 409)
            prepared = self.client.post(endpoint + '/prepare', headers=self.native, json=body)
            self.assertEqual(prepared.json(), {'content': 'Focus on the test results'})
            self.assertEqual(self.client.post(endpoint + '/prepare', headers=self.native, json=body).status_code, 409)
            committed = self.client.post(endpoint + '/finish', headers=self.native, json={**body, 'accepted': True})
            self.assertEqual(committed.status_code, 200, committed.text)
            self.assertEqual(committed.json()['message']['id'], steer_id)
            self.assertEqual(self.client.post(endpoint + '/finish', headers=self.native,
                json={**body, 'accepted': True}).status_code, 409)
            reopened = AssistantService(self.path, self.config)
            self.assertEqual(reopened.get(self.cid)['messages'][-1]['content'], 'Focus on the test results')
            self.assertEqual(len(reopened.get(self.cid)['messages']), 3)

    def test_conversation_creation_sets_permission_atomically(self):
        endpoint = '/api/assistant/conversations'
        count = len(self.service.conversations())
        denied = self.client.post(endpoint, json={'permission_mode': 'full'})
        self.assertEqual(denied.status_code, 403, denied.text)
        invalid = self.client.post(endpoint, headers=self.desktop, json={'permission_mode': 'unsupported'})
        self.assertEqual(invalid.status_code, 400, invalid.text)
        self.assertEqual(len(self.service.conversations()), count)
        for mode in ('read_only', 'workspace_write', 'full'):
            request = {'permission_mode': mode} if mode != 'read_only' else {}
            response = self.client.post(endpoint, headers=self.desktop, json=request)
            self.assertEqual(response.status_code, 201, response.text)
            conversation = response.json()['conversation']
            self.assertEqual(conversation['permission_mode'], mode)
            self.assertEqual(AssistantService(self.path, self.config).permission(conversation['id']), mode)

    def test_desktop_subagent_settings_reach_company_native_runtime(self):
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            settings_path = '/api/assistant/delegation-settings'
            updated = self.client.patch(settings_path, headers=self.desktop, json={
                'dsh_max_depth': 3, 'dsh_max_active': 2, 'max_calls': 4,
            })
            self.assertEqual(updated.status_code, 200, updated.text)
            self.assertEqual(self.client.get(settings_path, headers=self.desktop).json(), updated.json())
            self.assertEqual(self.client.patch(settings_path, headers=self.desktop,
                                               json={'dsh_max_depth': 6}).status_code, 400)
            self.input['agent_id'] = company_runtime.AGENT_ID
            turn_id = self.begin()['turn_id']
            prepared = self.client.post(f'{self.external}/{turn_id}/prepare', headers=self.native,
                                        json={'agent_id': company_runtime.AGENT_ID})
            self.assertEqual(prepared.status_code, 200, prepared.text)
            self.assertEqual(prepared.json()['company_model'], self.config.model)
            self.assertNotIn(self.individual_key, prepared.text)
            runtime = self.client.post('/api/assistant/company-web-runtime', headers=self.native)
            self.assertEqual(runtime.json()['subagents'], {'maxDepth': 3, 'maxActiveSubagents': 2})
            legacy = f'{self.external}/{turn_id}/company-provider/chat/completions'
            self.assertEqual(self.client.post(legacy, headers=self.native, json={}).status_code, 404)

    def test_native_execution_persists_nested_steps_beyond_acp_limit(self):
        step = dict(title='子任务', kind='subagent', status='completed')
        steps = [dict(step, id='root')] + [
            dict(step, id=f'child-{index}', parent_id='root') for index in range(45)
        ]
        steps[-1]['parent_id'] = 'missing'
        body = dict(content='已检查', status='complete', execution={'steps': steps})
        acp = self.begin()['turn_id']
        self.assertEqual(self.client.post(f'{self.external}/{acp}/finish', headers=self.desktop, json=body).status_code, 400)
        self.assertEqual(self.client.post(f'{self.external}/{acp}/finish', headers=self.desktop,
                                         json={'content': 'ACP 完成', 'status': 'complete'}).status_code, 200)
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            self.input['agent_id'] = company_runtime.AGENT_ID
            native = self.begin()['turn_id']
            finished = self.client.post(f'{self.external}/{native}/finish', headers=self.desktop, json=body)
        self.assertEqual(finished.status_code, 200, finished.text)
        reopened = AssistantService(self.path, self.config)
        saved = reopened.get(self.cid)['messages'][-1]['reply_meta']['execution']['steps']
        self.assertEqual(len(saved), len(steps))
        self.assertEqual(saved[44]['parent_id'], 'root')
        self.assertNotIn('parent_id', saved[-1])

    def test_company_web_relay_is_native_issued_and_revocable(self):
        runtime_path = '/api/assistant/company-web-runtime'
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1', 'ANALYTICS_SQL_TABLES': ''}):
            self.assertEqual(self.client.post(runtime_path, headers=self.desktop).status_code, 403)
            granted = self.client.post(runtime_path, headers=self.native)
            self.assertEqual(granted.status_code, 200, granted.text)
            first = granted.json()
            self.assertEqual(set(first), {'id', 'token', 'model', 'vision', 'subagents', 'revision', 'models'})
            self.assertNotIn(self.config.api_key, granted.text)
            first_route = f"{runtime_path}/{first['id']}"
            provider_path = first_route + '/provider/chat/completions'
            headers = {'Authorization': 'Bearer ' + first['token']}
            body = {'model': first['model'], 'stream': True, 'messages': [{'role': 'user', 'content': 'mock'}]}
            self.assertEqual(self.client.post(provider_path, json=body).status_code, 403)
            self.assertEqual(self.client.post(provider_path, headers={**headers, 'Origin': 'https://example.test'},
                                             json=body).status_code, 403)
            self.assertEqual(self.client.post(provider_path, headers={**headers, 'X-Forwarded-For': '127.0.0.1'},
                                             json=body).status_code, 403)
            self.assertEqual(self.client.post(provider_path, headers=headers,
                                             json={**body, 'model': 'unauthorized-model'}).status_code, 403)
            with patch('ai_assistant.service.urlopen', return_value=Upstream(b'data: [DONE]\n\n')) as upstream:
                reply = self.client.post(provider_path, headers=headers, json=body)
                self.assertEqual((reply.status_code, reply.content), (200, b'data: [DONE]\n\n'))
                self.assertEqual(upstream.call_args.args[0].get_header('Authorization'), 'Bearer ' + self.individual_key)
            previous = self.service.company_web_runtime
            second = self.client.post(runtime_path, headers=self.native).json()
            self.assertTrue(previous[1].is_set())
            self.assertEqual(self.client.delete(first_route, headers=self.native).json(), {'revoked': False})
            self.assertEqual(self.client.post(provider_path, headers=headers, json=body).status_code, 403)
            second_route = f"{runtime_path}/{second['id']}"
            self.assertEqual(self.client.delete(second_route, headers=self.desktop).status_code, 403)
            self.assertEqual(self.client.delete(second_route, headers=self.native).json(), {'revoked': True})
            self.assertEqual(self.client.post(second_route + '/provider/chat/completions',
                                             headers={'Authorization': 'Bearer ' + second['token']},
                                             json=body).status_code, 403)

    def test_company_issued_key_is_required_and_keeps_fixed_native_provider(self):
        path = '/api/assistant/company-provider'
        runtime = '/api/assistant/company-web-runtime'
        sql_env = {'VV_MAN_COMPANY_DSH': '1', 'ANALYTICS_SQL_TABLES': 'company_private'}
        with patch.dict(os.environ, sql_env):
            self.service.models.set_company_key(None)
            # Old arbitrary endpoint entries are never interpreted as a company key.
            self.service.models.path.write_text(json.dumps({
                'active': 'deepseek', 'providers': [], 'company_override': {'api_key': 'foreign-key'},
            }), encoding='utf-8')
            self.assertFalse(self.client.get('/api/assistant/company-runtime', headers=self.native).json()['ready'])
            missing = self.client.get('/api/assistant/models', headers=self.desktop).json()['providers'][0]
            self.assertTrue(missing['requires_api_key'])
            self.assertFalse(missing['configured'])
            self.assertEqual(missing['model'], self.config.model)
            self.assertEqual(self.client.post(runtime, headers=self.native).status_code, 503)
            self.assertEqual(self.client.patch(path, json={'api_key': 'unauthorized'}).status_code, 403)
            self.assertEqual(self.client.patch(path, headers=self.desktop, json={
                'api_key': 'new-company-key', 'base_url': 'https://foreign.invalid/v1',
            }).status_code, 400)
            saved = self.client.patch(path, headers=self.desktop, json={'api_key': 'new-company-key'})
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertTrue(saved.json()['has_api_key'])
            self.assertNotIn('new-company-key', saved.text)
            self.assertNotIn(self.config.api_key, saved.text)
            self.assertEqual(saved.json()['base_url'], self.config.base_url)
            current = self.client.post(runtime, headers=self.native).json()
            self.assertEqual(current['model'], self.config.model)
            self.assertTrue(current['data']['available'])
            self.input['agent_id'] = company_runtime.AGENT_ID
            turn_id = self.begin()['turn_id']
            endpoint = f'{self.external}/{turn_id}'
            self.assertEqual(self.client.delete(path, headers=self.desktop).status_code, 409)
            prepared = self.client.post(endpoint + '/prepare', headers=self.native,
                                        json={'agent_id': company_runtime.AGENT_ID}).json()
            self.assertEqual(prepared['company_revision'], current['revision'])
            self.assertIn('query_database', {item['name'] for item in prepared['tools']})
            body = {'model': self.config.model, 'stream': True, 'messages': [{'role': 'user', 'content': 'fixture'}]}
            relay = runtime + '/' + current['id'] + '/provider/chat/completions'
            headers = {'Authorization': 'Bearer ' + current['token']}
            with patch('ai_assistant.service.urlopen', return_value=Upstream(b'data: [DONE]\n\n')) as upstream:
                result = self.client.post(relay, headers=headers, json=body)
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(upstream.call_args.args[0].get_header('Authorization'), 'Bearer new-company-key')
                self.assertTrue(upstream.call_args.args[0].full_url.startswith(self.config.base_url))
            self.assertEqual(self.client.post(endpoint + '/finish', headers=self.desktop,
                             json={'content': 'completed', 'status': 'complete'}).status_code, 200)
            self.assertTrue(AssistantService(self.path, self.config).company_key_view()['has_api_key'])
            removed = self.client.delete(path, headers=self.desktop).json()
            self.assertFalse(removed['has_api_key'])
            self.assertEqual(self.client.post(relay, headers=headers, json=body).status_code, 403)
            self.assertEqual(self.client.post(runtime, headers=self.native).status_code, 503)

    def test_company_web_mcp_reuses_sql_scope_and_expires_with_host(self):
        db_path = self.path.with_name('authorized.sqlite3')
        with closing(sqlite3.connect(db_path)) as db, db:
            db.executescript('CREATE TABLE allowed (value INTEGER); INSERT INTO allowed VALUES (17);'
                             'CREATE TABLE hidden (value INTEGER); INSERT INTO hidden VALUES (42);')
        settings = {'VV_MAN_COMPANY_DSH': '1', 'ANALYTICS_SQL_TABLES': 'allowed',
                    'ANALYTICS_DB_URL': 'sqlite:///' + db_path.as_posix(),
                    'ANALYTICS_SQL_AUDIT': str(db_path.with_suffix('.jsonl'))}
        with patch.dict(os.environ, settings):
            issued = self.client.post('/api/assistant/company-web-runtime', headers=self.native).json()
            self.assertTrue(issued['data']['available'])
            self.assertNotEqual(issued['data']['token'], issued['token'])
            base = f"/api/assistant/company-web-runtime/{issued['id']}"
            headers = {'Authorization': 'Bearer ' + issued['data']['token']}

            def call(method, params=None, **options):
                return self.client.post(base + '/mcp', headers=options.get('headers', headers), json={
                    'jsonrpc': '2.0', 'id': 'test', 'method': method, 'params': params or {},
                })

            self.assertEqual(call('tools/list', headers={'Authorization': 'Bearer ' + issued['token']}).status_code, 403)
            self.assertEqual(call('tools/list', headers={**headers, 'Origin': 'https://different.test'}).status_code, 403)
            init = call('initialize', {'protocolVersion': '2025-06-18'}).json()
            self.assertEqual(init['result']['protocolVersion'], '2025-06-18')
            self.assertEqual(self.client.post(base + '/mcp', headers=headers, json={
                'jsonrpc': '2.0', 'method': 'notifications/initialized',
            }).status_code, 202)
            tools = call('tools/list').json()['result']['tools']
            self.assertEqual([tool['name'] for tool in tools], ['list_database_schema', 'query_database'])
            schema = call('tools/call', {'name': 'list_database_schema'}).json()['result']
            self.assertEqual([table['table'] for table in json.loads(schema['content'][0]['text'])['tables']], ['allowed'])
            query = call('tools/call', {'name': 'query_database', 'arguments': {
                'sql': 'SELECT value FROM allowed',
            }}).json()['result']
            self.assertFalse(query['isError'], query)
            self.assertEqual(json.loads(query['content'][0]['text'])['rows'], [[17]])
            for sql in ('SELECT value FROM hidden', 'DELETE FROM allowed'):
                denied = call('tools/call', {'name': 'query_database', 'arguments': {'sql': sql}})
                self.assertTrue(denied.json()['result']['isError'])
            self.assertTrue(call('tools/call', {'name': 'run_powershell'}).json()['result']['isError'])
            self.assertEqual(self.client.delete(base, headers=self.native).json(), {'revoked': True})
            self.assertEqual(call('tools/list').status_code, 403)

    def test_company_web_builtins_use_separate_leases_and_sql_tools(self):
        db_dir = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1])
        self.addCleanup(db_dir.cleanup)
        db_path = Path(db_dir.name) / 'authorized.sqlite3'
        with closing(sqlite3.connect(db_path)) as db, db:
            db.executescript('CREATE TABLE allowed (value INTEGER); INSERT INTO allowed VALUES (17);'
                             'CREATE TABLE hidden (value INTEGER); INSERT INTO hidden VALUES (42);')
        settings = {'VV_MAN_COMPANY_DSH': '1', 'ANALYTICS_SQL_TABLES': 'allowed',
                    'ANALYTICS_DB_URL': 'sqlite:///' + db_path.as_posix(),
                    'ANALYTICS_SQL_AUDIT': str(db_path.with_suffix('.jsonl'))}
        with patch.dict(os.environ, settings):
            self._assert_company_web_mcp_split()

    def test_dsh_next_builtins_remain_registered_and_fail_closed_without_data_access(self):
        remote = type('UnavailableGateway', (), {'mode': 'invalid'})()
        issued = self.service.dsh_next_runtime.open(remote)
        tokens = {row['id']: row['token'] for row in issued['data_servers']}
        self.assertEqual(set(tokens), {'database', 'text-to-sql'})
        self.assertEqual(len(set(tokens.values())), 2)

        def call(server, token, method, params=None):
            body = {'jsonrpc': '2.0', 'id': 'test', 'method': method, 'params': params or {}}
            return self.service.dispatch_dsh_next_mcp(issued['id'], token, body, server)['result']

        def denied(server, token):
            with self.assertRaises(AssistantError) as rejected:
                call(server, token, 'tools/list')
            self.assertEqual(rejected.exception.status, 403)

        expected_tools = {'database': ['list_database_schema', 'execute_read_only_sql'], 'text-to-sql': ['propose_sql']}
        for server, names in expected_tools.items():
            token = tokens[server]
            self.assertEqual(call(server, token, 'initialize')['serverInfo']['name'], server)
            self.assertEqual([tool['name'] for tool in call(server, token, 'tools/list')['tools']], names)
            result = call(server, token, 'tools/call', {'name': names[0]})
            self.assertTrue(result['isError'])
        denied('database', tokens['text-to-sql'])
        self.assertTrue(self.service.dsh_next_runtime.close(issued['id']))
        denied('database', tokens['database'])

    def _assert_company_web_mcp_split(self):
        issued = self.service.start_company_web_runtime()
        tokens = {entry['id']: entry['token'] for entry in issued['data_servers']}
        self.assertEqual(set(tokens), {'database', 'text-to-sql'})
        self.assertEqual(len(set([issued['token'], issued['data']['token'], *tokens.values()])), 4)
        def call(server, method, params=None, *, token=None):
            body = {'jsonrpc': '2.0', 'id': 'test', 'method': method, 'params': params or {}}
            return self.service.dispatch_company_web_mcp(issued['id'], token or tokens[server], body, server)['result']

        def invoke(server, name, arguments):
            return call(server, 'tools/call', {'name': name, 'arguments': arguments})

        def denied(server, token=None):
            with self.assertRaises(AssistantError) as rejected:
                call(server, 'tools/list', token=token)
            self.assertEqual(rejected.exception.status, 403)

        for server, names in [('database', ['list_database_schema', 'execute_read_only_sql']),
                              ('text-to-sql', ['propose_sql'])]:
            self.assertEqual(call(server, 'initialize')['serverInfo']['name'], server)
            tools = call(server, 'tools/list')['tools']
            self.assertEqual([tool['name'] for tool in tools], names)
        denied('database', tokens['text-to-sql'])
        denied('text-to-sql', issued['data']['token'])
        denied('unknown', tokens['database'])
        self.assertTrue(invoke('database', 'execute_read_only_sql', {'question': 'denied'})['isError'])
        self.assertTrue(invoke('text-to-sql', 'execute_read_only_sql', {'sql': 'SELECT value FROM allowed'})['isError'])
        with (patch('ai_assistant.external_tools.propose_sql', return_value='SELECT value FROM allowed') as propose,
              patch('ai_assistant.external_tools.run') as execute):
            proposal = invoke('text-to-sql', 'propose_sql', {'question': 'List values'})
            self.assertFalse(proposal['isError'], proposal)
            sql = json.loads(proposal['content'][0]['text'])['sql']
            self.assertIn('LIMIT', sql)
            self.assertEqual([table['table'] for table in propose.call_args.args[1]], ['allowed'])
            propose.return_value = 'SELECT value FROM hidden'
            self.assertTrue(invoke('text-to-sql', 'propose_sql', {'question': 'List values'})['isError'])
            execute.assert_not_called()
        query = invoke('database', 'execute_read_only_sql', {'sql': sql})
        self.assertFalse(query['isError'], query)
        self.assertEqual(json.loads(query['content'][0]['text'])['rows'], [[17]])
        for sql in ('SELECT value FROM hidden', 'DELETE FROM allowed'):
            self.assertTrue(invoke('database', 'execute_read_only_sql', {'sql': sql})['isError'])
        self.assertEqual(self.service.stop_company_web_runtime(issued['id']), {'revoked': True})
        denied('database')
        denied('text-to-sql')

    def test_desktop_terminal_and_restart_restore_transcript(self):
        self.assertEqual(self.client.post(self.external, json=self.input).status_code, 403)
        self.assertEqual(self.client.post(self.external, headers=self.desktop,
                                         json={**self.input, 'skill_ids': ['abc']}).status_code, 400)
        start = self.begin()
        turn_id = start['turn_id']
        finish_url = self.external + '/' + turn_id + '/finish'
        self.assertEqual(start['conversation']['title'], 'ACP_PRIVATE_QUESTION')
        self.assertEqual(start['assistant_message']['status'], 'streaming')
        self.assertEqual(start['assistant_message']['reply_meta']['transport'], 'acp')
        self.assertEqual(self.client.post(self.external, headers=self.desktop, json=self.input).status_code, 409)
        self.assertEqual(self.client.post(self.chat + '/messages', headers=self.desktop,
                                         json={'content': 'Overlapping internal turn'}).status_code, 409)
        execution = {'steps': [], 'plan': [], 'truncated': True}
        body = {'content': 'ACP_PRIVATE_ANSWER', 'status': 'complete', 'model': 'confirmed-model', 'execution': execution}
        self.assertEqual(self.client.post(finish_url, json=body).status_code, 403)
        response = self.client.post(finish_url, headers=self.desktop, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()['message']
        self.assertEqual(result['content'], 'ACP_PRIVATE_ANSWER')
        self.assertEqual(result['reply_meta']['model'], 'confirmed-model')
        self.assertEqual(result['reply_meta']['execution'], execution)
        self.assertIn('elapsed_ms', result['reply_meta'])
        self.assertEqual(self.client.post(finish_url, headers=self.desktop,
                                         json={'content': 'rewrite', 'status': 'error'}).json()['message'], result)
        reopened = AssistantService(self.path, self.config)
        self.assertEqual(reopened.get(self.cid)['messages'], [start['user_message'], result])
        with patch('ai_assistant.service.urlopen', return_value=Upstream(
            b'data: {"choices":[{"delta":{"content":"internal"}}]}\n\ndata: [DONE]\n\n'
        )) as provider:
            self.assertEqual(self.client.post(self.chat + '/messages', headers=self.desktop,
                                             json={'content': 'Builtin question'}).status_code, 200)
        outbound = json.loads(provider.call_args.args[0].data)
        self.assertEqual(outbound['messages'][-3:], [
            dict(role='user', content='ACP_PRIVATE_QUESTION'),
            dict(role='assistant', content='ACP_PRIVATE_ANSWER'),
            dict(role='user', content='Builtin question'),
        ])

    def test_dsh_recommendations_are_validated_and_persist_only_for_complete_reply(self):
        first = self.begin()
        route = f"{self.external}/{first['turn_id']}/finish"
        card = dict(id='a' * 32, kind='plugin', title='Badge Skill', description='Add the official badge.',
                    pluginId='@deepseek-ai/dsh-experimental-badge-skill-bundle')
        body = dict(content='DSH answer', status='complete')
        for invalid in ([card, card], [{**card, 'pluginId': 'https://untrusted.invalid'}],
                        [{**card, 'kind': 'page'}], [{**card, 'title': '<' * 161}],
                        [{**card, 'rawInput': 'not a projected field'}]):
            response = self.client.post(route, headers=self.desktop, json={**body, 'recommendations': invalid})
            self.assertEqual(response.status_code, 400, response.text)
        response = self.client.post(route, headers=self.desktop, json={**body, 'recommendations': [card]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['message']['reply_meta']['recommendations'], [card])
        second = self.begin()
        response = self.client.post(f"{self.external}/{second['turn_id']}/finish", headers=self.desktop,
                                    json={**body, 'status': 'cancelled', 'recommendations': [card]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn('recommendations', response.json()['message']['reply_meta'])
        reopened = AssistantService(self.path, self.config)
        self.assertEqual(reopened.get(self.cid)['messages'][1]['reply_meta']['recommendations'], [card])

    def test_cancel_and_stale_finish_do_not_release_later_turn(self):
        first = self.begin()
        self.assertTrue(self.client.post(self.chat + '/cancel', headers=self.desktop, json={}).json()['cancelled'])
        second = self.begin()
        stale = self.client.post(self.external + '/' + first['turn_id'] + '/finish', headers=self.desktop,
                                 json={'content': 'late', 'status': 'complete'})
        self.assertEqual(stale.json()['message']['status'], 'cancelled')
        self.assertEqual(self.client.post(self.external, headers=self.desktop, json=self.input).status_code, 409)
        stopped = self.client.post(self.external + '/' + second['turn_id'] + '/finish', headers=self.desktop,
                                   json={'content': 'partial reply', 'status': 'cancelled'})
        self.assertEqual(stopped.json()['message']['content'], 'partial reply')
        self.assertFalse(self.service.active)

    def test_native_usage_validation_persistence_and_cancelled_turns(self):
        turn = self.begin()
        route = f"{self.external}/{turn['turn_id']}/finish"
        body = dict(content='ACP usage test', status='cancelled')
        for invalid in (
            dict(input_tokens=True, output_tokens=1), dict(input_tokens=-1, output_tokens=1),
            dict(input_tokens=(1 << 53), output_tokens=1), dict(input_tokens=1, output_tokens=2.5),
            dict(input_tokens=1, output_tokens=2, partial=1), dict(input_tokens=1),
            dict(input_tokens=1, output_tokens=2, total_tokens=3),
            dict(input_tokens=1, output_tokens=2, cached_input_tokens=2),
            dict(input_tokens=1, output_tokens=2, cached_input_tokens=False),
        ):
            response = self.client.post(route, headers=self.desktop, json={**body, 'usage': invalid})
            self.assertEqual(response.status_code, 400, response.text)
            self.assertEqual(response.json()['error']['code'], 'invalid_external_usage')
        for invalid in (dict(used_tokens=1, max_tokens=0), dict(used_tokens=True, max_tokens=50),
                        dict(used_tokens=3), dict(used_tokens=3, max_tokens=50, ratio=0.06)):
            response = self.client.post(route, headers=self.desktop, json={**body, 'context': invalid})
            self.assertEqual(response.status_code, 400, response.text)
            self.assertEqual(response.json()['error']['code'], 'invalid_external_usage')
        valid = dict(input_tokens=159, output_tokens=0, cached_input_tokens=64)
        context = dict(used_tokens=162, max_tokens=1000)
        result = self.client.post(route, headers=self.desktop, json={**body, 'usage': valid, 'context': context})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['message']['reply_meta']['usage'], dict(valid, partial=True))
        self.assertEqual(result.json()['message']['reply_meta']['context'], context)
        second = self.begin()
        result = self.client.post(f"{self.external}/{second['turn_id']}/finish", headers=self.desktop,
                                  json={'content': 'No usage available', 'status': 'complete'})
        self.assertEqual(result.status_code, 200, result.text)
        unavailable = result.json()['message']['reply_meta']
        self.assertTrue(unavailable['usage_unavailable'])
        self.assertNotIn('usage', unavailable)
        restarted = AssistantService(self.path, self.config)
        metadata = [item['reply_meta'] for item in restarted.get(self.cid)['messages'] if item['role'] == 'assistant']
        self.assertEqual(metadata[0]['usage'], dict(valid, partial=True))
        self.assertEqual(metadata[0]['context'], context)
        self.assertTrue(metadata[1]['usage_unavailable'])
        self.assertNotIn('context', metadata[1])

    def test_parallel_same_agent_chats_keep_turns_and_tools_isolated(self):
        names = ('first', 'second')
        chats = {}
        for name in names:
            root = self.path.parent / name
            root.mkdir()
            (root / (name + '.md')).write_text('COMMON_MARKER ' + name, encoding='utf-8')
            project = self.service.create_workspace(name, str(root))
            self.service.update_workspace(project['id'], {'instructions': name.upper() + '_PROJECT_MARKER'})
            cid = self.service.create(workspace=project['id'])['id']
            chat = f'/api/assistant/conversations/{cid}'
            body = {**self.input, 'content': name.upper() + '_QUESTION_MARKER'}
            start = self.client.post(chat + '/external-turns', headers=self.desktop, json=body)
            self.assertEqual(start.status_code, 201, start.text)
            turn = start.json()['turn_id']
            chats[name] = (cid, chat, turn)

        agent = {'agent_id': self.input['agent_id']}
        for name, other in (names, names[::-1]):
            _, chat, turn = chats[name]
            other_turn = chats[other][2]
            self.assertEqual(self.client.post(f'{chat}/external-turns/{other_turn}/prepare',
                                              headers=self.native, json=agent).status_code, 409)
            prepared = self.client.post(f'{chat}/external-turns/{turn}/prepare', headers=self.native, json=agent)
            self.assertEqual(prepared.status_code, 200, prepared.text)
            self.assertIn(name.upper() + '_PROJECT_MARKER', prepared.json()['text'])
            self.assertNotIn(other.upper() + '_PROJECT_MARKER', prepared.json()['text'])

        def search(name):
            _, chat, turn = chats[name]
            return self.client.post(f'{chat}/external-turns/{turn}/tool', headers=self.native,
                                    json={**agent, 'name': 'search_project_files',
                                          'arguments': {'query': 'COMMON_MARKER', 'mode': 'content'}})

        entered, resume = Event(), Event()
        original = project_files.search_files

        def pause_first(roots, *args):
            if Path(roots['source_1'][0]).name == 'first':
                entered.set()
                if not resume.wait(10):
                    raise AssertionError('timed out waiting to resume first tool')
            return original(roots, *args)

        first_id, first_chat, first_turn = chats['first']
        second_id, second_chat, second_turn = chats['second']
        with patch.object(project_files, 'search_files', side_effect=pause_first), ThreadPoolExecutor(max_workers=2) as workers:
            first_call = workers.submit(search, 'first')
            try:
                self.assertTrue(entered.wait(5))
                duplicate = search('first').json()
                self.assertTrue(duplicate['isError'])
                self.assertIn('当前工具调用仍在执行', duplicate['content'][0]['text'])
                second_call = workers.submit(search, 'second').result(timeout=5).json()
                self.assertFalse(second_call['isError'])
                self.assertEqual(json.loads(second_call['content'][0]['text'])['matches'], [
                    {'source': 'source_1', 'path': 'second.md', 'line': 1, 'snippet': 'COMMON_MARKER second'},
                ])
                stopped = self.client.post(first_chat + '/cancel', headers=self.desktop, json={})
                self.assertTrue(stopped.json()['cancelled'])
                self.assertEqual(set(self.service.active), {second_id})
            finally:
                resume.set()
            self.assertTrue(first_call.result(timeout=5).json()['isError'])

        late = self.client.post(f'{first_chat}/external-turns/{first_turn}/finish', headers=self.desktop,
                                json={'content': 'late first result', 'status': 'complete'})
        self.assertEqual(late.json()['message']['status'], 'cancelled')
        completed = self.client.post(f'{second_chat}/external-turns/{second_turn}/finish', headers=self.desktop,
                                     json={'content': 'second result', 'status': 'complete'})
        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(self.service.get(first_id)['messages'][-1]['status'], 'cancelled')
        self.assertEqual(self.service.get(second_id)['messages'][-1]['content'], 'second result')
        self.assertFalse(self.service.active)

    def test_builtin_stream_can_run_while_an_external_chat_is_active(self):
        external = self.begin()
        other = self.service.create()['id']
        chat = f'/api/assistant/conversations/{other}'
        opened, resume = Event(), Event()

        def upstream(_request, **_options):
            opened.set()
            if not resume.wait(10):
                raise AssertionError('timed out waiting to resume built-in stream')
            return Upstream(b'data: {"choices":[{"delta":{"content":"Builtin answer"}}]}\n\ndata: [DONE]\n\n')

        with patch('ai_assistant.service.urlopen', side_effect=upstream) as provider, ThreadPoolExecutor(max_workers=1) as workers:
            running = workers.submit(self.client.post, chat + '/messages', headers=self.desktop,
                                     json={'content': 'Built-in question'})
            try:
                self.assertTrue(opened.wait(5))
                finished = self.client.post(f"{self.external}/{external['turn_id']}/finish", headers=self.desktop,
                                            json={'content': 'External answer', 'status': 'complete'})
                self.assertEqual(finished.status_code, 200, finished.text)
                self.assertEqual(set(self.service.active), {other})
            finally:
                resume.set()
            stream = running.result(timeout=5)
        self.assertIn('event: done', stream.text)
        self.assertNotIn(self.input['content'], provider.call_args.args[0].data.decode())
        self.assertEqual(self.service.get(other)['messages'][-1]['content'], 'Builtin answer')
        self.assertEqual(self.service.get(self.cid)['messages'][-1]['content'], 'External answer')
        self.assertFalse(self.service.active)

    def test_external_messages_are_excluded_from_project_memory(self):
        project = self.service.create_workspace('Test')
        self.service.update_workspace(project['id'], {'memory_mode': 'project'})
        first = self.service.create(workspace=project['id'])['id']
        second = self.service.create(workspace=project['id'])['id']
        args = self.input
        capture = self.service.begin_external_turn(first, args['content'], args['agent_id'], args['agent_name'])
        self.service.finish_external_turn(first, capture['turn_id'], 'ACP_PRIVATE_ANSWER', 'complete')
        _, memory, _ = self.service._project_context(second, include_private=True)
        self.assertEqual(memory, [])

    def test_external_history_restores_completed_same_chat_text_across_agents(self):
        agent = self.input['agent_id']
        other = '7b083bee-b370-42aa-8850-bc3beaff5893'
        from PIL import Image
        image = io.BytesIO()
        Image.new('RGB', (2, 2), 'white').save(image, format='PNG')
        data_url = 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode('ascii')

        def completed(who, text, model, status='complete', **kwargs):
            turn = self.service.begin_external_turn(self.cid, text, who, 'Extern', model, **kwargs)
            self.service.finish_external_turn(self.cid, turn['turn_id'], 'answer ' + text, status)
            return turn['turn_id']

        self.config.vision_enabled = True
        images = [dict(name='history.png', data_url=data_url)]
        _, builtin, cancel = self.service.begin(self.cid, 'built-in question', images)
        self.service.save(self.cid, dict(builtin, content='built-in answer', status='complete'))
        self.service.release(self.cid, cancel)
        completed(agent, 'first', 'old-model')
        completed(other, 'different agent', 'other-model', attachments=images)
        predecessor = completed(agent, 'second', 'new-model')
        completed(agent, 'incomplete', 'new-model', 'error')
        other_chat = self.service.create()['id']
        isolated = self.service.begin_external_turn(other_chat, 'ISOLATED_CHAT', agent, 'Extern')
        self.service.finish_external_turn(other_chat, isolated['turn_id'], 'ISOLATED_REPLY', 'complete')
        self.service = AssistantService(self.path, self.config)
        self.app.state.assistant_service = self.service
        final = self.service.begin_external_turn(self.cid, 'current', agent, 'Extern', 'third-model')
        prepared = self.service.prepare_external_turn(self.cid, final['turn_id'], agent)
        self.assertEqual(prepared['history'], [
            {'role': 'user', 'content': 'built-in question'}, {'role': 'assistant', 'content': 'built-in answer'},
            {'role': 'user', 'content': 'first'}, {'role': 'assistant', 'content': 'answer first'},
            {'role': 'user', 'content': 'different agent'}, {'role': 'assistant', 'content': 'answer different agent'},
            {'role': 'user', 'content': 'second'}, {'role': 'assistant', 'content': 'answer second'},
        ])
        self.assertEqual(prepared['history_summary'], '')
        self.assertEqual(prepared['history_predecessor'], predecessor)
        self.assertEqual(prepared['images'], [])
        self.assertNotIn(data_url, json.dumps(prepared))
        self.service.finish_external_turn(self.cid, final['turn_id'], 'ACP continuing answer', 'complete')
        with patch('ai_assistant.service.urlopen', return_value=Upstream(
                b'data: {"choices":[{"delta":{"content":"Back to built-in"}}]}\n\ndata: [DONE]\n\n')) as provider:
            reply = self.client.post(self.chat + '/messages', headers=self.desktop, json={'content': 'continue'})
        self.assertIn('event: done', reply.text)
        messages = json.loads(provider.call_args.args[0].data)['messages']
        self.assertEqual(sum(data_url in json.dumps(message) for message in messages), 1)
        self.assertEqual(messages[-3:], [dict(role='user', content='current'),
                                         dict(role='assistant', content='ACP continuing answer'),
                                         dict(role='user', content='continue')])

    def test_external_context_compacts_completed_same_chat_text_across_agents(self):
        from ai_assistant import conversation_context

        agent = self.input['agent_id']
        other = '7b083bee-b370-42aa-8850-bc3beaff5893'

        def complete(who, question, answer, status='complete'):
            turn = self.service.begin_external_turn(self.cid, question, who, 'External', 'different-models-ok')
            self.service.finish_external_turn(self.cid, turn['turn_id'], answer, status)

        complete(agent, 'Please remember ALLOWED_EARLY_RULE applies only to this project.', 'Understood.')
        complete(other, 'Please remember OTHER_AGENT_RULE', 'OTHER_AGENT_REPLY')
        complete(agent, 'Please remember ERROR_SECRET', 'ERROR_REPLY', 'error')
        complete(agent, 'Please remember CANCEL_SECRET', 'CANCEL_REPLY', 'cancelled')
        for index in range(conversation_context.RECENT_TURNS + 1):
            complete(agent, f'Outbound question {index}', f'Outbound reply {index}')
        complete(agent, 'Use RECENT_QUESTION as the latest relevant data.', 'RECENT_ANSWER')
        turn = self.service.begin_external_turn(self.cid, 'Unchanged CURRENT_QUESTION', agent, 'External')
        address = f"{self.external}/{turn['turn_id']}/prepare"
        prepared = self.client.post(address, headers=self.native, json={'agent_id': agent})
        self.assertEqual(prepared.status_code, 200, prepared.text)
        packet = prepared.json()
        summary, recent = packet['history_summary'], packet['history']
        self.assertLessEqual(len(summary.encode('utf-8')), conversation_context.SUMMARY_BYTES)
        self.assertIn('ALLOWED_EARLY_RULE', summary)
        self.assertIn('OTHER_AGENT_RULE', summary)
        self.assertEqual(len(recent), 2 * conversation_context.RECENT_TURNS)
        self.assertEqual(recent[-1], dict(role='assistant', content='RECENT_ANSWER'))
        self.assertLessEqual(sum(len(message['content'].encode('utf-8')) for message in recent),
                             conversation_context.RECENT_BYTES)
        self.assertNotRegex(json.dumps([summary, recent]), 'ERROR_SECRET|ERROR_REPLY|CANCEL_SECRET|CANCEL_REPLY|CURRENT_QUESTION')
        self.assertEqual(packet['text'], 'Unchanged CURRENT_QUESTION')

    def test_company_model_and_effort_are_scoped_to_each_native_turn(self):
        self.config.base_url = 'https://api.deepseek.com/v1'
        self.config.model = 'deepseek-flash'
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            rows = self.client.get('/api/assistant/models', headers=self.desktop).json()['company_models']
            self.assertEqual([(item['model'], item['vision']) for item in rows],
                             [('deepseek-flash', True), ('deepseek-v4-pro', False)])
            self.assertEqual(rows[0]['reasoning_efforts'], ['none', 'low', 'high', 'max'])
            inputs = {**self.input, 'agent_id': company_runtime.AGENT_ID}
            self.assertEqual(self.client.post(self.external, headers=self.desktop,
                json={**inputs, 'company_model': 'foreign'}).status_code, 400)
            self.assertEqual(self.client.post(self.external, headers=self.desktop,
                json={**inputs, 'reasoning_effort': 'xhigh'}).status_code, 400)

            first = self.external
            second_id = self.service.create()['id']
            second = self.external.replace(self.cid, second_id)
            choices = [(first, 'deepseek-v4-pro', 'max'), (second, 'deepseek-flash', 'none')]
            turns = [
                (route, model, effort, self.client.post(route, headers=self.desktop,
                    json={**inputs, 'company_model': model, 'reasoning_effort': effort}).json()['turn_id'])
                for route, model, effort in choices
            ]
            for route, model, effort, turn_id in turns:
                prepared = self.client.post(f'{route}/{turn_id}/prepare', headers=self.native,
                                            json={'agent_id': company_runtime.AGENT_ID}).json()
                self.assertEqual((prepared['company_model'], prepared['company_reasoning_effort']), (model, effort))

            path = '/api/assistant/company-web-runtime'
            grant = self.client.post(path, headers=self.native).json()
            route = f"{path}/{grant['id']}/provider/responses"
            headers = {'Authorization': 'Bearer ' + grant['token']}
            with patch('ai_assistant.service.urlopen', side_effect=lambda *_args, **_kwargs:
                       Upstream(b'event: response.completed\ndata: {"type":"response.completed"}\n\n')) as upstream:
                for _, model, effort in choices:
                    reply = self.client.post(route, headers=headers, json=dict(
                        model=model, stream=True, input='fixture', reasoning={'effort': effort}))
                    self.assertEqual(reply.status_code, 200, reply.text)
                    wire = json.loads(upstream.call_args.args[0].data)
                    self.assertEqual((wire['model'], wire['reasoning']['effort']), (model, effort))
                rejected = self.client.post(route, headers=headers, json=dict(
                    model='deepseek-v4-pro', stream=True, input='fixture', reasoning={'effort': 'xhigh'}))
                self.assertEqual(rejected.status_code, 403)

    def test_company_native_responses_relay_keeps_images_tools_and_streaming_events(self):
        self.config.base_url = 'https://api.deepseek.com/v1/chat/completions'
        self.config.model = 'deepseek-flash'
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            root = '/api/assistant/company-web-runtime'
            issued = self.client.post(root, headers=self.native).json()
            runtime = root + '/' + issued['id']
            endpoint = runtime + '/provider/responses'
            headers = {'Authorization': 'Bearer ' + issued['token']}
            inputs = [
                {'role': 'user', 'content': [{'type': 'input_text', 'text': 'Read the image'},
                    {'type': 'input_image', 'image_url': 'data:image/png;base64,AA=='}]},
                {'type': 'function_call', 'call_id': 'call_1', 'name': 'search', 'arguments': '{}'},
                {'type': 'function_call_output', 'call_id': 'call_1', 'output': 'found'},
            ]
            tools = [{'type': 'function', 'name': 'search', 'parameters': {'type': 'object'}}]
            body = dict(model='deepseek-flash', input=inputs, tools=tools, stream=True,
                        store=True, background=True, max_output_tokens=100_000)
            stream = (b'event: response.output_text.delta\ndata: {"type":"response.output_text.delta",'
                      b'"delta":"arrived"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n')
            with patch('ai_assistant.service.urlopen', return_value=Upstream(stream)) as upstream:
                result = self.client.post(endpoint, headers=headers, json=body)
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.content, stream)
                request = upstream.call_args.args[0]
                self.assertEqual(request.full_url, 'https://api.deepseek.com/v1/responses')
                self.assertEqual(request.get_header('Authorization'), 'Bearer ' + self.individual_key)
                sent = json.loads(request.data)
                self.assertEqual(sent['input'], inputs)
                self.assertEqual(sent['tools'], tools)
                self.assertEqual(sent['max_output_tokens'], company_runtime.MAX_OUTPUT_TOKENS)
                self.assertFalse(sent['store'])
                self.assertNotIn('background', sent)
                self.assertEqual(self.client.post(endpoint, json=body).status_code, 403)
                for change in ({'model': 'wrong-model'}, {'previous_response_id': 'remote-state'},
                               {'input': [{'type': 'item_reference', 'id': 'remote'}]},
                               {'tools': [{'type': 'mcp', 'server_url': 'https://invalid.test'}]}):
                    rejected = self.client.post(endpoint, headers=headers, json={**body, **change})
                    self.assertEqual(rejected.status_code, 403, rejected.text)
                self.assertEqual(upstream.call_count, 1)
                self.assertEqual(self.client.delete(runtime, headers=self.native).status_code, 200)
                self.assertEqual(self.client.post(endpoint, headers=headers, json=body).status_code, 403)

    def test_company_connection_test_requires_responses_feedback(self):
        self.config.base_url = 'https://api.deepseek.com'
        self.config.model = 'deepseek-flash'
        endpoint = '/api/assistant/models/deepseek/test'
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            raw = (b'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n'
                   b'event: response.completed\ndata: {"type":"response.completed"}\n\n')
            with patch('ai_assistant.service.urlopen', return_value=Upstream(raw)) as upstream:
                result = self.client.post(endpoint, headers=self.desktop)
                self.assertTrue(result.json()['ok'], result.text)
                request = upstream.call_args.args[0]
                self.assertEqual(request.full_url, 'https://api.deepseek.com/responses')
                self.assertEqual(request.get_header('Authorization'), 'Bearer ' + self.individual_key)
                self.assertNotIn('Authorization', request.headers)
                self.assertEqual(json.loads(request.data)['input'], 'Reply OK.')
            with patch('ai_assistant.service.urlopen', return_value=Upstream(b'data: [DONE]\n\n')):
                result = self.client.post(endpoint, headers=self.desktop)
                self.assertFalse(result.json()['ok'], result.text)

    def test_official_deepseek_flash_sends_native_image_through_same_company_relay(self):
        from PIL import Image
        image = io.BytesIO()
        Image.new('RGB', (2, 2), 'white').save(image, format='PNG')
        data_url = 'data:image/png;base64,' + base64.b64encode(image.getvalue()).decode('ascii')
        self.config.base_url = 'https://api.deepseek.com/v1'
        self.config.model = 'deepseek-flash'
        self.config.vision_enabled = False
        self.input.update(agent_id=company_runtime.AGENT_ID,
                          attachments=[{'name': 'sample.png', 'data_url': data_url}])
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            self.assertTrue(self.service.status(desktop=True)['capabilities']['vision'])
            turn = self.begin()['turn_id']
            prepared = self.client.post(f'{self.external}/{turn}/prepare', headers=self.native,
                                        json={'agent_id': company_runtime.AGENT_ID}).json()
            self.assertEqual(prepared['images'][0]['mimeType'], 'image/png')
            self.assertEqual(prepared['images'][0]['data'], data_url.partition(',')[2])
            runtime_path = '/api/assistant/company-web-runtime'
            runtime = self.client.post(runtime_path, headers=self.native).json()
            self.assertTrue(runtime['vision'])
            body = dict(model='deepseek-flash', stream=True, messages=[dict(role='user', content=[
                dict(type='text', text='Inspect this screenshot'),
                dict(type='image_url', image_url={'url': data_url}),
            ])])
            with patch('ai_assistant.service.urlopen', return_value=Upstream(b'data: [DONE]\n\n')) as upstream:
                response = self.client.post(runtime_path + '/' + runtime['id'] + '/provider/chat/completions',
                                            headers={'Authorization': 'Bearer ' + runtime['token']}, json=body)
                self.assertEqual(response.status_code, 200, response.text)
                request = upstream.call_args.args[0]
                self.assertEqual(request.full_url, 'https://api.deepseek.com/v1/chat/completions')
                self.assertEqual(request.get_header('Authorization'), 'Bearer ' + self.individual_key)
                self.assertEqual(json.loads(request.data)['messages'], body['messages'])
            self.config.base_url = 'https://api.deepseek.com.example.test/v1'
            self.assertFalse(self.service.status(desktop=True)['capabilities']['vision'])

    def test_native_prepare_uses_only_authorized_attachments(self):
        from PIL import Image
        image = io.BytesIO()
        Image.new('RGB', (2, 2), 'white').save(image, format='PNG')
        encoded = base64.b64encode(image.getvalue()).decode('ascii')
        document = self.service.save_document('guide.md', b'DOC_MARKER')
        omitted = self.service.save_document('other.md', b'OMITTED_DOC')
        skill = self.service.skills.add(
            'SKILL.md', b'---\nname: guide-test\ndescription: Example instruction\n---\nSKILL_MARKER')
        uploaded = self.client.post('/api/assistant/external-files', headers={**self.desktop, 'X-Filename': 'chart.csv'},
                                    content=b'day,amount\nMonday,TABLE_MARKER\nTuesday,15\n')
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        table_id = uploaded.json()['file']['id']
        args = {'agent_id': company_runtime.AGENT_ID}
        request = {
            **self.input, **args, 'content': '', 'file_ids': [document['id']], 'skill_ids': [skill['id']],
            'analysis_file_id': table_id,
            'attachments': [{'name': 'sample.png', 'data_url': 'data:image/png;base64,' + encoded}],
        }
        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            self.config.vision_enabled = False
            rejected = self.client.post(self.external, headers=self.desktop, json=request)
            self.assertEqual(rejected.status_code, 400, rejected.text)
            self.assertIn('company_vision_unavailable', rejected.text)
            self.assertEqual(self.service.get(self.cid)['messages'], [])
            self.config.vision_enabled = True
            started = self.client.post(self.external, headers=self.desktop, json=request)
        self.assertEqual(started.status_code, 201, started.text)
        packet = started.json()
        self.assertEqual(packet['user_message']['attachments'][0]['mime'], 'image/png')
        self.assertEqual(packet['assistant_message']['reply_meta']['transport'], 'dsh-native')
        route = f"{self.external}/{packet['turn_id']}/prepare"
        self.assertEqual(self.client.post(route, headers=self.desktop, json=args).status_code, 403)
        self.assertEqual(self.client.post(route, headers=self.native, json={'agent_id': 'wrong'}).status_code, 409)
        self.assertEqual(self.client.post(route, headers=self.native, json={**args, 'file_ids': [omitted['id']]}).status_code, 400)
        prepared = self.client.post(route, headers=self.native, json=args)
        self.assertEqual(prepared.status_code, 200, prepared.text)
        result = prepared.json()
        self.assertEqual(result['images'], [{'mimeType': 'image/png', 'data': encoded}])
        for marker in ('DOC_MARKER', 'SKILL_MARKER', 'TABLE_MARKER'):
            self.assertIn(marker, result['text'])
        self.assertNotIn('OMITTED_DOC', result['text'])
        self.assertEqual(result['company_model'], self.config.model)
        self.assertNotIn(self.individual_key, prepared.text)
        self.assertFalse(result['project']['available'])
        finished = self.client.post(route.replace('/prepare', '/finish'), headers=self.desktop,
                                    json={'content': 'Received all attachments', 'status': 'complete'})
        self.assertEqual(finished.status_code, 200, finished.text)
        other = self.service.external_table_store().upload('other_owner', 'private.csv', b'item\nunrelated\n')
        wrong_owner = self.client.post(self.external, headers=self.desktop,
                                       json={**self.input, 'analysis_file_id': other['id']})
        self.assertEqual(wrong_owner.status_code, 404)

    def test_native_prepare_scopes_personal_plugin_tools_to_selected_turn(self):
        class Registry:
            def enabled_states(self):
                return {'personal': True, 'other': True}

            def specs(self, *, server_ids=None):
                active = {name for name, enabled in self.enabled_states().items() if enabled}
                return [
                    dict(type='function', function=dict(name=f'mcp__{server}__read', description='Read notes',
                                                        parameters={'type': 'object'}))
                    for server in sorted(active if server_ids is None else active & set(server_ids))
                ]

            def tool_policy(self, _name):
                return 'read'

            def call(self, name, _arguments, *, permission_mode, confirmed, server_ids=None):
                if name != 'mcp__personal__read' or server_ids not in (None, {'personal'}):
                    raise AssertionError('MCP scope was not passed through')
                return dict(ok=True, content='personal value')

        registry = Registry()
        self.app.state.mcp_registry = registry
        skill = self.service.skills.add(
            'SKILL.md', b'---\nname: personal-notes\ndescription: Read personal notes\n---\nPLUGIN_SKILL_MARKER')
        manifest = {'name': 'Personal notes', 'skill_ids': [skill['id']], 'mcp_ids': ['personal']}
        bundle = self.service.plugins.add(manifest, registry)
        self.service.plugins.set_enabled(bundle['id'], True, registry)
        identity = {'agent_id': company_runtime.AGENT_ID}

        def prepare(plugin_ids):
            turn = self.client.post(self.external, headers=self.desktop, json={
                **self.input, **identity, 'plugin_ids': plugin_ids,
            })
            self.assertEqual(turn.status_code, 201, turn.text)
            route = f"{self.external}/{turn.json()['turn_id']}"
            result = self.client.post(route + '/prepare', headers=self.native, json=identity)
            self.assertEqual(result.status_code, 200, result.text)
            return route, result.json()

        def call(route, name):
            return self.client.post(route + '/tool', headers=self.native, json={
                **identity, 'name': name, 'arguments': {},
            })

        with patch.dict(os.environ, {'VV_MAN_COMPANY_DSH': '1'}):
            route, selected = prepare([bundle['id']])
            names = {tool['name'] for tool in selected['tools']}
            self.assertIn('mcp__personal__read', names)
            self.assertNotIn('mcp__other__read', names)
            self.assertIn('PLUGIN_SKILL_MARKER', selected['text'])
            self.assertEqual(call(route, 'mcp__personal__read').json()['content'][0]['text'], 'personal value')
            self.assertTrue(call(route, 'mcp__other__read').json()['isError'])
            finished = self.client.post(route + '/finish', headers=self.desktop,
                                        json={'content': 'Personal plugin result', 'status': 'complete'})
            self.assertEqual(finished.status_code, 200, finished.text)
            self.assertEqual(call(route, 'mcp__personal__read').status_code, 409)
            next_route, unselected = prepare([])
            self.assertNotIn('PLUGIN_SKILL_MARKER', unselected['text'])
            self.assertTrue({'mcp__personal__read', 'mcp__other__read'} <=
                            {tool['name'] for tool in unselected['tools']})
            self.assertEqual(call(next_route, 'mcp__personal__read').json()['content'][0]['text'], 'personal value')

    def test_native_project_read_and_proposal_preserve_policy(self):
        root = Path(self.path.parent) / 'source'
        root.mkdir()
        file = root / 'notes.md'
        file.write_bytes(b'line1\nline2\n')
        (root / '.env').write_bytes(b'SECRET')
        project = self.service.create_workspace('Local', str(root))
        self.service.update_workspace(project['id'], {'instructions': 'PROJECT_MARKER'})
        cid = self.service.create(workspace=project['id'])['id']
        capture = self.service.begin_external_turn(cid, self.input['content'], self.input['agent_id'], self.input['agent_name'])
        args = {'agent_id': self.input['agent_id']}
        route = f"/api/assistant/conversations/{cid}/external-turns/{capture['turn_id']}"
        prepare = self.client.post(route + '/prepare', headers=self.native, json=args)
        self.assertEqual(prepare.status_code, 200, prepare.text)
        self.assertEqual(prepare.json()['project']['files'], [{'path': 'notes.md', 'source': 'source_1'}])
        self.assertIn('PROJECT_MARKER', prepare.json()['text'])
        self.assertNotIn(str(root), prepare.json()['text'])
        call = lambda **body: self.client.post(route + '/project-file', headers=self.native,
                                               json={**args, 'source': 'source_1', 'path': 'notes.md', **body})
        read = call(action='read', line=2, limit=1)
        self.assertEqual(read.status_code, 200, read.text)
        expected = hashlib.sha256(file.read_bytes()).hexdigest()
        self.assertEqual(read.json(), {'content': 'line2\n', 'sha256': expected})
        self.assertEqual(call(action='read', path='../secret.md').status_code, 403)
        read_only_edit = call(action='propose', content='review first', expected_sha256=expected)
        self.assertEqual(read_only_edit.status_code, 200, read_only_edit.text)
        self.assertEqual(read_only_edit.json()['proposal']['status'], 'pending')
        self.assertEqual(file.read_bytes(), b'line1\nline2\n')
        self.service.decide_file_proposal(cid, read_only_edit.json()['proposal']['id'], 'reject')
        self.service.set_permission(cid, 'workspace_write')
        self.assertEqual(call(action='propose', content='new', expected_sha256='0' * 64).status_code, 409)
        edit = call(action='propose', content='new', expected_sha256=expected)
        self.assertEqual(edit.status_code, 200, edit.text)
        proposal = edit.json()['proposal']
        self.assertEqual(file.read_bytes(), b'line1\nline2\n')
        self.assertEqual(proposal['status'], 'pending')
        self.service.decide_file_proposal(cid, proposal['id'], 'approve')
        self.assertEqual(file.read_bytes(), b'new')
        self.service.update_workspace(project['id'], {'root_path': None})
        self.assertEqual(call(action='read').status_code, 409)

    def test_native_search_uses_authorized_roots_beyond_the_project_manifest(self):
        root, extra = (self.path.parent / folder for folder in ('source', 'extra'))
        for directory in (root, extra):
            directory.mkdir()
        (root / 'fixture.md').write_text('report line', encoding='utf-8')
        deep = extra / 'nested'
        deep.mkdir()
        (deep / 'fixture.cjs').write_text('other line\nReport line', encoding='utf-8')
        project = self.service.create_workspace('Local', str(root))
        self.service.update_workspace(project['id'], {'source_folders': [
            {'root_path': str(root)}, {'root_path': str(extra)},
        ]}, authorize=lambda selections: [project_files.validate_root(path) for path, _ in selections])
        cid = self.service.create(workspace=project['id'])['id']
        capture = self.service.begin_external_turn(cid, self.input['content'], self.input['agent_id'], self.input['agent_name'])
        args = {'agent_id': self.input['agent_id']}
        route = f"/api/assistant/conversations/{cid}/external-turns/{capture['turn_id']}"
        name = 'search_project_files'
        with patch.object(external_context, 'MAX_DEPTH', 0):
            prepare = self.client.post(route + '/prepare', headers=self.native, json=args)
        self.assertEqual(prepare.status_code, 200, prepare.text)
        data = prepare.json()
        self.assertEqual(data['permission_mode'], 'read_only')
        self.assertNotIn('fixture.cjs', str(data['project']['files']))
        specs = {item['name']: item for item in data['tools']}
        self.assertIn(name, specs)
        self.assertNotIn('requires_confirmation', specs[name])
        self.assertEqual(specs[name]['inputSchema']['required'], ['query'])

        def search(arguments, headers=self.native):
            return self.client.post(route + '/tool', headers=headers,
                                    json={**args, 'name': name, 'arguments': arguments})

        self.assertEqual(search({'query': 'fixture'}, self.desktop).status_code, 403)
        hits = search({'query': 'REPORT', 'mode': 'content'}).json()
        self.assertFalse(hits['isError'])
        result = json.loads(hits['content'][0]['text'])
        self.assertEqual({(match['source'], match['path'], match['line']) for match in result['matches']},
                         {('source_1', 'fixture.md', 1), ('source_2', 'nested/fixture.cjs', 2)})
        self.assertNotIn(str(extra), hits['content'][0]['text'])
        self.assertTrue(search({'query': 'fixture', 'path': 'nested'}).json()['isError'])
        matches = search({'query': 'fixture', 'source': 'source_2', 'path': 'nested'}).json()
        self.assertFalse(matches['isError'])
        self.assertEqual(json.loads(matches['content'][0]['text'])['matches'],
                         [{'source': 'source_2', 'path': 'nested/fixture.cjs'}])
        self.service.update_workspace(project['id'], {'root_path': str(root)})
        self.assertTrue(search({'query': 'fixture', 'source': 'source_2'}).json()['isError'])
        self.service.update_workspace(project['id'], {'root_path': None})
        prepared = self.client.post(route + '/prepare', headers=self.native, json=args).json()
        self.assertNotIn(name, {item['name'] for item in prepared['tools']})
        self.assertTrue(search({'query': 'fixture'}).json()['isError'])
        self.service.cancel(cid)
        self.assertEqual(search({'query': 'fixture'}).status_code, 409)

    def test_native_development_target_requires_live_project_and_desktop_proof(self):
        root, extra = (self.path.parent / folder for folder in ('development', 'other'))
        root.mkdir()
        extra.mkdir()
        project = self.service.create_workspace('Dev', str(root))
        sources = [{'root_path': str(root)}, {'root_path': str(extra)}]
        self.service.update_workspace(project['id'], {'source_folders': sources},
                                      authorize=lambda entries: [project_files.validate_root(path) for path, _ in entries])
        cid = self.service.create(workspace=project['id'])['id']
        turn = self.service.begin_external_turn(cid, 'project tools', self.input['agent_id'], self.input['agent_name'])
        route = f"/api/assistant/conversations/{cid}/external-turns/{turn['turn_id']}"
        workspace_route = f"/api/assistant/workspaces/{project['id']}/development-target"
        git, tests = 'project_git_diff', 'run_project_tests'
        agent = {'agent_id': self.input['agent_id']}

        def prepare():
            response = self.client.post(route + '/prepare', headers=self.native, json=agent)
            self.assertEqual(response.status_code, 200, response.text)
            packet = response.json()
            self.assertEqual(packet['workspace_id'], project['id'])
            self.assertNotIn(str(root), json.dumps(packet))
            return {item['name']: item for item in packet['tools']}, packet['project_sources']

        def target(name, **fields):
            return self.client.post(route + '/project-root', headers=self.native, json={**agent, 'name': name, **fields})

        advertised, bindings = prepare()
        self.assertIn(git, advertised)
        self.assertNotIn(tests, advertised)
        first = bindings[0]['root_key']
        self.assertEqual(target(tests, root_key=first).status_code, 403)
        self.assertEqual(self.client.post(workspace_route, headers=self.desktop, json={'name': git}).status_code, 403)
        self.assertEqual(self.client.post(route + '/project-root', headers=self.desktop,
                                          json={**agent, 'name': git}).status_code, 403)
        original = target(git)
        self.assertEqual(original.status_code, 200, original.text)
        self.assertEqual(original.json()['root_path'], str(root))
        self.assertEqual(original.json()['root_key'], first)
        ordinary = self.client.post(route + '/tool', headers=self.native, json={**agent, 'name': git, 'arguments': {}})
        self.assertTrue(ordinary.json()['isError'])
        self.assertEqual(target(git, agent_id='wrong').status_code, 409)
        self.assertEqual(target(git, source='../outside').status_code, 400)

        self.service.set_permission(cid, 'workspace_write')
        advertised, _ = prepare()
        self.assertTrue(advertised[tests]['requires_confirmation'])
        self.assertEqual(target(tests, root_key=first).json()['root_path'], str(root))
        self.service.set_permission(cid, 'read_only')
        self.assertEqual(target(tests, root_key=first).status_code, 403)

        self.service.update_workspace(project['id'], {'source_folders': sources[::-1]})
        rebound = self.client.post(workspace_route, headers=self.native, json={'name': tests, 'root_key': first})
        self.assertEqual(rebound.status_code, 200, rebound.text)
        self.assertEqual((rebound.json()['source'], rebound.json()['root_path']), ('source_2', str(root)))
        moved = root.with_name('replaced')
        root.rename(moved)
        root.mkdir()
        self.assertEqual(target(git, root_key=first).status_code, 409)
        self.assertEqual(self.client.post(workspace_route, headers=self.native,
                                          json={'name': git, 'root_key': first}).status_code, 409)
        self.service.cancel(cid)
        self.assertEqual(target(git, source='source_2').status_code, 409)
        self.service.update_workspace(project['id'], {'archived': True})
        self.assertEqual(self.client.post(workspace_route, headers=self.native, json={'name': git}).status_code, 404)

    def test_native_tools_guard_schema_queries_load_bound_deep_tasks_and_call_mcp(self):
        data = self.path.parent / 'test-sql.sqlite3'
        tables = [f'allowed_{index}' for index in range(14)]
        with sqlite3.connect(data) as sql:
            for table in tables + ['secret']:
                sql.execute(f'CREATE TABLE {table}(value INTEGER)')
                sql.execute(f'INSERT INTO {table} VALUES(42)')
        sql.close()
        self.app.state.deep_analysis_service = DeepAnalysisService(
            self.path.parent / 'deep', config=DeepConfig(base_url='', model='', api_key=''))
        self.addCleanup(self.app.state.deep_analysis_service.close)

        class Registry:
            def specs(self):
                return [{'type': 'function', 'function': {'name': 'mcp__fixture__read_data',
                         'description': 'Read fixture', 'parameters': {'type': 'object'}}}]

            def tool_policy(self, name):
                return 'read'

            def call(self, name, arguments, *, permission_mode, confirmed):
                return {'ok': True, 'content': f"fixture {arguments['value']}", 'summary': 'fixture'}

        self.app.state.mcp_registry = Registry()
        table = self.service.external_table_store().upload('local_shared', 'selected.csv', b'name,value\nRow,12\n')
        request = {**self.input, 'analysis_file_id': table['id']}
        agent_id = self.input['agent_id']
        with patch.dict(os.environ, {'ANALYTICS_DB_URL': 'sqlite:///' + data.as_posix(),
                                     'ANALYTICS_SQL_TABLES': ','.join(tables)}):
            first = self.client.post(self.external, headers=self.desktop, json=request).json()
            route = f"{self.external}/{first['turn_id']}"
            prep = self.client.post(route + '/prepare', headers=self.native, json={'agent_id': agent_id})
            self.assertEqual(prep.status_code, 200, prep.text)
            names = {tool['name'] for tool in prep.json()['tools']}
            self.assertEqual(names, {'list_database_schema', 'query_database', 'get_deep_analysis_task', 'mcp__fixture__read_data'})

            def invoke(name, **arguments):
                response = self.client.post(route + '/tool', headers=self.native,
                                            json={'agent_id': agent_id, 'name': name, 'arguments': arguments})
                self.assertEqual(response.status_code, 200, response.text)
                return response.json()

            schema = json.loads(invoke('list_database_schema')['content'][0]['text'])
            self.assertEqual(schema['table_count'], 14)
            self.assertEqual({item['table'] for item in schema['tables']}, set(tables))
            result = json.loads(invoke('query_database', sql='SELECT COUNT(*) FROM allowed_0')['content'][0]['text'])
            self.assertEqual(result['rows'], [[1]])
            for denied in ('DELETE FROM allowed_0', 'SELECT * FROM allowed_0, secret', 'SELECT * FROM main.allowed_0'):
                self.assertTrue(invoke('query_database', sql=denied)['isError'])
            self.assertTrue(invoke('create_deep_analysis', question='Not yet')['isError'])
            self.assertTrue(invoke('fetch_url', url='https://example.com')['isError'])
            self.assertEqual(invoke('mcp__fixture__read_data', value='approved')['content'][0]['text'], 'fixture approved')
            self.service.set_permission(self.cid, 'workspace_write')
            self.client.post(route + '/prepare', headers=self.native, json={'agent_id': agent_id})
            tasks = []
            for call in (invoke('create_deep_analysis', question='Identify values'),
                         invoke('create_deep_analysis_from_query', sql='SELECT COUNT(*) AS items FROM allowed_0',
                                analysis_question='Summarize count')):
                self.assertFalse(call['isError'], call)
                task_id = json.loads(call['content'][0]['text'])['task_id']
                tasks.append(task_id)
                answer = invoke('get_deep_analysis_task', task_id=task_id)
                self.assertEqual(json.loads(answer['content'][0]['text'])['status'], 'blocked')
            self.assertNotEqual(tasks[0], tasks[1])
            self.assertTrue(invoke('get_deep_analysis_task', task_id='1' * 32)['isError'])
            self.service.cancel(self.cid)
            self.assertEqual(self.client.post(route + '/tool', headers=self.native, json={
                'agent_id': agent_id, 'name': 'list_database_schema', 'arguments': {},
            }).status_code, 409)

    def test_remote_tool_respects_gateway_rejection_and_omits_upstream_error(self):
        carried = []

        class Remote:
            mode = 'remote'

            def request_tool_data(self, path, method, **kwargs):
                carried.append((path, method, kwargs))
                if path == '/api/sql/schema':
                    return {'tables': [{'table': 'approved', 'columns': []}]}
                raise ValueError('unexposed gateway debug credential')

        self.app.state.remote_data = Remote()
        packet = self.begin()
        path = f"{self.external}/{packet['turn_id']}"
        args = {'agent_id': self.input['agent_id']}
        self.client.post(path + '/prepare', headers=self.native, json=args)
        schema = self.client.post(path + '/tool', headers=self.native,
                                  json={**args, 'name': 'list_database_schema', 'arguments': {}})
        self.assertIn('approved', schema.text)
        query = self.client.post(path + '/tool', headers=self.native, json={
            **args, 'name': 'query_database', 'arguments': {'sql': 'SELECT * FROM unrelated'},
        })
        self.assertTrue(query.json()['isError'])
        self.assertNotIn('credential', query.text)
        self.assertEqual([call[:2] for call in carried], [('/api/sql/schema', 'GET'), ('/api/sql/query', 'POST')])
