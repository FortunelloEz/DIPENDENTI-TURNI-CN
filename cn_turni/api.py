# cn_turni/api.py
from __future__ import annotations

from typing import Any, Dict, List, Optional

from cn_turni.db import Db, default_db_path, week_id_from_ui_weekkey


class Api:
    def __init__(self, db_path: Optional[str] = None):
        # compatibile con main.py che fa Api()
        self.db = Db(db_path or default_db_path())
        # retention safety (anche se la fai in main non rompe)
        self.db.purge_old_weeks(months=6)

    def ping(self) -> Dict[str, Any]:
        return {"ok": True}

    # =========================
    # Employees
    # =========================
    def employees_list(self) -> List[Dict[str, Any]]:
        return self.db.employees_list()

    def employee_create(self, payload: Dict[str, Any]) -> int:
        return self.db.employee_create(payload)

    def employee_update(self, payload: Dict[str, Any]) -> None:
        self.db.employee_update(payload)

    def employee_delete(self, emp_id: int) -> None:
        self.db.employee_delete(int(emp_id))

    # =========================
    # Overrides (Calendario)
    # =========================
    def overrides_get_week(self, week_key: str) -> List[Dict[str, Any]]:
        week_id = week_id_from_ui_weekkey(week_key)
        return self.db.overrides_week_get(week_id)

    def overrides_set_many(self, week_key: str, day_index: int, role: str, items: List[Dict[str, Any]]) -> None:
        """
        items: [{time_label:"10:00", employee_ids:[1,2]}, ...]
        """
        week_id = week_id_from_ui_weekkey(week_key)
        self.db.overrides_set_many(
            week_id=week_id,
            day_index=int(day_index),
            role=str(role),
            items=items or [],
        )

    def overrides_clear_week(self, week_key: str) -> None:
        week_id = week_id_from_ui_weekkey(week_key)
        self.db.overrides_clear_week(week_id)

    # =========================
    # Squadre (Fabbisogni)
    # =========================
    def squads_get_week(self, week_key: str) -> Dict[str, Any]:
        week_id = week_id_from_ui_weekkey(week_key)
        return self.db.squads_week_get(week_id)

    def squads_set_week(self, week_key: str, data: Dict[str, Any]) -> None:
        """
        data: {"0":{"morning":{role:qty}, "evening":{...}}, ...}
        """
        week_id = week_id_from_ui_weekkey(week_key)
        self.db.squads_week_set(week_id, data or {})

    # =========================
    # Indeterminati (per-week params)
    # =========================
    def permanent_week_get(self, week_key: str) -> List[Dict[str, Any]]:
        week_id = week_id_from_ui_weekkey(week_key)
        return self.db.permanent_week_get(week_id)

    def permanent_week_set(self, week_key: str, items: List[Dict[str, Any]]) -> None:
        week_id = week_id_from_ui_weekkey(week_key)
        self.db.permanent_week_set(week_id, items or [])