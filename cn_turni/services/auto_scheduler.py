# cn_turni/services/auto_scheduler.py
from __future__ import annotations
from dataclasses import dataclass
from .csv_availability import norm_name
from typing import Dict, List, Optional, Tuple, Set

ROLES = ["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"]

MORNING_PREFIX = tuple(f"{h:02d}:" for h in range(8, 16))   # 08:..15:
EVENING_PREFIX = tuple(f"{h:02d}:" for h in range(16, 24))  # 16:..23:


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


def _norm_name(s: str) -> str:
    return norm_name(s)


def _skill(emp: Employee, role: str) -> float:
    base = float(emp.skills.get(role, 0) or 0)
    bonus = 0.25 if emp.preferred_role == role else 0.0
    return base + bonus


def _best_role(emp: Employee) -> str:
    return max(ROLES, key=lambda r: _skill(emp, r))


def _day_labels(availability: dict, emp_name: str, iso_day: str) -> Optional[Set[str]]:
    """
    Ritorna il set di labels disponibili per quel giorno (mezz'ore),
    oppure None se la persona NON è presente nel CSV (=> disponibile full day).
    """
    key = _norm_name(emp_name)
    day = availability.get(key, {}).get(iso_day)
    if not day:
        return None
    return set(getattr(day, "labels", set()) or set())


def _has_morning(labels: Set[str]) -> bool:
    return any(t.startswith(MORNING_PREFIX) for t in labels)


def _has_evening(labels: Set[str]) -> bool:
    return any(t.startswith(EVENING_PREFIX) for t in labels)


def _is_indifferent_day(availability: dict, emp_name: str, iso_day: str) -> bool:
    key = _norm_name(emp_name)
    day = availability.get(key, {}).get(iso_day)
    return bool(day) and (getattr(day, "mode", "normal") == "indifferent")


def _allowed_by_profile(emp: Employee, slot: str) -> bool:
    if slot == "morning":
        return bool(emp.slot_morning)
    return bool(emp.slot_evening)


def _is_available_slot(availability: dict, emp: Employee, iso_day: str, slot: str) -> bool:
    """
    True se:
    - non è nel CSV => disponibile
    - nel CSV ha almeno una mezz'ora nel blocco richiesto
    """
    labels = _day_labels(availability, emp.name, iso_day)
    if labels is None:
        return bool(emp.is_permanent)
    if slot == "morning":
        return _has_morning(labels)
    return _has_evening(labels)


def _choose_slot_for_permanent(availability: dict, emp: Employee, iso_day: str) -> Optional[str]:
    """
    Sceglie lo slot per i permanenti:
    - Se nel CSV ha SOLO mattina => morning
    - Se nel CSV ha SOLO sera    => evening
    - Se ha entrambe => morning (default)
    - Se non è nel CSV => morning (default)
    Poi applica vincoli anagrafica (slot_morning/slot_evening).
    """
    labels = _day_labels(availability, emp.name, iso_day)

    # default
    slot = "morning"

    if labels is not None:
        hm = _has_morning(labels)
        he = _has_evening(labels)
        if hm and not he:
            slot = "morning"
        elif he and not hm:
            slot = "evening"
        else:
            slot = "morning"

    # rispetta profilo
    if slot == "morning" and not emp.slot_morning and emp.slot_evening:
        slot = "evening"
    if slot == "evening" and not emp.slot_evening and emp.slot_morning:
        slot = "morning"

    # se non può fare nessuno dei due, scarta
    if not emp.slot_morning and not emp.slot_evening:
        return None

    # se ha scelto uno slot che comunque non è disponibile (es: ha solo sera ma profilo solo mattina),
    # allora scarta.
    if not _is_available_slot(availability, emp, iso_day, slot):
        return None

    return slot


def build_plan(
        *,
        week_days_iso: List[str],  # len=7 iso dates
        employees: List[Employee],
        permanent_settings: List[PermanentSettings],
        availability: dict,
        squads_need: dict,  # squads_need[day][slot][role] = int
) -> Tuple[Plan, List[NeedDeficit]]:


    perm_map = {p.employee_id: p for p in permanent_settings}
    perm_ids = set(perm_map.keys())

    # ✅ permanente se flag=1 O se ha settings in questa settimana
    permanents = [e for e in employees if e.is_permanent or e.id in perm_ids]
    temps = [e for e in employees if (not e.is_permanent) and (e.id not in perm_ids)]



    squads_need = {int(k): v for k, v in (squads_need or {}).items()}

    plan: Plan = {d: {"morning": {}, "evening": {}} for d in range(7)}
    deficits: List[NeedDeficit] = []
    # ore assegnate per permanenti (slot = 8h)
    perm_hours: Dict[int, int] = {e.id: 0 for e in permanents}
    perm_targets: Dict[int, int] = {}
    perm_dayoff: Dict[int, Optional[int]] = {}

    perm_used_day: Dict[Tuple[int, int], bool] = {}
    # Per i giorni 'INDIFFERENTE' impediamo doppio turno (mattina+sera)
    indiff_used_day: Dict[Tuple[int, int], bool] = {}

    for e in permanents:
        p = perm_map.get(e.id, PermanentSettings(e.id, None, 40))
        perm_targets[e.id] = int(p.target_hours or 40)
        perm_dayoff[e.id] = p.day_off
    # ---- 1) permanenti coprono per primi il fabbisogno ----
    for d in range(7):
        iso = week_days_iso[d]

        # Ordine slot guidato dal fabbisogno totale (metà giornata con più bisogno prima)
        slot_order = ["morning", "evening"]
        try:
            slot_order.sort(
                key=lambda s: sum(int((squads_need.get(d, {}).get(s, {}) or {}).get(r, 0) or 0) for r in ROLES),
                reverse=True,
            )
        except Exception:
            pass

        for slot in slot_order:
            need = squads_need.get(d, {}).get(slot, {})

            # già usati nello slot (qualsiasi ruolo)
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

                # candidati permanenti: disponibili + profilo slot + non day_off + non superare target
                candidates = []
                for emp in permanents:
                    if emp.id in used:
                        continue
                    if _is_indifferent_day(availability, emp.name, iso) and indiff_used_day.get((emp.id, d)):
                        continue
                    if perm_dayoff.get(emp.id) == d:
                        continue
                    if perm_used_day.get((emp.id, d)):
                        continue
                    if _is_indifferent_day(availability, emp.name, iso) and indiff_used_day.get((emp.id, d)):
                        continue
                    # preferenza: mattina, ma se stiamo riempiendo evening allora ok
                    if not _allowed_by_profile(emp, slot):
                        continue
                    if not _is_available_slot(availability, emp, iso, slot):
                        continue

                    # non superare target (assegnazione slot = 8h)
                    if perm_hours.get(emp.id, 0) + 8 > perm_targets.get(emp.id, 40):
                        continue

                    candidates.append((emp, _skill(emp, role)))

                candidates.sort(key=lambda t: t[1], reverse=True)

                for emp, _ in candidates[:missing]:
                    current.append(emp.id)
                    used.add(emp.id)
                    if _is_indifferent_day(availability, emp.name, iso):
                        indiff_used_day[(emp.id, d)] = True

                    # ore settimanali
                    perm_hours[emp.id] = perm_hours.get(emp.id, 0) + 8

                    # ⭐ segna che ha già lavorato quel giorno
                    perm_used_day[(emp.id, d)] = True
    # ---- determinati: riempiono fabbisogno per slot ----
    for d in range(7):
        iso = week_days_iso[d]
        # Ordine slot guidato dal fabbisogno totale (metà giornata con più bisogno prima)
        slot_order = ["morning", "evening"]
        try:
            slot_order.sort(
                key=lambda s: sum(int((squads_need.get(d, {}).get(s, {}) or {}).get(r, 0) or 0) for r in ROLES),
                reverse=True,
            )
        except Exception:
            pass

        for slot in slot_order:
            need = squads_need.get(d, {}).get(slot, {})

            # già usati nello slot (qualsiasi ruolo)
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

                candidates = []
                for emp in temps:
                    if emp.id in used:
                        continue
                    if not _allowed_by_profile(emp, slot):
                        continue
                    if not _is_available_slot(availability, emp, iso, slot):
                        continue
                    candidates.append((emp, _skill(emp, role)))

                candidates.sort(key=lambda t: t[1], reverse=True)

                for emp, _ in candidates[:missing]:
                    current.append(emp.id)
                    used.add(emp.id)
                    if _is_indifferent_day(availability, emp.name, iso):
                        indiff_used_day[(emp.id, d)] = True

                if len(current) < required:
                    deficits.append(NeedDeficit(d, slot, role, required - len(current)))

    return plan, deficits