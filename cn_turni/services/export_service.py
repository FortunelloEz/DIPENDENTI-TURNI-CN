# cn_turni/services/export_service.py
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from cn_turni.db import week_id_from_ui_weekkey


def _week_days_iso(week_key: str) -> list[str]:
    d0 = date.fromisoformat(week_key)
    return [(d0 + timedelta(days=i)).isoformat() for i in range(7)]


def _day_label_it(iso_day: str) -> str:
    d = date.fromisoformat(iso_day)
    mesi = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]
    giorni = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"]
    return f"{giorni[d.weekday()]} {d.day:02d} {mesi[d.month-1]}"


def _labels_to_range(labels: list[str]) -> Optional[str]:
    if not labels:
        return None
    labels = sorted(labels)
    start_h = int(labels[0].split(":")[0])
    last = labels[-1]
    end_h = int(last.split(":")[0])
    end_m = int(last.split(":")[1])
    end = end_h + (1 if end_m == 30 else 0)
    if end >= 24:
        return f"{start_h}-ch"
    return f"{start_h}-{end}"


def _slot_of_time(t: str) -> str:
    h = int(t.split(":")[0])
    return "morning" if h < 16 else "evening"


def _iter_overrides_rows(db: Any, week_id: str):
    if hasattr(db, "overrides_week_get"):
        return db.overrides_week_get(week_id)
    if hasattr(db, "overrides_get_week"):
        return db.overrides_get_week(week_id)

    conn = getattr(db, "conn", None) or getattr(db, "_conn", None)
    if conn is None:
        raise RuntimeError("Export: non trovo db.overrides_get_week() né db.conn (SQLite).")

    cur = conn.cursor()
    cur.execute(
        """
        SELECT day_index, role, time_label, employee_ids
        FROM schedule_override
        WHERE week_id = ?
        ORDER BY day_index, role, time_label
        """,
        (week_id,),
    )
    rows = []
    for day_index, role, time_label, employee_ids in cur.fetchall():
        rows.append(
            {
                "day_index": int(day_index),
                "role": role,
                "time_label": time_label,
                "employee_ids": employee_ids,
            }
        )
    return rows


def build_week_export(db: Any, week_key: str) -> dict:
    week_id = week_id_from_ui_weekkey(week_key)
    days_iso = _week_days_iso(week_key)

    emp_rows = db.employees_list()
    id_to_name = {int(r["id"]): str(r["name"]).strip() for r in emp_rows}

    grid: Dict[int, Dict[int, Dict[str, set[str]]]] = {}

    overrides = _iter_overrides_rows(db, week_id)
    for r in overrides:
        day_index = int(r["day_index"])
        time_label = str(r["time_label"])
        slot = _slot_of_time(time_label)

        eids = r.get("employee_ids")
        if isinstance(eids, str):
            s = eids.strip()
            if s.startswith("["):
                import json
                eids = json.loads(s)
            elif s == "":
                eids = []
            else:
                eids = [int(x) for x in s.split(",") if x.strip().isdigit()]

        for eid in (eids or []):
            eid = int(eid)
            grid.setdefault(eid, {}).setdefault(day_index, {}).setdefault(slot, set()).add(time_label)

    # Martedì->Domenica come nel tuo esempio
    day_indices = [1, 2, 3, 4, 5, 6]
    headers = []
    for di in day_indices:
        iso = days_iso[di]
        headers.append({"iso": iso, "label": _day_label_it(iso), "slots": ["morning", "evening"]})

    rows = []
    for eid, by_day in grid.items():
        name = id_to_name.get(eid, f"ID {eid}")
        cells: List[str] = []
        any_cell = False
        for di in day_indices:
            day_slots = by_day.get(di, {})
            for slot in ("morning", "evening"):
                labels = sorted(day_slots.get(slot, set()))
                rng = _labels_to_range(labels)
                cells.append(rng or "")
                if rng:
                    any_cell = True
        if any_cell:
            rows.append({"name": name, "cells": cells})

    rows.sort(key=lambda r: r["name"].lower())
    return {"week_key": week_key, "week_id": week_id, "headers": headers, "rows": rows}
