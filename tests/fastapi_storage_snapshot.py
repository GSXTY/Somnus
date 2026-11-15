"""Read-only content digests for migration acceptance; never emits stored content."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys


def snapshot(folder, filenames=None):
    result = {}
    for name in filenames or ('events.sqlite3', 'assistant.sqlite3'):
        path = Path(folder) / name
        if not path.is_file():
            result[name] = None
            continue
        with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
            tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            item = {}
            for table in tables:
                quoted = '"' + table.replace('"', '""') + '"'
                rows = sorted(json.dumps(row, ensure_ascii=False, default=str) for row in db.execute('SELECT * FROM ' + quoted))
                item[table] = {'count': len(rows), 'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest()}
            result[name] = item
    return result


if __name__ == '__main__':
    filenames = ('events.sqlite3', 'assistant.sqlite3', 'deep_analysis/analysis.sqlite3') if '--deep' in sys.argv[2:] else None
    print(json.dumps(snapshot(sys.argv[1], filenames), indent=2))
