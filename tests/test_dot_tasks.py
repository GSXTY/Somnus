import base64
import hashlib
import hmac
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from ai_assistant.dot_tasks import DotError, DotTasks, RpcError


class DotTasksTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.received = []
        self.key = b'Synthetic-key-' * 2
        self.bridge = DotTasks(self.folder, sender=self.receiver)
        self.bridge.listener = object()
        self.params = {'name': 'task.created', 'arguments': {},
                       'delivery': {'mode': 'webhook', 'url': 'https://example.test/callback',
                                    'secret': 'whsec_' + base64.b64encode(self.key).decode()}}

    def receiver(self, url, body, headers):
        self.assertEqual(url, self.params['delivery']['url'])
        raw = b'.'.join((headers['webhook-id'].encode(), headers['webhook-timestamp'].encode(), body))
        signature = base64.b64encode(hmac.digest(self.key, raw, hashlib.sha256)).decode()
        self.assertEqual(headers['webhook-signature'], 'v1,' + signature)
        payload = json.loads(body)
        self.received.append(payload)
        if payload.get('type') == 'verification':
            return 200, json.dumps({'challenge': payload['challenge']}).encode()
        return 202, b''

    def test_explicit_prompt_reaches_only_bound_task_and_result_returns_to_its_conversation(self):
        self.assertFalse(self.bridge.status()['ready'])
        with self.assertRaises(DotError):
            self.bridge.create_task('first-chat', 'draft prompt')
        self.assertFalse(self.bridge.path.exists())
        opened = self.bridge.dispatch('events/subscribe', self.params)
        self.assertEqual(opened['id'], self.bridge.dispatch('events/subscribe', self.params)['id'])
        self.assertTrue(self.bridge.status()['ready'])
        task = self.bridge.create_task('first-chat', '  Simulated widgets  ')
        self.assertEqual(task['status'], 'pending')
        self.assertEqual(len(self.received), 2)
        self.assertEqual(self.received[-1]['data']['task_id'], task['id'])
        self.assertNotIn('Simulated widgets', json.dumps(self.received))
        self.assertNotIn('first-chat', json.dumps(self.received))
        read = {'name': 'read_task', 'arguments': {'task_id': task['id']}}
        self.assertEqual(self.bridge.call_tool(read)['structuredContent']['text'], 'Simulated widgets')
        submit = {'name': 'submit_result', 'arguments': {'task_id': task['id'], 'result': 'Ready.'}}
        self.bridge.call_tool(submit)
        self.bridge.call_tool(submit)
        with self.assertRaises(RpcError):
            self.bridge.call_tool({**submit, 'arguments': {**submit['arguments'], 'result': 'Different.'}})
        reloaded = DotTasks(self.folder)
        self.assertEqual(reloaded.list_tasks('first-chat')['tasks'][0]['result'], 'Ready.')
        self.assertEqual(reloaded.list_tasks('second-chat')['tasks'], [])
        self.bridge.dispatch('events/unsubscribe', self.params)
        self.assertFalse(self.bridge.status()['ready'])
        with self.assertRaises(RpcError):
            self.bridge.call_tool(read)

    def test_listener_config_opt_in_and_webhook_failure(self):
        with patch.dict('os.environ', {'SOMNUS_DOT_MCP_PORT': '18431', 'SOMNUS_DOT_MCP_PATH': 'short'}):
            self.assertIsNone(self.bridge.config())
        slug = 'synthetic_path_' + 'x' * 24
        with patch.dict('os.environ', {'SOMNUS_DOT_MCP_PORT': '18431', 'SOMNUS_DOT_MCP_PATH': slug}):
            self.assertEqual(self.bridge.config(), (18431, '/mcp/' + slug))
        self.bridge.subscribe(self.params)
        self.bridge.sender = lambda *_: (500, b'')
        task = self.bridge.create_task('failed-chat', 'Simulated task')
        self.assertEqual(task['status'], 'error')
        self.assertIsNone(task['result'])

    def test_subscription_survives_restart_until_expiry_or_path_rotation(self):
        self.bridge.route_key = 'old-route-hash'
        opened = self.bridge.subscribe(self.params)
        restarted = DotTasks(self.folder, self.receiver)
        restarted.route_key = self.bridge.route_key
        restarted.restore_subscription()
        self.assertEqual(restarted.active_subscription()['id'], opened['id'])
        self.assertEqual(restarted.active_subscription()['key'], self.key)
        self.assertEqual(len(self.received), 1)
        restarted.route_key = 'new-route-hash'
        restarted.subscription = None
        restarted.restore_subscription()
        self.assertIsNone(restarted.active_subscription())

    def test_setup_allocates_persists_and_starts_once(self):
        companion = DotTasks(self.folder)
        self.addCleanup(companion.stop)
        with patch.dict('os.environ', clear=True):
            self.assertEqual(companion.setup_status(), {
                'enabled': False, 'ready': False, 'paused': False, 'port': None, 'secret_path': None,
            })
            setup = companion.setup()
            listener = companion.listener
            self.assertTrue(setup['enabled'])
            self.assertFalse(setup['ready'])
            self.assertEqual(listener.server_address, ('127.0.0.1', setup['port']))
            self.assertGreaterEqual(len(setup['secret_path']), 32)
            self.assertEqual(json.loads(companion.config_path.read_text(encoding='utf-8')),
                             {key: setup[key] for key in ('port', 'secret_path')})
            self.assertEqual(companion.setup(18433), setup)
            self.assertIs(companion.listener, listener)
            companion.stop()
            self.assertEqual(companion.setup_status()['secret_path'], setup['secret_path'])

    def test_setup_preserves_invalid_config_and_rejects_failed_bind(self):
        companion = DotTasks(self.folder)
        with patch.dict('os.environ', clear=True):
            with patch('ai_assistant.dot_tasks.ThreadingHTTPServer', side_effect=OSError):
                with self.assertRaises(DotError) as bind_error:
                    companion.setup(18433)
                self.assertEqual(bind_error.exception.code, 'dot_port_unavailable')
                self.assertFalse(companion.config_path.exists())
            companion.config_path.write_text('malformed', encoding='utf-8')
            with self.assertRaises(DotError) as config_error:
                companion.setup()
            self.assertEqual(config_error.exception.code, 'dot_config_invalid')
            self.assertEqual(companion.config_path.read_text(encoding='utf-8'), 'malformed')

    def test_pause_survives_restart_and_preserves_in_flight_result_and_subscription(self):
        companion = DotTasks(self.folder, self.receiver)
        self.addCleanup(companion.stop)
        with patch.dict('os.environ', clear=True):
            setup = companion.setup()
            companion.subscribe(self.params)
            task = companion.create_task('first-chat', 'Send before pause')
            paused = companion.set_enabled(False)
            self.assertTrue(paused['enabled'])
            self.assertTrue(paused['paused'])
            self.assertFalse(paused['ready'])
            self.assertEqual(paused['secret_path'], setup['secret_path'])
            self.assertEqual(companion.set_enabled(False), paused)
            with self.assertRaises(DotError) as blocked:
                companion.create_task('first-chat', 'Send after pause')
            self.assertEqual(blocked.exception.code, 'dot_paused')
            with self.assertRaises(RpcError):
                companion.subscribe({**self.params, 'delivery': {
                    **self.params['delivery'], 'url': 'https://other.example.test/callback',
                }})
            self.assertEqual(len(self.received), 2)
            companion.stop()
            restarted = DotTasks(self.folder, self.receiver)
            self.addCleanup(restarted.stop)
            restarted.start()
            self.assertTrue(restarted.setup_status()['paused'])
            self.assertIsNotNone(restarted.active_subscription())
            read = {'name': 'read_task', 'arguments': {'task_id': task['id']}}
            self.assertEqual(restarted.call_tool(read)['structuredContent']['text'], 'Send before pause')
            restarted.call_tool({'name': 'submit_result', 'arguments': {
                'task_id': task['id'], 'result': 'Ready.',
            }})
            with self.assertRaises(RpcError):
                restarted.call_tool(read)
            self.assertEqual(restarted.list_tasks('first-chat')['tasks'][0]['result'], 'Ready.')
            self.assertTrue(restarted.set_enabled(True)['ready'])
            self.assertEqual(restarted.create_task('first-chat', 'Send again')['status'], 'pending')
            self.assertEqual(len(self.received), 3)


if __name__ == '__main__':
    unittest.main()
