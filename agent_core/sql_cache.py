"""Small on-disk cache for question→result pairs.

Repeating the same question costs no model tokens and no database time. Entries
are keyed by the normalized question plus the data source, and expire quickly so
a dashboard refresh never shows stale numbers for long.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = ROOT / 'data' / 'sql_cache.sqlite3'


def ttl_seconds() -> int:
    try:
        return max(0, int(os.getenv('ANALYTICS_SQL_CACHE_TTL', '600')))
    except ValueError:
        return 600


@contextmanager
def _db():
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(CACHE_PATH, timeout=5)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute(
            'CREATE TABLE IF NOT EXISTS answers(key TEXT PRIMARY KEY, question TEXT, payload TEXT, created_at REAL)')
        yield connection
        connection.commit()
    finally:
        connection.close()


def _key(question: str, database: str) -> str:
    normalized = ' '.join((question or '').lower().split())
    return hashlib.sha256(f'{database}|{normalized}'.encode('utf-8')).hexdigest()


def get(question: str, database: str):
    if ttl_seconds() <= 0:
        return None
    try:
        with _db() as db:
            row = db.execute('SELECT payload, created_at FROM answers WHERE key=?', (_key(question, database),)).fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    if time.time() - row['created_at'] > ttl_seconds():
        return None
    try:
        return json.loads(row['payload'])
    except ValueError:
        return None


def put(question: str, database: str, payload: dict) -> None:
    if ttl_seconds() <= 0:
        return
    try:
        with _db() as db:
            db.execute('INSERT OR REPLACE INTO answers(key, question, payload, created_at) VALUES(?,?,?,?)',
                       (_key(question, database), question[:500], json.dumps(payload, ensure_ascii=False), time.time()))
            db.execute('DELETE FROM answers WHERE created_at < ?', (time.time() - 86400,))
    except (sqlite3.Error, TypeError, ValueError):
        pass


def stats() -> dict:
    try:
        with _db() as db:
            row = db.execute('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM answers').fetchone()
            return dict(entries=row['n'], last_at=row['last'], ttl=ttl_seconds())
    except sqlite3.Error:
        return dict(entries=0, last_at=None, ttl=ttl_seconds())
