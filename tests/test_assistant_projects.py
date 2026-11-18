import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_assistant.asgi import create_router
from ai_assistant import project_files
from ai_assistant.project_files import validate_root
from ai_assistant.service import AssistantService, Config


class Upstream(io.BytesIO):
    headers = {'Content-Type': 'text/event-stream'}


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.root = self.directory / 'project'
        self.root.mkdir()
        self.file = self.root / 'notes.md'
        self.file.write_bytes(b'Original\r\n')
        (self.root / '.env').write_text('private', encoding='utf-8')
        self.token = 'a' * 64
        app = FastAPI()
        app.state.session_mode = 'shared'
        self.service = app.state.assistant_service = AssistantService(
            self.directory / 'assistant.sqlite3', Config('http://127.0.0.1/v1', 'test', 'fake'))
        with patch.dict(os.environ, RESPIRATORY_VIEWER_PROJECT_TOKEN=self.token):
            with patch('ai_assistant.project_access.sys.platform', 'win32'):
                app.include_router(create_router())
        self.origin = 'http://127.0.0.1:9876'
        cookie = hmac.new(self.token.encode(), b'vvman-project-browser-session', hashlib.sha256).hexdigest()
        self.client = TestClient(app, base_url=self.origin, client=('127.0.0.1', 30000))
        self.addCleanup(self.client.close)
        self.native = {'x-data-agent-native': self.token}
        self.headers = {'origin': self.origin, 'cookie': 'respiratory_desktop=' + cookie}
        self.prefix = '/api/assistant'

    def create_project(self):
        grant = self.client.post(self.prefix + '/project-folder-grants',
                                 json={'path': str(self.root)}, headers=self.native)
        self.assertEqual(grant.status_code, 200, grant.text)
        fields = dict(grant.json(), name='Sample')
        response = self.client.post(self.prefix + '/workspaces', json=fields, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.text)
        reused = self.client.post(self.prefix + '/workspaces', json=fields, headers=self.headers)
        self.assertEqual(reused.status_code, 403)
        return response.json()['workspace']

    def conversation(self, project):
        cid = self.service.create(workspace=project['id'])['id']
        return self.prefix + '/conversations/' + cid

    def grant(self, directory):
        response = self.client.post(self.prefix + '/project-folder-grants',
                                    json={'path': str(directory)}, headers=self.native)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def send(self, path, name, fields, content='Project question', *, desktop=True):
        call = {'id': 'test-call', 'index': 0, 'function': {'name': name, 'arguments': json.dumps(fields)}}
        tool = json.dumps({'choices': [{'delta': {'tool_calls': [call]}}]})
        streams = [Upstream(f'data: {tool}\n\ndata: [DONE]\n\n'.encode()),
                   Upstream(b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')]
        with patch('ai_assistant.service.urlopen', side_effect=streams) as upstream:
            result = self.client.post(path + '/messages', headers=self.headers if desktop else {}, json={'content': content})
        self.assertEqual(result.status_code, 200, result.text)
        packets = {}
        for block in result.text.strip().split('\n\n'):
            event, data = block.split('\n', 1)
            packets[event.removeprefix('event: ')] = json.loads(data.removeprefix('data: '))
        model = json.loads(upstream.call_args_list[0].args[0].data)
        reply = json.loads(upstream.call_args_list[1].args[0].data)
        return packets, model, reply['messages'][-1]['content']

    def test_native_folder_selection_and_sidebar_lifecycle(self):
        blocked = self.client.post(self.prefix + '/project-folder-grants',
                                   json={'path': str(self.root)}, headers=self.headers)
        self.assertEqual(blocked.status_code, 403)
        project = self.create_project()
        path = self.prefix + '/workspaces/' + project['id']
        self.assertEqual(project['root_path'], str(self.root))
        self.assertIsNone(self.client.get(self.prefix + '/workspaces').json()['workspaces'][1]['root_path'])
        session = self.conversation(project)
        pinned = self.client.patch(path, headers=self.headers, json={'name': 'Renamed', 'pinned': True}).json()['workspace']
        self.assertEqual((pinned['name'], pinned['pinned']), ('Renamed', True))
        archived = self.client.patch(path, headers=self.headers, json={'archived': True}).json()['workspace']
        self.assertEqual((archived['archived'], archived['pinned']), (True, False))
        self.assertEqual(self.client.delete(path, headers=self.headers).status_code, 200)
        history = self.client.get(self.prefix + '/conversations').json()['conversations']
        self.assertEqual([item['id'] for item in history], [session.rsplit('/', 1)[1]])

    def test_scoped_reads_and_explicit_write(self):
        project = self.create_project()
        path = self.conversation(project)
        tool = 'propose_project_file_edit'
        edit = {'path': 'notes.md', 'new_content': 'After\r\n'}
        _, model, reply = self.send(path, 'list_project_files', {})
        names = {spec['function']['name'] for spec in model['tools']}
        self.assertTrue({'list_project_files', 'read_project_file'} <= names)
        self.assertIn(tool, names)
        self.assertIn('propose_project_file_create', names)
        self.assertNotIn('run_powershell', names)
        self.assertIn('notes.md', reply)
        self.assertNotIn('.env', reply)
        self.assertIn('批准并成功应用后再报告文件已修改', model['messages'][0]['content'])
        for denied in ('../outside.md', '.env', 'notes.md:stream', 'C:\\outside.md'):
            with self.subTest(denied=denied):
                packets, _, _ = self.send(path, 'read_project_file', {'path': denied})
                self.assertFalse(packets['tool_result']['ok'])
        packets, _, _ = self.send(path, tool, edit)
        proposal = packets['file_proposal']['proposal']
        self.assertEqual(proposal['old_content'], 'Original\r\n')
        self.assertEqual(self.file.read_bytes(), b'Original\r\n')
        route = path + '/file-proposals/' + proposal['id'] + '/approve'
        self.assertEqual(self.client.post(route, json={}).status_code, 403)
        approval = self.client.post(route, json={}, headers=self.headers)
        self.assertEqual(approval.status_code, 200, approval.text)
        self.assertEqual(self.file.read_bytes(), b'After\r\n')
        self.assertEqual(approval.json()['proposal']['status'], 'applied')
        self.assertEqual(self.client.post(route, json={}, headers=self.headers).status_code, 200)
        self.assertEqual(self.service.permission(path.rsplit('/', 1)[1]), 'read_only')

    def test_desktop_workspace_file_listing_is_read_only_and_bounds_paths(self):
        path = self.conversation(self.create_project()) + '/workspace-files'
        docs = self.root / 'docs'
        docs.mkdir()
        (docs / 'guide.md').write_text('Guide', encoding='utf-8')
        (docs / 'raw.bin').write_bytes(b'raw')
        self.assertEqual(self.client.get(path).status_code, 403)
        listed = self.client.get(path, headers=self.headers)
        self.assertEqual(listed.headers['cache-control'], 'no-store')
        self.assertEqual(listed.json(), {
            'entries': [{'name': 'docs', 'path': 'docs', 'kind': 'folder'},
                        {'name': 'notes.md', 'path': 'notes.md', 'kind': 'file'}],
            'folders': [{'source': 'source_1', 'label': 'project'}],
            'folder': '', 'source': 'source_1', 'truncated': False,
        })
        nested = self.client.get(path, headers=self.headers, params={'folder': 'docs'}).json()
        self.assertEqual(nested['entries'], [{'name': 'guide.md', 'path': 'docs/guide.md', 'kind': 'file'}])
        preview = self.client.get(path, headers=self.headers, params={'file': 'docs/guide.md'}).json()
        self.assertEqual(preview['file'], {'name': 'guide.md', 'path': 'docs/guide.md', 'content': 'Guide'})
        self.assertEqual(self.client.get(path, headers=self.headers, params={'file': '../notes.md'}).status_code, 403)
        self.assertEqual(self.client.get(path, headers=self.headers, params={'file': '.env'}).status_code, 403)
        self.assertEqual(self.client.get(path, headers=self.headers, params={'file': 'docs/raw.bin'}).status_code, 400)
        self.assertEqual(self.client.get(path, headers=self.headers, params={'source': 'source_8'}).status_code, 409)
        self.assertEqual(self.client.get(path, headers=self.headers, params={'folder': '', 'file': 'notes.md'}).status_code, 400)
        self.assertEqual(self.client.get(path + '?folder=&folder=docs', headers=self.headers).status_code, 400)
        self.assertIn(self.client.post(path, headers=self.headers, json={}).status_code, (404, 405))

    def test_create_proposals_review_new_files_and_preserve_conflicting_disk_contents(self):
        project = self.create_project()
        path = self.conversation(project)
        cid = path.rsplit('/', 1)[-1]
        self.service.set_permission(cid, 'workspace_write')
        directory = self.root / 'docs'
        directory.mkdir()
        target = directory / 'new.md'
        tool = 'propose_project_file_create'
        fields = {'path': 'docs/new.md', 'new_content': '新文件\r\n'}
        packets, model, _ = self.send(path, tool, fields)
        self.assertIn(tool, {spec['function']['name'] for spec in model['tools']})
        proposal = packets['file_proposal']['proposal']
        self.assertEqual((proposal['operation'], proposal['old_content']), ('create', ''))
        self.assertFalse(target.exists())
        approve = path + '/file-proposals/' + proposal['id'] + '/approve'
        open_target = path + '/file-proposals/' + proposal['id'] + '/open-target'
        self.assertEqual(self.client.post(open_target, json={}, headers=self.native).status_code, 409)
        denied = self.client.post(approve, json={})
        self.assertEqual(denied.status_code, 403)
        target.write_bytes(b'Existing')
        conflict = self.client.post(approve, json={}, headers=self.headers)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['error']['code'], 'file_exists')
        self.assertEqual(target.read_bytes(), b'Existing')
        self.assertEqual(self.service.file_proposals(cid)[0]['status'], 'pending')
        self.service.decide_file_proposal(cid, proposal['id'], 'reject')
        for blocked_path in ('docs/new.md', '.env', '../escape.md', 'missing/new.md', 'docs/photo.png'):
            packets, _, _ = self.send(path, tool, {**fields, 'path': blocked_path})
            self.assertFalse(packets['tool_result']['ok'], blocked_path)
        target.unlink()
        agent = '12345678-1234-1234-1234-123456789012'
        self.service.set_permission(cid, 'read_only')
        turn = self.service.begin_external_turn(cid, 'Create sample', agent, 'Codex')
        prepared = self.service.prepare_external_turn(cid, turn['turn_id'], agent)
        self.assertEqual(prepared['permission_mode'], 'read_only')
        self.assertTrue(prepared['project']['supports_create'])
        native = path + '/external-turns/' + turn['turn_id'] + '/project-file'
        result = self.client.post(native, headers=self.native, json={
            'source': 'source_1', 'action': 'propose_create', 'agent_id': agent,
            'path': 'docs/new.md', 'content': fields['new_content'],
        })
        self.assertEqual(result.status_code, 200, result.text)
        proposal = result.json()['proposal']
        self.assertFalse(target.exists())
        self.assertEqual(proposal['operation'], 'create')
        applied = self.service.decide_file_proposal(cid, proposal['id'], 'approve')
        self.assertEqual(applied['status'], 'applied')
        self.assertEqual(target.read_bytes(), fields['new_content'].encode())
        self.assertEqual(self.service.decide_file_proposal(cid, proposal['id'], 'approve'), applied)
        open_target = path + '/file-proposals/' + proposal['id'] + '/open-target'
        self.assertEqual(self.client.post(open_target, json={}, headers=self.headers).status_code, 403)
        opened = self.client.post(open_target, json={}, headers=self.native)
        self.assertEqual(opened.json(), {'root_path': str(self.root), 'relative_path': 'docs/new.md'})
        self.assertEqual(opened.headers['cache-control'], 'no-store')
        forged = self.client.post(open_target, json={'path': 'notes.md'}, headers=self.native)
        self.assertEqual(forged.status_code, 400)
        target.unlink()
        missing = self.client.post(open_target, json={}, headers=self.native)
        self.assertEqual(missing.status_code, 409)

    def test_builtin_project_tool_waits_for_native_job_and_rechecks_target(self):
        project = self.create_project()
        path = self.conversation(project)
        cid = path.rsplit('/', 1)[1]
        tool = 'run_project_tests'
        self.service.set_permission(cid, 'workspace_write')
        call = {'id': 'run-test', 'index': 0, 'function': {'name': tool, 'arguments': '{"preset_id":"test_runner"}'}}
        packet = json.dumps({'choices': [{'delta': {'tool_calls': [call]}}]})
        streams = [Upstream(f'data: {packet}\n\ndata: [DONE]\n\n'.encode()),
                   Upstream(b'data: {"choices":[{"delta":{"content":"Report complete"}}]}\n\ndata: [DONE]\n\n')]
        with patch('ai_assistant.service.urlopen', side_effect=streams) as upstream:
            stream = self.service.stream(cid, *self.service.begin(
                cid, 'Verify', tool_context={'project_desktop': True}))
            self.assertEqual(next(stream)[0], 'start')
            self.assertEqual(next(stream)[0], 'tool_call')
            event, job = next(stream)
            self.assertEqual((event, job['name']), ('project_development', tool))
            model = json.loads(upstream.call_args.args[0].data)
            self.assertIn(tool, {item['function']['name'] for item in model['tools']})
            route = f"{path}/development-jobs/{job['id']}"

            def action(suffix, fields, headers=self.native):
                return self.client.post(route + '/' + suffix, json=fields, headers=headers)

            self.assertEqual(action('claim', {}, headers=self.headers).status_code, 403)
            self.assertEqual(action('target', {'source': 'source_1'}).status_code, 409)
            looked_up = action('claim', {})
            self.assertEqual(looked_up.json(), dict(name=tool, workspace_id=project['id'],
                                                  arguments={'preset_id': 'test_runner'}))
            self.assertEqual(action('claim', {}).status_code, 409)
            self.service.set_permission(cid, 'read_only')
            self.assertEqual(action('target', {'source': 'source_1'}).status_code, 403)
            self.service.set_permission(cid, 'workspace_write')
            result = {'result': dict(content=[dict(type='text', text='Fixture test passed')], isError=False)}
            self.assertEqual(action('complete', result).status_code, 409)
            target = action('target', {'source': 'source_1'})
            self.assertEqual(target.json()['root_path'], str(self.root))
            self.assertEqual(action('complete', result).json(), {'ok': True})
            self.assertEqual(action('complete', result).status_code, 409)
            self.assertEqual(list(stream)[-1][0], 'done')
            followup = json.loads(upstream.call_args.args[0].data)
            self.assertEqual(followup['messages'][-1]['content'], 'Fixture test passed')
            self.assertEqual(action('target', {'source': 'source_1'}).status_code, 409)

    def test_powershell_requires_explicit_desktop_full_and_live_project_authorization(self):
        path = self.conversation(self.create_project())
        cid = path.rsplit('/', 1)[1]
        command = "Write-Output 'fixture'"
        tool = 'run_powershell'
        with self.service.db() as db:
            db.execute("UPDATE conversations SET permission_mode='full' WHERE id=?", (cid,))
        self.assertEqual(self.service.get(cid)['conversation']['permission_mode'], 'workspace_write')
        self.assertEqual(self.client.post(path + '/permission', json={'mode': 'full'}).status_code, 403)
        _, reduced, _ = self.send(path, 'list_project_files', {})
        self.assertNotIn(tool, {spec['function']['name'] for spec in reduced['tools']})
        self.assertEqual(self.client.post(path + '/permission', headers=self.headers,
                                          json={'mode': 'full'}).json()['permission_mode'], 'full')
        self.assertEqual(self.client.post(path + '/development-target', headers=self.native,
                                          json={'name': tool}).status_code, 403)

        agent = '12345678-1234-1234-1234-123456789012'
        turn = self.service.begin_external_turn(cid, 'PowerShell fixture', agent, 'Codex')
        turn_path = f"{path}/external-turns/{turn['turn_id']}"
        prepared = self.client.post(turn_path + '/prepare', headers=self.native, json={'agent_id': agent}).json()
        shell = next(item for item in prepared['tools'] if item['name'] == tool)
        self.assertNotIn('requires_confirmation', shell)
        location = {'agent_id': agent, 'name': tool}
        self.assertEqual(self.client.post(turn_path + '/project-root', headers=self.headers, json=location).status_code, 403)
        accepted = self.client.post(turn_path + '/project-root', headers=self.native, json=location)
        self.assertEqual(accepted.json()['root_path'], str(self.root))
        self.service.set_permission(cid, 'workspace_write')
        self.assertEqual(self.client.post(turn_path + '/project-root', headers=self.native, json=location).status_code, 403)
        self.service.finish_external_turn(cid, turn['turn_id'], '', 'cancelled')
        self.service.set_permission(cid, 'full')

        call = {'id': 'ps-fixture', 'index': 0, 'function': {'name': tool, 'arguments': json.dumps({'command': command})}}
        packet = json.dumps({'choices': [{'delta': {'tool_calls': [call]}}]})
        streams = [Upstream(f'data: {packet}\n\ndata: [DONE]\n\n'.encode()),
                   Upstream(b'data: {"choices":[{"delta":{"content":"complete"}}]}\n\ndata: [DONE]\n\n')]
        with patch('ai_assistant.service.urlopen', side_effect=streams):
            stream = self.service.stream(cid, *self.service.begin(cid, 'Run fixture', tool_context={'project_desktop': True}))
            self.assertEqual(next(stream)[0], 'start')
            self.assertEqual(next(stream)[0], 'tool_call')
            event, job = next(stream)
            self.assertEqual((event, job['name']), ('project_development', tool))
            job_route = f"{path}/development-jobs/{job['id']}"
            claim = self.client.post(job_route + '/claim', headers=self.native, json={})
            self.assertEqual(claim.json()['arguments'], {'command': command})
            wrong = self.client.post(job_route + '/target', headers=self.native, json={'source': 'source_2'})
            self.assertEqual(wrong.status_code, 400)
            allowed = self.client.post(job_route + '/target', headers=self.native, json={})
            self.assertEqual(allowed.json()['root_path'], str(self.root))
            self.service.set_permission(cid, 'workspace_write')
            self.assertEqual(self.client.post(job_route + '/target', headers=self.native, json={}).status_code, 403)
            self.service.set_permission(cid, 'full')
            complete = {'result': {'content': [{'type': 'text', 'text': 'fixture'}], 'isError': False}}
            self.assertEqual(self.client.post(job_route + '/complete', headers=self.native, json=complete).status_code, 200)
            self.assertEqual(list(stream)[-1][0], 'done')

    @unittest.skipUnless(shutil.which('git'), 'Git is required for linked worktree integration')
    def test_chat_worktree_binding_isolated_tools_native_targets_and_history(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.root), *args],
                                           stderr=subprocess.STDOUT).decode().strip()

        git('init')
        git('add', 'notes.md')
        git('-c', 'user.name=Worktree Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Initial')
        commit = git('rev-parse', 'HEAD')
        project = self.create_project()
        self.service.update_workspace(project['id'], {'source_folders': [
            {'root_path': str(self.root)}, {'root_path': str(self.directory)},
        ]}, authorize=lambda entries: [validate_root(path) for path, _ in entries])
        path = self.conversation(project)
        cid = path.rsplit('/', 1)[1]
        sibling = self.conversation(project)
        self.service.set_permission(cid, 'workspace_write')
        setup = path + '/worktree-target'
        source = {'source': 'source_1'}
        self.assertEqual(self.client.post(setup, headers=self.headers, json=source).status_code, 403)
        _, _, cancel = self.service.begin(cid, 'Existing turn')
        self.assertEqual(self.client.post(setup, headers=self.native, json=source).status_code, 409)
        self.service.cancel(cid)
        self.assertTrue(cancel.is_set())
        packets, _, _ = self.send(path, 'propose_project_file_edit', {'path': 'notes.md', 'new_content': 'Original proposal'})
        proposal = packets['file_proposal']['proposal']
        blocked = self.client.post(setup, headers=self.native, json=source)
        self.assertEqual(blocked.json()['error']['code'], 'pending_file_proposals')
        self.assertEqual(self.service.file_proposals(cid)[0]['status'], 'pending')
        self.service.decide_file_proposal(cid, proposal['id'], 'reject')

        setup_response = self.client.post(setup, headers=self.native, json=source)
        self.assertEqual(setup_response.status_code, 200, setup_response.text)
        base = setup_response.json()
        root = Path(base['worktrees_path']) / (cid + '-1234567890abcdef')
        root.parent.mkdir()
        branch = 'vvman/' + root.name
        git('worktree', 'add', '-b', branch, str(root))
        fields = dict(source, root_path=str(root), branch=branch, commit=commit, base_root_key=base['root_key'])
        self.assertEqual(self.client.post(path + '/worktree', headers=self.headers, json=fields).status_code, 403)
        false_commit = self.client.post(path + '/worktree', headers=self.native, json=dict(fields, commit='0' * 40))
        self.assertEqual(false_commit.status_code, 409)
        response = self.client.post(path + '/worktree', headers=self.native, json=fields)
        self.assertEqual(response.status_code, 200, response.text)
        info = response.json()['worktree']
        self.assertEqual((info['branch'], info['commit'], info['source']), (branch, commit, 'source_1'))
        self.assertNotIn(str(root), json.dumps(self.service.get(cid)['conversation']))
        self.assertEqual(self.service.get(cid)['conversation']['worktree'], info)
        reopened = AssistantService(self.service.path, self.service.config)
        self.assertEqual(reopened.get(cid)['conversation']['worktree'], info)
        self.assertEqual(self.client.post(path + '/worktree-location', headers=self.native, json={}).json(),
                         {'root_path': str(root)})

        (root / 'notes.md').write_text('Worktree marker', encoding='utf-8')
        files = self.client.get(path + '/workspace-files', headers=self.headers, params={'file': 'notes.md'}).json()
        self.assertEqual(files['file']['content'], 'Worktree marker')
        base_files = self.client.get(sibling + '/workspace-files', headers=self.headers, params={'file': 'notes.md'}).json()
        self.assertEqual(base_files['file']['content'], 'Original\r\n')
        self.assertEqual(self.client.get(path + '/workspace-files', headers=self.headers,
                                         params={'source': 'source_2'}).status_code, 409)
        _, _, text = self.send(path, 'search_project_files', {'query': 'Worktree marker', 'mode': 'content'})
        self.assertEqual(json.loads(text)['matches'][0]['path'], 'notes.md')
        _, _, text = self.send(sibling, 'read_project_file', {'path': 'notes.md'})
        self.assertEqual(json.loads(text)['content'], 'Original\r\n')
        self.assertFalse(self.send(path, 'read_project_file', {'path': 'notes.md', 'source': 'source_2'})[0]['tool_result']['ok'])
        packets, _, _ = self.send(path, 'propose_project_file_edit', {'path': 'notes.md', 'new_content': 'Changed worktree'})
        patch_id = packets['file_proposal']['proposal']['id']
        self.service.update_workspace(project['id'], {'source_folders': [
            {'root_path': str(self.directory)}, {'root_path': str(self.root)},
        ]})
        self.assertEqual(self.service.decide_file_proposal(cid, patch_id, 'approve')['status'], 'applied')
        self.assertEqual((root / 'notes.md').read_text(encoding='utf-8'), 'Changed worktree')
        self.assertEqual(self.file.read_bytes(), b'Original\r\n')
        target = self.client.post(path + '/development-target', headers=self.native,
                                  json={'name': 'run_project_tests', 'root_key': base['root_key']})
        self.assertEqual(target.status_code, 200, target.text)
        self.assertEqual((target.json()['root_path'], target.json()['base_root_path']), (str(root), str(self.root)))
        self.assertNotEqual(target.json()['root_key'], base['root_key'])

        agent = '21922344-de22-4c5f-87f5-8b58633c37a9'
        external = self.service.begin_external_turn(cid, 'Check worktree', agent, 'Fixture')
        turn = f"{path}/external-turns/{external['turn_id']}"
        prepare = self.client.post(turn + '/prepare', headers=self.native, json={'agent_id': agent}).json()
        self.assertEqual(prepare['project_sources'], [{'source': 'source_1', 'root_key': base['root_key']}])
        target = self.client.post(turn + '/project-root', headers=self.native,
                                  json={'agent_id': agent, 'name': 'project_git_diff'})
        self.assertEqual(target.json()['root_path'], str(root))
        self.service.cancel(cid)
        self.service.update_workspace(project['id'], {'source_folders': [{'root_path': str(self.directory)}]})
        self.assertEqual(self.client.post(path + '/worktree-location', headers=self.native, json={}).status_code, 409)
        self.assertEqual(self.service.get(cid)['conversation']['worktree'], info)
        self.assertTrue(root.is_dir())

    def test_builtin_runner_lookup_with_read_only_mode(self):
        project = self.create_project()
        path = self.conversation(project)
        cid = path.rsplit('/', 1)[1]
        tool = 'list_project_test_runners'
        call = {'id': 'list-test', 'index': 0, 'function': {'name': tool, 'arguments': '{}'}}
        packet = json.dumps({'choices': [{'delta': {'tool_calls': [call]}}]})
        response = Upstream(f'data: {packet}\n\ndata: [DONE]\n\n'.encode())
        with patch('ai_assistant.service.urlopen', return_value=response) as upstream:
            stream = self.service.stream(cid, *self.service.begin(
                cid, 'Show my tests', tool_context={'project_desktop': True}))
            self.assertEqual(next(stream)[0], 'start')
            self.assertEqual(next(stream)[0], 'tool_call')
            event, job = next(stream)
            self.assertEqual((event, job['name']), ('project_development', tool))
            model = json.loads(upstream.call_args.args[0].data)
            names = {item['function']['name'] for item in model['tools']}
            self.assertTrue({tool, 'project_git_diff'} <= names)
            self.assertNotIn('run_project_tests', names)
            route = f"{path}/development-jobs/{job['id']}"
            claim = self.client.post(route + '/claim', headers=self.native, json={})
            self.assertEqual(claim.status_code, 200, claim.text)
            root_key = self.service._root_key(validate_root(str(self.root)))
            target = self.client.post(route + '/target', headers=self.native, json={'root_key': root_key})
            self.assertEqual(target.json()['root_path'], str(self.root))
            self.assertEqual(self.client.post(route + '/target', headers=self.native,
                                              json={'root_key': '0' * 64}).status_code, 409)
            self.service.cancel(cid)
            self.assertEqual(self.client.post(route + '/target', headers=self.native,
                                              json={'root_key': root_key}).status_code, 409)
            stream.close()

    def test_builtin_diff_claim_can_narrow_to_an_authorized_relative_path(self):
        project = self.create_project()
        path = self.conversation(project)
        cid = path.rsplit('/', 1)[1]
        tool = 'project_git_diff'
        for relative, valid in (('src/test.py', True), ('../outside.py', False), ('C:\\outside.py', False)):
            fields = {'source': 'source_1', 'path': relative}
            call = dict(id='diff', index=0, function=dict(name=tool, arguments=json.dumps(fields)))
            packet = json.dumps({'choices': [{'delta': {'tool_calls': [call]}}]})
            response = Upstream(f'data: {packet}\n\ndata: [DONE]\n\n'.encode())
            with self.subTest(relative=relative), patch('ai_assistant.service.urlopen', return_value=response):
                stream = self.service.stream(cid, *self.service.begin(
                    cid, 'Check Git changes', tool_context={'project_desktop': True}))
                self.assertEqual(next(stream)[0], 'start')
                self.assertEqual(next(stream)[0], 'tool_call')
                event, details = next(stream)
                if valid:
                    self.assertEqual(event, 'project_development')
                    route = f"{path}/development-jobs/{details['id']}/claim"
                    self.assertEqual(self.client.post(route, headers=self.native, json={}).json()['arguments'], fields)
                else:
                    self.assertEqual(event, 'tool_result')
                    self.assertFalse(details['ok'])
                stream.close()

    def test_project_search_respects_desktop_policy_and_returns_literal_hits(self):
        nested = self.root / 'src'
        nested.mkdir()
        runtime = nested / 'Runtime.cjs'
        runtime.write_text('x' * 49000 + '\n' + 'y' * 400 + '中文 Ab[Cd]' + 'z' * 400, encoding='utf-8')
        (nested / 'runtime.png').write_bytes(b'\x00Ab[Cd]')
        (nested / 'runtime-secret.toml').write_text('Ab[Cd]', encoding='utf-8')
        (nested / 'runtime.min.js').write_text('Ab[Cd]', encoding='utf-8')
        (nested / 'runtime-binary.js').write_bytes(b'\x01Ab[Cd]')
        (nested / 'runtime-generated.js').write_text('/* @generated */ Ab[Cd]', encoding='utf-8')
        (self.root / 'node_modules').mkdir()
        (self.root / 'node_modules' / 'runtime.js').write_text('Ab[Cd]', encoding='utf-8')
        outside = self.directory / 'outside.cjs'
        outside.write_text('Ab[Cd]', encoding='utf-8')
        try:
            os.link(outside, nested / 'runtime-linked.cjs')
        except PermissionError:
            # Some Windows test environments prohibit creating hard links.
            (nested / 'runtime-linked.cjs').write_text('Ab[Cd]', encoding='utf-8')
        real_lstat = Path.lstat

        def linked_lstat(path):
            info = real_lstat(path)
            if path.name == 'runtime-linked.cjs' and info.st_nlink == 1:
                fields = list(info)
                fields[3] = 2
                return os.stat_result(fields)
            return info

        self.enterContext(patch.object(Path, 'lstat', linked_lstat))
        project = self.create_project()
        chat = self.conversation(project)
        name = 'search_project_files'
        packets, model, reply = self.send(chat, name, {'query': 'RUNTIME'})
        self.assertTrue(packets['tool_result']['ok'])
        self.assertIn(name, {spec['function']['name'] for spec in model['tools']})
        paths = {item['path'] for item in json.loads(reply)['matches']}
        self.assertTrue({'src/Runtime.cjs', 'src/runtime.png'} <= paths)
        self.assertFalse(paths & {'src/runtime-secret.toml', 'node_modules/runtime.js', 'src/runtime-linked.cjs'})
        fields = {'query': 'ab[cd]', 'mode': 'content', 'path': 'src'}
        packets, _, reply = self.send(chat, name, fields)
        self.assertTrue(packets['tool_result']['ok'])
        result = json.loads(reply)
        self.assertEqual((result['mode'], result['truncated']), ('content', False))
        hit, = result['matches']
        self.assertEqual((hit['source'], hit['path'], hit['line']), ('source_1', 'src/Runtime.cjs', 2))
        self.assertIn('中文 Ab[Cd]', hit['snippet'])
        self.assertLessEqual(len(hit['snippet']), project_files.SNIPPET_LENGTH + 2)
        self.assertFalse(self.send(chat, name, {**fields, 'path': '../'})[0]['tool_result']['ok'])
        packets, model, _ = self.send(chat, name, fields, desktop=False)
        self.assertFalse(packets['tool_result']['ok'])
        self.assertNotIn(name, {spec['function']['name'] for spec in model['tools']})

    def test_search_checks_cancellation_revocation_and_limits(self):
        for index in range(3):
            (self.root / f'match{index}.py').write_text('match', encoding='utf-8')
        roots = {'source_1': validate_root(str(self.root))}
        with patch.object(project_files, 'MAX_SEARCH_MATCHES', 1):
            result = project_files.search_files(roots, 'match', 'content', None, lambda: False)
        self.assertEqual(len(result['matches']), 1)
        self.assertTrue(result['truncated'])
        stopped = project_files.search_files(roots, 'match', 'name', None, lambda: True)
        self.assertEqual(stopped, {'mode': 'name', 'matches': [], 'truncated': True})
        project = self.create_project()
        chat = self.conversation(project)
        original = project_files.search_files

        def changed(*args):
            result = original(*args)
            self.service.update_workspace(project['id'], {'root_path': None})
            return result

        with patch.object(project_files, 'search_files', side_effect=changed):
            packets, _, reply = self.send(chat, 'search_project_files', {'query': 'match'})
        self.assertFalse(packets['tool_result']['ok'])
        self.assertNotIn('match0.py', reply)

    def test_stale_approval_preserves_external_changes(self):
        project = self.create_project()
        path = self.conversation(project)
        self.service.set_permission(path.rsplit('/', 1)[1], 'full')
        packets, _, _ = self.send(path, 'propose_project_file_edit', {'path': 'notes.md', 'new_content': 'New'})
        proposal = packets['file_proposal']['proposal']
        self.file.write_text('external update', encoding='utf-8')
        route = path + '/file-proposals/' + proposal['id']
        denied = self.client.post(route + '/approve', json={}, headers=self.headers)
        self.assertEqual(denied.status_code, 409, denied.text)
        self.assertEqual(denied.json()['error']['code'], 'file_changed')
        self.assertEqual(self.file.read_text(encoding='utf-8'), 'external update')
        self.assertEqual(self.client.post(route + '/reject', json={}, headers=self.headers).json()['proposal']['status'],
                         'rejected')

    def test_multiple_sources_require_grants_and_preserve_approval_on_reorder(self):
        project = self.create_project()
        route = self.prefix + '/workspaces/' + project['id']
        second = self.directory / 'other' / 'project'
        second.mkdir(parents=True)
        other_file = second / 'notes.md'
        other_file.write_text('second old', encoding='utf-8')
        first_item = {'root_path': str(self.root)}
        second_item = self.grant(second)
        third = self.directory / 'third'
        third.mkdir()
        third_item = {'root_path': str(third), 'folder_grant': 'bad'}
        additions = {'source_folders': [first_item, second_item, third_item]}
        self.assertEqual(self.client.patch(route, headers=self.headers, json=additions).status_code, 403)
        update = self.client.patch(route, headers=self.headers, json={'source_folders': [first_item, second_item]})
        self.assertEqual(update.status_code, 200, update.text)
        workspace = update.json()['workspace']
        self.assertEqual(workspace['source_folders'], [str(self.root), str(second)])
        self.assertEqual(workspace['root_path'], str(self.root))
        redacted = self.client.get(self.prefix + '/workspaces').json()['workspaces'][1]
        self.assertEqual(redacted['source_folders'], [])
        session = self.conversation(project)
        _, _, reply = self.send(session, 'list_project_files', {})
        self.assertEqual([item['source'] for item in json.loads(reply)['sources']], ['source_1', 'source_2'])
        _, _, reply = self.send(session, 'read_project_file', {'path': 'notes.md'})
        self.assertEqual(json.loads(reply)['content'], 'Original\r\n')
        _, _, reply = self.send(session, 'read_project_file', {'path': 'notes.md', 'source': 'source_2'})
        self.assertEqual(json.loads(reply)['content'], 'second old')
        self.service.set_permission(session.rsplit('/', 1)[1], 'full')
        packet, _, _ = self.send(session, 'propose_project_file_edit', dict(path='notes.md', source='source_2', new_content='approved'))
        proposal = packet['file_proposal']['proposal']
        self.assertEqual(proposal['source_folder'], str(second))
        reordered = self.client.patch(route, headers=self.headers, json={'source_folders': [{'root_path': str(second)}, first_item]})
        self.assertEqual(reordered.json()['workspace']['root_path'], str(second))
        decision = session + '/file-proposals/' + proposal['id'] + '/approve'
        self.assertEqual(self.client.post(decision, headers=self.headers, json={}).status_code, 200)
        self.assertEqual(other_file.read_text(encoding='utf-8'), 'approved')
        self.assertEqual(self.file.read_bytes(), b'Original\r\n')

        packet, _, _ = self.send(session, 'propose_project_file_edit', dict(path='notes.md', new_content='cannot apply'))
        proposal = packet['file_proposal']['proposal']
        removed = self.client.patch(route, headers=self.headers, json={'source_folders': [first_item]})
        self.assertEqual(removed.status_code, 200, removed.text)
        decision = session + '/file-proposals/' + proposal['id'] + '/approve'
        self.assertEqual(self.client.post(decision, headers=self.headers, json={}).status_code, 409)
        self.assertEqual(other_file.read_text(encoding='utf-8'), 'approved')

    def test_project_instructions_and_optional_same_project_memory(self):
        project = self.create_project()
        route = self.prefix + '/workspaces/' + project['id']
        history_session = self.conversation(project)
        self.send(history_session, 'list_project_files', {}, content='distinct same workspace text')
        unrelated = self.service.create_workspace('Unrelated')
        unrelated_session = self.conversation(unrelated)
        self.send(unrelated_session, 'list_project_files', {}, content='distinct other workspace text')
        session = self.conversation(project)
        updated = self.client.patch(route, headers=self.headers, json={'instructions': 'local project directions'})
        self.assertEqual(updated.status_code, 200, updated.text)
        _, model, _ = self.send(session, 'list_project_files', {})
        text = json.dumps(model, ensure_ascii=False)
        self.assertIn('local project directions', text)
        self.assertIn('本轮开始时的本机时间为', text)
        self.assertNotIn('distinct same workspace text', text)

        enabled = self.client.patch(route, headers=self.headers, json={'memory_mode': 'project'})
        self.assertEqual(enabled.json()['workspace']['memory_mode'], 'project')
        _, model, _ = self.send(session, 'list_project_files', {})
        text = json.dumps(model, ensure_ascii=False)
        self.assertIn('distinct same workspace text', text)
        self.assertNotIn('distinct other workspace text', text)
        _, model, _ = self.send(session, 'list_project_files', {}, desktop=False)
        text = json.dumps(model, ensure_ascii=False)
        self.assertNotIn('distinct same workspace text', text)
        self.assertIn('服务所在机器的时间（用户时区未知）', text)
        self.assertNotIn('list_project_files', {spec['function']['name'] for spec in model['tools']})
        self.assertEqual(self.client.patch(route, headers=self.headers, json={'instructions': 'x' * 6001}).status_code, 400)

    def test_legacy_root_is_migrated_with_existing_conversation(self):
        wid = 'ws_legacy'
        path, identity = validate_root(str(self.root))
        with self.service.db() as db:
            db.execute('INSERT INTO workspaces(id,name,created_at,root_path,root_identity) VALUES(?,?,?,?,?)',
                       (wid, 'legacy', 1, path, identity))
        session = self.conversation({'id': wid})
        reopened = AssistantService(self.service.path, self.service.config)
        self.assertEqual(reopened.workspaces()[1]['source_folders'], [path])
        self.assertEqual(reopened.workspaces()[1]['memory_mode'], 'default')
        chat_id = session.rsplit('/', 1)[1]
        self.assertEqual(reopened.conversations(wid)[0]['id'], chat_id)
        _, _, roots = reopened._project_context(chat_id, include_private=True)
        self.assertEqual(roots, {'source_1': (path, identity)})


if __name__ == '__main__':
    unittest.main()
