# app/services/scheduler.py
# =========================
# Motore di pianificazione: assegna i dipendenti agli slot applicando vincoli hard e scoring di priorità.
from __future__ import annotations

import sqlite3
from typing import Dict, Any, List

from app.db.repo_schedule import clear_generated, insert_generated
from app.db.repo_settings import get_settings
from app.domain.scoring import score_assignment_candidate
from app.utils.dates import week_days_from_start

def generate_schedule(conn: sqlite3.Connection, week_start_iso: str) -> Dict[str, Any]:
    """
    Skeleton: genera turni con logica greedy (stub).
    In pratica: per ogni giorno/skill/slot richiesto, scegli il candidato col punteggio migliore.
    """
    settings = get_settings(conn)
    need = settings.get("need_per_slot", {}).get("default", {})
    skills = list(need.keys())

    # per ora: 1 slot finto per giorno (da riempire con slot 30min reali)
    days = week_days_from_start(week_start_iso, 6)  # mar-dom

    # fetch employees+skills
    employees = conn.execute("""
        SELECT e.id, e.name, e.active
        FROM employees e
        WHERE e.active=1
        ORDER BY e.name
    """).fetchall()

    emp_skills = {}
    for e in employees:
        ss = conn.execute("SELECT skill FROM employee_skills WHERE employee_id=?", (e["id"],)).fetchall()
        emp_skills[e["id"]] = {x["skill"] for x in ss}

    out_rows: List[Dict[str, Any]] = []
    for day in days:
        for skill in skills:
            required_n = int(need.get(skill, 0))
            for _ in range(required_n):
                best = None
                best_score = -10**9
                for e in employees:
                    if skill not in emp_skills.get(e["id"], set()):
                        continue
                    s = score_assignment_candidate(employee_id=e["id"], day_iso=day, skill=skill)
                    if s > best_score:
                        best_score = s
                        best = e["id"]
                if best is not None:
                    out_rows.append({
                        "day_iso": day,
                        "slot_start": "12:00",
                        "slot_end": "15:00",
                        "skill": skill,
                        "employee_id": best,
                        "score": best_score,
                    })

    clear_generated(conn, week_start_iso)
    n = insert_generated(conn, week_start_iso, out_rows)
    return {"ok": True, "generated": n}
