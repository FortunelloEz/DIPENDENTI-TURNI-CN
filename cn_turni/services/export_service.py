# cn_turni/services/export_service.py
from __future__ import annotations

import json
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


def _hh_index(label: str) -> int:
    """ "12:30" -> 25 (indice di mezz'ora)."""
    h, m = label.split(":")
    return int(h) * 2 + (1 if int(m) >= 30 else 0)


def _fmt_hh(idx: int) -> str:
    """Indice di mezz'ora -> "8", "12:30" (ore intere senza minuti, come prima)."""
    h, half = divmod(idx, 2)
    return f"{h}:30" if half else f"{h}"


def _labels_to_range(labels: list[str]) -> Optional[str]:
    """
    Range del turno da etichette di mezz'ora, con precisione di 30 minuti.
    {"12:30",...,"15:30"} -> "12:30-16";  {"08:00",...,"15:00"} -> "8-15:30";
    fine a mezzanotte -> "ch" (chiusura), es. "16-ch".
    """
    if not labels:
        return None
    idxs = sorted(_hh_index(t) for t in labels)
    start = _fmt_hh(idxs[0])
    end_idx = idxs[-1] + 1  # l'ultima mezz'ora finisce 30 minuti dopo
    if end_idx >= 48:
        return f"{start}-ch"
    return f"{start}-{_fmt_hh(end_idx)}"


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


def _labels_to_full_range(labels: list[str]) -> Optional[str]:
    """Come _labels_to_range ma prende tutte le labels del giorno (ignora slot) e restituisce il range complessivo."""
    return _labels_to_range(labels)


def build_week_export_simple(db: Any, week_key: str) -> dict:
    """Versione semplificata: 1 colonna per giorno (niente split mattina/sera).
    Mostra il range orario complessivo del dipendente per ogni giorno."""
    week_id = week_id_from_ui_weekkey(week_key)
    days_iso = _week_days_iso(week_key)

    emp_rows = db.employees_list()
    id_to_name = {int(r["id"]): str(r["name"]).strip() for r in emp_rows}

    # grid[eid][day_index] = {role: set_of_time_labels}
    grid: Dict[int, Dict[int, Dict[str, set]]] = {}

    overrides = _iter_overrides_rows(db, week_id)
    for r in overrides:
        day_index = int(r["day_index"])
        time_label = str(r["time_label"])
        role = str(r.get("role") or "")

        eids = r.get("employee_ids")
        if isinstance(eids, str):
            s = eids.strip()
            if s.startswith("["):
                eids = json.loads(s)
            elif s == "":
                eids = []
            else:
                eids = [int(x) for x in s.split(",") if x.strip().isdigit()]

        for eid in (eids or []):
            eid = int(eid)
            by_role = grid.setdefault(eid, {}).setdefault(day_index, {})
            by_role.setdefault(role, set()).add(time_label)

    day_indices = [1, 2, 3, 4, 5, 6]
    headers = []
    for di in day_indices:
        iso = days_iso[di]
        headers.append({"iso": iso, "label": _day_label_it(iso)})

    rows = []
    for eid, by_day in grid.items():
        name = id_to_name.get(eid, "Ex dipendente")  # eliminato: resta nello storico
        cells: List[str] = []
        roles: List[str] = []
        any_cell = False
        for di in day_indices:
            by_role = by_day.get(di, {})
            all_labels = sorted({lbl for lbls in by_role.values() for lbl in lbls})
            rng = _labels_to_full_range(all_labels)
            # ruolo dominante = quello con più mezz'ore
            dominant_role = max(by_role, key=lambda r: len(by_role[r]), default="") if rng else ""
            cells.append(rng or "")
            roles.append(dominant_role)
            if rng:
                any_cell = True
        if any_cell:
            rows.append({"name": name, "cells": cells, "roles": roles})

    rows.sort(key=lambda r: r["name"].lower())
    return {"week_key": week_key, "week_id": week_id, "headers": headers, "rows": rows}


def build_week_export(db: Any, week_key: str) -> dict:
    week_id = week_id_from_ui_weekkey(week_key)
    days_iso = _week_days_iso(week_key)

    emp_rows = db.employees_list()
    id_to_name = {int(r["id"]): str(r["name"]).strip() for r in emp_rows}

    # grid[eid][day_index][slot] = {"labels": set(), "role": str}
    grid: Dict[int, Dict[int, Dict[str, Any]]] = {}

    overrides = _iter_overrides_rows(db, week_id)
    for r in overrides:
        day_index = int(r["day_index"])
        time_label = str(r["time_label"])
        slot = _slot_of_time(time_label)
        role = str(r.get("role") or "")

        eids = r.get("employee_ids")
        if isinstance(eids, str):
            s = eids.strip()
            if s.startswith("["):
                eids = json.loads(s)
            elif s == "":
                eids = []
            else:
                eids = [int(x) for x in s.split(",") if x.strip().isdigit()]

        for eid in (eids or []):
            eid = int(eid)
            day_data = grid.setdefault(eid, {}).setdefault(day_index, {})
            slot_data = day_data.setdefault(slot, {"labels": set(), "role": role})
            slot_data["labels"].add(time_label)
            # ruolo: teniamo il più frequente (in caso di conflitto, il primo vince)
            if not slot_data["role"]:
                slot_data["role"] = role
    # Martedì->Domenica come nel tuo esempio
    day_indices = [1, 2, 3, 4, 5, 6]
    headers = []
    for di in day_indices:
        iso = days_iso[di]
        headers.append({"iso": iso, "label": _day_label_it(iso), "slots": ["morning", "evening"]})

    rows = []
    for eid, by_day in grid.items():
        name = id_to_name.get(eid, "Ex dipendente")  # eliminato: resta nello storico
        cells: List[str] = []
        roles: List[str] = []   # parallelo a cells: ruolo per ogni cella
        any_cell = False
        for di in day_indices:
            day_slots = by_day.get(di, {})
            for slot in ("morning", "evening"):
                slot_data = day_slots.get(slot, {})
                labels = sorted(slot_data.get("labels", set()) if isinstance(slot_data, dict) else slot_data)
                role = slot_data.get("role", "") if isinstance(slot_data, dict) else ""
                rng = _labels_to_range(labels)
                cells.append(rng or "")
                roles.append(role if rng else "")
                if rng:
                    any_cell = True
        if any_cell:
            rows.append({"name": name, "cells": cells, "roles": roles})

    rows.sort(key=lambda r: r["name"].lower())
    return {"week_key": week_key, "week_id": week_id, "headers": headers, "rows": rows}
