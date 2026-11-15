"""Contract tests with synthetic CSV and fake model/executor; never executes generated code."""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from deep_analysis.config import Config
from deep_analysis.runtime import DockerExecutor
from deep_analysis.service import AnalysisError, DeepAnalysisService, parse_action


CSV = b'synthetic,userid,therapy_seconds,device_ahi,missing_percent\ntrue,SYNTHETIC-001,28800,4.2,1.5\n'


class FakeExecutor:
    def __init__(self, ready=True):
        self.ready = ready
        self.calls = []
        self.closed = False

    def readiness(self):
        return dict(docker_available=self.ready, image_ready=self.ready, execution_ready=self.ready,
                    execution_reason='' if self.ready else 'Docker is unavailable in this synthetic test.')

    def execute(self, code, input_path, workspace, cancel, deadline):
        self.calls.append(code)
        # Fake output fixture only; the supplied code string is NEVER executed.
        from PIL import Image
        Image.new('RGB', (20, 10), (160, 80, 60)).save(Path(workspace) / 'chart.png')
        return dict(exit_code=0, output='synthetic rows=1; missing_percent=1.5')

    def close(self):
        self.closed = True


class FakeModel:
    def __init__(self, outputs=None):
        self.outputs = list(outputs or ['<Code>print("synthetic")</Code>', '<Answer>合成日报分析完成；不是患者数据。</Answer>'])
        self.calls = []

    def complete(self, messages):
        self.calls.append([item.copy() for item in messages])
        return self.outputs.pop(0)


class DeepAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runner, self.model = FakeExecutor(), FakeModel()
        self.service = DeepAnalysisService(self.temp.name, Config('https://synthetic.invalid/v1', 'test-model', 'test-only'),
                                           executor=self.runner, model_client=self.model)
        self.addCleanup(self.service.close)
        self.file = self.service.upload('owner-a', 'synthetic.csv', CSV)

    def wait_task(self, task):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = self.service.get_task('owner-a', task['id'])
            if result['status'] not in ('queued', 'running'):
                return result
            time.sleep(.01)
        self.fail('synthetic task did not finish')

    def test_independent_config_does_not_read_chat_credentials(self):
        with patch.dict(os.environ, {'AI_ASSISTANT_BASE_URL': 'https://chat.invalid', 'AI_ASSISTANT_MODEL': 'chat',
                                    'AI_ASSISTANT_API_KEY': 'must-not-use'}, clear=True):
            config = Config()
            self.assertFalse(config.configured)
            self.assertEqual(config.api_key, '')
        with patch.dict(os.environ, {'DEEP_ANALYSIS_MAX_FILE_MB': '0'}, clear=True):
            with self.assertRaises(ValueError):
                Config()

    def test_status_distinguishes_configuration_from_execution_and_connection(self):
        result = self.service.status()
        self.assertTrue(result['configured'])
        self.assertEqual(result['connection_status'], 'unverified')
        self.assertFalse(result['official_deepanalyze'])
        self.assertNotIn('api_key', result)
        self.assertNotIn('base_url', result)
        self.assertEqual(self.model.calls, [])

    def test_missing_docker_creates_blocked_task_without_model_call(self):
        self.runner.ready = False
        task = self.service.create_task('owner-a', self.file['id'], '分析合成数据')
        self.assertEqual(task['status'], 'blocked')
        self.assertEqual(task['error_code'], 'execution_not_ready')
        self.assertEqual(self.model.calls, [])
        self.assertEqual(self.runner.calls, [])

    def test_missing_model_is_blocked_and_retained(self):
        self.service.config = Config('', '', '')
        task = self.service.create_task('owner-a', self.file['id'], '分析')
        self.assertEqual(task['error_code'], 'model_not_configured')
        self.assertEqual(self.service.get_task('owner-a', task['id'])['status'], 'blocked')
        self.assertEqual(self.model.calls, [])

    def test_csv_validation_and_encoding_preserve_source_fingerprint(self):
        import hashlib
        raw = '来源,数值\n合成,3\n'.encode('gb18030')
        metadata = self.service.upload('owner-a', '../../valid.csv', raw)
        self.assertEqual(metadata['name'], 'valid.csv')
        self.assertEqual(metadata['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(metadata['columns'], ['来源', '数值'])
        for raw in (b'', b'x,y\n1\n', b'x\x00\n1\n', b'x\n'):
            with self.assertRaises(AnalysisError):
                self.service.upload('owner-a', 'invalid.csv', raw)

    def test_excel_upload_is_converted_to_csv(self):
        from io import BytesIO
        from openpyxl import Workbook
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = '日报'
        sheet.append(['用户ID', '治疗时长'])
        sheet.append([1001, 480])
        sheet.append([1002, 420])
        buffer = BytesIO()
        workbook.save(buffer)
        metadata = self.service.upload('owner-a', 'report.xlsx', buffer.getvalue())
        self.assertEqual(metadata['columns'], ['用户ID', '治疗时长'])
        self.assertEqual(metadata['row_count'], 2)
        self.assertEqual(metadata['source_format'], 'xlsx')
        self.assertEqual(metadata['selected_sheet'], '日报')

    def test_duplicate_headers_are_renamed_instead_of_rejected(self):
        raw = b'a,a,b\n1,2,3\n'
        metadata = self.service.upload('owner-a', 'dup.csv', raw)
        self.assertEqual(metadata['columns'], ['a', 'a_2', 'b'])
        self.assertEqual(metadata['renamed_columns'], [dict(original='a', name='a_2')])
        self.assertEqual(self.service.get_file('owner-a', metadata['id'])['columns'], ['a', 'a_2', 'b'])

    def test_owner_cannot_read_foreign_file_task_or_artifact(self):
        with self.assertRaises(AnalysisError) as failure:
            self.service.get_file('owner-b', self.file['id'])
        self.assertEqual(failure.exception.status, 404)
        task = self.wait_task(self.service.create_task('owner-a', self.file['id'], '分析合成数据并画图'))
        for method, identifier in ((self.service.get_task, task['id']), (self.service.artifact, task['artifacts'][0]['id'])):
            with self.assertRaises(AnalysisError) as failure:
                method('owner-b', identifier)
            self.assertEqual(failure.exception.status, 404)

    def test_complete_task_requires_execution_and_returns_verified_artifacts(self):
        task = self.wait_task(self.service.create_task('owner-a', self.file['id'], '分析合成数据并画图'))
        self.assertEqual(task['status'], 'complete')
        self.assertEqual([s['type'] for s in task['steps']], ['code', 'execute'])
        self.assertEqual({a['name'] for a in task['artifacts']}, {'chart.png', 'analysis-report.md'})
        self.assertEqual(self.service.status()['connection_status'], 'verified')
        artifact = next(a for a in task['artifacts'] if a['name'] == 'chart.png')
        path, _ = self.service.artifact('owner-a', artifact['id'])
        path.write_bytes(b'changed')
        with self.assertRaises(AnalysisError) as failure:
            self.service.artifact('owner-a', artifact['id'])
        self.assertEqual(failure.exception.code, 'artifact_changed')

    def test_answer_without_code_never_claims_complete(self):
        self.service.config.max_rounds = 2
        self.model.outputs = ['<Answer>未经验证</Answer>'] * 2
        task = self.wait_task(self.service.create_task('owner-a', self.file['id'], '分析'))
        self.assertEqual(task['status'], 'failed')
        self.assertEqual(task['error_code'], 'round_limit')
        self.assertEqual(task['answer'], '')
        self.assertEqual(task['artifacts'], [])
        self.assertEqual(self.runner.calls, [])

    def test_incomplete_blocks_never_execute(self):
        for text in ('<Code>print(1)', '<Code></Code>', 'no block here'):
            with self.assertRaises(AnalysisError):
                parse_action(text)
        # Tolerated: surrounding prose, reasoning blocks and both blocks present.
        self.assertEqual(parse_action('prefix<Code>a</Code>suffix')[0], 'Code')
        self.assertEqual(parse_action('<Code>a</Code><Answer>b</Answer>')[0], 'Code')
        self.assertEqual(parse_action('<Analyze>x</Analyze><Answer>ok</Answer>'), ('Answer', 'ok'))
        # Local models fall back to markdown fences; treat a fenced block as code.
        self.assertEqual(parse_action('说明\n```python\nprint(1)\n```\n')[0], 'Code')
        # Some emit the language name on the line after the fence.
        self.assertEqual(parse_action('```\npython\nprint(2)\n```'), ('Code', 'print(2)'))
        # Same quirk inside the protocol tags.
        self.assertEqual(parse_action('<Code>python\nprint(3)</Code>'), ('Code', 'print(3)'))
        self.model.outputs = ['<Code>print(1)']
        task = self.wait_task(self.service.create_task('owner-a', self.file['id'], '分析'))
        self.assertEqual(task['error_code'], 'invalid_model_action')
        self.assertEqual(self.runner.calls, [])

    def test_cancel_cannot_be_overwritten_by_old_model_response(self):
        entered, release = threading.Event(), threading.Event()
        def blocked(messages):
            entered.set()
            release.wait(2)
            return '<Answer>should not save</Answer>'
        self.model.complete = blocked
        task = self.service.create_task('owner-a', self.file['id'], '分析')
        self.assertTrue(entered.wait(1))
        self.service.cancel('owner-a', task['id'])
        release.set()
        deadline = time.monotonic() + 2
        while self.service.active and time.monotonic() < deadline:
            time.sleep(.01)
        result = self.service.get_task('owner-a', task['id'])
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(result['answer'], '')
        self.assertEqual(self.runner.calls, [])

    def test_restart_marks_stale_tasks_and_close_rejects_new_tasks(self):
        self.runner.ready = False
        task = self.service.create_task('owner-a', self.file['id'], '分析')
        task['status'] = 'running'
        self.service._save(task)
        replacement = DeepAnalysisService(self.temp.name, Config('', '', ''), executor=FakeExecutor(False))
        self.assertEqual(replacement.get_task('owner-a', task['id'])['status'], 'interrupted')
        replacement.close()
        with self.assertRaises(AnalysisError):
            replacement.create_task('owner-a', self.file['id'], '分析')
        self.assertTrue(replacement.executor.closed)

    def test_artifact_scan_omits_html_symlinks_and_internal_code(self):
        workspace = Path(self.temp.name) / 'tasks' / ('a' * 32) / 'work'
        workspace.mkdir(parents=True)
        (workspace / 'unsafe.html').write_text('<script>bad()</script>')
        (workspace / '_analysis.py').write_text('private runtime script')
        (workspace / 'report.txt').write_text('synthetic')
        entries = self.service._collect('owner-a', 'a' * 32, workspace)
        self.assertEqual([item['name'] for item in entries], ['report.txt'])

    def test_workspace_budget_and_docker_command_safety_without_execution(self):
        workspace = Path(self.temp.name) / 'quota'
        workspace.mkdir()
        (workspace / 'large.bin').write_bytes(b'x' * 1024)
        self.assertFalse(DockerExecutor.workspace_over_budget(workspace))
        for index in range(501):
            (workspace / str(index)).touch()
        self.assertTrue(DockerExecutor.workspace_over_budget(workspace))
        executor = DockerExecutor(self.service.config)
        with patch('deep_analysis.runtime.shutil.which', return_value=None), patch('deep_analysis.runtime.subprocess.Popen') as popen:
            self.assertFalse(executor.readiness(force=True)['execution_ready'])
            popen.assert_not_called()

    def test_authoritative_report_uses_host_directory_instead_of_work_link(self):
        workspace = self.service.tasks_dir / ('b' * 32) / 'work'
        workspace.mkdir(parents=True)
        outside = Path(self.temp.name) / 'host-data.txt'
        outside.write_text('untouched', encoding='utf-8')
        try:
            (workspace / 'analysis-report.md').symlink_to(outside)
        except OSError:
            (workspace / 'analysis-report.md').write_text('untrusted report', encoding='utf-8')
        artifacts = self.service._collect('owner-a', 'b' * 32, workspace, report='verified answer')
        self.assertEqual(len(artifacts), 1)
        path, item = self.service.artifact('owner-a', artifacts[0]['id'])
        self.assertEqual(path.parent, workspace.parent)
        self.assertEqual(item['name'], 'analysis-report.md')
        self.assertEqual(path.read_text(encoding='utf-8'), 'verified answer')
        self.assertEqual(outside.read_text(encoding='utf-8'), 'untouched')

    def test_docker_execution_uses_only_bounded_explicit_mounts_and_never_pulls(self):
        executor = DockerExecutor(self.service.config)
        executor.readiness = lambda: {'execution_ready': True}
        process = MagicMock()
        process.poll.return_value = 0
        process.returncode = 0
        workspace = self.service.tasks_dir / ('b' * 32) / 'work'
        with patch('deep_analysis.runtime.shutil.which', return_value='docker'), \
             patch('deep_analysis.runtime.subprocess.Popen', return_value=process) as spawn, \
             patch('deep_analysis.runtime.subprocess.run') as remove:
            executor.execute('print("never executed in test")', self.service.uploads / (self.file['id'] + '.csv'),
                             workspace, threading.Event(), time.monotonic() + 10)
        command = spawn.call_args.args[0]
        self.assertIn('--pull=never', command)
        for flag, value in (('--network', 'none'), ('--user', '65534:65534'), ('--pids-limit', '64'), ('--memory', '512m')):
            self.assertEqual(command[command.index(flag) + 1], value)
        mounts = [command[index + 1] for index, value in enumerate(command) if value == '--mount']
        self.assertEqual(len(mounts), 3)
        self.assertTrue(mounts[0].endswith('dst=/input/data.csv,readonly'))
        self.assertTrue(mounts[1].endswith('dst=/input/analysis.py,readonly'))
        self.assertTrue(mounts[2].endswith('dst=/work'))
        self.assertEqual(command[-1], '/input/analysis.py')
        self.assertFalse(list(workspace.iterdir()))
        self.assertFalse(list(workspace.parent.glob('*.py')))
        self.assertNotIn('shell', spawn.call_args.kwargs)
        self.assertEqual(remove.call_args.args[0][1:3], ['rm', '-f'])

    def test_close_interrupts_inflight_model_and_old_response_cannot_complete(self):
        entered, release = threading.Event(), threading.Event()
        def blocked(messages):
            entered.set()
            release.wait(2)
            return '<Code>print(1)</Code>'
        self.model.complete = blocked
        task = self.service.create_task('owner-a', self.file['id'], '分析')
        self.assertTrue(entered.wait(1))
        self.service.close()
        self.assertEqual(self.service.get_task('owner-a', task['id'])['status'], 'interrupted')
        release.set()
        deadline = time.monotonic() + 2
        while self.service.active and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(self.service.get_task('owner-a', task['id'])['status'], 'interrupted')
        self.assertEqual(self.runner.calls, [])


if __name__ == '__main__':
    unittest.main()
