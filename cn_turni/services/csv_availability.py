# cn_turni/services/csv_availability.py
from __future__ import annotations
from dataclasses import dataclass
import csv
import io
import re
import unicodedata
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

def _strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(ch for ch in s if not unicodedata.combining(ch))

def _normalize_header(s: str) -> str:
    s = _strip_accents(s).lower()
    s = re.sub(r"[_\-–—:/,;|()\[\]]+", " ", s)
    s = " ".join(s.split())
    return s

ALL_DAY = set(_half_hours(8, 24))
MORNING = set(_half_hours(8, 16))
EVENING = set(_half_hours(16, 24))

def _norm_name(s: str) -> str:
    return " ".join((s or "").strip().upper().split())

def norm_name(s: str) -> str:
    """Public alias for name normalization (kept for cross-module consistency)."""
    return _norm_name(s)


def _extract_month_day(header: str) -> Optional[Tuple[int, int]]:
    h = _normalize_header(header)

    # caso classico: "venerdi 17 aprile" / "17 aprile"
    m = re.search(
        r"\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b",
        h
    )
    if m:
        day = int(m.group(1))
        month = _MONTHS[m.group(2)]
        return month, day

    # fallback: "aprile 17"
    m = re.search(
        r"\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{1,2})\b",
        h
    )
    if m:
        month = _MONTHS[m.group(1)]
        day = int(m.group(2))
        return month, day

    return None

def _labels_between(start_h: int, end_h: int) -> Set[str]:
    return _labels_between_hh(start_h * 2, end_h * 2)


def _labels_between_hh(start_idx: int, end_idx: int) -> Set[str]:
    """Labels tra due indici di mezz'ora (idx = ore*2 + 1 se :30), limitati a 08:00-24:00."""
    start_idx = max(16, min(48, start_idx))
    end_idx = max(16, min(48, end_idx))
    if end_idx <= start_idx:
        return set()
    return {f"{i // 2:02d}:{'30' if i % 2 else '00'}" for i in range(start_idx, end_idx)}


# Orario: "18", "12:30", "12.30", "9,30"
_TIME_RE = re.compile(r"\b(\d{1,2})(?:\s*[:.,]\s*(\d{2}))?\b")


def _extract_times_hh(s: str) -> list[int]:
    """Estrae gli orari dalla cella come indici di mezz'ora. I minuti >= 30 contano come mezz'ora."""
    out: list[int] = []
    for m in _TIME_RE.finditer(s):
        h = int(m.group(1))
        mins = int(m.group(2)) if m.group(2) else 0
        if h > 24 or mins > 59:
            continue
        out.append(h * 2 + (1 if mins >= 30 else 0))
    return out

def _parse_cell(value: str) -> DayAvailability:
    raw = value or ""
    s = _strip_accents(raw).strip().upper()

    if not s or "NON DISPONIBILE" in s or s in {"NO", "N", "X", "-"}:
        return DayAvailability(set())

    if any(tok in s for tok in {"INDIFFERENTE", "FULL", "TUTTO IL GIORNO", "INTERA GIORNATA"}):
        return DayAvailability((MORNING | EVENING), raw=value, needs_resolution=False, mode="indifferent")

    has_morning = any(tok in s for tok in {"MATTINA", "MATT"})
    has_evening = any(tok in s for tok in {"POMERIGGIO", "POME", "SERA", "PM"})

    if has_morning and has_evening:
        return DayAvailability(MORNING | EVENING)

    if has_morning:
        return DayAvailability(set(MORNING))

    if has_evening:
        return DayAvailability(set(EVENING))

    times = _extract_times_hh(s)

    if "CHIUSURA" in s and len(times) >= 1:
        labels = _labels_between_hh(times[0], 48)
        if labels:
            return DayAvailability(labels)
        return DayAvailability(set(), raw=value, needs_resolution=True)

    if len(times) >= 2:
        labels = _labels_between_hh(times[0], times[1])
        if labels:
            return DayAvailability(labels)
        # es. "18-01": fine dopo mezzanotte o intervallo incoerente -> lo chiede all'utente
        return DayAvailability(set(), raw=value, needs_resolution=True)

    return DayAvailability(set(), raw=value, needs_resolution=True)

def _resolve_year(month: int, day: int, year: int, ref: Optional[date]) -> date:
    """
    Sceglie l'anno della data. Con una data di riferimento (la settimana scelta in UI)
    prende tra anno-1, anno e anno+1 quello più vicino: così un CSV a cavallo di
    Capodanno (30 dicembre / 2 gennaio) resta nella stessa settimana.
    """
    if ref is None:
        return date(year, month, day)
    best: Optional[date] = None
    for y in (year - 1, year, year + 1):
        try:
            cand = date(y, month, day)
        except ValueError:  # es. 29 febbraio in anno non bisestile
            continue
        if best is None or abs((cand - ref).days) < abs((best - ref).days):
            best = cand
    if best is None:
        raise ValueError(f"CSV: data non valida {day}/{month}.")
    return best


def parse_availability_csv(
        csv_text: str,
        *,
        year: Optional[int] = None,
        ref_date: Optional[date] = None,
) -> AvailabilityMap:
    """
    Legge il CSV (tipo Google Forms) e ritorna:
      availability[name][iso_date] = DayAvailability(labels=set([...]))
    ref_date: data di riferimento per scegliere l'anno vicino a Capodanno.
    """
    if year is None:
        year = ref_date.year if ref_date else date.today().year

    f = io.StringIO(csv_text)
    reader = csv.reader(f)
    rows = list(reader)
    if len(rows) < 2:
        return {}

    headers = rows[0]

    hn = [_normalize_header(h) for h in headers]

    name_idx = next(
        (
            i
            for i, h in enumerate(hn)
            if (
                ("nome" in h and "utente" not in h)
                or "dipendente" in h
                or "persona" in h
                or "collaboratore" in h
        )
        ),
        2,
    )
    date_cols = []
    for i, h in enumerate(headers):
        md = _extract_month_day(h)
        if md:
            month, day = md
            iso = _resolve_year(month, day, year, ref_date).isoformat()
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