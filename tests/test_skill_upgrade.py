# tests/test_skill_upgrade.py
import pytest
from cn_turni.services.skill_upgrade import skill_upgrade_pass


def _hh(start_h: int, end_h: int) -> list[str]:
    out = []
    for h in range(start_h, end_h):
        out.append(f"{h:02d}:00")
        out.append(f"{h:02d}:30")
    return out


class _Emp:
    def __init__(self, emp_id: int, skills: dict, avail_labels=None):
        self.id = emp_id
        self.skills = skills
        self._avail = set(avail_labels or [])


def _avail(emp, _d, t):
    return t in emp._avail


def _need(role: str, qty: int, slot: str = "evening") -> dict:
    return {0: {slot: {role: qty}}}


# ── 1. Scenario principale: X (skill=2, 16-24) vs Y (skill=8, 19-24), need=1 ──

def test_upgrade_x_sostituito_da_y_ore_19_24():
    """
    X (cassa=2) copre 16-24 dopo il build_plan perché ha più ore disponibili.
    Y (cassa=8) è disponibile solo 19-24.
    Dopo upgrade: 16:00-18:30 → X, 19:00-23:30 → Y.
    """
    x = _Emp(1, {"Cassa": 2}, _hh(16, 24))
    y = _Emp(2, {"Cassa": 8}, _hh(19, 24))

    labels_16_24 = _hh(16, 24)
    by_cell = {(0, t, "Cassa"): [x.id] for t in labels_16_24}
    busy_by_time = {(0, t): {x.id} for t in labels_16_24}
    daily_halfhours = {(x.id, 0): len(labels_16_24)}

    count = skill_upgrade_pass(
        by_cell=by_cell,
        emp_by_id={1: x, 2: y},
        employees=[x, y],
        busy_by_time=busy_by_time,
        daily_halfhours=daily_halfhours,
        squads_need=_need("Cassa", 1),
        is_available=_avail,
    )

    labels_16_19 = _hh(16, 19)
    labels_19_24 = _hh(19, 24)

    assert count == len(labels_19_24), "deve rimpiazzare X con Y su ogni label 19-24"

    for t in labels_16_19:
        assert by_cell[(0, t, "Cassa")] == [x.id], f"X deve restare a {t}"

    for t in labels_19_24:
        assert by_cell[(0, t, "Cassa")] == [y.id], f"Y deve essere in {t}"

    # ore aggiornate
    assert daily_halfhours[(x.id, 0)] == len(labels_16_19)
    assert daily_halfhours[(y.id, 0)] == len(labels_19_24)


# ── 2. X ha skill maggiore: nessun upgrade ──────────────────────────────────────

def test_no_upgrade_se_x_e_migliore():
    x = _Emp(1, {"Cassa": 8}, _hh(16, 24))
    y = _Emp(2, {"Cassa": 2}, _hh(19, 24))

    labels = _hh(16, 24)
    by_cell = {(0, t, "Cassa"): [x.id] for t in labels}
    busy = {(0, t): {x.id} for t in labels}
    hh = {(x.id, 0): len(labels)}

    count = skill_upgrade_pass(
        by_cell=by_cell, emp_by_id={1: x, 2: y}, employees=[x, y],
        busy_by_time=busy, daily_halfhours=hh,
        squads_need=_need("Cassa", 1), is_available=_avail,
    )

    assert count == 0
    for t in labels:
        assert by_cell[(0, t, "Cassa")] == [x.id]


# ── 3. Skill uguale: nessun upgrade ─────────────────────────────────────────────

def test_no_upgrade_skill_uguale():
    x = _Emp(1, {"Cassa": 5}, _hh(16, 24))
    y = _Emp(2, {"Cassa": 5}, _hh(19, 24))

    labels = _hh(16, 24)
    by_cell = {(0, t, "Cassa"): [x.id] for t in labels}
    busy = {(0, t): {x.id} for t in labels}
    hh = {(x.id, 0): len(labels)}

    count = skill_upgrade_pass(
        by_cell=by_cell, emp_by_id={1: x, 2: y}, employees=[x, y],
        busy_by_time=busy, daily_halfhours=hh,
        squads_need=_need("Cassa", 1), is_available=_avail,
    )

    assert count == 0


# ── 4. Y già occupato sulle stesse celle (Bar) → nessun upgrade ──────────────

def test_no_upgrade_candidato_busy():
    x = _Emp(1, {"Cassa": 2}, _hh(19, 24))
    y = _Emp(2, {"Cassa": 8}, _hh(19, 24))

    labels = _hh(19, 24)
    by_cell = {(0, t, "Cassa"): [x.id] for t in labels}
    # Y è già occupato su Bar nelle stesse celle
    for t in labels:
        by_cell[(0, t, "Bar")] = [y.id]

    busy = {(0, t): {x.id, y.id} for t in labels}
    hh = {(x.id, 0): len(labels), (y.id, 0): len(labels)}

    count = skill_upgrade_pass(
        by_cell=by_cell, emp_by_id={1: x, 2: y}, employees=[x, y],
        busy_by_time=busy, daily_halfhours=hh,
        squads_need={0: {"evening": {"Cassa": 1, "Bar": 1}}},
        is_available=_avail,
    )

    assert count == 0
    for t in labels:
        assert by_cell[(0, t, "Cassa")] == [x.id]


# ── 5. need=0 per quel ruolo: cella ignorata ─────────────────────────────────

def test_no_upgrade_need_zero():
    x = _Emp(1, {"Cassa": 2}, _hh(16, 24))
    y = _Emp(2, {"Cassa": 8}, _hh(16, 24))

    labels = _hh(16, 24)
    by_cell = {(0, t, "Cassa"): [x.id] for t in labels}
    busy = {(0, t): {x.id} for t in labels}
    hh = {(x.id, 0): len(labels)}

    count = skill_upgrade_pass(
        by_cell=by_cell, emp_by_id={1: x, 2: y}, employees=[x, y],
        busy_by_time=busy, daily_halfhours=hh,
        squads_need=_need("Cassa", 0),  # need=0
        is_available=_avail,
    )

    assert count == 0


# ── 6. Cella non a fabbisogno esatto (len < required): non toccarla ──────────

def test_no_upgrade_cella_incompleta():
    """Se la cella ha 1 persona ma ne servono 2, non va toccata dall'upgrade."""
    x = _Emp(1, {"Cassa": 2}, _hh(16, 24))
    y = _Emp(2, {"Cassa": 8}, _hh(16, 24))

    labels = _hh(16, 24)
    by_cell = {(0, t, "Cassa"): [x.id] for t in labels}
    busy = {(0, t): {x.id} for t in labels}
    hh = {(x.id, 0): len(labels)}

    count = skill_upgrade_pass(
        by_cell=by_cell, emp_by_id={1: x, 2: y}, employees=[x, y],
        busy_by_time=busy, daily_halfhours=hh,
        squads_need=_need("Cassa", 2),  # need=2, in cella c'è solo 1 → skip
        is_available=_avail,
    )

    assert count == 0


# ── 7. need=2: rimpiazza il peggiore tra i due ────────────────────────────────

def test_upgrade_need2_rimpiazza_peggiore():
    """
    need=2, in cella [X(skill=2), Z(skill=5)].
    Y (skill=8) disponibile → rimpiazza X (il peggiore).
    """
    x = _Emp(1, {"Cassa": 2}, _hh(16, 24))
    z = _Emp(3, {"Cassa": 5}, _hh(16, 24))
    y = _Emp(2, {"Cassa": 8}, _hh(16, 24))

    labels = _hh(16, 24)
    by_cell = {(0, t, "Cassa"): [x.id, z.id] for t in labels}
    busy = {(0, t): {x.id, z.id} for t in labels}
    hh = {(x.id, 0): len(labels), (z.id, 0): len(labels)}

    count = skill_upgrade_pass(
        by_cell=by_cell, emp_by_id={1: x, 2: y, 3: z}, employees=[x, y, z],
        busy_by_time=busy, daily_halfhours=hh,
        squads_need=_need("Cassa", 2),
        is_available=_avail,
    )

    assert count == len(labels)
    for t in labels:
        assert x.id not in by_cell[(0, t, "Cassa")], "X (skill=2) deve essere rimpiazzato"
        assert y.id in by_cell[(0, t, "Cassa")], "Y (skill=8) deve essere inserito"
        assert z.id in by_cell[(0, t, "Cassa")], "Z (skill=5) deve restare"


# ── 8. Candidato non disponibile: skip ───────────────────────────────────────

def test_no_upgrade_candidato_non_disponibile():
    """Y ha skill=8 ma is_available restituisce False → nessun upgrade."""
    x = _Emp(1, {"Cassa": 2}, _hh(16, 24))
    y = _Emp(2, {"Cassa": 8}, [])  # nessun label disponibile

    labels = _hh(16, 24)
    by_cell = {(0, t, "Cassa"): [x.id] for t in labels}
    busy = {(0, t): {x.id} for t in labels}
    hh = {(x.id, 0): len(labels)}

    count = skill_upgrade_pass(
        by_cell=by_cell, emp_by_id={1: x, 2: y}, employees=[x, y],
        busy_by_time=busy, daily_halfhours=hh,
        squads_need=_need("Cassa", 1),
        is_available=_avail,
    )

    assert count == 0
