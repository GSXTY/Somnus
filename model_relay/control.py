"""Read and change the private owner-controlled sharing flag."""

import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile


class RelayControl:
    """A missing or unreadable flag keeps model sharing closed."""

    def __init__(self, path):
        self.path = Path(path)

    def enabled(self):
        try:
            with self.path.open('rb') as handle:
                data = handle.read(128)
            if len(data) == 128:
                return False
            value = json.loads(data)
            return isinstance(value, dict) and len(value) == 1 and value.get('enabled') is True
        except (OSError, ValueError, RecursionError):
            return False

    def set_enabled(self, enabled):
        if type(enabled) is not bool:
            raise TypeError('Sharing must be enabled or disabled.')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.path.parent,
                                    prefix='.sharing-', delete=False) as handle:
                temporary = Path(handle.name)
                json.dump({'enabled': enabled}, handle)
            os.replace(temporary, self.path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
