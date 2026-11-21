"""The source dependency rejects incomplete, changed, or unexpected checkouts."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.prepare_dsh_source import inspect_source, prepare_source


class DshSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name)
        (self.source / '.git').write_text('gitdir: fixture')
        (self.source / 'package.json').write_text(json.dumps({'name': '@deepseek-ai/dsh-root', 'packageManager': 'pnpm@11.28.5'}))
        (self.source / 'pnpm-lock.yaml').write_text('lockfileVersion: 9\n')
        (self.source / 'LICENSE').write_text('MIT License\nCopyright (c) 2026 DeepSeek\n')
        for name in ['apps/desktop/src/main.ts', 'apps/desktop/scripts/package-target.ts', 'scripts/build.ts', 'pnpm-workspace.yaml']:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        for name in ['packages', 'native', 'vendor']:
            (self.source / name).mkdir()
        self.lock = {'commit': 'a' * 40, 'packageName': '@deepseek-ai/dsh-root',
                     'packageManager': 'pnpm@11.28.5', 'license': 'MIT',
                     'lockfileSha256': hashlib.sha256((self.source / 'pnpm-lock.yaml').read_bytes()).hexdigest()}

    def capture(self, source, *arguments):
        return {('rev-parse', '--show-toplevel'): str(self.source),
                ('rev-parse', 'HEAD'): self.lock['commit'],
                ('status', '--porcelain', '--untracked-files=no'): ''}[arguments]

    def test_complete_pinned_source_needs_no_original_archive(self):
        with patch('tools.prepare_dsh_source.git', side_effect=self.capture):
            self.assertFalse(inspect_source(self.source, self.lock)['originalAsarRequired'])

    def test_wrong_commit_and_modified_dependency_are_refused(self):
        for command, value in [(('rev-parse', 'HEAD'), 'b' * 40),
                               (('status', '--porcelain', '--untracked-files=no'), ' M package.json')]:
            def changed(source, *arguments):
                return value if arguments == command else self.capture(source, *arguments)
            with self.subTest(command=command), patch('tools.prepare_dsh_source.git', side_effect=changed):
                with self.assertRaises(RuntimeError):
                    inspect_source(self.source, self.lock)

    def test_lockfile_change_and_missing_license_are_refused(self):
        with patch('tools.prepare_dsh_source.git', side_effect=self.capture):
            (self.source / 'pnpm-lock.yaml').write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                inspect_source(self.source, self.lock)
            (self.source / 'pnpm-lock.yaml').write_text('lockfileVersion: 9\n')
            (self.source / 'LICENSE').write_text('different license')
            with self.assertRaisesRegex(RuntimeError, 'license'):
                inspect_source(self.source, self.lock)

    def test_nonempty_destination_is_preserved_without_git_commands(self):
        (self.source / '.git').unlink()
        with patch('tools.prepare_dsh_source.subprocess.run') as execute:
            with self.assertRaisesRegex(RuntimeError, 'nonempty'):
                prepare_source(self.source, self.lock)
            execute.assert_not_called()
        self.assertTrue((self.source / 'package.json').is_file())


if __name__ == '__main__':
    unittest.main()
