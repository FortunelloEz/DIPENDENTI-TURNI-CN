# cn_turni/services/csv_availability.py
from __future__ import annotations
from dataclasses import dataclass
import csv
import io
import re
from datetime import date
from typing import Dict, Tuple, Optional


@dataclass(frozen=True)
class DayAvailability:
    morning: bool  # 08-16
    evening: bool  # 16-24


# name -> iso_date -> DayAvailability
AvailabilityMap = Dict[str, Dict[str, DayAvailability]]


_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}


def _norm_name(s: str) -> str:
    return " ".join((s or "").strip().upper().split())


def _extract_month_day(header: str) -> Optional[Tuple[int, int]]:
    h = (header or "").lower()
    m = re.search(r"\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b", h)
    if not m:
        return None
    day = int(m.group(1))
    month = _MONTHS[m.group(2)]
    return month, day


def _parse_cell(value: str) -> DayAvailability:
    s = (value or "").strip().upper()
    if not s or "NON DISPONIBILE" in s:
        return DayAvailability(False, False)
    if "INDIFFERENTE" in s:
        return DayAvailability(True, True)

    nums = [int(x) for x in re.findall(r"\b(\d{1,2})\b", s)]
    if "CHIUSURA" in s and 16 in nums:
        return DayAvailability(False, True)

    if len(nums) >= 2:
        start, end = nums[0], nums[1]
        morning = (start < 16) and (end > 8)
        evening = (end > 16) or (start >= 16)
        return DayAvailability(morning, evening)

    if "MATTINA" in s:
        return DayAvailability(True, False)
    if "POMERIGGIO" in s or "SERA" in s:
        return DayAvailability(False, True)

    return DayAvailability(True, True)


def parse_availability_csv(csv_text: str, *, year: Optional[int] = None) -> AvailabilityMap:
    """
    Legge il CSV (tipo Google Forms) e ritorna:
      availability[name][iso_date] = {morning, evening}
    """
    if year is None:
        year = date.today().year

    f = io.StringIO(csv_text)
    reader = csv.reader(f)
    rows = list(reader)
    if len(rows) < 2:
        return {}

    headers = rows[0]
    # colonna nome: prima che contiene "nome"
    def _hnorm(x: str) -> str:
        return " ".join((x or "").strip().lower().split())

    hn = [_hnorm(h) for h in headers]

    # priorità: "nome" esatto
    if "nome" in hn:
        name_idx = hn.index("nome")
    else:
        # fallback: prima colonna che contiene "nome" MA non contiene "utente"
        name_idx = next((i for i, h in enumerate(hn) if ("nome" in h and "utente" not in h)), 2)

    date_cols = []
    for i, h in enumerate(headers):
        md = _extract_month_day(h)
        if md:
            month, day = md
            iso = date(year, month, day).isoformat()
            date_cols.append((i, iso))

    if not date_cols:
        raise ValueError("CSV: non trovo colonne data tipo 'Venerdì 9 Gennaio'.")

    out: AvailabilityMap = {}
    for row in rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        name_raw = row[name_idx] if name_idx < len(row) else ""
        name = _norm_name(name_raw)
        if not name:
            continue
        out.setdefault(name, {})
        for idx, iso in date_cols:
            cell = row[idx] if idx < len(row) else ""
            out[name][iso] = _parse_cell(cell)

    return out
