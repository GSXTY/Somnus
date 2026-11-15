"""Create a small synthetic SQLite database so the AI query feature can be tried
before a company read-only account exists.

Usage: python tools/seed_analytics_demo.py [path]
"""
from __future__ import annotations

import random
import sqlite3
import sys
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ['YA70A20', 'YA70B20', 'YA70B25', 'YA70B30']


def seed(path: Path, users: int = 80, days: int = 30) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    random.seed(20261111)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.executescript('''
            CREATE TABLE users (
                user_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                registered_at TEXT NOT NULL,
                device_model TEXT NOT NULL,
                firmware TEXT NOT NULL
            );
            CREATE TABLE daily_usage (
                user_id TEXT NOT NULL REFERENCES users(user_id),
                record_date TEXT NOT NULL,
                therapy_minutes INTEGER NOT NULL,
                ahi REAL,
                leak_p95 REAL,
                PRIMARY KEY (user_id, record_date)
            );
            CREATE INDEX daily_usage_date ON daily_usage(record_date);
        ''')
        today = date(2026, 11, 10)
        for index in range(users):
            user_id = f'U{1000 + index}'
            registered = today - timedelta(days=random.randint(20, 300))
            connection.execute('INSERT INTO users VALUES (?,?,?,?,?)',
                               (user_id, f'用户 {index + 1}', registered.isoformat(),
                                random.choice(MODELS), f'1.00.{random.randint(10, 21)}'))
            for offset in range(days):
                day = today - timedelta(days=offset)
                if day < registered or random.random() < 0.08:
                    continue
                minutes = random.randint(180, 520)
                ahi = round(0.1 + 0.9 * random.random() ** 2, 2)
                leak = round(1 + 5 * random.random(), 1)
                connection.execute('INSERT INTO daily_usage VALUES (?,?,?,?,?)',
                                   (user_id, day.isoformat(), minutes, ahi, leak))
    return path


if __name__ == '__main__':
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'analytics_demo.sqlite3'
    print(seed(target))
