"""Read-only portable plugin capability contract; never grants execution rights."""
SCHEMA_VERSION = 1
CAPABILITIES = frozenset({'skills', 'mcp', 'ui.settings', 'ui.sidebar', 'ui.message'})


def describe(*, skills=False, mcp=False, minimum=None, declared=None):
    capabilities = sorted(({'skills'} if skills else set()) | ({'mcp'} if mcp else set()))
    return {'schema_version': SCHEMA_VERSION, 'format': 'somnus.plugin.v1',
            'legacy': declared is None, 'capabilities': capabilities,
            'minimum_somnus_version': minimum,
            'compatibility': 'compatible' if declared is not None else 'unverified'}


def validate(value):
    if (not isinstance(value, dict) or set(value) - {'schema_version', 'runtime', 'capabilities'}
            or value.get('schema_version') != SCHEMA_VERSION
            or value.get('runtime', 'somnus') != 'somnus'
            or not isinstance(value.get('capabilities', []), list)
            or any(item not in CAPABILITIES for item in value.get('capabilities', []))
            or len(set(value.get('capabilities', []))) != len(value.get('capabilities', []))):
        raise ValueError('Invalid declarative plugin contract')
    if any(item.startswith('ui.') for item in value.get('capabilities', [])):
        raise ValueError('Portable text packages cannot install browser components; use an explicit UI adapter')
    return value
