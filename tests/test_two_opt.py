# tests/test_two_opt.py
import pytest
from cn_turni.services.swap_optimizer import two_opt_swap


class _Emp:
    """Minimal employee stub for swap tests."""
    def __init__(self, emp_id: int, name: str, skills: dict):
        self.id = emp_id
        self.name = name
        self.skills = skills


def _make_cell(ids_by_role_time: dict) -> dict:
    """Helper: {(role, time): [emp_ids]} → proper by_cell keys."""
    return {k: list(v) for k, v in ids_by_role_time.items()}


# ── Caso 1: incrocio Cassa/Bar con swap vantaggioso ──────────────────────────

def test_cassa_bar_incrocio_swap():
    """X(Cassa=9, Bar=7) su Cassa; Y(Cassa=6, Bar=1) su Bar.
    delta = (7 + 6 - 9 - 1) * 4 = +12 → swap applicato."""
    x = _Emp(1, "X", {"Cassa": 9, "Bar": 7})
    y = _Emp(2, "Y", {"Cassa": 6, "Bar": 1})

    times = ["08:00", "08:30", "09:00", "09:30"]
    by_cell: dict = {}
    for t in times:
        by_cell[(0, t, "Cassa")] = [1]
        by_cell[(0, t, "Bar")] = [2]

    count, gain = two_opt_swap(by_cell, {1: x, 2: y})

    assert count == 1
    assert gain == 12  # (7 + 6 - 9 - 1) * 4

    for t in times:
        assert by_cell[(0, t, "Cassa")] == [2], f"Cassa a {t} deve avere Y"
        assert by_cell[(0, t, "Bar")] == [1], f"Bar a {t} deve avere X"


# ── Caso 2: assegnazione già ottima → nessuna modifica ───────────────────────

def test_gia_ottimo_nessuna_modifica():
    """X(Cassa=9, Bar=2) su Cassa; Y(Cassa=1, Bar=8) su Bar.
    delta = (2 + 1 - 9 - 8) * 4 = -56 → nessuno swap."""
    x = _Emp(1, "X", {"Cassa": 9, "Bar": 2})
    y = _Emp(2, "Y", {"Cassa": 1, "Bar": 8})

    times = ["16:00", "16:30", "17:00", "17:30"]
    by_cell: dict = {}
    for t in times:
        by_cell[(0, t, "Cassa")] = [1]
        by_cell[(0, t, "Bar")] = [2]

    original = {k: list(v) for k, v in by_cell.items()}

    count, gain = two_opt_swap(by_cell, {1: x, 2: y})

    assert count == 0
    assert gain == 0.0
    for k, v in original.items():
        assert by_cell[k] == v, f"Cella {k} modificata senza motivo"


# ── Caso 3: skill zero blocca lo swap ────────────────────────────────────────

def test_skill_zero_blocca_swap():
    """X(Cassa=8, Bar=0) su Cassa; Y(Cassa=3, Bar=7) su Bar.
    X.skill(Bar)=0 → swap bloccato anche se la somma del delta potrebbe essere > 0."""
    x = _Emp(1, "X", {"Cassa": 8, "Bar": 0})
    y = _Emp(2, "Y", {"Cassa": 3, "Bar": 7})

    times = ["10:00", "10:30"]
    by_cell: dict = {}
    for t in times:
        by_cell[(0, t, "Cassa")] = [1]
        by_cell[(0, t, "Bar")] = [2]

    original = {k: list(v) for k, v in by_cell.items()}

    count, gain = two_opt_swap(by_cell, {1: x, 2: y})

    assert count == 0
    for k, v in original.items():
        assert by_cell[k] == v, f"Cella {k} modificata con skill=0"


# ── Caso 4: nessuna sovrapposizione di time_label → nessuno swap ─────────────

def test_no_sovrapposizione_nessuno_swap():
    """X su Cassa 08:00-10:00; Y su Bar 12:00-14:00.
    Intersezione vuota → nessuno swap possibile."""
    x = _Emp(1, "X", {"Cassa": 8, "Bar": 9})
    y = _Emp(2, "Y", {"Cassa": 7, "Bar": 3})

    times_x = ["08:00", "08:30", "09:00", "09:30"]
    times_y = ["12:00", "12:30", "13:00", "13:30"]
    by_cell: dict = {}
    for t in times_x:
        by_cell[(0, t, "Cassa")] = [1]
    for t in times_y:
        by_cell[(0, t, "Bar")] = [2]

    count, gain = two_opt_swap(by_cell, {1: x, 2: y})

    assert count == 0
    assert gain == 0.0
