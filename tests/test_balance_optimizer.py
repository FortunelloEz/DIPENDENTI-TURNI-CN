"""Ottimizzatore di bilanciamento: meglio 6 + 7 che 10 + 1."""
from cn_turni.services.balance_optimizer import best_assignment, rebalance

SK = {
    "X": {"Cassa": 10, "Runner": 6},
    "Y": {"Cassa": 7, "Runner": 1},
}
sk = lambda c, r: SK[c].get(r, 0)


def test_prefers_balanced_team_over_one_star():
    # X in Cassa (10) + Y in Runner (1)  ->  X in Runner (6) + Y in Cassa (7)
    sol = best_assignment(["Cassa", "Runner"], ["X", "Y"], sk, {"X": "Cassa", "Y": "Runner"})
    assert sol == {"X": "Runner", "Y": "Cassa"}


def test_uses_free_person_to_raise_minimum():
    # caso reale del test: P5 tuttofare va al Runner, P2 entra al Bar
    S = {"P1": {"Cassa": 10, "Runner": 5, "Bar": 2}, "P0": {"Cassa": 4, "Runner": 5, "Bar": 2},
         "P5": {"Cassa": 9, "Runner": 9, "Bar": 10}, "P2": {"Cassa": 6, "Runner": 4, "Bar": 8}}
    f = lambda c, r: S[c].get(r, 0)
    sol = best_assignment(["Bar", "Cassa", "Runner"], ["P1", "P0", "P5", "P2"], f,
                          {"P1": "Cassa", "P0": "Runner", "P5": "Bar"})
    assert sorted(f(c, r) for c, r in sol.items()) == [8, 9, 10]


def test_keeps_current_when_already_optimal_and_never_uses_skill_zero():
    S = {"A": {"Cassa": 5, "Bar": 0}, "B": {"Cassa": 5, "Bar": 5}}
    f = lambda c, r: S[c].get(r, 0)
    assert best_assignment(["Cassa", "Bar"], ["A", "B"], f, {"A": "Cassa", "B": "Bar"}) == {"A": "Cassa", "B": "Bar"}
    # A non sa fare il Bar: con due posti da Bar se ne copre uno solo, con B
    assert best_assignment(["Bar", "Bar"], ["A", "B"], f, {}) == {"B": "Bar"}


def test_rebalance_rewrites_cells_without_changing_coverage():
    labels = ["16:00", "16:30"]
    by_cell = {(5, t, "Cassa"): ["X"] for t in labels} | {(5, t, "Runner"): ["Y"] for t in labels}
    n = rebalance(by_cell, [5], {"evening": labels}, sk, lambda c: None,
                  free_candidates=lambda d, ls: [], on_replace=lambda *a: None)
    assert n == 2
    assert all(by_cell[(5, t, "Cassa")] == ["Y"] and by_cell[(5, t, "Runner")] == ["X"] for t in labels)


def test_rebalance_can_choose_which_role_stays_uncovered():
    # 5 posti, 4 persone: conviene lasciare scoperto un Runner e coprire le Comande
    P = {"P0": {"Cassa": 4, "Runner": 8, "Bar": 9, "Comande": 3}, "P1": {"Cassa": 3, "Runner": 2, "Comande": 1},
         "P2": {"Cassa": 5, "Runner": 7, "Bar": 7, "Comande": 10}, "P3": {"Cassa": 3, "Runner": 2, "Comande": 7}}
    labels = ["16:00", "16:30"]
    bc = {}
    for t in labels:
        bc[(5, t, "Runner")] = ["P1", "P2"]; bc[(5, t, "Cassa")] = ["P3"]; bc[(5, t, "Bar")] = ["P0"]
    need = {"Runner": 2, "Comande": 1, "Bar": 1, "Cassa": 1}
    rebalance(bc, [5], {"evening": labels}, lambda c, r: P[c].get(r, 0), lambda c: None,
              free_candidates=lambda d, ls: [], on_replace=lambda *a: None,
              required=lambda d, s, r: need.get(r, 0), roles=["Cassa", "Runner", "Bar", "Comande"])
    got = [P[e][r] for (d, t, r), ids in bc.items() if t == "16:00" for e in ids]
    assert len(got) == 4 and min(got) == 3 and sum(got) == 26
