from datetime import date

from cn_turni.services.csv_availability import _parse_cell, parse_availability_csv


def _range(cell: str):
    d = _parse_cell(cell)
    labels = sorted(d.labels)
    return (labels[0], labels[-1]) if labels else None, d.needs_resolution


def test_half_hour_start_is_respected():
    assert _range("12:30-16") == (("12:30", "15:30"), False)
    assert _range("12.30 - 16") == (("12:30", "15:30"), False)


def test_half_hour_end_is_respected():
    assert _range("10-14:30") == (("10:00", "14:00"), False)


def test_whole_hours_unchanged():
    assert _range("10-15") == (("10:00", "14:30"), False)
    assert _range("dalle 18 a chiusura") == (("18:00", "23:30"), False)


def test_after_midnight_asks_user():
    assert _range("18-01") == (None, True)


def test_morning_and_evening_means_both():
    assert _range("MATTINA E SERA") == (("08:00", "23:30"), False)
    assert _range("mattina") == (("08:00", "15:30"), False)
    assert _range("sera") == (("16:00", "23:30"), False)


def test_unavailable():
    assert _range("NON DISPONIBILE") == (None, False)


def test_new_year_csv_uses_nearest_year():
    csv_text = (
        "Timestamp,Utente,Nome,Martedì 30 dicembre,Venerdì 2 gennaio\n"
        "x,y,MARIO,10-16,18-24\n"
    )
    av = parse_availability_csv(csv_text, year=2026, ref_date=date(2026, 12, 28))
    assert set(av["MARIO"].keys()) == {"2026-12-30", "2027-01-02"}

    av = parse_availability_csv(csv_text, year=2027, ref_date=date(2026, 12, 29).replace(year=2027, month=1, day=1))
    assert set(av["MARIO"].keys()) == {"2026-12-30", "2027-01-02"}
