"""Generate or statically validate a portable Somnus plugin; never executes plugins."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app_version import APP_VERSION
from ai_assistant.plugin_package import parse
from ai_assistant.plugin_contract import describe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['template', 'validate'])
    parser.add_argument('path', type=Path)
    args = parser.parse_args()
    if args.action == 'template':
        package = {'format': 'somnus.plugin.v1', 'minimum_somnus_version': APP_VERSION,
                   'manifest': {'name': 'Example plugin', 'version': '1.0.0', 'description': '', 'mcp_ids': []},
                   'skills': [{'name': 'example-skill', 'description': 'Synthetic example',
                               'instructions': 'Reply with EXAMPLE-OK when explicitly requested.', 'references': []}],
                   'contract': {'schema_version': 1, 'runtime': 'somnus', 'capabilities': ['skills']}}
        parse(package)
        with args.path.open('x', encoding='utf-8') as out:
            json.dump(package, out, ensure_ascii=False, indent=2)
    else:
        package = json.loads(args.path.read_text(encoding='utf-8-sig'))
        minimum, manifest, skills = parse(package)
        print(json.dumps(describe(skills=bool(skills), mcp=bool(manifest['mcp_ids']), minimum=minimum,
                                  declared=package.get('contract')), ensure_ascii=False))


if __name__ == '__main__':
    main()
