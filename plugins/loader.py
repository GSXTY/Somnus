"""Plugin discovery: folders under plugins/ that declare plugin.json.

A plugin contributes chat tools (and later UI routes). Loading is defensive: a
broken plugin is skipped with a warning instead of taking the app down.
"""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN_DIR = ROOT / 'plugins'

_cache: dict | None = None


def discover(force=False):
    """Return {'specs': [...], 'handlers': {...}, 'plugins': [...], 'errors': [...]}."""
    global _cache
    if _cache is not None and not force:
        return _cache

    specs, handlers, plugins, errors = [], {}, [], []
    if PLUGIN_DIR.is_dir():
        for folder in sorted(PLUGIN_DIR.iterdir()):
            manifest = folder / 'plugin.json'
            if not folder.is_dir() or not manifest.is_file() or folder.name.startswith('_'):
                continue
            try:
                meta = json.loads(manifest.read_text(encoding='utf-8'))
            except (OSError, ValueError) as exc:
                errors.append(f'{folder.name}: {exc}')
                continue
            module_name = f'plugins.{folder.name}.tools'
            table = {}
            if (folder / 'tools.py').is_file():
                try:
                    if str(ROOT) not in sys.path:
                        sys.path.insert(0, str(ROOT))
                    module = importlib.import_module(module_name)
                    table = getattr(module, 'HANDLERS', {})
                except Exception as exc:
                    errors.append(f'{folder.name}: {type(exc).__name__}: {exc}')
                    continue
            count = 0
            for tool in meta.get('tools') or []:
                name = tool.get('name')
                if not name or name not in table:
                    continue
                specs.append(dict(type='function', function=dict(
                    name=name, description=tool.get('description', ''), parameters=tool.get('parameters') or {})))
                handlers[name] = table[name]
                count += 1
            plugins.append(dict(key=meta.get('key') or folder.name, name=meta.get('name') or folder.name,
                                version=meta.get('version'), tools=count,
                                routes=meta.get('routes') or [],
                                has_ui=(folder / 'web' / 'index.html').is_file()))
    _cache = dict(specs=specs, handlers=handlers, plugins=plugins, errors=errors)
    return _cache


def tool_specs(extra=()):
    return list(extra) + discover()['specs']


def handler(name):
    return discover()['handlers'].get(name)
