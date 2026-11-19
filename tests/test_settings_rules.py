"""Ogni impostazione cambia davvero il risultato dell'import."""
import io
import contextlib
from collections import defaultdict

import pytest

from cn_turni import app_settings
from cn_turni.db import Db, week_id_from_ui_weekkey
from cn_turni.services.import_service import ImportService

WEEK = "2026-05-25"
WID = week_id_from_ui_weekkey(WEEK)
SAB, DOM = 5, 6


def _db(tmp_path):
    return Db(str(tmp_path / "s.db"))


def _run(db, csv):
    with contextlib.redirect_stdout(io.StringIO()):
        res = ImportService(db).import_availability_and_autofill(WEEK, csv)
    assert res.get("ok"), res
    return res


def _hours(db, emp_id):
    per = defaultdict(int)
    for o in db.overrides_week_get(WID):
        if emp_id in o["employee_ids"]:
            per[o["day_index"]] += 1
    return {d: n / 2 for d, n in per.items()}


def _blocks(db, emp_id, day):
    idx = sorted({int(o["time_label"][:2]) * 2 + (o["time_label"][3:] == "30")
                  for o in db.overrides_week_get(WID) if o["day_index"] == day and emp_id in o["employee_ids"]})
    out, cur = [], []
    for i in idx:
        if cur and i != cur[-1] + 1:
            out.append(cur); cur = []
        cur.append(i)
    if cur:
        out.append(cur)
    return [(b[0] / 2, (b[-1] + 1) / 2) for b in out]


def test_settings_validation_is_all_or_nothing(tmp_path):
    db = _db(tmp_path)
    with pytest.raises(ValueError):
        app_settings.save(db, {"temp_max_daily_hours": 12, "min_rest_hours": 99})
    assert app_settings.load(db)["temp_max_daily_hours"] == 10   # niente salvato
    assert app_settings.save(db, {"temp_max_daily_hours": 12})["temp_max_daily_hours"] == 12


def test_temp_daily_cap_from_settings(tmp_path):
    db = _db(tmp_path)
    a = db.employee_create({"name": "ANNA", "skills": {"Cassa": 5}})
    db.squads_week_set(WID, {str(SAB): {"morning": {"Cassa": 1}, "evening": {"Cassa": 1}}})
    csv = "T,U,Nome,Sabato 30 maggio\nx,y,ANNA,8-24\n"
    _run(db, csv)
    assert _hours(db, a)[SAB] <= 10                       # predefinito: 10 ore
    app_settings.save(db, {"temp_max_daily_hours": 16})
    _run(db, csv)
    assert _hours(db, a)[SAB] == 16                       # con 16 può fare tutta la giornata


def test_min_rest_between_days(tmp_path):
    db = _db(tmp_path)
    a = db.employee_create({"name": "ANNA", "skills": {"Cassa": 5}})
    db.squads_week_set(WID, {str(SAB): {"evening": {"Cassa": 1}}, str(DOM): {"morning": {"Cassa": 1}}})
    csv = "T,U,Nome,Sabato 30 maggio,Domenica 31 maggio\nx,y,ANNA,16-24,8-16\n"
    _run(db, csv)
    h = _hours(db, a)
    assert h.get(SAB) and h.get(DOM)                      # riposo non controllato: fa entrambi
    app_settings.save(db, {"min_rest_hours": 11})
    _run(db, csv)
    # chiude sabato alle 24: con 11 ore di riposo la domenica non può iniziare prima delle 11
    sab, dom = _blocks(db, a, SAB), _blocks(db, a, DOM)
    if sab and dom:
        assert dom[0][0] >= sab[-1][1] - 24 + 11


def test_permanent_missing_from_csv_setting(tmp_path):
    db = _db(tmp_path)
    p = db.employee_create({"name": "PIA", "is_permanent": 1, "skills": {"Cassa": 5}})
    db.employee_create({"name": "ANNA", "skills": {"Bar": 5}})
    db.squads_week_set(WID, {str(SAB): {"morning": {"Cassa": 1}}})
    csv = "T,U,Nome,Sabato 30 maggio\nx,y,ANNA,8-16\n"     # PIA non compila il modulo
    _run(db, csv)
    assert _hours(db, p).get(SAB) == 8
    app_settings.save(db, {"perm_available_if_missing": False})
    _run(db, csv)
    assert not _hours(db, p)


def test_permanent_zero_hours_means_zero(tmp_path):
    db = _db(tmp_path)
    p = db.employee_create({"name": "PIA", "is_permanent": 1, "skills": {"Cassa": 5}})
    db.permanent_week_set(WID, [{"employee_id": p, "day_off": None, "target_hours": 0}])   # es. ferie
    db.squads_week_set(WID, {str(SAB): {"morning": {"Cassa": 1}}})
    _run(db, "T,U,Nome,Sabato 30 maggio\nx,y,PIA,8-16\n")
    assert not _hours(db, p)


def test_min_shift_and_split_shifts(tmp_path):
    db = _db(tmp_path)
    a = db.employee_create({"name": "ANNA", "skills": {"Cassa": 5}})
    # serve Cassa tutto il giorno; ANNA disponibile 8-24 ma con massimo 9 ore
    db.squads_week_set(WID, {str(SAB): {"morning": {"Cassa": 1}, "evening": {"Cassa": 1}}})
    app_settings.save(db, {"temp_max_daily_hours": 9})
    csv = "T,U,Nome,Sabato 30 maggio\nx,y,ANNA,8-24\n"
    _run(db, csv)
    assert all(e - s >= 2 for s, e in _blocks(db, a, SAB))   # nessun pezzo sotto le 2 ore
    app_settings.save(db, {"min_shift_hours": 0, "allow_split_shifts": False})
    _run(db, csv)
    assert len(_blocks(db, a, SAB)) == 1                     # un solo turno continuo
