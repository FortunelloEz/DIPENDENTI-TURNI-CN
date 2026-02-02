# app/api.py
# =========================
# Bridge JS ↔ Python: espone alla UI i metodi backend e instrada le chiamate verso i servizi applicativi.
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List

from app.db.connection import get_conn
from app.db.repo_employees import (
    list_employees,
    create_employee,
    update_employee,
    delete_employee,
    set_employee_skills,
)
from app.db.repo_settings import get_settings, upsert_settings
from app.db.repo_schedule import (
    week_has_generated,
    get_effective_assignments,
    insert_override,
)
from app.services.importer_excel import import_availability_excel
from app.services.validator import validate_all
from app.services.scheduler import generate_schedule
from app.services.exporter_excel import export_schedule_excel
from app.utils.dates import week_days_from_start


class Api:
    def __init__(self, paths):
        self._db_path = Path(paths.db_path)
        self._exports_dir = Path(paths.exports_dir)

    # ---- meta / health ----
    def ping(self) -> Dict[str, Any]:
        return {"ok": True, "db_path": str(self._db_path)}

    # ---- employees ----
    def employees_list(self) -> List[Dict[str, Any]]:
        with get_conn(self._db_path) as conn:
            return [asdict(e) for e in list_employees(conn)]

    def employees_create(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            emp = create_employee(conn, payload)
            return asdict(emp)

    def employees_update(self, emp_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            emp = update_employee(conn, emp_id, payload)
            return asdict(emp)

    def employees_delete(self, emp_id: int) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            delete_employee(conn, emp_id)
        return {"ok": True}

    def employees_set_skills(self, emp_id: int, skills: List[str]) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            set_employee_skills(conn, emp_id, skills)
        return {"ok": True}

    # ---- settings ----
    def settings_get(self) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            return get_settings(conn)

    def settings_save(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            upsert_settings(conn, payload)
        return {"ok": True}

    # ---- availability import ----
    def availability_import_excel(self, file_path: str) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            return import_availability_excel(conn, file_path)

    # ---- validation ----
    def validate(self) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            return validate_all(conn)

    # ---- scheduling (generate) ----
    def schedule_generate(self, week_start_iso: str) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            return generate_schedule(conn, week_start_iso)

    # ---- calendar homepage: get week grid ----
    def schedule_get_week(self, week_start_iso: str) -> Dict[str, Any]:
        with get_conn(self._db_path) as conn:
            settings = get_settings(conn)
            skills = settings.get("skills", ["sala", "bar", "cucina"])
            need = (settings.get("need_per_slot", {}) or {}).get("default", {})
            processed = week_has_generated(conn, week_start_iso)

            # mar-dom
            days = week_days_from_start(week_start_iso, 6)

            # 2 fasce fisse
            slots = [
                {"label": "Lunch", "slot_start": "12:00", "slot_end": "15:00"},
                {"label": "Dinner", "slot_start": "19:00", "slot_end": "23:00"},
            ]

            # effective assignments (se processed o anche solo override)
            assigns = get_effective_assignments(conn, week_start_iso)
            # indicizza per lookup rapido
            idx = {}
            for a in assigns:
                key = (a["day_iso"], a["slot_start"], a["slot_end"], a["skill"])
                idx.setdefault(key, []).append(
                    {"employee_id": a["employee_id"], "name": a["employee_name"]}
                )

            grid = []
            for day in days:
                for sl in slots:
                    for skill in skills:
                        key = (day, sl["slot_start"], sl["slot_end"], skill)
                        grid.append(
                            {
                                "day": day,
                                "slot_label": sl["label"],
                                "start": sl["slot_start"],
                                "end": sl["slot_end"],
                                "skill": skill,
                                "required": int(need.get(skill, 0)),
                                "assigned": idx.get(key, []),
                            }
                        )

            return {
                "ok": True,
                "week_start": week_start_iso,
                "processed": processed,
                "skills": skills,
                "grid": grid,
            }

    # ---- overrides: assign/unassign/move (drag&drop) ----
    def schedule_assign(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        # payload: week_start, day, start, end, skill, employee_id
        with get_conn(self._db_path) as conn:
            insert_override(
                conn,
                payload["week_start"],
                payload["day"],
                payload["start"],
                payload["end"],
                payload["skill"],
                int(payload["employee_id"]),
                "add",
                note="ui-assign",
            )
        return {"ok": True}

    def schedule_unassign(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        # payload: week_start, day, start, end, skill, employee_id
        with get_conn(self._db_path) as conn:
            insert_override(
                conn,
                payload["week_start"],
                payload["day"],
                payload["start"],
                payload["end"],
                payload["skill"],
                int(payload["employee_id"]),
                "remove",
                note="ui-unassign",
            )
        return {"ok": True}

    def schedule_move(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        payload:
        {
          week_start,
          from: {day,start,end,skill,employee_id},
          to:   {day,start,end,skill}
        }
        """
        week = payload["week_start"]
        f = payload["from"]
        t = payload["to"]

        emp_id = int(f["employee_id"])

        with get_conn(self._db_path) as conn:
            # remove old
            insert_override(conn, week, f["day"], f["start"], f["end"], f["skill"], emp_id, "remove", note="ui-move")
            # add new
            insert_override(conn, week, t["day"], t["start"], t["end"], t["skill"], emp_id, "add", note="ui-move")

        return {"ok": True}

    # ---- export ----
    def schedule_export_excel(self, week_start_iso: str) -> Dict[str, Any]:
        out_path = str(self._exports_dir / f"turni_{week_start_iso}.xlsx")
        with get_conn(self._db_path) as conn:
            export_schedule_excel(conn, week_start_iso, out_path)
        return {"ok": True, "path": out_path}
