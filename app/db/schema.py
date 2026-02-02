from __future__ import annotations

from pathlib import Path
import sqlite3

SCHEMA_VERSION = 3

def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA foreign_keys = ON;")

        conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """)

        row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        current = int(row[0]) if row else 0

        if current < 1:
            _migrate_1(conn)
            current = 1

        if current < 2:
            _migrate_2(conn)
            current = 2

        if current < 3:
            _migrate_3(conn)
            current = 3

        conn.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version', ?)",
            (str(SCHEMA_VERSION),)
        )
        conn.commit()
    finally:
        conn.close()

def _migrate_1(conn: sqlite3.Connection) -> None:
    conn.execute("""
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
    );
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS employee_skills (
        employee_id INTEGER NOT NULL,
        skill TEXT NOT NULL,
        PRIMARY KEY(employee_id, skill),
        FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS imports_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        imported_at TEXT NOT NULL,
        file_path TEXT NOT NULL,
        rows_count INTEGER NOT NULL DEFAULT 0
    );
    """)

def _migrate_2(conn: sqlite3.Connection) -> None:
    conn.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

def _migrate_3(conn: sqlite3.Connection) -> None:
    # turni generati
    conn.execute("""
    CREATE TABLE IF NOT EXISTS schedule_generated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start_iso TEXT NOT NULL,
        day_iso TEXT NOT NULL,
        slot_start TEXT NOT NULL,
        slot_end TEXT NOT NULL,
        skill TEXT NOT NULL,
        employee_id INTEGER NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    """)

    # override admin (add/remove/replace)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS schedule_override (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start_iso TEXT NOT NULL,
        day_iso TEXT NOT NULL,
        slot_start TEXT NOT NULL,
        slot_end TEXT NOT NULL,
        skill TEXT NOT NULL,
        employee_id INTEGER NOT NULL,
        action TEXT NOT NULL, -- add/remove/replace
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    """)
