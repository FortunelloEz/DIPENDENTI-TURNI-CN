# app/db/repo_availability.py
# =========================
# Repository per la gestione delle disponibilità importate (raw) e delle eventuali override manuali.
from __future__ import annotations

import sqlite3
from typing import List, Dict, Any

def clear_raw_by_import(conn: sqlite3.Connection, import_id: int) -> None:
    conn.execute("DELETE FROM availability_raw WHERE source_import_id=?", (import_id,))

def insert_raw(conn: sqlite3.Connection, rows: List[Dict[str, Any]]) -> int:
    n = 0
    for r in rows:
        conn.execute(
            """INSERT INTO availability_raw(employee_id, day_iso, start_time, end_time, source_import_id)
               VALUES(?,?,?,?,?)""",
            (r["employee_id"], r["day_iso"], r["start_time"], r["end_time"], r.get("source_import_id")),
        )
        n += 1
    return n

def list_raw_for_week(conn: sqlite3.Connection, week_start_iso: str) -> List[sqlite3.Row]:
    # stub: qui torneremo con range mar-dom calcolato da services/utils
    return conn.execute(
        "SELECT * FROM availability_raw WHERE day_iso >= ? ORDER BY day_iso, start_time",
        (week_start_iso,),
    ).fetchall()
