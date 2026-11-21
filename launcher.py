"""Start SomnusNext's local workspace with an independent product profile."""
import os
from pathlib import Path
import sys


def configure_product_environment(environment=None):
    environment = os.environ if environment is None else environment
    if sys.platform == 'darwin':
        app_data = Path.home() / 'Library/Application Support'
    else:
        app_data = Path(environment.get('APPDATA') or environment.get('LOCALAPPDATA') or Path.home())
    environment.setdefault('AI_AGENT_DATA_DIR', str(app_data / 'VVFLY/SomnusNext/data'))
    # The source entry must not implicitly import the copied root .env or old model registry.
    environment.setdefault('SOMNUS_PROFILE_CONFIG_ONLY', '1')
    environment.setdefault('SOMNUS_DSH_CONFIGURED_PROVIDERS', '1')
    return environment


if __name__ == '__main__':
    configure_product_environment()
    from server.cli import main

    sys.exit(main() or 0)
