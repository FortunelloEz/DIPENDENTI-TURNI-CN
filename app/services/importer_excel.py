# app/services/importer_excel.py
# =========================
# Importa i file Excel delle disponibilità, normalizza i dati e li salva come input grezzo nel database.
from __future__ import annotations

from datetime import datetime, timezone
import sqlite3
from typing import Dict, Any, List

import pandas as pd

from app.db.repo_settings import log_import
from app.db.repo_availability import insert_raw

def import_availability_excel(conn: sqlite3.Connection, file_path: str) -> Dict[str, Any]:
    """
    Excel atteso (minimo):
    - employee_id (int) oppure name (poi si mappa)
    - day_iso (YYYY-MM-DD)
    - start_time (HH:MM)
    - end_time (HH:MM)
    """
    df = pd.read_excel(file_path)
    df.columns = [c.strip() for c in df.columns]

    required = {"employee_id", "day_iso", "start_time", "end_time"}
    missing = required - set(df.columns)
    if missing:
        return {"ok": False, "error": f"Missing columns: {sorted(missing)}"}

    imported_at = datetime.now(timezone.utc).isoformat()
    import_id = log_import(conn, imported_at, file_path, int(len(df)))

    rows: List[Dict[str, Any]] = []
    for _, r in df.iterrows():
        rows.append({
            "employee_id": int(r["employee_id"]),
            "day_iso": str(r["day_iso"])[:10],
            "start_time": str(r["start_time"])[:5],
            "end_time": str(r["end_time"])[:5],
            "source_import_id": import_id,
        })

    n = insert_raw(conn, rows)
    return {"ok": True, "import_id": import_id, "rows": n}
