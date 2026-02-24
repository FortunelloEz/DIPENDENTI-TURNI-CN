# cn_turni/services/auto_scheduler.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

ROLES = ["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"]


@dataclass
class Employee:
    id: int
    name: str
    is_permanent: bool
    preferred_role: Optional[str]
    slot_morning: int
    slot_evening: int
    skills: Dict[str, int]


@dataclass
class PermanentSettings:
    employee_id: int
    day_off: Optional[int]      # 0..6
    target_hours: int           # default 40


@dataclass
class NeedDeficit:
    day: int
    slot: str   # "morning" | "evening"
    role: str
    missing: int


# plan[day][slot][role] = [employee_id,...]
Plan = Dict[int, Dict[str, Dict[str, List[int]]]]


def _skill(emp: Employee, role: str) -> float:
    base = float(emp.skills.get(role, 0) or 0)
    bonus = 0.25 if emp.preferred_role == role else 0.0
    return base + bonus


def _best_role(emp: Employee) -> str:
    return max(ROLES, key=lambda r: _skill(emp, r))


def _is_available(availability: dict, emp_name: str, iso_day: str, slot: str) -> bool:
    """
    availability[name][iso_day] = {morning:bool, evening:bool}
    Se non presente nel CSV -> disponibile (tua regola 'a meno di indicazioni diverse').
    """
    key = " ".join(emp_name.strip().upper().split())
    day = availability.get(key, {}).get(iso_day)
    if not day:
        return True
    return bool(day.morning) if slot == "morning" else bool(day.evening)


def build_plan(
        *,
        week_days_iso: List[str],  # len=7 iso dates
        employees: List[Employee],
        permanent_settings: List[PermanentSettings],
        availability: dict,
        squads_need: dict,  # squads_need[day][slot][role] = int
) -> Tuple[Plan, List[NeedDeficit]]:
    perm_map = {p.employee_id: p for p in permanent_settings}
    permanents = [e for e in employees if e.is_permanent]
    temps = [e for e in employees if not e.is_permanent]
    squads_need = {int(k): v for k, v in (squads_need or {}).items()}

    plan: Plan = {d: {"morning": {}, "evening": {}} for d in range(7)}
    deficits: List[NeedDeficit] = []

    # ---- permanenti ----
    for emp in permanents:
        p = perm_map.get(emp.id, PermanentSettings(emp.id, None, 40))
        target_days = max(0, round((p.target_hours or 40) / 8))
        day_order = [d for d in range(7) if d != p.day_off]

        for d in range(7):
            if p.day_off == d:
                continue
            if d not in day_order[:target_days]:
                continue

            iso = week_days_iso[d]

            # slot: se CSV dice solo uno, segui; altrimenti default morning,
            # ma rispetta i flag slot_morning/slot_evening dell’anagrafica
            slot = "morning"
            key = " ".join(emp.name.strip().upper().split())
            av = availability.get(key, {}).get(iso)

            if av:
                if av.morning and not av.evening:
                    slot = "morning"
                elif av.evening and not av.morning:
                    slot = "evening"
                else:
                    # entrambi disponibili -> scegli un default valido
                    slot = "morning"
            if slot not in ("morning", "evening"):
                continue
            # rispetta configurazione dipendente
            if slot == "morning" and not emp.slot_morning:
                slot = "evening"
            if slot == "evening" and not emp.slot_evening:
                slot = "morning"

            if not _is_available(availability, emp.name, iso, slot):
                continue

            role = _best_role(emp)
            plan[d][slot].setdefault(role, [])
            if emp.id not in plan[d][slot][role]:
                plan[d][slot][role].append(emp.id)

    # ---- determinati: riempiono fabbisogno ----
    for d in range(7):
        iso = week_days_iso[d]
        for slot in ["morning", "evening"]:
            need = squads_need.get(d, {}).get(slot, {})
            # chi è già usato nello slot (in qualsiasi ruolo)
            used = set()
            for r in ROLES:
                for eid in plan[d][slot].get(r, []):
                    used.add(eid)

            for role in ROLES:
                required = int(need.get(role, 0) or 0)
                if required <= 0:
                    continue

                current = plan[d][slot].setdefault(role, [])
                missing = required - len(current)
                if missing <= 0:
                    continue

                # candidati disponibili + non già usati nello stesso slot
                candidates = []
                for emp in temps:
                    if emp.id in used:
                        continue
                    if slot == "morning" and not emp.slot_morning:
                        continue
                    if slot == "evening" and not emp.slot_evening:
                        continue
                    if not _is_available(availability, emp.name, iso, slot):
                        continue
                    candidates.append((emp, _skill(emp, role)))

                candidates.sort(key=lambda t: t[1], reverse=True)

                for emp, _ in candidates[:missing]:
                    current.append(emp.id)
                    used.add(emp.id)

                if len(current) < required:
                    deficits.append(NeedDeficit(d, slot, role, required - len(current)))

    return plan, deficits
