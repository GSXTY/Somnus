"""Plugin discovery: folders under plugins/ that declare plugin.json.

A plugin contributes chat tools and can register workspace entries. Loading is defensive: a
broken plugin is skipped with a warning instead of taking the app down.
"""
from __future__ import annotations

import importlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN_DIR = ROOT / 'plugins'

_cache: dict | None = None


def workspace_entries(meta, folder, has_ui, errors):
    """Publish navigation metadata for pages already served by the host."""
    entries = meta.get('workspace_entries', [])
    if not isinstance(entries, list):
        errors.append(f'{folder.name}: workspace_entries must be a list')
        return []

    key = meta.get('key') or folder.name
    published = []
    identifiers = set()
    for entry in entries:
        if not isinstance(entry, dict):
            errors.append(f'{folder.name}: invalid workspace entry')
            continue
        identifier, title = entry.get('id'), entry.get('title')
        path, slot = entry.get('path'), entry.get('slot')
        access = entry.get('access')
        mode = entry.get('mode')
        detection = (folder.name == key == 'respiratory' and identifier == 'analysis'
                     and mode == 'embedded' and path == '/events' and access == 'selected-record')
        module = (key == folder.name and re.fullmatch(r'[a-z][a-z0-9-]*', folder.name)
                  and has_ui and path == f'/module/{key}/' and mode == 'standalone'
                  and access == 'plugin-managed')
        if (not isinstance(identifier, str) or not re.fullmatch(r'[a-z][a-z0-9-]*', identifier)
                or identifier in identifiers or not isinstance(title, str) or not title.strip()
                or slot not in ('tools', 'sidebar') or not (detection or module)):
            errors.append(f'{folder.name}: invalid workspace entry {identifier!r}')
            continue
        identifiers.add(identifier)
        published.append(dict(id=identifier, title=title.strip(), path=path, slot=slot,
                              mode=mode, access=access))
    return published


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
                if not isinstance(meta, dict):
                    raise ValueError('plugin.json must contain an object')
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
            has_ui = (folder / 'web' / 'index.html').is_file()
            plugins.append(dict(key=meta.get('key') or folder.name, name=meta.get('name') or folder.name,
                                version=meta.get('version'), tools=count,
                                routes=meta.get('routes') or [],
                                has_ui=has_ui, workspace_entries=workspace_entries(meta, folder, has_ui, errors)))
    _cache = dict(specs=specs, handlers=handlers, plugins=plugins, errors=errors)
    return _cache


def tool_specs(extra=()):
    return list(extra) + discover()['specs']


def handler(name):
    return discover()['handlers'].get(name)
