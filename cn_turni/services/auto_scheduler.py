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


def _raw_skill(emp: Employee, role: str) -> int:
    return int(emp.skills.get(role, 0) or 0)

def _can_cover_role(emp: Employee, role: str) -> bool:
    return _raw_skill(emp, role) > 0

def _skill(emp: Employee, role: str) -> float:
    base = float(_raw_skill(emp, role))
    bonus = 0.25 if emp.preferred_role == role else 0.0
    return base + bonus


def _best_role(emp: Employee) -> str:
    return max(ROLES, key=lambda r: _skill(emp, r))

def _positive_roles(emp: Employee) -> List[str]:
    return [r for r in ROLES if _raw_skill(emp, r) > 0]

def _role_options_count(emp: Employee) -> int:
    return len(_positive_roles(emp))

def _best_skill_value(emp: Employee) -> int:
    vals = [_raw_skill(emp, r) for r in ROLES]
    return max(vals) if vals else 0

def _candidate_priority(emp: Employee, role: str) -> tuple:
    """
    Ordinamento migliore:
    1) skill sul ruolo DESC
    2) preferred role prima
    3) meno alternative prima (specialista prima del jolly)
    4) distacco tra ruolo corrente e seconda scelta DESC
    5) nome per stabilità
    """
    role_skill = _raw_skill(emp, role)
    preferred = 1 if emp.preferred_role == role else 0

    positive = sorted((_raw_skill(emp, r) for r in ROLES if _raw_skill(emp, r) > 0), reverse=True)
    best = positive[0] if positive else 0
    second = positive[1] if len(positive) > 1 else 0
    gap = role_skill - second if role_skill == best else 0

    return (
        role_skill,               # più bravo su quel ruolo
        preferred,                # preferred role
        -_role_options_count(emp),# meno ruoli possibili = prima
        gap,                      # specializzazione vera
        -(emp.id or 0),           # stabilità deterministica
    )


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


def _is_available_slot(
        availability: dict,
        emp: Employee,
        iso_day: str,
        slot: str,
        permanent_ids: Optional[Set[int]] = None,
) -> bool:
    labels = _day_labels(availability, emp.name, iso_day)
    if labels is None:
        is_perm = bool(emp.is_permanent) or (permanent_ids is not None and emp.id in permanent_ids)
        return is_perm
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

            role_order = [r for r in ROLES if int(need.get(r, 0) or 0) > 0]
            role_order.sort(
                key=lambda r: (
                    sum(
                        1 for emp in permanents
                        if _can_cover_role(emp, r)
                        and _allowed_by_profile(emp, slot)
                        and _is_available_slot(availability, emp, iso, slot, perm_ids)
                        and perm_dayoff.get(emp.id) != d
                        and not perm_used_day.get((emp.id, d))
                        and not (_is_indifferent_day(availability, emp.name, iso) and indiff_used_day.get((emp.id, d)))
                        and (perm_hours.get(emp.id, 0) + 8 <= perm_targets.get(emp.id, 40))
                    ),
                    -int(need.get(r, 0) or 0)
                )
            )

            for role in role_order:
                required = int(need.get(role, 0) or 0)
                if required <= 0:
                    continue

                current = plan[d][slot].setdefault(role, [])
                missing = required - len(current)
                if missing <= 0:
                    continue

                # candidati permanenti: disponibili + profilo slot + non day_off + non superare target
                candidates: List[Employee] = []
                for emp in permanents:
                    if emp.id in used:
                        continue
                    if perm_dayoff.get(emp.id) == d:
                        continue
                    if perm_used_day.get((emp.id, d)):
                        continue
                    if _is_indifferent_day(availability, emp.name, iso) and indiff_used_day.get((emp.id, d)):
                        continue
                    if not _allowed_by_profile(emp, slot):
                        continue
                    if not _is_available_slot(availability, emp, iso, slot, perm_ids):
                        continue

                    # 0 = NON può coprire quel ruolo
                    if not _can_cover_role(emp, role):
                        continue

                    if perm_hours.get(emp.id, 0) + 8 > perm_targets.get(emp.id, 40):
                        continue

                    candidates.append(emp)

                candidates.sort(key=lambda emp: _candidate_priority(emp, role), reverse=True)

                for emp in candidates[:missing]:
                    current.append(emp.id)
                    used.add(emp.id)

                    if _is_indifferent_day(availability, emp.name, iso):
                        indiff_used_day[(emp.id, d)] = True

                    perm_hours[emp.id] = perm_hours.get(emp.id, 0) + 8
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

            role_order = [r for r in ROLES if int(need.get(r, 0) or 0) > 0]
            role_order.sort(
                key=lambda r: (
                    sum(
                        1 for emp in temps
                        if _can_cover_role(emp, r)
                        and _allowed_by_profile(emp, slot)
                        and _is_available_slot(availability, emp, iso, slot, perm_ids)


                        and not (_is_indifferent_day(availability, emp.name, iso) and indiff_used_day.get((emp.id, d)))

                    ),
                    -int(need.get(r, 0) or 0)
                )
            )

            for role in role_order:
                required = int(need.get(role, 0) or 0)
                if required <= 0:
                    continue

                current = plan[d][slot].setdefault(role, [])
                missing = required - len(current)
                if missing <= 0:
                    continue

                candidates: List[Employee] = []
                for emp in temps:
                    if emp.id in used:
                        continue
                    if _is_indifferent_day(availability, emp.name, iso) and indiff_used_day.get((emp.id, d)):
                        continue
                    if not _allowed_by_profile(emp, slot):
                        continue
                    if not _is_available_slot(availability, emp, iso, slot, perm_ids):
                        continue

                    # 0 = NON può coprire quel ruolo
                    if not _can_cover_role(emp, role):
                        continue

                    candidates.append(emp)

                candidates.sort(key=lambda emp: _candidate_priority(emp, role), reverse=True)

                for emp in candidates[:missing]:
                    current.append(emp.id)
                    used.add(emp.id)
                    if _is_indifferent_day(availability, emp.name, iso):
                        indiff_used_day[(emp.id, d)] = True
                if len(current) < required:
                    deficits.append(NeedDeficit(d, slot, role, required - len(current)))

    return plan, deficits
