import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from server import cli
from server.paths import default_data_dir, prepare_default_data_dir


class DesktopPathsTests(unittest.TestCase):
    def test_frozen_mac_defaults_and_config_do_not_depend_on_bundle_location(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            folder = home / 'Library' / 'Application Support' / 'VVFLY' / 'RespiratoryViewer'
            folder.mkdir(parents=True)
            config = folder / '.env'
            config.write_text('AI_AGENT_DESKTOP_TEST=ignored\nAI_AGENT_DESKTOP_CONFIG=mac\n', encoding='utf-8')
            with (patch.object(sys, 'platform', 'darwin'), patch.object(sys, 'frozen', True, create=True),
                  patch('server.paths.Path.home', return_value=home),
                  patch.dict(os.environ, {'AI_AGENT_DESKTOP_TEST': 'existing'}, clear=True)):
                self.assertEqual(default_data_dir(), folder)
                self.assertEqual(cli.load_env(), config)
                self.assertEqual(os.environ['AI_AGENT_DESKTOP_TEST'], 'existing')
                self.assertEqual(os.environ['AI_AGENT_DESKTOP_CONFIG'], 'mac')

    def test_packaged_config_directory_override_and_windows_location(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config = home / '.env'
            config.write_text('AI_AGENT_DESKTOP_CONFIG=selected\n', encoding='utf-8')
            with patch.object(sys, 'frozen', True, create=True):
                with patch.object(sys, 'platform', 'darwin'), patch.dict(os.environ, {'AI_AGENT_DATA_DIR': directory}, clear=True):
                    self.assertEqual(default_data_dir(), home.resolve())
                    self.assertEqual(cli.load_env(), config.resolve())
                with (patch.object(sys, 'platform', 'win32'), patch.object(sys, 'executable', str(home / 'RespiratoryViewer.exe')),
                      patch.dict(os.environ, {'LOCALAPPDATA': directory}, clear=True)):
                    self.assertEqual(default_data_dir(), home / 'VVFLY' / 'Somnus')
                    self.assertEqual(cli.load_env(), config)

    def test_windows_installed_backend_reads_writable_data_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Path(directory) / 'Program Files' / 'RespiratoryViewer' / 'backend'
            data_dir = Path(directory) / 'Local AppData'
            data_dir.mkdir()
            config = data_dir / '.env'
            config.write_text('AI_AGENT_DESKTOP_CONFIG=installed\n', encoding='utf-8')
            with (patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'platform', 'win32'),
                  patch.object(sys, 'executable', str(install / 'RespiratoryViewer.exe')),
                  patch.dict(os.environ, {'AI_AGENT_DATA_DIR': str(data_dir)}, clear=True)):
                self.assertEqual(cli.load_env(), config.resolve())
                self.assertEqual(os.environ['AI_AGENT_DESKTOP_CONFIG'], 'installed')

    def test_windows_first_launch_copies_profile_and_uses_new_config(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            legacy = base / 'VVFLY' / 'RespiratoryViewer'
            legacy.mkdir(parents=True)
            config = legacy / '.env'
            config.write_text('DATA_AGENT_REMOTE_CA=gateway-cert.pem\n', encoding='utf-8')
            (legacy / 'gateway-cert.pem').write_bytes(b'public certificate')
            (legacy / 'mcp.json').write_bytes(b'{"servers":[]}')
            with sqlite3.connect(legacy / 'assistant.sqlite3') as db:
                db.execute('CREATE TABLE conversations (content)')
                db.execute('INSERT INTO conversations VALUES (?)', ('kept',))
                db.execute('CREATE TABLE default_plugins (name)')
                db.execute('INSERT INTO default_plugins VALUES (?)', ('handoff',))
            db.close()
            target = base / 'VVFLY' / 'Somnus'
            with (patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'platform', 'win32'),
                  patch.object(sys, 'executable', str(base / 'install' / 'SomnusBackend.exe')),
                  patch.dict(os.environ, {'LOCALAPPDATA': directory}, clear=True),
                  patch('server.cli._redirect_output_when_headless'),
                  patch('server.cli.pick_port', return_value=8765), patch('server.app.create_app') as create_app,
                  patch('uvicorn.run')):
                self.assertEqual(cli.main(['--no-browser']), 0)
                self.assertEqual(create_app.call_args.kwargs['data_dir'], target)
                self.assertEqual(Path(os.environ['DATA_AGENT_REMOTE_CA']), target / 'gateway-cert.pem')
                self.assertEqual(cli.load_env(), target / '.env')
                self.assertEqual((target / 'mcp.json').read_bytes(), (legacy / 'mcp.json').read_bytes())
                with sqlite3.connect(target / 'assistant.sqlite3') as copy:
                    self.assertEqual(copy.execute('SELECT content FROM conversations').fetchall(), [('kept',)])
                    self.assertEqual(copy.execute('SELECT name FROM default_plugins').fetchall(), [('handoff',)])
                copy.close()
                (target / 'mcp.json').write_bytes(b'new data')
                self.assertEqual(prepare_default_data_dir(), target)
                self.assertEqual((target / 'mcp.json').read_bytes(), b'new data')
                self.assertEqual((legacy / 'mcp.json').read_bytes(), b'{"servers":[]}')

    def test_windows_migration_copy_failure_can_retry_without_partial_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / 'VVFLY' / 'RespiratoryViewer'
            legacy.mkdir(parents=True)
            (legacy / '.env').write_bytes(b'KEY=value')
            with (patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'platform', 'win32'),
                  patch.dict(os.environ, {'LOCALAPPDATA': directory}, clear=True)):
                target = default_data_dir()
                with patch('server.paths.shutil.copytree', side_effect=OSError('copy blocked')):
                    with self.assertRaises(OSError):
                        prepare_default_data_dir()
                self.assertFalse(target.exists())
                self.assertTrue((legacy / '.env').is_file())
                self.assertEqual(prepare_default_data_dir(), target)
                self.assertEqual((target / '.env').read_bytes(), b'KEY=value')

    def test_windows_override_leaves_legacy_and_default_profiles_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            override = Path(directory) / 'explicit'
            override.mkdir()
            (override / '.env').write_text('AI_AGENT_DESKTOP_CONFIG=override\n', encoding='utf-8')
            legacy = Path(directory) / 'VVFLY' / 'RespiratoryViewer'
            legacy.mkdir(parents=True)
            (legacy / '.env').write_text('AI_AGENT_DESKTOP_CONFIG=legacy\n', encoding='utf-8')
            with (patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'platform', 'win32'),
                  patch.object(sys, 'executable', str(override / 'backend' / 'SomnusBackend.exe')),
                  patch.dict(os.environ, {'LOCALAPPDATA': directory}, clear=True),
                  patch('server.cli._redirect_output_when_headless'),
                  patch('server.cli.pick_port', return_value=8765), patch('server.app.create_app') as create_app,
                  patch('uvicorn.run')):
                self.assertEqual(cli.main(['--data-dir', str(override), '--no-browser']), 0)
                self.assertEqual(create_app.call_args.kwargs['data_dir'], override)
                self.assertEqual(os.environ['AI_AGENT_DESKTOP_CONFIG'], 'override')
                self.assertFalse(legacy.with_name('Somnus').exists())


class DesktopLaunchTests(unittest.TestCase):
    def test_frozen_headless_flag_skips_window_and_browser(self):
        with (patch.object(sys, 'frozen', True, create=True), patch('server.cli.load_env', return_value=None),
              patch('server.cli.pick_port', return_value=8765), patch('server.app.create_app') as create_app,
              patch('server.cli.run_windowed') as native, patch('server.cli.threading.Timer') as browser_timer,
              patch('uvicorn.run') as serve):
            self.assertEqual(cli.main(['--no-browser']), 0)
            native.assert_not_called()
            browser_timer.assert_not_called()
            serve.assert_called_once_with(create_app.return_value, host='127.0.0.1', port=8765, workers=1,
                                          access_log=False, proxy_headers=False)

    def test_explicit_window_with_no_browser_disables_fallback(self):
        with (patch('server.cli.load_env', return_value=None), patch('server.cli.pick_port', return_value=8765),
              patch('server.app.create_app') as create_app, patch('server.cli.desktop_available', return_value=True),
              patch('server.cli.run_windowed', return_value=0) as native):
            self.assertEqual(cli.main(['--window', '--no-browser']), 0)
            native.assert_called_once_with(create_app.return_value, '127.0.0.1', 8765,
                                           'http://127.0.0.1:8765', browser_fallback=False)

    def test_mac_window_uses_cocoa_and_stops_service(self):
        server = SimpleNamespace(started=True, should_exit=False, run=Mock())
        webview = SimpleNamespace(create_window=Mock(), start=Mock())
        with (patch.object(sys, 'platform', 'darwin'), patch.dict(sys.modules, {'webview': webview}),
              patch('uvicorn.Server', return_value=server), patch('server.cli.threading.Thread') as thread):
            self.assertEqual(cli.run_windowed(Mock(), '127.0.0.1', 8765, 'http://127.0.0.1:8765'), 0)
            webview.start.assert_called_once_with(gui='cocoa', private_mode=False)
            self.assertTrue(server.should_exit)
            thread.return_value.join.assert_called_once_with(timeout=10)


if __name__ == '__main__':
    unittest.main()
