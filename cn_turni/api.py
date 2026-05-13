# cn_turni/api.py
from __future__ import annotations

from typing import Any, Dict, List, Optional
from cn_turni.services.import_service import ImportService
from cn_turni.db import Db, default_db_path, week_id_from_ui_weekkey
from cn_turni.services.export_service import build_week_export
from cn_turni.services.pdf_export import build_pdf_from_export
from tkinter import Tk, filedialog
import base64
import os

class Api:
    def __init__(self, db_path: Optional[str] = None):
        # compatibile con main.py che fa Api()
        self.db = Db(db_path or default_db_path())
        # retention safety (anche se la fai in main non rompe)
        self.db.purge_old_weeks(months=6)
        self.import_service = ImportService(self.db)
    # =========================
    # Day Type Presets
    # =========================
    def day_type_presets_get(self):
        return self.db.day_type_presets_get()

    def day_type_presets_set(self, payload: dict):
        self.db.day_type_presets_set(payload)
        return {"ok": True}

    def day_type_assignments_get(self):
        return self.db.day_type_assignments_get()

    def day_type_assignments_set(self, day_index: int, type_name: str):
        self.db.day_type_assignments_set(day_index, type_name)
        return {"ok": True}

    def ping(self) -> Dict[str, Any]:
        return {"ok": True}
    def import_availability_and_autofill(
            self,
            week_key: str,
            csv_text: str,
            resolutions: Optional[List[Dict[str, Any]]] = None,
            custom_resolutions: Optional[List[Dict[str, Any]]] = None,
    ):
        return self.import_service.import_availability_and_autofill(
            week_key, csv_text, resolutions, custom_resolutions
        )



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

    def employees_bulk_set_skill(self, role: str, value: int) -> Dict[str, Any]:
        count = self.db.employees_bulk_set_skill(role, value)
        return {"ok": True, "updated": count}
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

    def squads_template_save(self, name: str, payload: dict):
        self.db.squads_template_save(name, payload)
        return {"ok": True}

    def squads_template_list(self):
        return self.db.squads_template_list()

    def squads_template_get(self, name: str):
        return self.db.squads_template_get(name)

    def squads_template_delete(self, name: str) -> Dict[str, Any]:
        self.db.squads_template_delete(name)
        return {"ok": True}
    def export_week(self, week_key: str):
        return build_week_export(self.db, week_key)

    def export_week_pdf_base64(self, week_key: str):
        export = build_week_export(self.db, week_key)
        pdf_bytes = build_pdf_from_export(export)
        return base64.b64encode(pdf_bytes).decode("ascii")

    def export_week_pdf_save_dialog(self, week_key: str) -> dict:
        export = build_week_export(self.db, week_key)
        pdf_bytes = build_pdf_from_export(export)

        # popup Windows
        root = Tk()
        root.withdraw()

        path = filedialog.asksaveasfilename(
            title="Salva PDF settimana",
            defaultextension=".pdf",
            filetypes=[("PDF files", "*.pdf")],
            initialfile=f"Export_{week_key}.pdf"
        )

        root.destroy()

        if not path:
            return {"saved": False}

        with open(path, "wb") as f:
            f.write(pdf_bytes)

        return {"saved": True, "path": path}
    # =========================
    # Imported Files (lista CSV caricati)
    # =========================
    def imported_files_list(self) -> List[Dict[str, Any]]:
        return self.db.imported_files_list()

    def imported_files_open_dialog(self) -> dict:
        """Apre il picker Windows e restituisce path + filename. Nessun salvataggio ancora."""
        root = Tk()
        root.withdraw()
        root.lift()
        root.attributes("-topmost", True)
        path = filedialog.askopenfilename(
            title="Seleziona file CSV disponibilità",
            filetypes=[("CSV files", "*.csv"), ("Tutti i file", "*.*")]
        )
        root.destroy()
        if not path:
            return {"ok": False, "cancelled": True}
        return {"ok": True, "path": path, "filename": os.path.basename(path)}

    def imported_files_add(self, filename: str, file_path: str, week_key: str) -> int:
        return self.db.imported_files_add(str(filename), str(file_path), str(week_key))

    def imported_files_get_content(self, file_id: int) -> dict:
        return self.db.imported_files_get_content(int(file_id))

    def imported_files_delete(self, file_id: int) -> None:
        self.db.imported_files_delete(int(file_id))

    def imported_files_clear(self) -> None:
        self.db.imported_files_clear()

    def imported_files_read_path(self, file_path: str) -> dict:
        """Legge il contenuto di un file CSV da path assoluto."""
        if not os.path.isfile(file_path):
            return {"ok": False, "error": f"File non trovato: {file_path}"}
        try:
            with open(file_path, "r", encoding="utf-8-sig") as f:
                return {"ok": True, "csv_text": f.read()}
        except Exception as e:
            return {"ok": False, "error": str(e)}