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
    work_days: str = ""
    max_daily_hours: Optional[float] = None


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


def _best_other_open_role_skill(emp: Employee, role: str, open_roles: List[str]) -> int:
    vals = [_raw_skill(emp, r) for r in open_roles if r != role]
    return max(vals) if vals else 0


def _candidate_priority(emp: Employee, role: str, open_roles: List[str]) -> tuple:
    """
    Preferisci chi:
    1) è bravo sul ruolo corrente
    2) è meno "critico" sugli altri ruoli ancora aperti
    3) ha preferred_role uguale
    4) ha meno alternative positive
    5) è più specializzato
    6) stabilità deterministica
    """
    role_skill = _raw_skill(emp, role)
    preferred = 1 if emp.preferred_role == role else 0

    other_best = _best_other_open_role_skill(emp, role, open_roles)

    positive = sorted((_raw_skill(emp, r) for r in ROLES if _raw_skill(emp, r) > 0), reverse=True)
    best = positive[0] if positive else 0
    second = positive[1] if len(positive) > 1 else 0
    gap = role_skill - second if role_skill == best else 0

    preservation_margin = role_skill - other_best

    return (
        preservation_margin,
        role_skill,
        preferred,
        -_role_options_count(emp),
        gap,
        -(emp.id or 0),
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

def _allowed_by_work_days(emp: Employee, day_index: int) -> bool:
    raw = (getattr(emp, "work_days", None) or "").strip()
    if not raw:
        return True
    try:
        allowed = {int(x.strip()) for x in raw.split(",") if x.strip().isdigit()}
        return day_index in allowed
    except Exception:
        return True


def _is_available_slot(
        availability: dict,
        emp: Employee,
        iso_day: str,
        slot: str,
        permanent_ids: Optional[Set[int]] = None,
) -> bool:
    labels = _day_labels(availability, emp.name, iso_day)
    if labels is None:
        # Non nel CSV: disponibile solo se permanente
        is_perm = bool(emp.is_permanent) or (permanent_ids is not None and emp.id in permanent_ids)
        return is_perm
    if not labels:
        # Nel CSV ma con labels vuote = non disponibile
        return False
    if slot == "morning":
        return _has_morning(labels)
    return _has_evening(labels)


def _is_available_any_slot(
        availability: dict,
        emp: Employee,
        iso_day: str,
        permanent_ids: Optional[Set[int]] = None,
) -> bool:
    """Vero se disponibile in almeno uno dei due slot."""
    return (
            _is_available_slot(availability, emp, iso_day, "morning", permanent_ids)
            or _is_available_slot(availability, emp, iso_day, "evening", permanent_ids)
    )


def _slot_need_total(squads_need: dict, day: int, slot: str) -> int:
    """Somma del fabbisogno di tutti i ruoli per un giorno+slot."""
    return sum(
        int((squads_need.get(day, {}).get(slot, {}) or {}).get(r, 0) or 0)
        for r in ROLES
    )


def _slot_coverage_ratio(plan: Plan, squads_need: dict, day: int, slot: str) -> float:
    """
    Rapporto tra persone già assegnate e fabbisogno totale per giorno+slot.
    0.0 = nessuno assegnato, 1.0 = pieno, >1.0 = sovrannumero.
    Usato per bilanciare gli INDIFFERENTI verso lo slot più scoperto.
    """
    need = _slot_need_total(squads_need, day, slot)
    if need == 0:
        return 1.0  # nessuna necessità = non prioritario
    assigned = sum(len(plan[day][slot].get(r, [])) for r in ROLES)
    return assigned / need


def _choose_slot_for_indifferent(
        plan: Plan,
        squads_need: dict,
        emp: Employee,
        day: int,
) -> Optional[str]:
    """
    Per chi è INDIFFERENTE: assegna allo slot con copertura peggiore.
    Rispetta comunque i vincoli di profilo (slot_morning/slot_evening).
    """
    can_morning = bool(emp.slot_morning)
    can_evening = bool(emp.slot_evening)

    if not can_morning and not can_evening:
        return None

    ratio_m = _slot_coverage_ratio(plan, squads_need, day, "morning") if can_morning else float("inf")
    ratio_e = _slot_coverage_ratio(plan, squads_need, day, "evening") if can_evening else float("inf")

    if can_morning and not can_evening:
        return "morning"
    if can_evening and not can_morning:
        return "evening"

    # Entrambi disponibili: sceglie lo slot più scoperto (ratio minore)
    return "morning" if ratio_m <= ratio_e else "evening"


def _choose_slot_for_permanent(availability: dict, emp: Employee, iso_day: str, plan: Plan = None, squads_need: dict = None, day: int = None) -> Optional[str]:
    """
    Sceglie lo slot per i permanenti:
    - Se nel CSV ha SOLO mattina => morning
    - Se nel CSV ha SOLO sera    => evening
    - Se ha entrambe (indifferente) => slot più scoperto (se plan/squads_need disponibili), altrimenti morning
    - Se non è nel CSV => morning (default)
    Poi applica vincoli anagrafica (slot_morning/slot_evening).
    """
    labels = _day_labels(availability, emp.name, iso_day)

    slot = "morning"

    if labels is not None:
        hm = _has_morning(labels)
        he = _has_evening(labels)
        if hm and not he:
            slot = "morning"
        elif he and not hm:
            slot = "evening"
        elif hm and he:
            # Indifferente: usa il bilanciamento se abbiamo i dati
            if plan is not None and squads_need is not None and day is not None:
                balanced = _choose_slot_for_indifferent(plan, squads_need, emp, day)
                if balanced:
                    slot = balanced
            else:
                slot = "morning"

    # Rispetta profilo
    if slot == "morning" and not emp.slot_morning and emp.slot_evening:
        slot = "evening"
    if slot == "evening" and not emp.slot_evening and emp.slot_morning:
        slot = "morning"

    if not emp.slot_morning and not emp.slot_evening:
        return None

    if not _is_available_slot(availability, emp, iso_day, slot):
        return None

    return slot


def build_plan(
        *,
        week_days_iso: List[str],
        employees: List[Employee],
        permanent_settings: List[PermanentSettings],
        availability: dict,
        squads_need: dict,
) -> Tuple[Plan, List[NeedDeficit]]:

    perm_map = {p.employee_id: p for p in permanent_settings}
    perm_ids = set(perm_map.keys())

    permanents = [e for e in employees if e.is_permanent or e.id in perm_ids]
    temps = [e for e in employees if (not e.is_permanent) and (e.id not in perm_ids)]

    squads_need = {int(k): v for k, v in (squads_need or {}).items()}

    plan: Plan = {d: {"morning": {}, "evening": {}} for d in range(7)}
    deficits: List[NeedDeficit] = []

    perm_hours: Dict[int, int] = {e.id: 0 for e in permanents}
    perm_targets: Dict[int, int] = {}
    perm_dayoff: Dict[int, Optional[int]] = {}

    perm_used_day: Dict[Tuple[int, int], bool] = {}
    # Traccia per gli INDIFFERENTI: usati in un certo slot di un certo giorno
    # (non blocca doppio slot se hanno disponibilità esplicita per entrambi)
    indiff_used_slot: Dict[Tuple[int, int, str], bool] = {}
    # Determinati: traccia slot già usati (non giorno intero)
    temp_used_slot: Dict[Tuple[int, int, str], bool] = {}

    for e in permanents:
        p = perm_map.get(e.id, PermanentSettings(e.id, None, 40))
        perm_targets[e.id] = int(p.target_hours or 40)
        perm_dayoff[e.id] = p.day_off

    # ── 1) PERMANENTI ──
    for d in range(7):
        iso = week_days_iso[d]

        slot_order = ["morning", "evening"]
        try:
            slot_order.sort(
                key=lambda s: _slot_need_total(squads_need, d, s),
                reverse=True,
            )
        except Exception:
            pass

        for slot in slot_order:
            need = squads_need.get(d, {}).get(slot, {})

            used_this_slot = set()
            for r in ROLES:
                for eid in plan[d][slot].get(r, []):
                    used_this_slot.add(eid)

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
                        and not indiff_used_slot.get((emp.id, d, slot))
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

                candidates: List[Employee] = []
                for emp in permanents:
                    if emp.id in used_this_slot:
                        continue
                    if perm_dayoff.get(emp.id) == d:
                        continue
                    if perm_used_day.get((emp.id, d)):
                        continue
                    # Blocca indifferenti già usati in questo stesso slot
                    if _is_indifferent_day(availability, emp.name, iso) and indiff_used_slot.get((emp.id, d, slot)):
                        continue
                    if not _allowed_by_profile(emp, slot):
                        continue
                    if not _allowed_by_work_days(emp, d):
                        continue
                    if not _is_available_slot(availability, emp, iso, slot, perm_ids):
                        continue
                    if not _can_cover_role(emp, role):
                        continue
                    if perm_hours.get(emp.id, 0) + 8 > perm_targets.get(emp.id, 40):
                        continue

                    candidates.append(emp)

                open_roles = [
                    r for r in role_order
                    if int(need.get(r, 0) or 0) > len(plan[d][slot].get(r, []))
                ]

                candidates.sort(
                    key=lambda emp: _candidate_priority(emp, role, open_roles),
                    reverse=True
                )

                for emp in candidates[:missing]:
                    current.append(emp.id)
                    used_this_slot.add(emp.id)

                    if _is_indifferent_day(availability, emp.name, iso):
                        indiff_used_slot[(emp.id, d, slot)] = True

                    perm_hours[emp.id] = perm_hours.get(emp.id, 0) + 8
                    perm_used_day[(emp.id, d)] = True

    # ── 2) DETERMINATI ──
    # FIX: i determinati con disponibilità ESPLICITA per entrambi i slot
    # possono lavorare in entrambi (es. 08-24). Non vengono bloccati sul giorno intero.
    # Vengono bloccati solo sul singolo slot già usato (tramite temp_used_slot).
    # Gli INDIFFERENTI (mode=indifferent) invece vengono assegnati a UN SOLO slot bilanciato.
    for d in range(7):
        iso = week_days_iso[d]

        slot_order = ["morning", "evening"]
        try:
            slot_order.sort(
                key=lambda s: _slot_need_total(squads_need, d, s),
                reverse=True,
            )
        except Exception:
            pass

        for slot in slot_order:
            need = squads_need.get(d, {}).get(slot, {})

            used_this_slot = set()
            for r in ROLES:
                for eid in plan[d][slot].get(r, []):
                    used_this_slot.add(eid)

            role_order = [r for r in ROLES if int(need.get(r, 0) or 0) > 0]
            role_order.sort(
                key=lambda r: (
                    sum(
                        1 for emp in temps
                        if _can_cover_role(emp, r)
                        and _allowed_by_profile(emp, slot)
                        and _is_available_slot(availability, emp, iso, slot, perm_ids)
                        and not temp_used_slot.get((emp.id, d, slot))
                        and not (_is_indifferent_day(availability, emp.name, iso) and indiff_used_slot.get((emp.id, d, slot)))
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
                    if emp.id in used_this_slot:
                        continue
                    # Già usato in questo slot specifico
                    if temp_used_slot.get((emp.id, d, slot)):
                        continue
                    # Indifferente già usato in questo slot
                    if _is_indifferent_day(availability, emp.name, iso) and indiff_used_slot.get((emp.id, d, slot)):
                        continue
                    # Indifferente: assegna solo allo slot bilanciato
                    if _is_indifferent_day(availability, emp.name, iso):
                        target_slot = _choose_slot_for_indifferent(plan, squads_need, emp, d)
                        if target_slot != slot:
                            continue
                    if not _allowed_by_profile(emp, slot):
                        continue
                    if not _allowed_by_work_days(emp, d):
                        continue
                    if not _is_available_slot(availability, emp, iso, slot, perm_ids):
                        continue
                    if not _can_cover_role(emp, role):
                        continue
                    candidates.append(emp)

                open_roles = [
                    r for r in role_order
                    if int(need.get(r, 0) or 0) > len(plan[d][slot].get(r, []))
                ]

                candidates.sort(
                    key=lambda emp: _candidate_priority(emp, role, open_roles),
                    reverse=True
                )

                for emp in candidates[:missing]:
                    current.append(emp.id)
                    used_this_slot.add(emp.id)
                    # Segna lo slot usato (NON il giorno intero per i non-indifferenti)
                    temp_used_slot[(emp.id, d, slot)] = True
                    if _is_indifferent_day(availability, emp.name, iso):
                        indiff_used_slot[(emp.id, d, slot)] = True

                if len(current) < required:
                    deficits.append(NeedDeficit(d, slot, role, required - len(current)))

    return plan, deficits