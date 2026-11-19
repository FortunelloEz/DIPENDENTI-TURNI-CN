# cn_turni/services/assistant.py
"""
Assistente turni LOCALE: nessun modello di linguaggio, nessuna rete, nessuna chiave.

Capisce un insieme chiuso di richieste in italiano scritte in modo libero e risponde
leggendo SOLO il database. Non inventa: se un dato manca lo dice.

Informazioni:  scoperti / chi è libero / ore di una persona / giorno più critico / riepilogo
Modifiche:     sostituisci A con B · aggiungi A · togli A
Le modifiche non vengono mai applicate da `ask`: `ask` restituisce un'anteprima e
un'azione strutturata; `apply` RICALCOLA l'azione sul DB del momento e la scrive in
un'unica transazione (Db.overrides_set_cells).
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from cn_turni.db import week_id_from_ui_weekkey

ROLES = ["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"]
DAY_NAMES = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
SHIFT_NAMES = {"morning": "mattina", "evening": "pomeriggio"}


def _half_hours(start_h: int, end_h: int) -> List[str]:
    return [f"{h:02d}:{m}" for h in range(start_h, end_h) for m in ("00", "30")]


SHIFT_LABELS = {"morning": _half_hours(8, 16), "evening": _half_hours(16, 24)}
ALL_LABELS = SHIFT_LABELS["morning"] + SHIFT_LABELS["evening"]

# ---------------------------------------------------------------- vocabolario
DAY_WORDS = {
    "lunedi": 0, "lun": 0, "martedi": 1, "mar": 1, "mercoledi": 2, "mer": 2,
    "giovedi": 3, "gio": 3, "venerdi": 4, "ven": 4, "sabato": 5, "sab": 5,
    "domenica": 6, "dom": 6,
}
SHIFT_WORDS = {
    "mattina": "morning", "mattino": "morning", "mattinata": "morning", "pranzo": "morning",
    "sera": "evening", "serata": "evening", "pomeriggio": "evening", "cena": "evening",
}
ROLE_WORDS = {
    "cassa": "Cassa", "runner": "Runner", "bar": "Bar", "comande": "Comande", "comanda": "Comande",
    "accoglienza": "Accoglienza", "jolly": "Jolly",
}
# parole comuni che possono coincidere con un nome ("Della", "Mar"...): valgono come nome
# solo se nella frase non c'è un nome più sicuro
STOPWORDS = {
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "del", "della", "dei", "delle",
    "da", "dal", "dalla", "in", "nel", "nella", "a", "al", "alla", "con", "su", "per", "tra", "fra",
    "e", "o", "che", "chi", "turno", "turni", "settimana", "oggi", "domani", "tutto", "tutti",
    "mi", "ci", "si", "posto", "ore", "quanto", "quante", "fa", "fai",
}

HELP_TEXT = [
    "Posso darti informazioni sulla settimana aperta in Home e fare piccole modifiche, sempre con la tua conferma.",
    "Informazioni:",
    "• «Cosa manca sabato?» · «Chi è scoperto questa settimana?»",
    "• «Chi lavora sabato?» · «Chi è libero domenica sera?»",
    "• «Quante ore fa Simone?»",
    "• «Qual è il giorno più critico?» · «Riepilogo della settimana»",
    "Modifiche (ti mostro sempre l'anteprima prima di salvare):",
    "• «Sostituisci Simone con Della sabato sera»",
    "• «Aggiungi Matteo in cassa domenica mattina»",
    "• «Togli Leonardo da domenica»",
]
SUGGESTIONS = [
    "Cosa manca questa settimana?",
    "Qual è il giorno più critico?",
    "Chi è libero sabato sera?",
]


def norm(s: str) -> str:
    """minuscolo, senza accenti e punteggiatura, spazi singoli"""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def _labels_to_ranges(labels: List[str]) -> str:
    """["16:00","16:30",...,"23:30"] -> "16:00–24:00" (più intervalli separati da virgola)"""
    idx = sorted({int(t[:2]) * 2 + (1 if t[3:] == "30" else 0) for t in labels})
    if not idx:
        return ""
    fmt = lambda i: f"{i // 2:02d}:{'30' if i % 2 else '00'}"
    out, start, prev = [], idx[0], idx[0]
    for i in idx[1:] + [None]:
        if i is not None and i == prev + 1:
            prev = i
            continue
        out.append(f"{fmt(start)}–{fmt(prev + 1)}")
        if i is not None:
            start = prev = i
    return ", ".join(out)


def _range_to_labels(rng: str) -> Set[str]:
    """ "12:30-16" / "08-16" (formato dell'anteprima disponibilità) -> mezz'ore """
    m = re.match(r"^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*$", str(rng or ""))
    if not m:
        return set()
    a = int(m.group(1)) * 2 + (1 if (m.group(2) or "00") >= "30" else 0)
    b = int(m.group(3)) * 2 + (1 if (m.group(4) or "00") >= "30" else 0)
    return {t for t in ALL_LABELS if a <= int(t[:2]) * 2 + (1 if t[3:] == "30" else 0) < b}


@dataclass
class Emp:
    id: int
    name: str
    skills: Dict[str, int]
    keys_strong: Set[str]   # nome completo e alias normalizzati
    keys_weak: Set[str]     # singole parole del nome (>= 3 lettere)


class Assistant:
    def __init__(self, db: Any):
        self.db = db

    # ------------------------------------------------------------ dati della settimana
    def _load(self, week_key: str) -> Dict[str, Any]:
        week_id = week_id_from_ui_weekkey(week_key)
        emps: List[Emp] = []
        for r in self.db.employees_list():
            full = norm(r["name"])
            strong = {full}
            for a in re.split(r"[|,;]+", r.get("aliases") or ""):
                if norm(a):
                    strong.add(norm(a))
            weak = {t for t in full.split() if len(t) >= 3}
            emps.append(Emp(int(r["id"]), str(r["name"]), {k: int(v) for k, v in (r.get("skills") or {}).items()}, strong, weak))

        # cells[(day, role, label)] = [ids]
        cells: Dict[Tuple[int, str, str], List[int]] = {}
        for o in self.db.overrides_week_get(week_id):
            ids = [int(x) for x in (o.get("employee_ids") or [])]
            if ids:
                cells[(int(o["day_index"]), str(o["role"]), str(o["time_label"]))] = ids

        squads = {int(k): v for k, v in (self.db.squads_week_get(week_id) or {}).items()}

        # disponibilità dal CSV: avail[day][emp_id] = set(mezz'ore); None = nessun CSV per la settimana
        avail: Optional[Dict[int, Dict[int, Set[str]]]] = None
        raw = self.db.availability_get(week_id)
        if raw.get("ok"):
            try:
                prev = json.loads(raw["data"])
                by_name = {norm(e.name): e.id for e in emps}
                avail = {}
                for d in prev.get("days", []):
                    di = int(d.get("day_index"))
                    for it in d.get("items", []):
                        eid = by_name.get(norm(it.get("name", "")))
                        if eid is not None:
                            avail.setdefault(di, {})[eid] = _range_to_labels(it.get("range", ""))
            except (ValueError, TypeError, KeyError):
                avail = None

        monday = date.fromisoformat(week_key)
        return {"week_key": week_key, "week_id": week_id, "emps": emps, "cells": cells,
                "squads": squads, "avail": avail, "monday": monday}

    @staticmethod
    def _week_text(data: Dict[str, Any]) -> str:
        m: date = data["monday"]
        e = m + timedelta(days=6)
        return f"{m:%d/%m} → {e:%d/%m}"

    @staticmethod
    def _day_text(data: Dict[str, Any], d: int) -> str:
        return f"{DAY_NAMES[d]} {(data['monday'] + timedelta(days=d)):%d/%m}"

    # ------------------------------------------------------------ copertura (stessa regola del calendario)
    def _coverage(self, data: Dict[str, Any], d: int) -> List[Dict[str, Any]]:
        out = []
        for shift in ("morning", "evening"):
            need = (data["squads"].get(d, {}) or {}).get(shift, {}) or {}
            for role in ROLES:
                req = int(need.get(role, 0) or 0)
                if req <= 0:
                    continue
                people: Set[int] = set()
                for t in SHIFT_LABELS[shift]:
                    people.update(data["cells"].get((d, role, t), []))
                out.append({"shift": shift, "role": role, "required": req, "covered": min(len(people), req)})
        return out

    # ------------------------------------------------------------ riconoscimento della frase
    def _parse_slots(self, text_n: str, data: Dict[str, Any]) -> Dict[str, Any]:
        toks = text_n.split()
        day = next((DAY_WORDS[t] for t in toks if t in DAY_WORDS), None)
        if day is None:
            today = date.today()
            off = (today - data["monday"]).days
            if "oggi" in toks and 0 <= off <= 6:
                day = off
            elif "domani" in toks and 0 <= off + 1 <= 6:
                day = off + 1
        shift = next((SHIFT_WORDS[t] for t in toks if t in SHIFT_WORDS), None)
        role = next((ROLE_WORDS[t] for t in toks if t in ROLE_WORDS), None)
        return {"day": day, "shift": shift, "role": role}

    def _find_names(self, text_n: str, emps: List[Emp]) -> List[Tuple[int, List[Emp], bool]]:
        """
        Nomi citati, in ordine di posizione: [(posizione, candidati, sicuro)].
        sicuro=False se la parola è anche una parola comune (es. «della»).
        """
        toks = text_n.split()
        common = STOPWORDS | set(DAY_WORDS) | set(ROLE_WORDS) | set(SHIFT_WORDS)
        strong: Dict[str, Set[int]] = {}
        for e in emps:
            for k in e.keys_strong:
                strong.setdefault(k, set()).add(e.id)
        weak: Dict[str, Set[int]] = {}
        for e in emps:
            for w in e.keys_weak:
                weak.setdefault(w, set()).add(e.id)
        max_len = max((len(k.split()) for k in strong), default=1)

        out: List[Tuple[int, Set[int], bool]] = []
        i = 0
        while i < len(toks):
            hit = None
            # 1) nome completo o alias: la sequenza di parole più lunga che corrisponde
            for n in range(min(max_len, len(toks) - i), 0, -1):
                key = " ".join(toks[i:i + n])
                if key in strong:
                    hit = (n, strong[key], not (n == 1 and key in common))
                    break
            # 2) una sola parola del nome (es. «simone» per «Simone Rossi»)
            if hit is None and toks[i] in weak:
                hit = (1, weak[toks[i]], toks[i] not in common)
            # 3) inizio di una parola del nome (es. «leo» per «Leonardo»), solo se non è una parola comune
            if hit is None and len(toks[i]) >= 3 and toks[i] not in common:
                ids = {eid for w, s in weak.items() if w.startswith(toks[i]) for eid in s}
                if ids:
                    hit = (1, ids, True)
            if hit:
                out.append((i, hit[1], hit[2]))
                i += hit[0]
            else:
                i += 1
        by_id = {e.id: e for e in emps}
        return [(pos, [by_id[x] for x in sorted(ids)], sure) for pos, ids, sure in out]

    @staticmethod
    def _pick(names: List[Tuple[int, List[Emp], bool]]) -> List[Tuple[int, List[Emp], bool]]:
        """se ci sono nomi sicuri, le parole comuni (es. «della») non contano come nomi"""
        sure = [n for n in names if n[2]]
        return sure if sure else names

    # ------------------------------------------------------------ API pubblica
    def ask(self, week_key: str, text: str) -> Dict[str, Any]:
        data = self._load(week_key)
        t = norm(text)
        if not t:
            return self._reply(["Scrivi una domanda, per esempio «Cosa manca sabato?»."], suggestions=SUGGESTIONS)
        slots = self._parse_slots(t, data)
        has = lambda *words: any(re.search(rf"\b{w}", t) for w in words)

        if has("aiuto", "help", "cosa sai", "cosa puoi", "comandi", "come funzion"):
            return self._reply(HELP_TEXT, title="Cosa posso fare", suggestions=SUGGESTIONS)
        if has("sostitu", "scambia", "cambia") or " al posto di " in f" {t} ":
            return self._plan_reply(data, {"type": "replace", "text": t, **slots})
        if has("togli", "rimuovi", "leva ", "elimina", "cancella"):
            return self._plan_reply(data, {"type": "remove", "text": t, **slots})
        if has("aggiungi", "metti", "inserisci", "assegna"):
            return self._plan_reply(data, {"type": "add", "text": t, **slots})
        if has("chi lavora", "chi c e", "chi ce ", "chi e in turno", "chi sono in turno", "in servizio"):
            return self._answer_who_works(data, slots)
        if has("liber", "disponibil", "chi puo", "chi potrebbe"):
            return self._answer_free(data, slots)
        if has("ore", "quanto lavora", "quando lavora", "turni di", "orari di"):
            return self._answer_hours(data, t)
        if has("critic", "peggio", "peggior", "piu scopert", "piu difficile"):
            return self._answer_critical(data)
        if has("manca", "mancano", "scopert", "buch", "copertura", "coperto", "copert"):
            return self._answer_uncovered(data, slots)
        if has("riepilogo", "situazione", "come va", "come siamo", "panoramica"):
            return self._answer_summary(data)
        # una persona citata da sola: mostro i suoi turni
        if self._pick(self._find_names(t, data["emps"])):
            return self._answer_hours(data, t)
        return self._reply(
            ["Non ho capito la richiesta. Prova con una di queste, oppure scrivi «aiuto»."],
            suggestions=SUGGESTIONS,
        )

    def apply(self, week_key: str, action: Dict[str, Any]) -> Dict[str, Any]:
        """Ricalcola l'azione sul DB attuale e la scrive in un'unica transazione."""
        data = self._load(week_key)
        plan = self._plan(data, dict(action or {}))
        if plan.get("error") or not plan.get("items"):
            return {"ok": False, "error": plan.get("error") or "Non c'è più niente da modificare: i turni sono cambiati nel frattempo."}
        self.db.overrides_set_cells(data["week_id"], plan["items"])
        return {"ok": True, "message": plan["done"]}

    # ------------------------------------------------------------ risposte informative
    @staticmethod
    def _reply(lines: List[str], title: str = "", suggestions: Optional[List[str]] = None, action: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"ok": True, "title": title, "lines": lines, "suggestions": suggestions or [], "action": action}

    def _answer_uncovered(self, data, slots) -> Dict[str, Any]:
        days = [slots["day"]] if slots["day"] is not None else range(7)
        lines, any_need = [], False
        for d in days:
            cov = self._coverage(data, d)
            any_need = any_need or bool(cov)
            miss = [c for c in cov if c["covered"] < c["required"] and (slots["shift"] in (None, c["shift"]))]
            if miss:
                parts = ", ".join(f"{c['role']} {SHIFT_NAMES[c['shift']]} {c['covered']}/{c['required']}" for c in miss)
                lines.append(f"• {self._day_text(data, d)}: {parts}")
        where = self._day_text(data, slots["day"]) if slots["day"] is not None else f"la settimana {self._week_text(data)}"
        if not any_need:
            return self._reply([f"Per {where.lower()} non è impostato nessun fabbisogno (pagina Squadre)."])
        if not lines:
            return self._reply([f"Per {where.lower()} tutti i ruoli richiesti sono coperti."], title="Tutto coperto")
        return self._reply(lines, title=f"Scoperti · {where}",
                           suggestions=["Chi è libero " + (DAY_NAMES[slots["day"]].lower() if slots["day"] is not None else "sabato") + "?"])

    def _answer_free(self, data, slots) -> Dict[str, Any]:
        if data["avail"] is None:
            return self._reply(["Per questa settimana non ci sono disponibilità importate: usa «Importa CSV» in Home."])
        if slots["day"] is None:
            return self._reply(["Per quale giorno? Per esempio «Chi è libero sabato sera?»."])
        d = slots["day"]
        labels = set(SHIFT_LABELS[slots["shift"]]) if slots["shift"] else set(ALL_LABELS)
        busy = {eid for (dd, _r, tl), ids in data["cells"].items() if dd == d and tl in labels for eid in ids}
        by_id = {e.id: e for e in data["emps"]}
        rows = []
        for eid, av in (data["avail"].get(d) or {}).items():
            inter = av & labels
            if not inter or eid in busy or eid not in by_id:
                continue
            e = by_id[eid]
            best = sorted(((s, r) for r, s in e.skills.items() if s > 0), reverse=True)[:2]
            skill_txt = (" · " + ", ".join(f"{r} {s}" for s, r in best)) if best else " · nessuna skill"
            rows.append((e.name, f"• {e.name} — {_labels_to_ranges(sorted(inter))}{skill_txt}"))
        where = self._day_text(data, d) + (f" {SHIFT_NAMES[slots['shift']]}" if slots["shift"] else "")
        if not rows:
            return self._reply([f"Nessuno è libero {where.lower()}: chi ha dato disponibilità è già in turno, o non ci sono disponibilità per quel giorno."])
        return self._reply([r for _, r in sorted(rows)], title=f"Liberi · {where}")

    def _answer_who_works(self, data, slots) -> Dict[str, Any]:
        if slots["day"] is None:
            return self._reply(["Per quale giorno? Per esempio «Chi lavora sabato sera?»."])
        d = slots["day"]
        by_id = {e.id: e for e in data["emps"]}
        lines = []
        for shift in ("morning", "evening"):
            if slots["shift"] not in (None, shift):
                continue
            per: Dict[Tuple[str, int], Set[str]] = {}
            for (dd, role, tl), ids in data["cells"].items():
                if dd == d and tl in SHIFT_LABELS[shift]:
                    for i in ids:
                        per.setdefault((role, i), set()).add(tl)
            if not per:
                continue
            lines.append(f"{SHIFT_NAMES[shift].capitalize()}:")
            for (role, i), ls in sorted(per.items(), key=lambda x: (ROLES.index(x[0][0]) if x[0][0] in ROLES else 99, by_id[x[0][1]].name if x[0][1] in by_id else "")):
                name = by_id[i].name if i in by_id else "Ex dipendente"
                lines.append(f"• {role}: {name} ({_labels_to_ranges(sorted(ls))})")
        where = self._day_text(data, d) + (f" {SHIFT_NAMES[slots['shift']]}" if slots["shift"] else "")
        if not lines:
            return self._reply([f"Nessuno è in turno {where.lower()}."])
        return self._reply(lines, title=f"In turno · {where}")

    def _emp_from_text(self, data, t) -> Tuple[Optional[Emp], Optional[Dict[str, Any]]]:
        names = self._pick(self._find_names(t, data["emps"]))
        if not names:
            return None, self._reply(["Di chi? Scrivi il nome, per esempio «Quante ore fa Simone?»."])
        cands = names[0][1]
        if len(cands) > 1:
            return None, self._reply([f"Quale? {', '.join(e.name for e in cands)}. Scrivi il nome completo."])
        return cands[0], None

    def _answer_hours(self, data, t) -> Dict[str, Any]:
        e, err = self._emp_from_text(data, t)
        if err:
            return err
        per_day: Dict[int, Dict[str, Set[str]]] = {}
        for (d, role, tl), ids in data["cells"].items():
            if e.id in ids:
                per_day.setdefault(d, {}).setdefault(role, set()).add(tl)
        if not per_day:
            return self._reply([f"{e.name} non ha turni nella settimana {self._week_text(data)}."])
        total = sum(len(set().union(*roles.values())) for roles in per_day.values()) / 2
        lines = [f"Totale: {str(total).replace('.0', '').replace('.', ',')} ore nella settimana {self._week_text(data)}."]
        for d in sorted(per_day):
            parts = "; ".join(f"{role} {_labels_to_ranges(sorted(ls))}" for role, ls in sorted(per_day[d].items()))
            lines.append(f"• {self._day_text(data, d)}: {parts}")
        return self._reply(lines, title=e.name)

    def _answer_critical(self, data) -> Dict[str, Any]:
        rows = []
        for d in range(7):
            cov = self._coverage(data, d)
            req = sum(c["required"] for c in cov)
            if req:
                got = sum(c["covered"] for c in cov)
                rows.append((got / req, d, req - got))
        if not rows:
            return self._reply(["Non è impostato nessun fabbisogno (pagina Squadre): non posso confrontare i giorni."])
        ratio, d, missing = min(rows)
        if missing == 0:
            return self._reply([f"Nessun giorno critico: nella settimana {self._week_text(data)} è tutto coperto."], title="Tutto coperto")
        return self._reply(
            [f"{self._day_text(data, d)}: coperto al {round(ratio * 100)}%, mancano {missing} {'persona' if missing == 1 else 'persone'}."],
            title="Giorno più critico",
            suggestions=[f"Cosa manca {DAY_NAMES[d].lower()}?", f"Chi è libero {DAY_NAMES[d].lower()}?"],
        )

    def _answer_summary(self, data) -> Dict[str, Any]:
        req = got = 0
        gaps = []
        for d in range(7):
            cov = self._coverage(data, d)
            r, g = sum(c["required"] for c in cov), sum(c["covered"] for c in cov)
            req, got = req + r, got + g
            if g < r:
                gaps.append(DAY_NAMES[d])
        if not req:
            return self._reply(["Non è impostato nessun fabbisogno (pagina Squadre)."])
        people = {i for ids in data["cells"].values() for i in ids}
        lines = [f"Copertura della settimana {self._week_text(data)}: {round(got / req * 100)}%.",
                 f"Persone in turno: {len(people)}."]
        lines.append("Giorni con buchi: " + ", ".join(gaps) + "." if gaps else "Nessun giorno con buchi.")
        return self._reply(lines, title="Riepilogo", suggestions=["Cosa manca questa settimana?"] if gaps else [])

    # ------------------------------------------------------------ modifiche: piano + anteprima
    def _plan_reply(self, data, action) -> Dict[str, Any]:
        plan = self._plan(data, action)
        if plan.get("error"):
            return self._reply([plan["error"]])
        return self._reply(
            [], title=plan["title"],
            action={"params": plan["params"], "preview": plan["preview"], "warnings": plan["warnings"],
                    "confirm": plan["confirm"]},
        )

    def _plan(self, data, a: Dict[str, Any]) -> Dict[str, Any]:
        # 1° passaggio (ask): dalla frase. 2° passaggio (apply): dai parametri già risolti,
        # che contengono anche il tipo dell'azione.
        if "params" in a:
            a = dict(a["params"])
        kind = a.get("type")
        by_id = {e.id: e for e in data["emps"]}
        day, shift, role = a.get("day"), a.get("shift"), a.get("role")

        def need_day():
            return {"error": "Per quale giorno? Aggiungi il giorno alla frase (es. «sabato»)."}

        def resolve(part_text: str) -> Tuple[Optional[Emp], Optional[str]]:
            names = self._pick(self._find_names(part_text, data["emps"]))
            if not names:
                return None, "Non trovo il nome del dipendente nella frase."
            cands = names[0][1]
            if len(cands) > 1:
                return None, f"Quale? {', '.join(e.name for e in cands)}. Scrivi il nome completo."
            return cands[0], None

        def emp_param(key: str, text_part: str) -> Tuple[Optional[Emp], Optional[str]]:
            if a.get(key) is not None:
                e = by_id.get(int(a[key]))
                return (e, None) if e else (None, "Il dipendente non esiste più.")
            return resolve(text_part)

        if day is None:
            return need_day()
        labels_day = SHIFT_LABELS[shift] if shift else ALL_LABELS
        # dentro le frasi il giorno va in minuscolo ("sabato 30/05"); a inizio riga si usa capitalize()
        where = self._day_text(data, day).lower() + (f" {SHIFT_NAMES[shift]}" if shift else "")

        # ---------------- sostituisci A con B
        if kind == "replace":
            text = a.get("text", "")
            left, right = text, ""
            for sep in (" al posto di ", " con "):
                if sep in f" {text} ":
                    l, r = f" {text} ".split(sep, 1)
                    left, right = (r, l) if sep == " al posto di " else (l, r)
                    break
            old, err = emp_param("old_id", left)
            if err:
                return {"error": err}
            new, err = emp_param("new_id", right)
            if err:
                return {"error": "Con chi lo sostituisco? Scrivi «sostituisci <nome> con <nome> <giorno>»." if not right and a.get("new_id") is None else err}
            if old.id == new.id:
                return {"error": "Hai indicato la stessa persona due volte."}
            items, preview, warnings, conflicts = [], [], [], set()
            touched: Dict[str, Set[str]] = {}
            for (d, r, tl), ids in sorted(data["cells"].items()):
                if d != day or tl not in labels_day or old.id not in ids or (role and r != role):
                    continue
                busy_elsewhere = any(new.id in data["cells"].get((d, r2, tl), []) for r2 in ROLES if r2 != r)
                if busy_elsewhere:
                    conflicts.add(tl)
                    continue
                rest = [i for i in ids if i != old.id]
                if new.id not in rest:
                    rest.append(new.id)
                items.append({"day_index": d, "role": r, "time_label": tl, "employee_ids": rest})
                touched.setdefault(r, set()).add(tl)
            if not items and not conflicts:
                return {"error": f"{old.name} non è in turno {where}{(' come ' + role) if role else ''}."}
            if conflicts:
                return {"error": f"{new.name} è già in turno in un altro ruolo {where} ({_labels_to_ranges(sorted(conflicts))}). Toglilo prima da lì, oppure scegli un'altra persona."}
            for r, ls in touched.items():
                preview.append(f"{where.capitalize()} · {r}: {old.name} → {new.name} ({_labels_to_ranges(sorted(ls))})")
                if new.skills.get(r, 0) <= 0:
                    warnings.append(f"{new.name} non ha skill per {r}.")
            warnings += self._avail_warnings(data, new, day, set().union(*touched.values()))
            return {"items": items, "preview": preview, "warnings": warnings, "title": "Sostituzione",
                    "confirm": "Sostituisci", "done": f"Fatto: {new.name} al posto di {old.name} {where}.",
                    "params": {"type": "replace", "day": day, "shift": shift, "role": role, "old_id": old.id, "new_id": new.id}}

        # ---------------- togli A
        if kind == "remove":
            emp, err = emp_param("emp_id", a.get("text", ""))
            if err:
                return {"error": err}
            items, touched = [], {}
            for (d, r, tl), ids in sorted(data["cells"].items()):
                if d == day and tl in labels_day and emp.id in ids and (not role or r == role):
                    items.append({"day_index": d, "role": r, "time_label": tl, "employee_ids": [i for i in ids if i != emp.id]})
                    touched.setdefault(r, set()).add(tl)
            if not items:
                return {"error": f"{emp.name} non è in turno {where}{(' come ' + role) if role else ''}."}
            preview = [f"{where.capitalize()} · {r}: tolgo {emp.name} ({_labels_to_ranges(sorted(ls))})" for r, ls in touched.items()]
            return {"items": items, "preview": preview, "warnings": ["Quelle fasce resteranno da coprire."], "title": "Rimozione",
                    "confirm": "Togli dal turno", "done": f"Fatto: {emp.name} tolto {where}.",
                    "params": {"type": "remove", "day": day, "shift": shift, "role": role, "emp_id": emp.id}}

        # ---------------- aggiungi A
        if kind == "add":
            emp, err = emp_param("emp_id", a.get("text", ""))
            if err:
                return {"error": err}
            if not shift:
                return {"error": "In quale fascia? Aggiungi «mattina» o «sera» alla frase."}
            if not role:
                # ruolo scoperto in quella fascia che la persona sa fare
                miss = [c["role"] for c in self._coverage(data, day)
                        if c["shift"] == shift and c["covered"] < c["required"] and emp.skills.get(c["role"], 0) > 0]
                if len(miss) == 1:
                    role = miss[0]
                else:
                    opts = miss or [r for r in ROLES if emp.skills.get(r, 0) > 0]
                    if not opts:
                        return {"error": f"{emp.name} non ha skill per nessun ruolo: completa la sua scheda in «Dipendenti»."}
                    example = f"aggiungi {emp.name.split()[0].title()} in {opts[0].lower()} {DAY_NAMES[day].lower()} {SHIFT_NAMES[shift]}"
                    return {"error": f"In quale ruolo? Ruoli possibili per {emp.name}: {', '.join(opts)}. Per esempio «{example}»."}
            labels = list(SHIFT_LABELS[shift])
            warnings = []
            av_day = (data["avail"] or {}).get(day)
            if data["avail"] is not None and av_day is not None and emp.id in av_day:
                inter = sorted(set(labels) & av_day[emp.id])
                if not inter:
                    return {"error": f"Secondo il CSV {emp.name} non è disponibile {where}. Se vuoi inserirlo lo stesso usa «Aggiungi turno» in Home."}
                if len(inter) < len(labels):
                    warnings.append(f"Lo inserisco solo nell'orario in cui è disponibile ({_labels_to_ranges(inter)}).")
                labels = inter
            else:
                warnings.append(f"Non ho la disponibilità di {emp.name} per quel giorno: lo inserisco per tutta la fascia.")
            clash = [tl for tl in labels for r2 in ROLES if r2 != role and emp.id in data["cells"].get((day, r2, tl), [])]
            if clash:
                return {"error": f"{emp.name} è già in turno in un altro ruolo {where} ({_labels_to_ranges(sorted(set(clash)))})."}
            todo = [tl for tl in labels if emp.id not in data["cells"].get((day, role, tl), [])]
            if not todo:
                return {"error": f"{emp.name} è già in {role} {where}."}
            items = [{"day_index": day, "role": role, "time_label": tl,
                      "employee_ids": data["cells"].get((day, role, tl), []) + [emp.id]} for tl in todo]
            if emp.skills.get(role, 0) <= 0:
                warnings.append(f"{emp.name} non ha skill per {role}.")
            return {"items": items, "preview": [f"{where.capitalize()} · {role}: aggiungo {emp.name} ({_labels_to_ranges(todo)})"],
                    "warnings": warnings, "title": "Aggiunta", "confirm": "Aggiungi",
                    "done": f"Fatto: {emp.name} aggiunto in {role} {where}.",
                    "params": {"type": "add", "day": day, "shift": shift, "role": role, "emp_id": emp.id}}

        return {"error": "Richiesta non riconosciuta."}

    @staticmethod
    def _avail_warnings(data, emp: Emp, day: int, labels: Set[str]) -> List[str]:
        if data["avail"] is None:
            return []
        av = (data["avail"].get(day) or {}).get(emp.id)
        if av is None:
            return [f"Non ho la disponibilità di {emp.name} per quel giorno nel CSV."]
        missing = sorted(labels - av)
        return [f"Secondo il CSV {emp.name} non è disponibile {_labels_to_ranges(missing)}."] if missing else []
