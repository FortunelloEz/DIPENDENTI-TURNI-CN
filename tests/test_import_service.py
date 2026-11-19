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


def test_preview_range_keeps_half_hours():
    from cn_turni.services.import_service import _labels_to_range
    from cn_turni.services.csv_availability import _half_hours

    assert _labels_to_range(set(_half_hours(8, 16))) == "08-16"
    assert _labels_to_range({"12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30"}) == "12:30-16"
    assert _labels_to_range({"10:00", "10:30", "11:00", "11:30", "12:00"}) == "10-12:30"


def test_detect_week_matches_csv_week(tmp_path):
    svc = ImportService(_db(tmp_path))
    # UI aperta su un'altra settimana: conta quella del CSV
    assert svc.detect_week_key("2026-04-06", CSV) == WEEK_KEY
    assert svc.detect_week_key(WEEK_KEY, "solo,intestazione\n") is None


def test_alias_merge_does_not_mutate_original(tmp_path):
    from cn_turni.services.csv_availability import DayAvailability

    db = _db(tmp_path)
    emp_id = db.employee_create({"name": "Luca Rossi", "aliases": "LUCA | LUKE"})
    svc = ImportService(db)
    a = DayAvailability({"10:00"})
    b = DayAvailability({"18:00"})
    availability = {"LUCA": {"2026-05-05": a}, "LUKE": {"2026-05-05": b}}
    name_to_id = {"LUCA": emp_id, "LUKE": emp_id}

    out = svc._remap_availability_to_canonical_keys(availability, db.employees_list(), name_to_id)

    assert out["LUCA ROSSI"]["2026-05-05"].labels == {"10:00", "18:00"}
    assert a.labels == {"10:00"} and b.labels == {"18:00"}


def test_copy_from_empty_week_keeps_destination(tmp_path):
    db = _db(tmp_path)
    db.overrides_bulk_save("2026-05-12", [
        {"day_index": 1, "role": "Cassa", "time_label": "10:00", "employee_ids": [1]},
    ])
    assert db.overrides_copy_week("2026-05-05", "2026-05-12") == 0
    assert len(db.overrides_week_get("2026-05-12")) == 1


def test_squads_single_table_wins_over_old_week_copy(tmp_path):
    db = _db(tmp_path)
    # salvataggio fatto "nella settimana A": scrive A e la tabella globale
    db.squads_week_set("2026-05-05", {"1": {"morning": {"Cassa": 1}}})
    # più tardi la tabella cambia, salvata "nella settimana B"
    db.squads_week_set("2026-05-12", {"1": {"morning": {"Cassa": 3}}})
    # la settimana A deve vedere la tabella unica attuale, non la sua copia vecchia
    assert db.squads_week_get("2026-05-05")["1"]["morning"]["Cassa"] == 3
    assert db.squads_week_get("2026-06-30")["1"]["morning"]["Cassa"] == 3


def test_employee_delete_frees_future_shifts_and_keeps_history(tmp_path):
    db = _db(tmp_path)
    a = db.employee_create({"name": "Anna"})
    b = db.employee_create({"name": "Bruno"})
    # settimana passata e settimana futura, entrambe con Anna
    db.overrides_bulk_save("2026-05-05", [
        {"day_index": 1, "role": "Cassa", "time_label": "10:00", "employee_ids": [a]},
    ])
    db.overrides_bulk_save("2026-06-02", [
        {"day_index": 1, "role": "Cassa", "time_label": "10:00", "employee_ids": [a, b]},
        {"day_index": 2, "role": "Bar", "time_label": "18:00", "employee_ids": [a]},
    ])
    usage = db.employee_usage(a, "2026-06-02")
    assert usage == {"future_slots": 2, "future_weeks": 1, "past_weeks": 1}

    freed = db.employee_delete(a, from_week_id="2026-06-02")
    assert freed == 2
    assert all(e["id"] != a for e in db.employees_list())
    # futuro: Anna tolta, Bruno resta, la cella rimasta vuota sparisce
    fut = db.overrides_week_get("2026-06-02")
    assert fut == [dict(fut[0], employee_ids=[b])] and len(fut) == 1
    # passato: storico invariato
    assert db.overrides_week_get("2026-05-05")[0]["employee_ids"] == [a]
