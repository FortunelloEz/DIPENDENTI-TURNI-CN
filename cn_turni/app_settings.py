# cn_turni/app_settings.py
"""
Impostazioni dell'app modificabili dall'utente (pagina «Impostazioni»).

Fonte unica: ogni impostazione è descritta qui (chiave, tipo, predefinito, limiti, testi).
La UI costruisce il modulo da questa descrizione e il backend valida con la stessa,
così pagina, algoritmo e controlli non possono andare fuori sincronia.
Valori salvati nella tabella `settings` con chiave "cfg.<chiave>".
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

DAY_LABELS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]

# section: titolo del gruppo nella pagina; type: int | bool | days
SCHEMA: List[Dict[str, Any]] = [
    # ---------------- Turnisti
    {
        "key": "temp_max_daily_hours", "section": "Turnisti", "type": "int",
        "default": 10, "min": 4, "max": 16, "unit": "ore",
        "label": "Ore massime al giorno",
        "help": "Vale per i turnisti che nella scheda non hanno «Ore max al giorno». "
                "Evita che chi è disponibile tutto il giorno venga messo su mattina e pomeriggio (fino a 16 ore).",
    },
    # ---------------- Indeterminati
    {
        "key": "perm_weekly_hours", "section": "Indeterminati", "type": "int",
        "default": 40, "min": 0, "max": 80, "unit": "ore",
        "label": "Ore settimanali predefinite",
        "help": "Ore di una settimana per ogni indeterminato, se nella finestra «Indeterminati» non ne hai indicate altre.",
    },
    {
        "key": "perm_max_daily_hours", "section": "Indeterminati", "type": "int",
        "default": 8, "min": 4, "max": 16, "unit": "ore",
        "label": "Ore massime al giorno",
        "help": "Vale per gli indeterminati che nella scheda non hanno «Ore max al giorno».",
    },
    {
        "key": "perm_available_if_missing", "section": "Indeterminati", "type": "bool",
        "default": True,
        "label": "Disponibili anche se non compaiono nel CSV",
        "help": "Attivo: un indeterminato che non compila il modulo delle disponibilità è considerato disponibile tutto il giorno. "
                "Spento: viene messo in turno solo nei giorni in cui compare nel CSV.",
    },
    # ---------------- Regole per tutti
    {
        "key": "min_rest_hours", "section": "Regole per tutti", "type": "int",
        "default": 0, "min": 0, "max": 16, "unit": "ore",
        "label": "Riposo minimo tra due turni",
        "help": "Ore minime tra la fine di un turno e l'inizio di quello del giorno dopo (es. chiusura alle 24 e apertura alle 8 = 8 ore). "
                "0 = non controllato. Per riferimento, la normativa generale prevede 11 ore: verifica con il tuo consulente i contratti dei tuoi dipendenti.",
    },
    {
        "key": "min_shift_hours", "section": "Regole per tutti", "type": "int",
        "default": 2, "min": 0, "max": 8, "unit": "ore",
        "label": "Durata minima di un turno",
        "help": "I pezzi di turno più corti (es. un'ora sola per tappare un buco) non vengono creati: quella fascia resta da coprire. "
                "0 = nessun minimo.",
    },
    {
        "key": "allow_split_shifts", "section": "Regole per tutti", "type": "bool",
        "default": True,
        "label": "Turni spezzati nella stessa giornata",
        "help": "Attivo: una persona può fare due turni separati nello stesso giorno (es. 8–10 e 16–24) se serve a coprire. "
                "Spento: ognuno fa un solo turno continuo al giorno (si tiene il più lungo).",
    },
    {
        "key": "open_days", "section": "Regole per tutti", "type": "days",
        "default": [1, 2, 3, 4, 5, 6],
        "label": "Giorni di apertura",
        "help": "Giorni mostrati nell'export (PDF ed Excel). I giorni di chiusura non vengono esportati.",
    },
    # ---------------- Dati
    {
        "key": "retention_months", "section": "Dati", "type": "int",
        "default": 6, "min": 0, "max": 60, "unit": "mesi",
        "label": "Conserva le settimane per",
        "help": "All'avvio l'app cancella le settimane più vecchie di così (prima ne fa un backup). 0 = non cancellare mai.",
    },
]

_BY_KEY = {s["key"]: s for s in SCHEMA}


def _validate(spec: Dict[str, Any], value: Any) -> Any:
    t = spec["type"]
    if t == "int":
        try:
            v = int(round(float(value)))
        except (TypeError, ValueError):
            raise ValueError(f"«{spec['label']}»: serve un numero.")
        if not spec["min"] <= v <= spec["max"]:
            raise ValueError(f"«{spec['label']}»: il valore deve essere tra {spec['min']} e {spec['max']}.")
        return v
    if t == "bool":
        if isinstance(value, str):
            return value.strip().lower() in ("1", "true", "si", "sì", "on")
        return bool(value)
    if t == "days":
        try:
            days = sorted({int(x) for x in (value or [])})
        except (TypeError, ValueError):
            raise ValueError(f"«{spec['label']}»: giorni non validi.")
        if not days or any(d < 0 or d > 6 for d in days):
            raise ValueError(f"«{spec['label']}»: scegli almeno un giorno.")
        return days
    raise ValueError(f"Tipo di impostazione sconosciuto: {t}")


def load(db: Any) -> Dict[str, Any]:
    """Tutti i valori, con il predefinito dove manca o dove il valore salvato non è più valido."""
    out: Dict[str, Any] = {}
    for spec in SCHEMA:
        raw = db.settings_get(f"cfg.{spec['key']}")
        if raw is None:
            out[spec["key"]] = spec["default"]
            continue
        try:
            out[spec["key"]] = _validate(spec, json.loads(raw))
        except (ValueError, TypeError):
            out[spec["key"]] = spec["default"]
    return out


def save(db: Any, values: Dict[str, Any]) -> Dict[str, Any]:
    """Valida TUTTO prima di scrivere: o si salvano tutte le impostazioni o nessuna."""
    clean = {}
    for key, value in (values or {}).items():
        spec = _BY_KEY.get(key)
        if spec is None:
            raise ValueError(f"Impostazione sconosciuta: {key}")
        clean[key] = _validate(spec, value)
    db.settings_set_many({f"cfg.{k}": json.dumps(v) for k, v in clean.items()})
    return load(db)


def schema_for_ui() -> List[Dict[str, Any]]:
    return [dict(s, day_labels=DAY_LABELS) if s["type"] == "days" else dict(s) for s in SCHEMA]
