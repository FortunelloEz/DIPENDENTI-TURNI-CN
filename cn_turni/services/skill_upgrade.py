# cn_turni/services/skill_upgrade.py
from __future__ import annotations
from typing import Callable, Dict, List, Tuple


def skill_upgrade_pass(
    by_cell: Dict[Tuple[int, str, str], List[int]],
    emp_by_id: Dict[int, object],
    employees: list,
    busy_by_time: Dict[Tuple[int, str], set],
    daily_halfhours: Dict[Tuple[int, int], int],
    squads_need: Dict[int, Dict[str, Dict[str, int]]],
    is_available: Callable[[object, int, str], bool],
) -> int:
    """
    Per ogni cella (d, t, role) esattamente a fabbisogno (len == required):
    se esiste un dipendente non assegnato con skill strettamente maggiore,
    disponibile e non impegnato in quel time-label → rimpiazza il peggiore.

    Modifica by_cell, busy_by_time e daily_halfhours in-place.
    Restituisce il numero di rimpiazzi effettuati.
    """
    def _skill(emp, role: str) -> int:
        return int((getattr(emp, "skills", None) or {}).get(role, 0) or 0)

    replacements = 0
    for (d, t, role), ids in list(by_cell.items()):
        if not ids:
            continue
        slot_name = "morning" if int(t.split(":")[0]) < 16 else "evening"
        required = int((squads_need.get(d, {}).get(slot_name, {}) or {}).get(role, 0) or 0)
        if required <= 0 or len(ids) != required:
            continue

        worst_id = min(
            ids,
            key=lambda eid: _skill(emp_by_id[eid], role) if emp_by_id.get(eid) else 0,
        )
        worst_emp = emp_by_id.get(worst_id)
        if not worst_emp:
            continue
        worst_skill = _skill(worst_emp, role)

        best_candidate = None
        best_skill_found = worst_skill
        for emp in employees:
            if emp.id in ids:
                continue
            if emp.id in busy_by_time.get((d, t), set()):
                continue
            s = _skill(emp, role)
            if s <= best_skill_found:
                continue
            if not is_available(emp, d, t):
                continue
            best_skill_found = s
            best_candidate = emp

        if not best_candidate:
            continue

        ids.remove(worst_id)
        ids.append(best_candidate.id)
        busy_by_time.setdefault((d, t), set()).discard(worst_id)
        busy_by_time.setdefault((d, t), set()).add(best_candidate.id)
        daily_halfhours[(worst_id, d)] = max(0, daily_halfhours.get((worst_id, d), 0) - 1)
        daily_halfhours[(best_candidate.id, d)] = daily_halfhours.get((best_candidate.id, d), 0) + 1
        replacements += 1

    return replacements
