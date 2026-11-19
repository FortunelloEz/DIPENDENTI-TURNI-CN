# cn_turni/services/swap_optimizer.py
from __future__ import annotations

from typing import Dict, List, Optional, Tuple


def _role_skill(emp, role_name: str) -> int:
    return int((emp.skills or {}).get(role_name, 0) or 0)


def two_opt_swap(
    by_cell: Dict[Tuple[int, str, str], List[int]],
    emp_by_id: Dict[int, object],
    max_iterations: int = 50,
) -> Tuple[int, float]:
    """
    Post-assignment local search: swap role assignments between pairs of employees
    on the same day when the total skill delta is strictly positive.

    Only swaps time labels where BOTH employees are simultaneously assigned to their
    respective roles, so role coverage counts never change.  Both employees must have
    skill > 0 for the new role; busy_by_time and daily_halfhours are unaffected
    because each employee keeps the same set of working time labels.

    Modifies by_cell in-place. Returns (swap_count, total_skill_gain).
    """
    swap_count = 0
    total_gain = 0.0

    for iteration in range(max_iterations):
        # Build per-day index: d → role → emp_id → set of time_labels
        day_index: Dict[int, Dict[str, Dict[int, set]]] = {}
        for (d, t, role), ids in by_cell.items():
            ri = day_index.setdefault(d, {}).setdefault(role, {})
            for eid in ids:
                ri.setdefault(eid, set()).add(t)

        best: Optional[tuple] = None  # (delta, d, role_A, role_B, eid_a, eid_b, common)
        best_delta = 0

        for d, role_map in day_index.items():
            roles = list(role_map.keys())
            for i_r in range(len(roles)):
                for j_r in range(i_r + 1, len(roles)):
                    role_A, role_B = roles[i_r], roles[j_r]
                    emps_A = role_map[role_A]
                    emps_B = role_map[role_B]

                    for eid_a, times_a in emps_A.items():
                        emp_a = emp_by_id.get(eid_a)
                        if not emp_a:
                            continue
                        skill_aA = _role_skill(emp_a, role_A)
                        skill_aB = _role_skill(emp_a, role_B)
                        if skill_aB <= 0:
                            continue

                        for eid_b, times_b in emps_B.items():
                            if eid_b == eid_a:
                                continue
                            emp_b = emp_by_id.get(eid_b)
                            if not emp_b:
                                continue
                            skill_bB = _role_skill(emp_b, role_B)
                            skill_bA = _role_skill(emp_b, role_A)
                            if skill_bA <= 0:
                                continue

                            common = times_a & times_b
                            if not common:
                                continue

                            delta = (skill_aB + skill_bA - skill_aA - skill_bB) * len(common)
                            if delta > best_delta:
                                best_delta = delta
                                best = (d, role_A, role_B, eid_a, eid_b, common)

        if best is None:
            break

        d, role_A, role_B, eid_a, eid_b, common = best
        emp_a = emp_by_id[eid_a]
        emp_b = emp_by_id[eid_b]

        for t in common:
            cell_A = by_cell.setdefault((d, t, role_A), [])
            cell_B = by_cell.setdefault((d, t, role_B), [])

            if eid_a in cell_A:
                cell_A.remove(eid_a)
            if eid_b not in cell_A:
                cell_A.append(eid_b)

            if eid_b in cell_B:
                cell_B.remove(eid_b)
            if eid_a not in cell_B:
                cell_B.append(eid_a)

        print(
            f"[2-opt #{iteration + 1}] g={d} {emp_a.name}@{role_A} <-> {emp_b.name}@{role_B} "
            f"({len(common)} hh, delta={best_delta})",
            flush=True,
        )
        swap_count += 1
        total_gain += best_delta

    return swap_count, total_gain
