"""Local paths shared by the desktop launcher and API host."""
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]


def default_data_dir():
    configured = os.getenv('AI_AGENT_DATA_DIR')
    if configured:
        return Path(configured).expanduser().resolve()
    if not getattr(sys, 'frozen', False):
        return ROOT / 'data'
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'VVFLY' / 'RespiratoryViewer'
    local_app_data = os.getenv('LOCALAPPDATA')
    return (Path(local_app_data) if local_app_data else Path.home()) / 'VVFLY' / 'RespiratoryViewer'
