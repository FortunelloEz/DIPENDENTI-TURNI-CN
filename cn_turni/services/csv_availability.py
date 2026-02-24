# cn_turni/services/csv_availability.py
from __future__ import annotations
from dataclasses import dataclass
import csv
import io
import re
from datetime import date
from typing import Dict, Tuple, Optional, Set

@dataclass(frozen=True)
class DayAvailability:
    labels: Set[str]  # mezz'ore disponibili es: {"18:00","18:30",...}
    raw: Optional[str] = None
    needs_resolution: bool = False
    mode: str = "normal"  # "normal" | "indifferent"

# name -> iso_date -> DayAvailability
AvailabilityMap = Dict[str, Dict[str, DayAvailability]]

_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}


def _half_hours(start_h: int, end_h: int) -> list[str]:
    out = []
    for h in range(start_h, end_h):
        out.append(f"{h:02d}:00")
        out.append(f"{h:02d}:30")
    return out

ALL_DAY = set(_half_hours(8, 24))
MORNING = set(_half_hours(8, 16))
EVENING = set(_half_hours(16, 24))

def _norm_name(s: str) -> str:
    return " ".join((s or "").strip().upper().split())

def norm_name(s: str) -> str:
    """Public alias for name normalization (kept for cross-module consistency)."""
    return _norm_name(s)


def _extract_month_day(header: str) -> Optional[Tuple[int, int]]:
    h = (header or "").lower()
    m = re.search(
        r"\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b",
        h
    )
    if not m:
        return None
    day = int(m.group(1))
    month = _MONTHS[m.group(2)]
    return month, day

def _labels_between(start_h: int, end_h: int) -> Set[str]:
    start_h = max(8, min(24, start_h))
    end_h = max(8, min(24, end_h))
    if end_h <= start_h:
        return set()
    return set(_half_hours(start_h, end_h))

def _parse_cell(value: str) -> DayAvailability:
    s = (value or "").strip().upper()

    # vuoto -> consideriamo "NON DISPONIBILE" (come prima)
    if not s or "NON DISPONIBILE" in s:
        return DayAvailability(set())

    if "INDIFFERENTE" in s:
        # Indifferente fascia oraria: disponibile potenzialmente tutto il giorno,
        # ma verrà assegnato SOLO a una delle due metà giornata (mattina o sera) dallo scheduler.
        return DayAvailability((MORNING | EVENING), raw=value, needs_resolution=False, mode="indifferent")

    # parole
    if "MATTINA" in s:
        return DayAvailability(set(MORNING))
    if "POMERIGGIO" in s or "SERA" in s:
        return DayAvailability(set(EVENING))

    # numeri orari (es. 18-22, 18 22)
    nums = [int(x) for x in re.findall(r"\b(\d{1,2})\b", s)]

    # "18 CHIUSURA" => 18-24
    if "CHIUSURA" in s and len(nums) >= 1:
        start = nums[0]
        return DayAvailability(_labels_between(start, 24))

    # "18-22"
    if len(nums) >= 2:
        start, end = nums[0], nums[1]
        return DayAvailability(_labels_between(start, end))

    # fallback: testo non interpretabile -> richiede risoluzione manuale
    return DayAvailability(set(), raw=value, needs_resolution=True)

def parse_availability_csv(csv_text: str, *, year: Optional[int] = None) -> AvailabilityMap:
    """
    Legge il CSV (tipo Google Forms) e ritorna:
      availability[name][iso_date] = DayAvailability(labels=set([...]))
    """
    if year is None:
        year = date.today().year

    f = io.StringIO(csv_text)
    reader = csv.reader(f)
    rows = list(reader)
    if len(rows) < 2:
        return {}

    headers = rows[0]

    def _hnorm(x: str) -> str:
        return " ".join((x or "").strip().lower().split())

    hn = [_hnorm(h) for h in headers]

    # colonna nome: prima che contiene "nome"
    if "nome" in hn:
        name_idx = hn.index("nome")
    else:
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