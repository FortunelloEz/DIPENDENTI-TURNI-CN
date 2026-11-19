# cn_turni/api.py
from __future__ import annotations

from typing import Any, Dict, List, Optional
from cn_turni.services.import_service import ImportService
from cn_turni.db import Db, default_db_path, week_id_from_ui_weekkey
from cn_turni.services.export_service import build_week_export, build_week_export_simple
from cn_turni.services.pdf_export import build_pdf_from_export, build_pdf_from_export_simple
from cn_turni.services.excel_export import build_excel_from_export, build_excel_from_export_simple
import webview
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

    # =========================
    # Gemini API Key (cifrata in DB)
    # =========================
    def gemini_key_get(self) -> Optional[str]:
        return self.db.gemini_key_get()

    def gemini_key_set(self, api_key: str) -> Dict[str, Any]:
        self.db.gemini_key_set(str(api_key))
        return {"ok": True}

    def gemini_key_delete(self) -> Dict[str, Any]:
        self.db.gemini_key_delete()
        return {"ok": True}

    # =========================
    # Settings generici (non cifrati)
    # =========================
    def settings_get(self, key: str) -> Optional[str]:
        return self.db.settings_get(str(key))

    def settings_set(self, key: str, value: str) -> Dict[str, Any]:
        self.db.settings_set(str(key), str(value))
        return {"ok": True}

    # =========================
    # Availability Cache
    # =========================
    def availability_save(self, week_key: str, preview_json: str) -> Dict[str, Any]:
        week_id = week_id_from_ui_weekkey(week_key)
        self.db.availability_save(week_id, str(preview_json))
        return {"ok": True}

    def availability_get(self, week_key: str) -> Dict[str, Any]:
        week_id = week_id_from_ui_weekkey(week_key)
        return self.db.availability_get(week_id)

    def availability_clear(self, week_key: str) -> Dict[str, Any]:
        week_id = week_id_from_ui_weekkey(week_key)
        self.db.availability_clear(week_id)
        return {"ok": True}

    def import_detect_week(self, week_key: str, csv_text: str) -> Optional[str]:
        """Settimana (lunedì, YYYY-MM-DD) che l'import userà per questo CSV."""
        return self.import_service.detect_week_key(week_key, csv_text)

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

    def overrides_copy_week(self, from_week_key: str, to_week_key: str) -> dict:
        from_week_id = week_id_from_ui_weekkey(from_week_key)
        to_week_id = week_id_from_ui_weekkey(to_week_key)
        count = self.db.overrides_copy_week(from_week_id, to_week_id)
        return {"ok": True, "copied": count}

    def overrides_save_slot(self, week_key: str, day_index: int, time_labels, role_ids) -> Dict[str, Any]:
        week_id = week_id_from_ui_weekkey(week_key)
        self.db.overrides_save_slot(week_id, int(day_index), list(time_labels or []), dict(role_ids or {}))
        return {"ok": True}

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

    def _save_dialog(self, save_filename: str, file_types: tuple) -> str | None:
        window = webview.windows[0]
        result = window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=save_filename,
            file_types=file_types,
        )
        return result[0] if result else None

    def export_week_pdf_save_dialog(self, week_key: str) -> dict:
        export = build_week_export(self.db, week_key)
        pdf_bytes = build_pdf_from_export(export)
        path = self._save_dialog(f"Export_{week_key}.pdf", ("PDF (*.pdf)",))
        if not path:
            return {"saved": False}
        with open(path, "wb") as f:
            f.write(pdf_bytes)
        return {"saved": True, "path": path}

    def export_week_simple_pdf_save_dialog(self, week_key: str) -> dict:
        export = build_week_export_simple(self.db, week_key)
        pdf_bytes = build_pdf_from_export_simple(export)
        path = self._save_dialog(f"Export_semplificato_{week_key}.pdf", ("PDF (*.pdf)",))
        if not path:
            return {"saved": False}
        with open(path, "wb") as f:
            f.write(pdf_bytes)
        return {"saved": True, "path": path}

    def export_week_excel_save_dialog(self, week_key: str) -> dict:
        export = build_week_export(self.db, week_key)
        xlsx_bytes = build_excel_from_export(export)
        path = self._save_dialog(f"Export_{week_key}.xlsx", ("Excel (*.xlsx)",))
        if not path:
            return {"saved": False}
        with open(path, "wb") as f:
            f.write(xlsx_bytes)
        return {"saved": True, "path": path}

    def export_week_simple_excel_save_dialog(self, week_key: str) -> dict:
        export = build_week_export_simple(self.db, week_key)
        xlsx_bytes = build_excel_from_export_simple(export)
        path = self._save_dialog(f"Export_semplificato_{week_key}.xlsx", ("Excel (*.xlsx)",))
        if not path:
            return {"saved": False}
        with open(path, "wb") as f:
            f.write(xlsx_bytes)
        return {"saved": True, "path": path}
    # =========================
    # Imported Files (lista CSV caricati)
    # =========================
    def imported_files_list(self) -> List[Dict[str, Any]]:
        return self.db.imported_files_list()

    def imported_files_open_dialog(self) -> dict:
        result = webview.windows[0].create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=("CSV (*.csv)", "Tutti i file (*.*)")
        )
        if not result:
            return {"ok": False, "cancelled": True}
        path = result[0]
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