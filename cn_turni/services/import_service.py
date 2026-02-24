# cn_turni/services/import_service.py
from __future__ import annotations
from dataclasses import asdict
from datetime import timedelta
from typing import Any
import re
from .csv_availability import parse_availability_csv
from .auto_scheduler import Employee, PermanentSettings, build_plan

def _half_hours(start_h: int, end_h: int) -> list[str]:
    out = []
    for h in range(start_h, end_h):
        out.append(f"{h:02d}:00")
        out.append(f"{h:02d}:30")
    return out

def _week_days_iso_from_week_key(week_key: str) -> list[str]:
    from datetime import date
    d0 = date.fromisoformat(week_key)
    return [(d0 + timedelta(days=i)).isoformat() for i in range(7)]


class ImportService:
    def __init__(self, db: Any):
        self.db = db

    def import_availability_and_autofill(self, week_key: str, week_id: str, csv_text: str, resolutions=None):
        # 1) employees dal DB
        emp_rows = self.db.employees_list()

        def _norm(s: str) -> str:
            return " ".join((s or "").strip().upper().split())

        # 2) mappa nome/alias -> employee_id
        name_to_id = {}
        for r in emp_rows:
            emp_id = int(r["id"])
            name_to_id[_norm(r["name"])] = emp_id

            aliases = (r.get("aliases") or "").strip()
            if aliases:
                for a in re.split(r"[|,;]+", aliases):
                    a = _norm(a)
                    if a:
                        name_to_id[a] = emp_id

        # 3) parse CSV
        availability = parse_availability_csv(csv_text)
        csv_names = list(availability.keys())

        # unknown = nomi del csv non trovati né come name né come alias
        unknown = [n for n in csv_names if _norm(n) not in name_to_id]

        # 4) se ci sono unknown e non ho risoluzioni => chiedo alla UI
        if unknown and not resolutions:
            return {
                "ok": False,
                "needs_resolution": True,
                "unknown": unknown,
                "employees": [{"id": int(r["id"]), "name": str(r["name"])} for r in emp_rows],
            }

        # 5) se arrivano resolutions => applicale (create / alias)
        if unknown and resolutions:
            # costruisco lookup emp_id -> row (per non richiamare employees_list dentro il loop)
            emp_by_id = {int(r["id"]): r for r in emp_rows}

            for it in resolutions:
                csv_name_raw = it.get("csv_name") or ""
                csv_name = _norm(csv_name_raw)
                action = it.get("action")

                if not csv_name:
                    continue

                if action == "create":
                    new_id = self.db.employee_create({
                        "name": csv_name_raw.strip() or csv_name.title(),
                        "is_permanent": 0,
                        "preferred_role": None,
                        "slot_morning": 1,
                        "slot_evening": 1,
                        "skills": {},
                        "aliases": "",
                    })
                    name_to_id[csv_name] = int(new_id)

                elif action == "alias":
                    emp_id = int(it.get("employee_id") or 0)
                    if emp_id <= 0 or emp_id not in emp_by_id:
                        continue

                    emp = emp_by_id[emp_id]
                    cur_aliases = (emp.get("aliases") or "").strip()
                    parts = [p.strip() for p in re.split(r"[|,;]+", cur_aliases) if p.strip()] if cur_aliases else []

                    # evita duplicati (normalizzati)
                    norm_parts = {_norm(p) for p in parts}
                    if csv_name not in norm_parts:
                        parts.append(csv_name_raw.strip() or csv_name.title())

                    self.db.employee_update({
                        "id": emp_id,
                        "name": emp["name"],
                        "is_permanent": emp.get("is_permanent", False),
                        "preferred_role": emp.get("preferred_role"),
                        "slot_morning": emp.get("slot_morning", 1),
                        "slot_evening": emp.get("slot_evening", 1),
                        "skills": emp.get("skills") or {},
                        "aliases": " | ".join(parts),
                    })

                    name_to_id[csv_name] = emp_id

            # IMPORTANTISSIMO: ricarico emp_rows, perché posso aver creato dipendenti nuovi
            emp_rows = self.db.employees_list()

        # 6) costruisco lista employees (planner lavora sugli employee del DB)
        employees = [
            Employee(
                id=int(r["id"]),
                name=str(r["name"]),
                is_permanent=bool(r.get("is_permanent", 0)),
                preferred_role=r.get("preferred_role"),
                slot_morning=int(r.get("slot_morning", 1) or 0),
                slot_evening=int(r.get("slot_evening", 1) or 0),
                skills=r.get("skills") or {},
            )
            for r in emp_rows
        ]

        # 7) permanents settings (USA week_id)
        perm_rows = self.db.permanent_week_get(week_id)
        perm_settings = [
            PermanentSettings(
                employee_id=int(r["employee_id"]),
                day_off=(None if r.get("day_off") is None else int(r["day_off"])),
                target_hours=int(r.get("target_hours", 40) or 40),
            )
            for r in perm_rows
        ]

        # 8) squads need (USA week_id)
        squads_need = self.db.squads_week_get(week_id)

        week_days_iso = _week_days_iso_from_week_key(week_key)

        plan, deficits = build_plan(
            week_days_iso=week_days_iso,
            employees=employees,
            permanent_settings=perm_settings,
            availability=availability,
            squads_need=squads_need,
        )

        # 9) salva overrides
        self.db.overrides_clear_week(week_id)

        MORNING_LABELS = _half_hours(8, 16)
        EVENING_LABELS = _half_hours(16, 24)

        for day_index, slots in (plan or {}).items():
            for slot_name, roles_map in (slots or {}).items():
                labels = MORNING_LABELS if slot_name == "morning" else EVENING_LABELS

                for role, emp_ids in (roles_map or {}).items():
                    emp_ids = list(dict.fromkeys(emp_ids or []))
                    items = [{"time_label": t, "employee_ids": emp_ids} for t in labels]

                    self.db.overrides_set_many(
                        week_id=week_id,
                        day_index=int(day_index),
                        role=str(role),
                        items=items,
                    )

        return {"ok": True, "deficits": [asdict(d) for d in deficits]}
