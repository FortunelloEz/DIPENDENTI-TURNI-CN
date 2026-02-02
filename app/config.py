# app/config.py
# =========================
# Gestisce configurazioni di default e caricamento/salvataggio delle impostazioni persistite nel database.
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any

DEFAULT_SETTINGS: Dict[str, Any] = {
    "week_start": "tue",  # mar-dom
    "slot_minutes": 30,
    "skills": ["sala", "bar", "cucina"],
    "need_per_slot": {  # esempio: planner userà questa struttura
        "default": {"sala": 1, "bar": 1, "cucina": 1}
    },
}

@dataclass(frozen=True)
class AppConfig:
    week_start: str
    slot_minutes: int

def load_config(settings: Dict[str, Any]) -> AppConfig:
    return AppConfig(
        week_start=settings.get("week_start", DEFAULT_SETTINGS["week_start"]),
        slot_minutes=int(settings.get("slot_minutes", DEFAULT_SETTINGS["slot_minutes"])),
    )
