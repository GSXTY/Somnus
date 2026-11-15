import json
import tempfile
import threading
import time
import unittest
import sqlite3
import base64
import io
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from unittest.mock import patch
from ai_assistant.service import AssistantService, Config, AssistantError
from ai_assistant.http import handle_http
from ai_assistant.images import validate_images


class Upstream(BaseHTTPRequestHandler):
    packets = ['data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', 'data: [DONE]\n\n']
    requests = []
    delay = 0
    def log_message(self, *_): pass
    def do_POST(self):
        type(self).requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        time.sleep(type(self).delay)
        for packet in type(self).packets:
            try:
                self.wfile.write(packet.encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                break


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'assistant.sqlite3'
        Upstream.packets = ['data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', 'data: [DONE]\n\n']
        Upstream.requests = []
        Upstream.delay = 0
        self.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.service = AssistantService(self.path, Config(f'http://127.0.0.1:{self.upstream.server_port}/v1', 'test-model', 'secret'))
        self.cid = self.service.create()['id']

    def tearDown(self):
        self.upstream.shutdown()
        self.upstream.server_close()
        self.tmp.cleanup()

    def run_turn(self, content='测试', context=None):
        return list(self.service.stream(self.cid, *self.service.begin(self.cid, content, tool_context=context)))

    def test_general_greeting_does_not_eagerly_read_database_schema(self):
        with patch('agent_core.sql_access.schema') as schema:
            self.assertEqual(self.run_turn('你好')[-1][0], 'done')
            schema.assert_not_called()
        messages = Upstream.requests[-1]['messages']
        self.assertEqual([message['role'] for message in messages], ['system', 'user'])
        prompt = messages[0]['content']
        self.assertIn('你是 Somnus，一个支持项目协作、公司数据查询与分析的 AI Agent', prompt)
        self.assertIn('简单问候用一两句自然回应', prompt)
        self.assertNotIn('内部 YA70 数据平台', prompt)
        self.assertNotIn('型号编码', prompt)

    def test_each_turn_uses_local_time_and_calendar_boundaries(self):
        hours_east = timezone(timedelta(hours=8))
        with patch('ai_assistant.service.datetime') as clock:
            clock.now.return_value.astimezone.side_effect = [
                datetime(2026, 12, 31, 23, 59, 59, tzinfo=hours_east),
                datetime(2027, 1, 1, 0, 0, 1, tzinfo=hours_east),
            ]
            with patch('agent_core.sql_access.schema') as schema:
                self.run_turn('今天几号？', {'project_desktop': True})
                self.run_turn('昨天几号？', {'project_desktop': True})
                schema.assert_not_called()
        previous, current = [request['messages'][0]['content'] for request in Upstream.requests]
        self.assertIn('本轮开始时的本机时间为 2026-12-31T23:59:59+08:00', previous)
        self.assertIn('今天 2026-12-31，昨天 2026-12-30，明天 2027-01-01', previous)
        self.assertIn('本轮开始时的本机时间为 2027-01-01T00:00:01+08:00', current)
        self.assertIn('今天 2027-01-01，昨天 2026-12-31，明天 2027-01-02', current)

    def test_remote_date_prompt_identifies_service_clock(self):
        hours_west = timezone(timedelta(hours=-5))
        with patch('ai_assistant.service.datetime') as clock:
            clock.now.return_value.astimezone.return_value = datetime(2026, 7, 4, 14, 30, tzinfo=hours_west)
            self.run_turn('What date is it today?')
        prompt = Upstream.requests[-1]['messages'][0]['content']
        self.assertIn('服务所在机器的时间（用户时区未知）为 2026-07-04T14:30:00-05:00', prompt)
        self.assertIn('今天 2026-07-04，昨天 2026-07-03', prompt)
        self.assertIn('业务报表的日期范围以报表数据源采用的业务时区为准', prompt)

    def test_share_exposes_only_public_web_and_no_private_tool_guidance(self):
        self.run_turn('你好', {'share': True})
        payload = Upstream.requests[-1]
        self.assertEqual([tool['function']['name'] for tool in payload['tools']], ['fetch_url'])
        prompt = payload['messages'][0]['content']
        self.assertNotIn('调用 3 次查询', prompt)
        self.assertNotIn('深度分析工具成功返回', prompt)

    def test_plain_chat_does_not_require_a_tool(self):
        with patch('ai_assistant.service.TOOL_SPECS', []):
            self.assertEqual(self.run_turn('What is 2 + 2?')[-1][0], 'done')
        payload = Upstream.requests[-1]
        self.assertNotIn('tools', payload)
        prompt = payload['messages'][0]['content']
        self.assertIn('直接回答常识和推导', prompt)
        self.assertIn('来源、限制或失败影响结论或下一步时，具体说明影响', prompt)
        self.assertIn('不得依据工程候选作诊断或建议调整治疗设置', prompt)

    def test_data_tools_preserve_provenance_and_follow_existing_permissions(self):
        context = {'analysis_file_id': 'test-id', 'analysis_file_meta': {'name': 'example.csv', 'row_count': 3, 'columns': ['count']}}
        self.run_turn('分析附件', context)
        read_only = Upstream.requests[-1]
        names = {tool['function']['name'] for tool in read_only['tools']}
        self.assertIn('query_database', names)
        self.assertNotIn('create_deep_analysis', names)
        self.assertIn('本轮可见的是文件元数据', read_only['messages'][1]['content'])
        self.service.set_permission(self.cid, 'workspace_write')
        self.run_turn('分析附件', context)
        writable = Upstream.requests[-1]
        names = {tool['function']['name'] for tool in writable['tools']}
        self.assertTrue({'query_database', 'create_deep_analysis', 'create_deep_analysis_from_query'} <= names)
        self.assertIn('仅在口径不明、报错或结果异常时查表结构', writable['messages'][0]['content'])
        self.assertIn('以工具成功返回的任务编号为准', writable['messages'][0]['content'])
        self.assertIn('本轮表格附件元数据', writable['messages'][1]['content'])

    def test_roundtrip_stream_and_restart(self):
        self.assertEqual(self.service.status()['connection_status'], 'unverified')
        result = self.run_turn()
        self.assertEqual([x[0] for x in result], ['start', 'delta', 'done'])
        self.assertEqual(self.service.status()['connection_status'], 'verified')
        reopened = AssistantService(self.path, Config('', '', ''))
        self.assertEqual(reopened.get(self.cid)['messages'][-1]['content'], '你好')
        self.assertNotIn('secret', json.dumps(self.service.status()))
        self.service.rename(self.cid, '数据分析')
        self.assertEqual(self.service.conversations()[0]['title'], '数据分析')

    def test_first_text_titles_default_chat_at_stream_start(self):
        self.assertEqual(self.service.get(self.cid)['conversation']['title'], '新会话')
        content = '  设备使用\n  趋势 ' + '很' * 80
        event, packet = self.run_turn(content)[0]
        self.assertEqual(event, 'start')
        expected = '设备使用 趋势 ' + '很' * 31 + '…'
        self.assertEqual(packet['conversation']['title'], expected)
        self.assertEqual(packet['conversation']['message_count'], 2)
        self.assertEqual(packet['user_message']['content'], content.strip())
        self.run_turn('后续问题')
        reopened = AssistantService(self.path, self.service.config)
        self.assertEqual(reopened.conversations()[0]['title'], expected)

    def test_first_text_preserves_explicit_titles_including_default_label(self):
        explicit = self.service.create('手动命名')['id']
        self.service.rename(self.cid, '新会话')
        for cid, title in ((explicit, '手动命名'), (self.cid, '新会话')):
            turn = list(self.service.stream(cid, *self.service.begin(cid, '第一条消息')))
            self.assertEqual(turn[0][1]['conversation']['title'], title)
            self.assertEqual(self.service.get(cid)['conversation']['title'], title)

    def test_unconfigured_no_messages(self):
        service = AssistantService(self.path, Config('', '', ''))
        with self.assertRaises(AssistantError) as error:
            service.begin(self.cid, 'test')
        self.assertEqual(error.exception.status, 503)
        self.assertEqual(service.get(self.cid)['messages'], [])
        self.assertEqual(service.get(self.cid)['conversation']['title'], '新会话')

    def test_eof_partial_is_error_and_excluded_from_context(self):
        Upstream.packets = ['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n']
        self.assertEqual(self.run_turn('failed-question')[-1][0], 'error')
        self.assertEqual(self.service.get(self.cid)['messages'][-1]['status'], 'error')
        Upstream.packets = ['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']
        self.run_turn('new-question')
        self.assertEqual([m['content'] for m in Upstream.requests[-1]['messages'][1:]], ['new-question'])
        self.assertFalse(self.service.active)

    def test_explicit_stop_is_a_terminal_marker_even_without_done(self):
        Upstream.packets = ['data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n']
        self.assertEqual(self.run_turn('single marker')[-1][0], 'done')

    def test_partial_tool_requests_are_not_executed(self):
        tool = {'index': 0, 'function': {'name': 'query_database', 'arguments': '{"question":'}}
        choice = {'delta': {'tool_calls': [tool]}, 'finish_reason': 'tool_calls'}
        Upstream.packets = ['data: ' + json.dumps({'choices': [choice]}) + '\n\n', 'data: [DONE]\n\n']
        with patch('ai_assistant.service.run_chat_tool') as call:
            self.assertEqual(self.run_turn('broken call')[-1][0], 'error')
            call.assert_not_called()

    def test_cancel_and_busy_release(self):
        turn = self.service.begin(self.cid, 'test')
        with self.assertRaises(AssistantError) as error:
            self.service.begin(self.cid, 'duplicate')
        self.assertEqual(error.exception.status, 409)
        self.service.cancel(self.cid)
        result = list(self.service.stream(self.cid, *turn))
        self.assertEqual(result[-1][0], 'cancelled')
        self.assertFalse(self.service.active)
        self.assertEqual(self.service.get(self.cid)['messages'][-1]['status'], 'cancelled')

    def test_disconnect_and_restart_clear_streaming(self):
        turn = self.service.begin(self.cid, 'test')
        stream = self.service.stream(self.cid, *turn)
        next(stream)
        stream.close()
        self.assertFalse(self.service.active)
        self.assertEqual(self.service.get(self.cid)['messages'][-1]['status'], 'cancelled')
        self.service.begin(self.cid, 'interrupted')
        reopened = AssistantService(self.path, self.service.config)
        self.assertEqual(reopened.get(self.cid)['messages'][-1]['status'], 'error')

    def test_validation_and_endpoint(self):
        with self.assertRaises(AssistantError): self.service.begin(self.cid, 'x'*12001)
        with self.assertRaises(AssistantError): self.service.rename(self.cid, ' ')
        self.assertEqual(Config('https://example.com/v1/chat/completions', 'x', 'y').endpoint, 'https://example.com/v1/chat/completions')
        self.assertFalse(Config('https://user:secret@example.com/v1', 'x', 'y').configured)
        self.assertFalse(Config('https://example.com/v1', 'x', '   ').configured)

    def test_complete_context_has_whole_turns(self):
        self.run_turn('first')
        self.run_turn('second')
        self.assertEqual([(m['role'], m['content']) for m in Upstream.requests[-1]['messages'][1:]], [('user','first'),('assistant','你好'),('user','second')])

    def test_sensitive_upstream_error_not_exposed(self):
        Upstream.packets = ['data: {"error":{"message":"secret private endpoint"}}\n\n']
        result = self.run_turn()
        self.assertEqual(result[-1][0], 'error')
        self.assertNotIn('secret', json.dumps(result))
        self.assertFalse(self.service.active)

    def test_read_timeout_releases_busy(self):
        self.service.config.timeout = 0.05
        Upstream.delay = 0.2
        self.assertEqual(self.run_turn()[-1][0], 'error')
        self.assertFalse(self.service.active)

    def test_soft_delete_hides_and_preserves_other_conversations(self):
        self.run_turn()
        other = self.service.create('保留')['id']
        self.assertEqual(self.service.delete(self.cid), dict(deleted=True, conversation_id=self.cid))
        self.assertEqual([c['id'] for c in self.service.conversations()], [other])
        for operation in [lambda:self.service.get(self.cid), lambda:self.service.rename(self.cid,'hidden'), lambda:self.service.begin(self.cid,'test'), lambda:self.service.delete(self.cid), lambda:self.service.cancel(self.cid)]:
            with self.assertRaises(AssistantError) as error: operation()
            self.assertEqual(error.exception.status, 404)
        with self.service.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages WHERE conversation_id=?',(self.cid,)).fetchone()[0], 2)
            self.assertIsNotNone(db.execute('SELECT deleted_at FROM conversations WHERE id=?',(self.cid,)).fetchone()[0])

    def test_delete_busy_and_missing(self):
        turn = self.service.begin(self.cid, 'test')
        with self.assertRaises(AssistantError) as error: self.service.delete(self.cid)
        self.assertEqual(error.exception.status, 409)
        self.service.cancel(self.cid)
        self.service.delete(self.cid)
        list(self.service.stream(self.cid, *turn))
        with self.assertRaises(AssistantError) as error: self.service.delete('missing')
        self.assertEqual(error.exception.status, 404)

    def test_old_schema_migration_preserves_data(self):
        path = Path(self.tmp.name) / 'legacy.sqlite3'
        with sqlite3.connect(path) as db:
            db.executescript("CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at REAL,updated_at REAL); CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,status TEXT,created_at REAL); INSERT INTO conversations VALUES('old','新会话',1,1); INSERT INTO messages VALUES('m','old','user','原文','complete',1);")
        db.close()
        service = AssistantService(path, self.service.config)
        self.assertEqual(service.get('old')['messages'][0]['content'], '原文')
        self.assertEqual(service.get('old')['messages'][0]['attachments'], [])
        list(service.stream('old', *service.begin('old', '新问题')))
        self.assertEqual(service.get('old')['conversation']['title'], '新会话')
        AssistantService(path, self.service.config)
        self.assertEqual(len(service.conversations()), 1)

    @staticmethod
    def image_attachment(format='PNG', size=(2,2)):
        from PIL import Image
        output = io.BytesIO()
        Image.new('RGB', size, 'blue').save(output, format)
        mime = {'PNG':'png','JPEG':'jpeg','WEBP':'webp'}[format]
        return dict(name='test.'+mime, data_url=f'data:image/{mime};base64,'+base64.b64encode(output.getvalue()).decode())

    def test_image_only_multimodal_and_persisted_history(self):
        image = self.image_attachment()
        self.service.config.vision_enabled = True
        turn = self.service.begin(self.cid, '', [image])
        self.assertEqual(list(self.service.stream(self.cid,*turn))[-1][0], 'done')
        sent = Upstream.requests[-1]['messages'][-1]['content']
        self.assertEqual(sent[0]['type'], 'image_url')
        self.assertEqual(sent[0]['image_url']['url'], image['data_url'])
        reopened = AssistantService(self.path,self.service.config)
        self.assertEqual(reopened.get(self.cid)['messages'][0]['attachments'][0]['width'], 2)
        self.run_turn('继续分析')
        self.assertIsInstance(Upstream.requests[-1]['messages'][1]['content'], list)
        self.assertFalse(any('attachments' in c for c in self.service.conversations()))

    def test_image_disabled_and_validation_before_persist(self):
        image = self.image_attachment()
        with self.assertRaises(AssistantError) as error: self.service.begin(self.cid,'test',[image])
        self.assertEqual(error.exception.code,'vision_disabled')
        self.assertEqual(self.service.get(self.cid)['messages'], [])
        self.service.config.vision_enabled=True
        invalid = [dict(name='bad',data_url='data:image/jpeg;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n').decode())]
        for attachments in [invalid, [image]*5, [dict(name='bad',data_url='https://example.com/a.png')]]:
            with self.assertRaises(AssistantError) as error: self.service.begin(self.cid,'test',attachments)
            self.assertEqual(error.exception.code,'invalid_attachment')
        self.assertEqual(self.service.get(self.cid)['messages'], [])
        for format in ['PNG','JPEG','WEBP']:
            self.assertEqual(len(validate_images([self.image_attachment(format)])),1)

    def test_image_size_limits_and_failed_image_context(self):
        large = self.image_attachment(size=(8193,1))
        with self.assertRaises(ValueError): validate_images([large])
        with self.assertRaises(ValueError): validate_images([dict(name='huge',data_url='data:image/png;base64,'+base64.b64encode(b'0'*(5*1024*1024+1)).decode())])
        self.service.config.vision_enabled=True
        Upstream.packets = ['data: {"error":{"message":"failed"}}\n\n']
        list(self.service.stream(self.cid,*self.service.begin(self.cid,'failed image',[self.image_attachment()])))
        Upstream.packets = ['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n','data: [DONE]\n\n']
        self.run_turn('text only')
        self.assertEqual(Upstream.requests[-1]['messages'][1:], [dict(role='user',content='text only')])

    def test_multimodal_history_budget(self):
        self.service.config.vision_enabled=True
        image = self.image_attachment()
        for question in ['first','second']:
            list(self.service.stream(self.cid,*self.service.begin(self.cid,question,[image]*3)))
        sent = Upstream.requests[-1]['messages'][1:]
        self.assertEqual(len(sent),1)
        self.assertEqual(len([part for part in sent[0]['content'] if part['type']=='image_url']),3)

    def test_long_chat_compacts_old_text_and_preserves_current_request(self):
        from ai_assistant import conversation_context

        def save_round(question, answer, status='complete', attachments=None):
            _, reply, cancel = self.service.begin(self.cid, question, attachments)
            self.service.save(self.cid, dict(reply, content=answer, status=status))
            self.service.release(self.cid, cancel)

        self.service.config.vision_enabled = True
        old_image = self.image_attachment('PNG')
        recent_image = self.image_attachment('WEBP')
        decision = '请记住，项目名称始终使用 EARLIEST_DECISION。'
        save_round(decision, '~~~python\nPRIVATE_CODE_PAYLOAD\n~~~', attachments=[old_image])
        save_round('记住 CANCELLED_QUESTION', 'CANCELLED_REPLY', 'cancelled')
        save_round('记住 ERROR_QUESTION', 'ERROR_REPLY', 'error')
        for index in range(170):
            question = f'轮次 {index} 的具体问题'
            if index == 55:
                question = '以后依照 MIDDLE_DECISION 发送数据。'
            save_round(question, '已处理该问题。')
        save_round('保留 RECENT_QUESTION 的原始文字。', 'RECENT_ANSWER', attachments=[recent_image])
        save_round('最新的大段问答仍需保留。', 'ANSWER_HEAD' + ('超' * 20_000) + 'ANSWER_TAIL')
        previous = self.service.get(self.cid)['messages']
        self.service = AssistantService(self.path, self.service.config)
        current = '本轮操作仅限 CURRENT_QUESTION。'

        self.assertEqual(self.run_turn(current)[-1][0], 'done')
        self.assertEqual(len(Upstream.requests), 1)
        messages = Upstream.requests[-1]['messages']
        summary = next(message['content'] for message in messages
                       if message['role'] == 'system' and '历史问答摘录' in message['content'])
        excerpt = json.loads(summary.split('\n', 1)[1])['历史问答摘录']
        self.assertLessEqual(len(excerpt.encode('utf-8')), conversation_context.SUMMARY_BYTES)
        self.assertIn('EARLIEST_DECISION', excerpt)
        self.assertIn('MIDDLE_DECISION', excerpt)
        self.assertNotIn('CURRENT_QUESTION', summary)
        self.assertEqual(messages[-1], {'role': 'user', 'content': current})
        self.assertEqual(len([message for message in messages[0:-1] if message['role'] == 'assistant']),
                         conversation_context.RECENT_TURNS)
        whole = json.dumps(messages, ensure_ascii=False)
        self.assertIn('RECENT_ANSWER', whole)
        self.assertIn(recent_image['data_url'], whole)
        self.assertNotIn(old_image['data_url'], whole)
        self.assertNotRegex(whole, 'PRIVATE_CODE_PAYLOAD|CANCELLED_QUESTION|CANCELLED_REPLY|ERROR_QUESTION|ERROR_REPLY')
        self.assertTrue(all(word in whole for word in ('ANSWER_HEAD', 'ANSWER_TAIL', '历史消息节选')))
        self.assertEqual(self.service.get(self.cid)['messages'][:-2], previous)

    def test_model_usage_uses_latest_valid_packet_per_tool_round(self):
        def packet(**fields):
            return 'data: ' + json.dumps(fields) + '\n\n'

        calls = [dict(index=0, id='tool', function=dict(name='list_database_schema', arguments='{}'))]
        Upstream.packets = [
            packet(choices=[dict(delta=dict(tool_calls=calls), finish_reason='tool_calls')]),
            packet(choices=[], usage=dict(prompt_tokens=3, completion_tokens=4)),
            packet(choices=[], usage=dict(prompt_tokens=30, completion_tokens=7,
                                         prompt_tokens_details=dict(cached_tokens=0))),
            packet(choices=[], usage=dict(prompt_tokens=True, completion_tokens=88)),
            'data: [DONE]\n\n',
        ]

        def tool(*_args, **_kwargs):
            Upstream.packets = [
                packet(choices=[dict(delta=dict(content='Finished.'))]),
                packet(choices=[dict(delta={}, finish_reason='stop')],
                       usage=dict(prompt_tokens=42, completion_tokens=9, prompt_cache_hit_tokens=23)),
                'data: [DONE]\n\n',
            ]
            return dict(ok=True, summary='mocked table', content='mocked table')

        with patch('ai_assistant.service.run_chat_tool', side_effect=tool):
            events = self.run_turn()
        self.assertEqual(len(Upstream.requests), 2)
        self.assertTrue(all('stream_options' not in request for request in Upstream.requests))
        self.assertEqual(events[-1][0], 'done')
        usage = events[-1][1]['message']['reply_meta']['usage']
        self.assertEqual(usage, dict(input_tokens=72, output_tokens=16, cached_input_tokens=23))
        reopened = AssistantService(self.path, self.service.config)
        self.assertEqual(reopened.get(self.cid)['messages'][-1]['reply_meta']['usage'], usage)

    def test_model_usage_is_partial_on_error_or_cancel_and_absent_without_counts(self):
        def packet(**fields):
            return 'data: ' + json.dumps(fields) + '\n\n'

        Upstream.packets = [
            packet(usage=dict(prompt_tokens=0, completion_tokens=11), choices=[]),
            packet(choices=[dict(delta=dict(content='partial reply'))]),
            'data: [DONE]\n\n',
        ]
        stream = self.service.stream(self.cid, *self.service.begin(self.cid, 'will stop'))
        self.assertEqual(next(stream)[0], 'start')
        self.assertEqual(next(stream)[0], 'delta')
        self.assertTrue(self.service.cancel(self.cid))
        stopped = next(stream)
        self.assertEqual(stopped[0], 'cancelled')
        self.assertEqual(stopped[1]['message']['reply_meta']['usage'],
                         dict(input_tokens=0, output_tokens=11, partial=True))
        stream.close()
        Upstream.packets = [
            packet(usage=dict(prompt_tokens=25, completion_tokens=3), error=dict(message='provider failure')),
        ]
        failed = self.run_turn('error still contains a usage report')[-1]
        self.assertEqual(failed[0], 'error')
        self.assertEqual(failed[1]['assistant_message']['reply_meta']['usage'],
                         dict(input_tokens=25, output_tokens=3, partial=True))
        Upstream.packets = [
            packet(choices=[dict(delta=dict(content='finished'))], usage=dict(prompt_tokens=1 << 53, completion_tokens=1)),
            'data: [DONE]\n\n',
        ]
        unavailable = self.run_turn('invalid upstream count')[-1][1]['message']['reply_meta']
        self.assertTrue(unavailable['usage_unavailable'])
        self.assertNotIn('usage', unavailable)

    def test_model_usage_is_partial_when_a_followup_request_omits_it(self):
        call = dict(index=0, id='tool', function=dict(name='list_database_schema', arguments='{}'))
        Upstream.packets = [
            'data: ' + json.dumps(dict(choices=[dict(delta=dict(tool_calls=[call]), finish_reason='tool_calls')],
                                       usage=dict(prompt_tokens=101, completion_tokens=13, prompt_cache_hit_tokens=51))) + '\n\n',
            'data: [DONE]\n\n',
        ]

        def tool(*_args, **_kwargs):
            Upstream.packets = ['data: {"choices":[{"delta":{"content":"No usage for this request."}}]}\n\n',
                                'data: [DONE]\n\n']
            return dict(ok=True, summary='mocked table', content='mocked table')

        with patch('ai_assistant.service.run_chat_tool', side_effect=tool):
            usage = self.run_turn()[-1][1]['message']['reply_meta']['usage']
        self.assertEqual(usage, dict(input_tokens=101, output_tokens=13, partial=True))

    def test_http_adapter(self):
        service = self.service
        class Host(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def send(self, value, status=200):
                raw = json.dumps(value).encode()
                self.send_response(status)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            def do_GET(self): handle_http(self, service)
            def do_POST(self): handle_http(self, service)
        host = ThreadingHTTPServer(('127.0.0.1', 0), Host)
        threading.Thread(target=host.serve_forever, daemon=True).start()
        try:
            base = f'http://127.0.0.1:{host.server_port}/api/assistant'
            with urlopen(base+'/status') as response:
                self.assertFalse(json.load(response)['database_connected'])
            request = Request(base+f'/conversations/{self.cid}/messages', json.dumps({'content':'test'}).encode(), {'Content-Type':'application/json'})
            with urlopen(request) as response:
                output = response.read().decode()
            self.assertIn('event: done', output)
            self.assertIn('你好', output)
            self.assertFalse(self.service.active)
            service.config.vision_enabled=True
            body = dict(content='',attachments=[self.image_attachment()])
            request = Request(base+f'/conversations/{self.cid}/messages',json.dumps(body).encode(),{'Content-Type':'application/json'})
            with urlopen(request) as response:
                self.assertIn('event: done',response.read().decode())
            request = Request(base+f'/conversations/{self.cid}/delete',b'{}',{'Content-Type':'application/json'})
            with urlopen(request) as response:
                self.assertTrue(json.load(response)['deleted'])
            with self.assertRaises(AssistantError): service.get(self.cid)
        finally:
            host.shutdown()
            host.server_close()


if __name__ == '__main__': unittest.main()
