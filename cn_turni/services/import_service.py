# cn_turni/services/import_service.py
from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta
from typing import Any, Optional

import re

from cn_turni.db import week_id_from_ui_weekkey
from .auto_scheduler import Employee, PermanentSettings, BalanceWarning, build_plan, ROLES, _allowed_by_work_days
from .csv_availability import DayAvailability, norm_name, parse_availability_csv
from .swap_optimizer import two_opt_swap
from .skill_upgrade import skill_upgrade_pass


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
                end = end_h + 1
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

                start_h = it.get("start_hour")
                end_h = it.get("end_hour")  # 24 = CHIUSURA
                if start_h is None or end_h is None:
                    continue
                start_h = int(start_h)
                end_h = int(end_h)
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
                weekly_hours_target=int(r["weekly_hours_target"]) if r.get("weekly_hours_target") is not None else None,
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
        perm_ids_set = {p.employee_id for p in perm_settings}

        # 9) squads need (USA week_id) — chiavi normalizzate a int per coerenza con enumerate()
        squads_need = {int(k): v for k, v in (self.db.squads_week_get(week_id) or {}).items()}
        # FIX: il CSV può partire da martedì.
        # Non schedulare giorni che non esistono nel CSV, altrimenti i permanenti
        # vengono usati su giorni fantasma e consumano ore prima del weekend.
        csv_days_set = set(all_days)

        for i, iso_day in enumerate(week_days_iso):
            if iso_day not in csv_days_set:
                squads_need[i] = {
                    "morning": {},
                    "evening": {},
                }

        # 8.5) remap availability keys (CSV nicknames/alias) -> canonical DB full-name keys
        availability_for_sched = self._remap_availability_to_canonical_keys(availability, emp_rows, name_to_id)

        plan, deficits, balance_warnings = build_plan(
            week_days_iso=week_days_iso,
            employees=employees,
            permanent_settings=perm_settings,
            availability=availability_for_sched,
            squads_need=squads_need,
        )

        # 10) salva overrides in un'unica transazione atomica
        MORNING_LABELS = _half_hours(8, 16)
        EVENING_LABELS = _half_hours(16, 24)

        all_override_items: list[dict] = []

        for day_index, slots in (plan or {}).items():
            iso_day = week_days_iso[int(day_index)]

            for slot_name, roles_map in (slots or {}).items():
                labels = MORNING_LABELS if slot_name == "morning" else EVENING_LABELS

                for role, emp_ids in (roles_map or {}).items():
                    # stabilizza ordine e rimuove duplicati preservando ordine
                    emp_ids = list(dict.fromkeys(emp_ids or []))

                    # pre-calcola quante mezz'ore max per dipendente in questo giorno/slot
                    emp_max_halfhours: dict[int, int] = {}
                    for eid in emp_ids:
                        emp = emp_by_id.get(int(eid))
                        if emp and emp.max_daily_hours is not None:
                            emp_max_halfhours[emp.id] = round(emp.max_daily_hours * 2)

                    # trova la prima mezz'ora disponibile nel CSV per ogni dipendente
                    emp_first_available: dict[int, Optional[str]] = {}
                    for eid in emp_ids:
                        emp = emp_by_id.get(int(eid))
                        if not emp or emp.id not in emp_max_halfhours:
                            continue
                        for t in labels:
                            if self._is_available_label(availability_for_sched, emp.name, iso_day, t, emp.is_permanent or emp.id in perm_ids_set):
                                emp_first_available[emp.id] = t
                                break

                    emp_halfhour_count: dict[int, int] = {}

                    for t in labels:
                        filtered: list[int] = []
                        for eid in emp_ids:
                            emp = emp_by_id.get(int(eid))
                            if not emp:
                                continue
                            if emp.id in emp_max_halfhours:
                                first = emp_first_available.get(emp.id)
                                if first is None:
                                    continue
                                if labels.index(t) < labels.index(first):
                                    continue
                                used = emp_halfhour_count.get(emp.id, 0)
                                if used >= emp_max_halfhours[emp.id]:
                                    continue
                            if self._is_available_label(availability_for_sched, emp.name, iso_day, t, emp.is_permanent or emp.id in perm_ids_set):
                                filtered.append(emp.id)
                                if emp.id in emp_max_halfhours:
                                    emp_halfhour_count[emp.id] = emp_halfhour_count.get(emp.id, 0) + 1

                        if filtered:
                            all_override_items.append({
                                "day_index": int(day_index),
                                "role": str(role),
                                "time_label": t,
                                "employee_ids": filtered,
                            })
        # 10b) FIX: riempi buchi reali sulle singole mezz'ore.
        # Lo scheduler lavora ancora su macro-slot morning/evening.
        # Qui invece controlliamo ogni time_label reale: se manca qualcuno,
        # scegliamo tra i disponibili in quella mezz'ora.
        by_cell: dict[tuple[int, str, str], list[int]] = {}
        busy_by_time: dict[tuple[int, str], set[int]] = {}
        daily_halfhours: dict[tuple[int, int], int] = {}

        for item in all_override_items:
            d = int(item["day_index"])
            role = str(item["role"])
            t = str(item["time_label"])
            ids = [int(x) for x in (item.get("employee_ids") or [])]

            by_cell[(d, t, role)] = list(dict.fromkeys(ids))
            busy_by_time.setdefault((d, t), set()).update(ids)

            for eid in ids:
                daily_halfhours[(eid, d)] = daily_halfhours.get((eid, d), 0) + 1

        def _role_skill(emp: Employee, role_name: str) -> int:
            return int((emp.skills or {}).get(role_name, 0) or 0)

        def _can_use_on_time(emp: Employee, d: int, iso_day: str, slot_name: str, role_name: str, t: str) -> bool:
            if _role_skill(emp, role_name) <= 0:
                return False

            if slot_name == "morning" and not emp.slot_morning:
                return False
            if slot_name == "evening" and not emp.slot_evening:
                return False

            if not _allowed_by_work_days(emp, d):
                return False

            if not self._is_available_label(
                    availability_for_sched,
                    emp.name,
                    iso_day,
                    t,
                    emp.is_permanent or emp.id in perm_ids_set,
            ):
                return False

            if emp.id in busy_by_time.get((d, t), set()):
                return False

            if emp.max_daily_hours is not None:
                max_halfhours = round(float(emp.max_daily_hours) * 2)
                if daily_halfhours.get((emp.id, d), 0) >= max_halfhours:
                    return False

            if emp.weekly_hours_target is not None:
                weekly_hh = sum(daily_halfhours.get((emp.id, dd), 0) for dd in range(7))
                if weekly_hh / 2.0 >= emp.weekly_hours_target:
                    return False

            return True

        # ── RIEMPIMENTO con scoring a costo opportunità ──
        # Per ogni (day, time_label), i ruoli scoperti vengono assegnati in ordine
        # di scarsità (meno candidati disponibili → precedenza più alta).
        # Il candidato viene scelto con preservation_margin:
        #   margin = skill sul ruolo corrente − miglior skill sui ruoli ancora scoperti
        # I forti finiscono dove sono più insostituibili; i deboli coprono i buchi rimanenti.

        for d, iso_day in enumerate(week_days_iso):
            day_need = squads_need.get(d, {}) or {}

            for slot_name, labels in [("morning", MORNING_LABELS), ("evening", EVENING_LABELS)]:
                slot_need = day_need.get(slot_name, {}) or {}

                for t in labels:
                    open_roles: dict[str, int] = {}
                    for role in ROLES:
                        required = int(slot_need.get(role, 0) or 0)
                        if required <= 0:
                            continue
                        still = required - len(by_cell.get((d, t, role), []))
                        if still > 0:
                            open_roles[role] = still

                    if not open_roles:
                        continue

                    # conta candidati validi per ogni ruolo (snapshot iniziale per la scarsità)
                    role_cand_count: dict[str, int] = {
                        role: sum(
                            1 for emp in employees
                            if _can_use_on_time(emp, d, iso_day, slot_name, role, t)
                            and emp.id not in by_cell.get((d, t, role), [])
                        )
                        for role in open_roles
                    }

                    # ordina: prima i ruoli con meno candidati, poi quelli più urgenti (required alto)
                    roles_sorted = sorted(
                        open_roles.keys(),
                        key=lambda r: (role_cand_count.get(r, 0), -open_roles[r]),
                    )

                    for role in roles_sorted:
                        still_needed = open_roles.get(role, 0)
                        if still_needed <= 0:
                            continue

                        # candidati aggiornati: rispetta busy modificato dalle assegnazioni precedenti in questo t
                        candidates = [
                            emp for emp in employees
                            if _can_use_on_time(emp, d, iso_day, slot_name, role, t)
                            and emp.id not in by_cell.get((d, t, role), [])
                        ]

                        other_open = [r for r in open_roles if r != role and open_roles[r] > 0]

                        def _opp_score(emp: Employee, _role=role, _other=other_open, _t=t) -> tuple:
                            rs = _role_skill(emp, _role)
                            best_other = max((_role_skill(emp, r) for r in _other), default=0)
                            margin = rs - best_other
                            # continuità adiacente: quante delle due mezz'ore vicine (prima/dopo)
                            # l'emp è già assegnato sullo stesso ruolo/giorno.
                            # Vale 0-2; favorisce chi *estende* un blocco continuo, non chi è sparso.
                            h, m = map(int, _t.split(':'))
                            hidx = h * 2 + (1 if m == 30 else 0)
                            def _hl(i: int) -> str:
                                return f"{i // 2:02d}:{'30' if i % 2 else '00'}"
                            extends_back = hidx > 16 and emp.id in by_cell.get((d, _hl(hidx - 1), _role), [])
                            extends_fwd  = hidx < 47 and emp.id in by_cell.get((d, _hl(hidx + 1), _role), [])
                            continuity = int(extends_back) + int(extends_fwd)
                            preferred = 1 if emp.preferred_role == _role else 0
                            weekly_hh = sum(daily_halfhours.get((emp.id, dd), 0) for dd in range(7))
                            daily_hh = daily_halfhours.get((emp.id, d), 0)
                            return (margin, rs, continuity, preferred, -weekly_hh, -daily_hh)

                        candidates.sort(key=_opp_score, reverse=True)

                        for emp in candidates[:still_needed]:
                            cell = by_cell.setdefault((d, t, role), [])
                            if emp.id not in cell:
                                cell.append(emp.id)
                            busy_by_time.setdefault((d, t), set()).add(emp.id)
                            daily_halfhours[(emp.id, d)] = daily_halfhours.get((emp.id, d), 0) + 1
                            open_roles[role] = max(0, open_roles[role] - 1)

        # ── Skill-upgrade pass ──
        def _is_avail_for_upgrade(emp: Employee, d: int, t: str) -> bool:
            slot_name = "morning" if int(t.split(":")[0]) < 16 else "evening"
            if slot_name == "morning" and not emp.slot_morning:
                return False
            if slot_name == "evening" and not emp.slot_evening:
                return False
            if not _allowed_by_work_days(emp, d):
                return False
            if not self._is_available_label(
                    availability_for_sched, emp.name, week_days_iso[d], t,
                    emp.is_permanent or emp.id in perm_ids_set):
                return False
            if emp.max_daily_hours is not None:
                if daily_halfhours.get((emp.id, d), 0) >= round(float(emp.max_daily_hours) * 2):
                    return False
            if emp.weekly_hours_target is not None:
                weekly_hh = sum(daily_halfhours.get((emp.id, dd), 0) for dd in range(7))
                if weekly_hh / 2.0 >= emp.weekly_hours_target:
                    return False
            return True

        _upgrade_count = skill_upgrade_pass(
            by_cell=by_cell,
            emp_by_id=emp_by_id,
            employees=employees,
            busy_by_time=busy_by_time,
            daily_halfhours=daily_halfhours,
            squads_need=squads_need,
            is_available=_is_avail_for_upgrade,
        )
        if _upgrade_count:
            print(f"[SkillUpgrade] {_upgrade_count} rimpiazzi di qualità applicati", flush=True)

        # ── 2-opt swap post-assegnazione ──
        _swap_count, _swap_gain = two_opt_swap(by_cell=by_cell, emp_by_id=emp_by_id)
        if _swap_count:
            print(f"[2-opt] {_swap_count} swap applicati, guadagno skill totale={_swap_gain:.0f}", flush=True)

        all_override_items = [
            {
                "day_index": d,
                "role": role,
                "time_label": t,
                "employee_ids": ids,
            }
            for (d, t, role), ids in by_cell.items()
            if ids
        ]
        saved_count = self.db.overrides_bulk_save(week_id, all_override_items)
        print(f"[AutoSchedule] Salvati {saved_count} slot -> week_id={week_id} (week_key={week_key})", flush=True)

        availability_preview = self._build_availability_preview(
            availability=availability_for_sched,
            week_days_iso=week_days_iso,
            name_to_id=name_to_id,
            emp_rows=emp_rows,
        )

        return {
            "ok": True,
            "deficits": [asdict(d) for d in deficits],
            "balance_warnings": [asdict(w) for w in balance_warnings],
            "week_key_used": week_key,
            "week_id_used": week_id,
            "availability_preview": availability_preview,
        }
