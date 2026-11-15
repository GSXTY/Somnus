import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from server import cli
from server.paths import default_data_dir


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
                    self.assertEqual(default_data_dir(), home / 'VVFLY' / 'RespiratoryViewer')
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
