# app/utils/dates.py
# =========================
# Gestisce logiche temporali: settimane mar–dom, slot da 30 minuti, parsing orari e finestre critiche.
from __future__ import annotations

from datetime import date, timedelta

def week_days_from_start(week_start_iso: str, days: int) -> list[str]:
    """
    week_start_iso: YYYY-MM-DD (martedì).
    days=6 => mar-dom (7 giorni totali? attenzione: qui è 6 offset -> 7 giorni)
    """
    y, m, d = [int(x) for x in week_start_iso.split("-")]
    start = date(y, m, d)
    return [(start + timedelta(days=i)).isoformat() for i in range(days + 1)]
