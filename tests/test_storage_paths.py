"""Development storage stays outside sources and does not create directories at import."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from storage_paths import storage_root, artifact_path, cache_path, backups_path

class StoragePathsTests(unittest.TestCase):
    def test_defaults_preserve_dist_build_and_cache_layout_outside_checkout(self):
        source = Path(tempfile.gettempdir()) / 'Somnus-fixture-source'
        expected = source.with_name(source.name + '-Storage').resolve()
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(storage_root(source), expected)
            self.assertEqual(artifact_path('dist', 'electron', project_root=source), expected / 'artifacts/dist/electron')
            self.assertEqual(cache_path('mcp-deps', project_root=source), expected / 'cache/mcp-deps')
            self.assertEqual(backups_path(project_root=source), expected / 'backups/local')

    def test_override_is_supported_but_never_inside_sources(self):
        source = Path(tempfile.gettempdir()) / 'Somnus-fixture-source'
        external = source.with_name('Somnus-custom-storage').resolve()
        with patch.dict(os.environ, {'SOMNUS_DEV_STORAGE': str(external)}):
            self.assertEqual(storage_root(source), external)
        for invalid in (source, source / 'nested-storage'):
            with patch.dict(os.environ, {'SOMNUS_DEV_STORAGE': str(invalid)}):
                with self.assertRaises(ValueError):
                    storage_root(source)

if __name__ == '__main__':
    unittest.main()
