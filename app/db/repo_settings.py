# app/db/repo_settings.py
# =========================
# Repository per impostazioni applicative, fabbisogni, priorità, finestre critiche e log degli import.
from __future__ import annotations

import json
import sqlite3
from typing import Dict, Any
from app.config import DEFAULT_SETTINGS

def get_settings(conn: sqlite3.Connection) -> Dict[str, Any]:
    rows = conn.execute("SELECT key,value FROM settings").fetchall()
    data: Dict[str, Any] = dict(DEFAULT_SETTINGS)
    for r in rows:
        key = r["key"]
        val = r["value"]
        try:
            data[key] = json.loads(val)
        except Exception:
            data[key] = val
    return data

def upsert_settings(conn: sqlite3.Connection, payload: Dict[str, Any]) -> None:
    for k, v in payload.items():
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (k, json.dumps(v)))

def log_import(conn: sqlite3.Connection, imported_at_iso: str, file_path: str, rows_count: int) -> int:
    cur = conn.execute(
        "INSERT INTO imports_log(imported_at,file_path,rows_count) VALUES(?,?,?)",
        (imported_at_iso, file_path, rows_count),
    )
    return int(cur.lastrowid)
