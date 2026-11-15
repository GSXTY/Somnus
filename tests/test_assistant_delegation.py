import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant import delegation
from ai_assistant.asgi import create_router
from ai_assistant.service import AssistantError, AssistantService, Config


AGENT_ID = '0b147fca-65a2-44d8-b385-2e355dbce071'
AGENTS = {AGENT_ID: '本机测试 Agent'}


class Upstream(io.BytesIO):
    headers = {'Content-Type': 'text/event-stream'}


def response(delta, reason):
    packet = {'choices': [{'delta': delta, 'finish_reason': reason}]}
    return Upstream(f'data: {json.dumps(packet)}\n\ndata: [DONE]\n\n'.encode())


def tool_calls(count=1):
    return response({'tool_calls': [
        {'index': i, 'id': f'mock{i}', 'function': {'name': delegation.TOOL_NAME, 'arguments': json.dumps({
            'agent_id': AGENT_ID, 'task': '复核合计', 'context': '样例总数 17',
        })}} for i in range(count)
    ]}, 'tool_calls')


class DelegationTests(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.service = AssistantService(Path(folder) / 'assistant.sqlite3', Config('http://localhost/v1', 'mock', 'dummy'))
        self.cid = self.service.create()['id']
        self.requests = []

    def mock_upstream(self, *responses):
        responses = iter(responses)

        def send(request, timeout):
            self.requests.append(json.loads(request.data))
            return next(responses)

        return patch('ai_assistant.service.urlopen', side_effect=send)

    def begin(self):
        return self.service.begin(self.cid, '请让另一个 Agent 复核',
                                  tool_context={'project_desktop': True, 'delegation_agents': AGENTS})

    def test_waits_for_one_child_then_returns_its_result_to_parent(self):
        with self.mock_upstream(tool_calls(2), response({'content': '复核已完成'}, 'stop')):
            events = self.service.stream(self.cid, *self.begin())
            opening = []
            for event, value in events:
                opening.append(event)
                if event == 'delegation_request':
                    request = value
                    break
            self.assertEqual(opening[-1], 'delegation_request')
            self.assertEqual((request['task'], request['context'], request['agent_id']), ('复核合计', '样例总数 17', AGENT_ID))
            self.assertEqual(len(self.requests), 1)
            with self.assertRaisesRegex(AssistantError, '已结束'):
                self.service.complete_delegation('other-chat', request['id'], {'status': 'complete', 'result': '17'})
            with self.assertRaisesRegex(AssistantError, '本轮可用列表'):
                self.service.complete_delegation(self.cid, request['id'], {'status': 'complete', 'agent_id': 'other', 'result': '17'})
            result = {'status': 'complete', 'result': '独立复核结果 17'}
            self.assertEqual(self.service.complete_delegation(self.cid, request['id'], result), {'accepted': True})
            with self.assertRaisesRegex(AssistantError, '已结束'):
                self.service.complete_delegation(self.cid, request['id'], result)
            following = list(events)
        self.assertNotIn('delegation_request', [event for event, _ in following])
        self.assertEqual(following[-1][0], 'done')
        self.assertEqual(self.service.get(self.cid)['messages'][-1]['reply_meta']['delegation']['result'], result['result'])
        self.assertNotIn(delegation.TOOL_NAME, [tool['function']['name'] for tool in self.requests[1]['tools']])
        outcomes = [message['content'] for message in self.requests[1]['messages'] if message['role'] == 'tool']
        self.assertEqual(json.loads(outcomes[0])['result'], result['result'])
        self.assertIn('最多委派一次', outcomes[1])

    def test_expiry_produces_failure_and_clears_request(self):
        with patch.object(delegation, 'TIMEOUT_SECONDS', 0):
            with self.mock_upstream(tool_calls(), response({'content': '自行完成'}, 'stop')):
                events = list(self.service.stream(self.cid, *self.begin()))
        request = next(value for event, value in events if event == 'delegation_request')
        self.assertEqual(next(value['status'] for event, value in events if event == 'delegation_resolved'), 'expired')
        with self.assertRaisesRegex(AssistantError, '已结束'):
            self.service.complete_delegation(self.cid, request['id'], {'status': 'declined'})

    def test_web_cannot_supply_an_agent_or_complete_a_request(self):
        app = FastAPI()
        app.state.assistant_service = self.service
        app.include_router(create_router())
        with TestClient(app) as client:
            root = f'/api/assistant/conversations/{self.cid}'
            self.assertEqual(client.post(root + '/messages', json={
                'content': '委派', 'delegation_agents': [{'id': AGENT_ID, 'name': AGENTS[AGENT_ID]}],
            }).status_code, 403)
            self.assertEqual(client.post(root + '/delegations/test', json={'status': 'declined'}).status_code, 403)
