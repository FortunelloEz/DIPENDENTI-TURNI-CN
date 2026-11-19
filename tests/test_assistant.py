"""Assistente locale: risposte dal DB e modifiche con anteprima + applicazione atomica."""
import json

import pytest

from cn_turni.db import Db, week_id_from_ui_weekkey
from cn_turni.services.assistant import Assistant, norm

WEEK = "2026-05-25"          # lunedì
WID = week_id_from_ui_weekkey(WEEK)
SAB = 5


def _half(a, b):
    return [f"{h:02d}:{m}" for h in range(a, b) for m in ("00", "30")]


@pytest.fixture()
def env(tmp_path):
    db = Db(str(tmp_path / "t.db"))
    ids = {
        "simone": db.employee_create({"name": "SIMONE", "skills": {"Cassa": 6, "Runner": 3}}),
        "della": db.employee_create({"name": "DELLA", "skills": {"Cassa": 8}}),
        "matteo": db.employee_create({"name": "MATTEO ROSSI", "aliases": "Teo", "skills": {"Runner": 5, "Bar": 4}}),
        "elia1": db.employee_create({"name": "ELIA INDETERMINATO", "skills": {"Runner": 3}}),
        "elia2": db.employee_create({"name": "ELIA MOSCATI", "skills": {"Runner": 3}}),
    }
    # fabbisogno sabato: sera Cassa 1 + Runner 2
    db.squads_week_set(WID, {str(SAB): {"morning": {}, "evening": {"Cassa": 1, "Runner": 2}}})
    # turni sabato sera: Simone in Cassa, Elia I. in Runner (manca 1 runner)
    items = [{"day_index": SAB, "role": "Cassa", "time_label": t, "employee_ids": [ids["simone"]]} for t in _half(16, 24)]
    items += [{"day_index": SAB, "role": "Runner", "time_label": t, "employee_ids": [ids["elia1"]]} for t in _half(16, 24)]
    db.overrides_bulk_save(WID, items)
    # disponibilità CSV di sabato
    preview = {"days": [{"day_index": SAB, "iso_day": "2026-05-30", "items": [
        {"name": "SIMONE", "range": "16-24"},
        {"name": "DELLA", "range": "16-24"},
        {"name": "MATTEO ROSSI", "range": "18-24"},
    ]}]}
    db.availability_save(WID, json.dumps(preview))
    return db, Assistant(db), ids


def text(res):
    return " | ".join([res.get("title", "")] + res.get("lines", []))


def test_norm():
    assert norm("  Chi è LIBERO, sabato?? ") == "chi e libero sabato"


def test_uncovered_and_critical(env):
    _, a, _ = env
    assert "Runner pomeriggio 1/2" in text(a.ask(WEEK, "cosa manca sabato?"))
    assert "Sabato 30/05" in text(a.ask(WEEK, "qual è il giorno più critico"))


def test_free_people(env):
    _, a, _ = env
    res = text(a.ask(WEEK, "chi è libero sabato sera"))
    assert "DELLA" in res and "MATTEO ROSSI — 18:00–24:00" in res
    assert "SIMONE" not in res  # è già in turno


def test_hours(env):
    _, a, _ = env
    res = text(a.ask(WEEK, "quante ore fa simone"))
    assert "Totale: 8 ore" in res and "Cassa 16:00–24:00" in res


def test_replace_preview_then_apply(env):
    db, a, ids = env
    res = a.ask(WEEK, "sostituisci Simone con Della sabato sera")
    act = res["action"]
    assert act and "SIMONE → DELLA" in act["preview"][0]
    # nessuna scrittura finché non si conferma
    assert all(ids["della"] not in o["employee_ids"] for o in db.overrides_week_get(WID))
    out = a.apply(WEEK, act)
    assert out["ok"]
    cassa = [o for o in db.overrides_week_get(WID) if o["role"] == "Cassa"]
    assert len(cassa) == 16 and all(o["employee_ids"] == [ids["della"]] for o in cassa)


def test_replace_with_word_della_as_preposition(env):
    _, a, _ = env
    # «della» qui è una preposizione: il nome sicuro è Simone
    res = a.ask(WEEK, "togli simone dal turno della sera sabato")
    assert res["action"] and "tolgo SIMONE" in res["action"]["preview"][0]


def test_replace_conflict_other_role(env):
    _, a, _ = env
    res = a.ask(WEEK, "sostituisci simone con elia indeterminato sabato")
    assert res["action"] is None and "già in turno in un altro ruolo" in text(res)


def test_ambiguous_name(env):
    _, a, _ = env
    res = a.ask(WEEK, "togli elia sabato")
    assert "ELIA INDETERMINATO" in text(res) and "ELIA MOSCATI" in text(res) and res["action"] is None


def test_add_uses_only_available_hours_and_missing_role(env):
    db, a, ids = env
    res = a.ask(WEEK, "aggiungi teo sabato sera")  # alias; ruolo dedotto: Runner è l'unico scoperto che sa fare
    act = res["action"]
    assert act and "Runner: aggiungo MATTEO ROSSI (18:00–24:00)" in act["preview"][0]
    assert a.apply(WEEK, act)["ok"]
    runner_1830 = next(o for o in db.overrides_week_get(WID) if o["role"] == "Runner" and o["time_label"] == "18:30")
    assert set(runner_1830["employee_ids"]) == {ids["elia1"], ids["matteo"]}


def test_add_needs_shift(env):
    _, a, _ = env
    assert "In quale fascia" in text(a.ask(WEEK, "aggiungi della sabato"))


def test_apply_is_recomputed_on_current_db(env):
    db, a, ids = env
    act = a.ask(WEEK, "togli simone sabato")["action"]
    # nel frattempo qualcuno ha già tolto Simone
    db.overrides_set_cells(WID, [{"day_index": SAB, "role": "Cassa", "time_label": t, "employee_ids": []} for t in _half(16, 24)])
    out = a.apply(WEEK, act)
    assert out["ok"] is False and "non è in turno" in out["error"]


def test_not_understood_and_help(env):
    _, a, _ = env
    assert "Non ho capito" in text(a.ask(WEEK, "che tempo fa domani"))
    assert "Cosa posso fare" in text(a.ask(WEEK, "aiuto"))


def test_set_cells_is_atomic(env):
    db, _, ids = env
    before = db.overrides_week_get(WID)
    with pytest.raises(Exception):
        db.overrides_set_cells(WID, [
            {"day_index": SAB, "role": "Cassa", "time_label": "16:00", "employee_ids": [ids["della"]]},
            {"day_index": SAB, "role": "Cassa", "time_label": "16:30", "employee_ids": ["non-un-numero"]},
        ])
    assert db.overrides_week_get(WID) == before


def test_name_prefix_and_unknown_role_hint(env):
    _, a, _ = env
    res = a.ask(WEEK, "togli sim sabato")            # «sim» = inizio di un solo nome
    assert res["action"] and "SIMONE" in res["action"]["preview"][0]
    res = a.ask(WEEK, "togli eli sabato")            # inizio di due nomi: chiede quale
    assert res["action"] is None and "ELIA MOSCATI" in text(res)
    res = a.ask(WEEK, "aggiungi matteo sabato mattina")  # nessun ruolo scoperto la mattina
    assert "Runner" in text(res) and "in runner" in text(res)


def test_who_works(env):
    _, a, _ = env
    res = text(a.ask(WEEK, "chi lavora sabato sera?"))
    assert "Cassa: SIMONE (16:00–24:00)" in res and "Runner: ELIA INDETERMINATO" in res
    assert "Nessuno è in turno" in text(a.ask(WEEK, "chi c'è lunedì"))
