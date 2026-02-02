# app/db/connection.py
# =========================
# Gestisce la connessione SQLite, i PRAGMA, le transazioni e fornisce helper per l’esecuzione delle query.
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

@contextmanager
def get_conn(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.row_factory = sqlite3.Row
        _apply_pragmas(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()

def _apply_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
