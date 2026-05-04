# cn_turni/services/import_service.py
from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta
from typing import Any, Optional

import re

from cn_turni.db import week_id_from_ui_weekkey
from .auto_scheduler import Employee, PermanentSettings, build_plan
from .csv_availability import DayAvailability, norm_name, parse_availability_csv


def _monday_of_iso(iso_day: str) -> str:
    d = date.fromisoformat(iso_day)
    monday = d - timedelta(days=d.weekday())  # Monday=0 ... Sunday=6
    return monday.isoformat()


def _half_hours(start_h: int, end_h: int) -> list[str]:
    out: list[str] = []
    for h in range(start_h, end_h):
        out.append(f"{h:02d}:00")
        out.append(f"{h:02d}:30")
    return out


def _week_days_iso_from_week_key(week_key: str) -> list[str]:
    d0 = date.fromisoformat(week_key)
    return [(d0 + timedelta(days=i)).isoformat() for i in range(7)]


class ImportService:
    def __init__(self, db: Any):
        self.db = db

    # ---- Availability helpers ----
    def _is_available_label(self, availability: dict, emp_name: str, iso_day: str, time_label: str, is_permanent: bool) -> bool:
        """
        Policy richiesta:
        - Se il dipendente NON è presente nel CSV per quel giorno -> NON disponibile,
          *tranne* gli indeterminati (is_permanent=True) che consideriamo disponibili di default.
        - Se è presente nel CSV:
            - labels vuote (es. 'NON DISPONIBILE') -> non disponibile
            - labels presenti -> disponibile solo su quelle mezz'ore
        """
        key = norm_name(emp_name)
        day = (availability or {}).get(key, {}).get(iso_day)
        if not day:
            return bool(is_permanent)

        labels = getattr(day, "labels", set()) or set()
        return time_label in labels

    def _collect_custom_cells(self, availability: dict) -> list[dict]:
        # availability: {CSV_NAME_NORM -> {ISO_DAY -> DayAvailability}}
        custom_cells: list[dict] = []
        for csv_name, days_map in (availability or {}).items():
            for iso_day, day_av in (days_map or {}).items():
                if getattr(day_av, "needs_resolution", False):
                    custom_cells.append({
                        "csv_name": csv_name,
                        "iso_day": iso_day,
                        "raw_text": getattr(day_av, "raw", "") or "",
                    })
        return custom_cells

    def _remap_availability_to_canonical_keys(self, availability: dict, emp_rows: list[dict], name_to_id: dict) -> dict:
        """
        Il CSV può usare soprannomi (es. "DANNY", "STANI").
        Lo scheduler però lookup-a availability con la chiave basata su Employee.name (nome completo dal DB).

        Qui normalizziamo/ri-mappiamo:
        - per ogni chiave CSV -> troviamo employee_id tramite name_to_id (alias inclusi)
        - usiamo come chiave canonical: norm_name(employee.name) (nome completo DB)
        - merge delle labels se per lo stesso employee arrivano più chiavi (alias multipli)
        """
        if not availability:
            return {}

        id_to_empname = {int(r["id"]): str(r["name"]) for r in (emp_rows or [])}

        canonical: dict[str, dict] = {}
        for csv_key, days_map in availability.items():
            emp_id = name_to_id.get(norm_name(csv_key))
            if not emp_id:
                # non risolto: lo ignoriamo (verrà gestito prima con "unknown")
                continue

            canon_key = norm_name(id_to_empname.get(int(emp_id), csv_key))
            tgt = canonical.setdefault(canon_key, {})

            for iso_day, day_av in (days_map or {}).items():
                existing = tgt.get(iso_day)
                if not existing:
                    tgt[iso_day] = day_av
                else:
                    # merge labels (union)
                    existing.labels |= getattr(day_av, "labels", set()) or set()

        return canonical


    def _build_availability_preview(self, availability: dict, week_days_iso: list[str], name_to_id: dict, emp_rows: list[dict]) -> dict:
        """
        Preview per UI (NON il calendario): mostra solo chi ha scritto disponibilità nel CSV,
        convertendo labels in un range compatto (start-end).
        """
        id_to_label = {int(r["id"]): str(r["name"]) for r in (emp_rows or [])}

        days = []
        for i, iso_day in enumerate(week_days_iso):
            items = []
            for csv_name_norm, by_day in (availability or {}).items():
                day_av = (by_day or {}).get(iso_day)
                if not day_av:
                    continue
                labels = getattr(day_av, "labels", set()) or set()
                if not labels:
                    continue

                emp_id = name_to_id.get(csv_name_norm)
                if not emp_id:
                    continue

                name = id_to_label.get(int(emp_id), csv_name_norm.title())

                lab_sorted = sorted(labels)
                start = lab_sorted[0]        # es "16:00"
                end_last = lab_sorted[-1]    # es "23:30"
                end_h = int(end_last.split(":")[0])
                end_m = int(end_last.split(":")[1])
                end = (end_h + 1) if end_m == 30 else end_h
                start_h = int(start.split(":")[0])

                items.append({"name": name, "range": f"{start_h:02d}-{end:02d}"})

            days.append({
                "day_index": i,
                "iso_day": iso_day,
                "items": sorted(items, key=lambda x: x["name"].lower()),
            })

        return {"days": days}

    # ---- Main entrypoint ----
    def import_availability_and_autofill(self, week_key: str, csv_text: str, resolutions=None, custom_resolutions=None):
        ui_year = date.fromisoformat(week_key).year

        # 1) employees dal DB
        emp_rows = self.db.employees_list()

        # 2) mappa nome/alias (normalizzati) -> employee_id
        name_to_id: dict[str, int] = {}
        for r in emp_rows:
            emp_id = int(r["id"])
            name_to_id[norm_name(r["name"])] = emp_id

            aliases = (r.get("aliases") or "").strip()
            if aliases:
                for a in re.split(r"[|,;]+", aliases):
                    a_norm = norm_name(a)
                    if a_norm:
                        name_to_id[a_norm] = emp_id

        # 3) parse CSV
        availability = parse_availability_csv(csv_text, year=ui_year)

        # custom cells (stringhe non interpretabili)
        custom_cells = self._collect_custom_cells(availability)

        # --- determina la settimana dal CSV (prima data presente) ---
        all_days: list[str] = []
        for _name, days_map in (availability or {}).items():
            all_days.extend(list((days_map or {}).keys()))

        if not all_days:
            return {"ok": False, "error": "CSV vuoto o senza colonne data valide."}

        csv_first_day = sorted(set(all_days))[0]     # es: 2026-01-09
        csv_week_key = _monday_of_iso(csv_first_day) # lunedì di quella settimana

        week_key = csv_week_key
        week_id = week_id_from_ui_weekkey(week_key)

        week_days_iso = _week_days_iso_from_week_key(week_key)

        csv_names = list((availability or {}).keys())
        unknown = [n for n in csv_names if norm_name(n) not in name_to_id]

        # 4) se ci sono unknown e non ho risoluzioni => chiedo alla UI
        if unknown and not resolutions:
            return {
                "ok": False,
                "needs_resolution": True,
                "unknown": unknown,
                "employees": [{"id": int(r["id"]), "name": str(r["name"])} for r in emp_rows],
            }

        # 4b) se ci sono celle custom e non ho ancora custom_resolutions => chiedo alla UI
        if custom_cells and not custom_resolutions:
            return {
                "ok": False,
                "needs_custom_slot_resolution": True,
                "custom_cells": custom_cells,
                "employees": [{"id": int(r["id"]), "name": str(r["name"])} for r in emp_rows],
            }

        # 5) se arrivano resolutions => applicale (create / alias)
        if unknown and resolutions:
            emp_by_id = {int(r["id"]): r for r in emp_rows}

            for it in resolutions:
                csv_name_raw = it.get("csv_name") or ""
                csv_name = norm_name(csv_name_raw)
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

                    norm_parts = {norm_name(p) for p in parts}
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

            # ricarico emp_rows perché posso aver creato dipendenti nuovi
            emp_rows = self.db.employees_list()

            # ri-parse perché le custom_cells potrebbero dipendere da risoluzioni
            availability = parse_availability_csv(csv_text, year=ui_year)
            custom_cells = self._collect_custom_cells(availability)

            if custom_cells and not custom_resolutions:
                return {
                    "ok": False,
                    "needs_custom_slot_resolution": True,
                    "custom_cells": custom_cells,
                    "employees": [{"id": int(r["id"]), "name": str(r["name"])} for r in emp_rows],
                }

            csv_names = list((availability or {}).keys())
            unknown = [n for n in csv_names if norm_name(n) not in name_to_id]
            if unknown:
                return {
                    "ok": False,
                    "needs_resolution": True,
                    "unknown": unknown,
                    "employees": [{"id": int(r["id"]), "name": str(r["name"])} for r in emp_rows],
                }

        # 6) Applica custom_resolutions (sovrascrive availability per quelle celle)
        if custom_resolutions:
            for it in custom_resolutions:
                csv_name = norm_name(it.get("csv_name") or "")
                iso_day = (it.get("iso_day") or "").strip()
                if not csv_name or not iso_day:
                    continue

                if bool(it.get("unavailable")):
                    availability.setdefault(csv_name, {})[iso_day] = DayAvailability(set())
                    continue

                start_h = int(it.get("start_hour"))
                end_h = int(it.get("end_hour"))  # 24 = CHIUSURA
                labels = set(_half_hours(start_h, end_h))
                availability.setdefault(csv_name, {})[iso_day] = DayAvailability(labels)

        # 7) costruisco lista employees (planner lavora sugli employee del DB)
        employees = [
            Employee(
                id=int(r["id"]),
                name=str(r["name"]),
                is_permanent=(int(r.get("is_permanent", 0) or 0) == 1),
                preferred_role=r.get("preferred_role"),
                slot_morning=int(r.get("slot_morning", 1) or 0),
                slot_evening=int(r.get("slot_evening", 1) or 0),
                skills=r.get("skills") or {},
                work_days=str(r.get("work_days") or ""),
                max_daily_hours=r.get("max_daily_hours"),
            )
            for r in emp_rows
        ]
        emp_by_id = {e.id: e for e in employees}

        # 8) permanents settings (USA week_id)
        perm_rows = self.db.permanent_week_get(week_id)
        perm_settings = [
            PermanentSettings(
                employee_id=int(r["employee_id"]),
                day_off=(None if r.get("day_off") is None else int(r["day_off"])),
                target_hours=int(r.get("target_hours", 40) or 40),
            )
            for r in perm_rows
        ]

        # 9) squads need (USA week_id)
        squads_need = self.db.squads_week_get(week_id)


        # 8.5) remap availability keys (CSV nicknames/alias) -> canonical DB full-name keys
        availability_for_sched = self._remap_availability_to_canonical_keys(availability, emp_rows, name_to_id)

        plan, deficits = build_plan(
            week_days_iso=week_days_iso,
            employees=employees,
            permanent_settings=perm_settings,
            availability=availability_for_sched,
            squads_need=squads_need,
        )

        # 10) salva overrides (calendario)
        self.db.overrides_clear_week(week_id)

        MORNING_LABELS = _half_hours(8, 16)
        EVENING_LABELS = _half_hours(16, 24)

        for day_index, slots in (plan or {}).items():
            iso_day = week_days_iso[int(day_index)]

            for slot_name, roles_map in (slots or {}).items():
                labels = MORNING_LABELS if slot_name == "morning" else EVENING_LABELS

                for role, emp_ids in (roles_map or {}).items():
                    # stabilizza ordine e rimuove duplicati preservando ordine
                    emp_ids = list(dict.fromkeys(emp_ids or []))

                    # pre-calcola quante mezz'ore max per dipendente in questo giorno/slot
                    # max_daily_hours -> numero di mezz'ore = max_daily_hours * 2
                    # le mezz'ore partono sempre dall'inizio dello slot
                    emp_max_halfhours: dict[int, int] = {}
                    for eid in emp_ids:
                        emp = emp_by_id.get(int(eid))
                        if emp and emp.max_daily_hours is not None:
                            emp_max_halfhours[emp.id] = round(emp.max_daily_hours * 2)

                    # trova la prima mezz'ora disponibile nel CSV per ogni dipendente
                    # (da lì parte il conteggio del limite)
                    emp_first_available: dict[int, Optional[str]] = {}
                    for eid in emp_ids:
                        emp = emp_by_id.get(int(eid))
                        if not emp or emp.id not in emp_max_halfhours:
                            continue
                        for t in labels:
                            if self._is_available_label(availability_for_sched, emp.name, iso_day, t, emp.is_permanent):
                                emp_first_available[emp.id] = t
                                break

                    # contatore mezz'ore assegnate per dipendente da quando è iniziato il suo turno
                    emp_halfhour_count: dict[int, int] = {}

                    items = []
                    for t in labels:
                        filtered: list[int] = []
                        for eid in emp_ids:
                            emp = emp_by_id.get(int(eid))
                            if not emp:
                                continue
                            # check limite ore: conta solo da quando il dipendente
                            # è disponibile per la prima volta in questo slot
                            if emp.id in emp_max_halfhours:
                                first = emp_first_available.get(emp.id)
                                if first is None:
                                    continue  # non disponibile in nessuna mezz'ora: salta
                                # prima della sua prima mezz'ora disponibile: non assegnare
                                if labels.index(t) < labels.index(first):
                                    continue
                                used = emp_halfhour_count.get(emp.id, 0)
                                if used >= emp_max_halfhours[emp.id]:
                                    continue
                            if self._is_available_label(availability_for_sched, emp.name, iso_day, t, emp.is_permanent):
                                filtered.append(emp.id)
                                if emp.id in emp_max_halfhours:
                                    emp_halfhour_count[emp.id] = emp_halfhour_count.get(emp.id, 0) + 1

                        items.append({"time_label": t, "employee_ids": filtered})
                    self.db.overrides_set_many(
                        week_id=week_id,
                        day_index=int(day_index),
                        role=str(role),
                        items=items,
                    )

        availability_preview = self._build_availability_preview(
            availability=availability_for_sched,
            week_days_iso=week_days_iso,
            name_to_id=name_to_id,
            emp_rows=emp_rows,
        )

        return {
            "ok": True,
            "deficits": [asdict(d) for d in deficits],
            "week_key_used": week_key,
            "week_id_used": week_id,
            "availability_preview": availability_preview,
        }
