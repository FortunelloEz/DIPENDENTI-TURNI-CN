"""Test di integrazione dell'import su un DB temporaneo."""
from cn_turni.db import Db, week_id_from_ui_weekkey
from cn_turni.services.import_service import ImportService

# Settimana: lunedì 2026-05-04 -> martedì 5 ... domenica 10 maggio
WEEK_KEY = "2026-05-04"
CSV = (
    "Timestamp,Utente,Nome,Martedì 5 maggio,Mercoledì 6 maggio\n"
    "x,y,LUCA,10-16,10-16\n"
)


def _db(tmp_path):
    return Db(str(tmp_path / "t.db"))


def test_alias_resolution_keeps_employee_fields(tmp_path):
    db = _db(tmp_path)
    emp_id = db.employee_create({
        "name": "Luca Rossi",
        "skills": {"Cassa": 5},
        "work_days": "1,2,3",
        "max_daily_hours": 6,
        "weekly_hours_target": 20,
    })
    svc = ImportService(db)
    res = svc.import_availability_and_autofill(
        WEEK_KEY, CSV,
        resolutions=[{"csv_name": "LUCA", "action": "alias", "employee_id": emp_id}],
    )
    assert res["ok"], res

    emp = next(e for e in db.employees_list() if e["id"] == emp_id)
    assert emp["work_days"] == "1,2,3"
    assert emp["max_daily_hours"] == 6
    assert emp["weekly_hours_target"] == 20
    assert "LUCA" in emp["aliases"]


def test_permanent_not_scheduled_on_day_off_by_gap_filling(tmp_path):
    db = _db(tmp_path)
    db.employee_create({"name": "LUCA", "skills": {"Cassa": 5}})
    perm_id = db.employee_create({"name": "Anna Fissa", "is_permanent": 1, "skills": {"Cassa": 9}})
    week_id = week_id_from_ui_weekkey(WEEK_KEY)
    # riposo il giorno 1 (martedì 5 maggio)
    db.permanent_week_set(week_id, [{"employee_id": perm_id, "day_off": 1, "target_hours": 40}])
    db.squads_week_set(week_id, {"1": {"morning": {"Cassa": 2}, "evening": {"Cassa": 1}}})

    res = ImportService(db).import_availability_and_autofill(WEEK_KEY, CSV)
    assert res["ok"], res

    for ov in db.overrides_week_get(week_id):
        if ov["day_index"] == 1:
            assert perm_id not in ov["employee_ids"], ov


def test_permanent_capped_at_8h_per_day_without_max_daily(tmp_path):
    db = _db(tmp_path)
    db.employee_create({"name": "LUCA", "skills": {"Cassa": 5}})
    perm_id = db.employee_create({"name": "Anna Fissa", "is_permanent": 1, "skills": {"Cassa": 9}})
    week_id = week_id_from_ui_weekkey(WEEK_KEY)
    db.squads_week_set(week_id, {"1": {"morning": {"Cassa": 1}, "evening": {"Cassa": 1}}})

    res = ImportService(db).import_availability_and_autofill(WEEK_KEY, CSV)
    assert res["ok"], res

    halfhours = sum(
        1 for ov in db.overrides_week_get(week_id)
        if ov["day_index"] == 1 and perm_id in ov["employee_ids"]
    )
    assert 0 < halfhours <= 16
