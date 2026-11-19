from cn_turni.services.csv_availability import _half_hours
from cn_turni.services.export_service import _labels_to_range


def test_whole_hours_keep_old_format():
    assert _labels_to_range(_half_hours(8, 16)) == "8-16"
    assert _labels_to_range(_half_hours(16, 24)) == "16-ch"


def test_half_hour_start_and_end():
    assert _labels_to_range(["12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]) == "12:30-16"
    assert _labels_to_range(_half_hours(8, 15) + ["15:00"]) == "8-15:30"
    assert _labels_to_range(["18:30", "19:00", "23:30"]) == "18:30-ch"


def test_empty():
    assert _labels_to_range([]) is None


def test_export_uses_open_days_setting(tmp_path):
    from cn_turni import app_settings
    from cn_turni.db import Db
    from cn_turni.services.export_service import build_week_export, build_week_export_simple
    db = Db(str(tmp_path / "e.db"))
    assert [h["iso"] for h in build_week_export(db, "2026-05-25")["headers"]][0] == "2026-05-26"   # predefinito: da martedì
    app_settings.save(db, {"open_days": [0, 4, 5]})
    assert [h["iso"] for h in build_week_export_simple(db, "2026-05-25")["headers"]] == ["2026-05-25", "2026-05-29", "2026-05-30"]
