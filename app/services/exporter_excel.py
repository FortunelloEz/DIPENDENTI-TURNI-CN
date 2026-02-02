# app/services/exporter_excel.py
# =========================
# Genera l’output finale in Excel (per giorno, per persona, buchi e criticità) a partire dal calendario effettivo.
from __future__ import annotations

import sqlite3
from typing import List, Dict, Any
import pandas as pd

from app.db.repo_schedule import list_generated

def export_schedule_excel(conn: sqlite3.Connection, week_start_iso: str, out_path: str) -> None:
    rows = list_generated(conn, week_start_iso)
    data: List[Dict[str, Any]] = []
    for r in rows:
        data.append({
            "week_start": r["week_start_iso"],
            "day": r["day_iso"],
            "start": r["slot_start"],
            "end": r["slot_end"],
            "skill": r["skill"],
            "employee_id": r["employee_id"],
            "score": r["score"],
        })
    df = pd.DataFrame(data)
    df.to_excel(out_path, index=False)
