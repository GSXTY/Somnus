import json
import io
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from ai_assistant import conversation_context as context
from ai_assistant.service import AssistantService, Config


class AssistantContextWindowTest(unittest.TestCase):
    def test_context_limits_are_scoped_to_known_official_endpoints(self):
        deepseek = context.model_window('https://api.deepseek.com/v1/chat/completions', 'deepseek-flash')
        self.assertEqual(deepseek.tokens, 1_000_000)
        self.assertEqual(deepseek.history_budget, 695_142)
        self.assertEqual(deepseek.input_budget, 782_035)
        self.assertEqual(context.model_window('https://api.openai.com/v1/chat/completions', 'gpt-6.1-sol').tokens,
                         1_050_000)
        self.assertEqual(context.model_window('https://api.openai.com/v1/chat/completions', 'gpt-5.3-codex').tokens,
                         400_000)
        for url, model in (
            ('https://api.deepseek.com.example.com', 'deepseek-flash'),
            ('https://api.deepseek.com:8080', 'deepseek-flash'),
            ('http://api.deepseek.com', 'deepseek-flash'),
            ('https://api.deepseek.com', 'custom'),
        ):
            self.assertIsNone(context.model_window(url, model))

    def test_expanded_history_compacts_by_budget_and_bounds_images(self):
        window = context.model_window('https://api.deepseek.com', 'deepseek-flash')
        with sqlite3.connect(':memory:') as db:
            db.row_factory = sqlite3.Row
            db.execute('CREATE TABLE messages (id, conversation_id, role, status, transport, content, attachments)')
            image = dict(size=100, data_url='data:image/png;base64,example')
            rows = []
            for index in range(24):
                question = '请记住最早的约定' if index == 0 else f'问题 {index}'
                rows.extend((
                    (f'q{index}', 'chat', 'user', 'complete', None, question, json.dumps([image])),
                    (f'a{index}', 'chat', 'assistant', 'complete', None, '长' * 50_000, '[]'),
                ))
            rows.append(('current', 'chat', 'user', 'complete', None, '此时的请求', '[]'))
            db.executemany('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', rows)
            summary, expanded = context.build(db, 'chat', 'current', window=window,
                                              current_images=[image], image_limit=300)
            _, fallback = context.build(db, 'chat', 'current')
        self.assertIn('请记住最早的约定', summary)
        self.assertGreater(len(expanded), len(fallback))
        self.assertEqual(sum(len(item['attachments']) for item in expanded), 2)
        self.assertLessEqual(sum(context._metrics(item['content'])[1] + 8 for item in expanded),
                             window.history_budget)

    def test_active_request_trims_only_complete_historical_pairs(self):
        window = context.ModelWindow(2000, output_reserve=200)
        messages = [
            {'role': 'system', 'content': 'header'},
            {'role': 'user', 'content': 'old'},
            {'role': 'assistant', 'content': '字' * 900},
            {'role': 'user', 'content': 'current'},
            {'role': 'tool', 'content': '值' * 800, 'tool_call_id': 'call-1'},
        ]
        self.assertEqual(context.fit_request(messages, [], window, 1, 2), (0, True))
        self.assertEqual([item['role'] for item in messages], ['system', 'user', 'tool'])
        self.assertEqual(messages[1]['content'], 'current')

    def test_native_stream_reports_provider_prompt_usage_for_known_window(self):
        sse = io.BytesIO(
            b'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n'
            b'data: {"choices":[],"usage":{"prompt_tokens":12345,"completion_tokens":20}}\n\n'
            b'data: [DONE]\n\n'
        )
        sse.headers = {'Content-Type': 'text/event-stream'}
        config = Config('https://api.deepseek.com', 'deepseek-flash', 'fake-key')
        with TemporaryDirectory() as folder, patch(
                'ai_assistant.provider_transport.open_stream', return_value=sse) as upstream:
            service = AssistantService(Path(folder) / 'assistant.sqlite3', config)
            cid = service.create()['id']
            events = list(service.stream(cid, *service.begin(cid, 'Hi')))
        self.assertEqual(events[-1][0], 'done')
        self.assertEqual(events[-1][1]['message']['reply_meta']['context'],
                         {'used_tokens': 12345, 'max_tokens': 1_000_000})
        request = json.loads(upstream.call_args.args[1].data)
        self.assertEqual(request['stream_options'], {'include_usage': True})


if __name__ == '__main__':
    unittest.main()
