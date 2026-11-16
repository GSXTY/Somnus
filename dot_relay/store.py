"""SQLite state for isolated desktop pairs, OAuth grants and task results."""

from contextlib import contextmanager
import hashlib
import secrets
import sqlite3
import time


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def token(prefix):
    return prefix + secrets.token_urlsafe(24)


class Store:
    def __init__(self, path):
        self.path = path
        with self.transaction() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS pairs (
                    id TEXT PRIMARY KEY, desktop TEXT NOT NULL UNIQUE,
                    pairing_code TEXT UNIQUE, code_expires REAL NOT NULL,
                    dot TEXT UNIQUE, dot_expires REAL, refresh TEXT UNIQUE,
                    refresh_expires REAL, oauth_client TEXT,
                    paused INTEGER NOT NULL DEFAULT 0,
                    subscription_id TEXT, callback TEXT, signing_key BLOB, subscription_expires REAL
                );
                CREATE TABLE IF NOT EXISTS clients (
                    id TEXT PRIMARY KEY, redirects TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS oauth_codes (
                    code TEXT PRIMARY KEY, pair_id TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
                    client_id TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY, pair_id TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
                    subscription_id TEXT NOT NULL, expires REAL NOT NULL, created_at TEXT NOT NULL,
                    status TEXT NOT NULL, prompt TEXT, result TEXT, error TEXT
                );
                CREATE INDEX IF NOT EXISTS tasks_pair ON tasks(pair_id, expires);
                CREATE TABLE IF NOT EXISTS rate_limits (
                    bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires REAL NOT NULL
                );
            """)

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def limit(self, bucket, count, period):
        now = time.time()
        with self.transaction() as db:
            db.execute('DELETE FROM rate_limits WHERE expires<=?', (now,))
            row = db.execute('SELECT count FROM rate_limits WHERE bucket=?', (bucket,)).fetchone()
            if row is None:
                db.execute('INSERT INTO rate_limits VALUES (?,1,?)', (bucket, now + period))
                return True
            if row['count'] >= count:
                return False
            db.execute('UPDATE rate_limits SET count=count+1 WHERE bucket=?', (bucket,))
            return True

    def create_pair(self):
        pair_id, desktop, code = token('pair_'), token('desktop_'), token('')
        expires = time.time() + 600
        with self.transaction() as db:
            db.execute("""DELETE FROM pairs WHERE dot IS NULL AND code_expires<=?
                          AND NOT EXISTS (SELECT 1 FROM oauth_codes WHERE pair_id=pairs.id AND expires>?)""",
                       (time.time() - 86400, time.time()))
            db.execute('INSERT INTO pairs (id,desktop,pairing_code,code_expires) VALUES (?,?,?,?)',
                       (pair_id, digest(desktop), digest(code), expires))
        return desktop, code, expires

    def renew_code(self, pair):
        code, expires = token(''), time.time() + 600
        with self.transaction() as db:
            count = db.execute("""UPDATE pairs SET pairing_code=?,code_expires=?
                                  WHERE id=? AND dot IS NULL""",
                               (digest(code), expires, pair)).rowcount
            if count:
                db.execute('DELETE FROM oauth_codes WHERE pair_id=?', (pair,))
        return (code, expires) if count else None

    def actor(self, bearer, *, dot=False):
        if not isinstance(bearer, str) or len(bearer) > 128:
            return None
        query = ('SELECT * FROM pairs WHERE dot=? AND dot_expires>?' if dot
                 else 'SELECT * FROM pairs WHERE desktop=?')
        args = (digest(bearer), time.time()) if dot else (digest(bearer),)
        with self.transaction() as db:
            row = db.execute(query, args).fetchone()
            return dict(row) if row else None

    def cleanup_tasks(self, db, pair):
        now = time.time()
        db.execute("""UPDATE tasks SET status='error', prompt=NULL,error='Task expired.'
                      WHERE pair_id=? AND status='pending' AND expires<=?""", (pair, now))
        db.execute('DELETE FROM tasks WHERE expires<=?', (now - 86400,))
