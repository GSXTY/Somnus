"""A failed backend freeze cannot leave an older build marked as current."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import build_electron


class BackendBuildReceiptTests(unittest.TestCase):
    def test_success_records_the_source_version_and_failure_invalidates_an_old_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frontend = root / 'page_design/web'
            frontend.mkdir(parents=True)
            (frontend / 'index.html').write_text('fixture')
            build = root / 'artifacts/build/electron'
            backend = build / 'backend/SomnusBackend'
            backend.mkdir(parents=True)
            receipt = backend / 'somnus-backend-build.json'
            with patch.object(build_electron, 'ROOT', root), patch.object(build_electron, 'BUILD', build):
                with patch.object(build_electron.subprocess, 'run') as run:
                    build_electron.build_backend()
                    run.assert_called_once()
                record = json.loads(receipt.read_text())
                self.assertEqual(record['sourceVersion'], build_electron.APP_VERSION)
                self.assertEqual(record['producer'], 'SomnusNext PyInstaller')
                with patch.object(build_electron.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'PyInstaller')):
                    with self.assertRaises(subprocess.CalledProcessError):
                        build_electron.build_backend()
                self.assertFalse(receipt.exists())


if __name__ == '__main__':
    unittest.main()
