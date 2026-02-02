# app/services/validator.py
# =========================
# Esegue controlli di consistenza sui dati (errori e warning) producendo un report senza modificare gli input.
from __future__ import annotations

import sqlite3
from typing import Dict, Any, List

def validate_all(conn: sqlite3.Connection) -> Dict[str, Any]:
    errors: List[str] = []

    # esempi minimi
    emp_count = conn.execute("SELECT COUNT(*) AS c FROM employees WHERE active=1").fetchone()["c"]
    if emp_count == 0:
        errors.append("Nessun dipendente attivo configurato.")

    # availability raw basic check
    bad = conn.execute("""
        SELECT COUNT(*) AS c
        FROM availability_raw
        WHERE start_time >= end_time
    """).fetchone()["c"]
    if bad > 0:
        errors.append(f"Disponibilità con start_time >= end_time: {bad}")

    return {"ok": len(errors) == 0, "errors": errors}
