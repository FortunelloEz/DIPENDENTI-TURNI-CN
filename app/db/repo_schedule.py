# app/db/repo_schedule.py
# =========================
# Repository per la gestione dei turni generati automaticamente e delle modifiche manuali (override).
from __future__ import annotations

import sqlite3
from typing import Dict, Any, List, Tuple


def clear_generated(conn: sqlite3.Connection, week_start_iso: str) -> None:
    conn.execute("DELETE FROM schedule_generated WHERE week_start_iso=?", (week_start_iso,))


def insert_generated(conn: sqlite3.Connection, week_start_iso: str, rows: List[Dict[str, Any]]) -> int:
    n = 0
    for r in rows:
        conn.execute(
            """INSERT INTO schedule_generated
               (week_start_iso, day_iso, slot_start, slot_end, skill, employee_id, score)
               VALUES(?,?,?,?,?,?,?)""",
            (
                week_start_iso,
                r["day_iso"],
                r["slot_start"],
                r["slot_end"],
                r["skill"],
                r["employee_id"],
                float(r.get("score", 0)),
            ),
        )
        n += 1
    return n


def list_generated(conn: sqlite3.Connection, week_start_iso: str) -> List[sqlite3.Row]:
    return conn.execute(
        """SELECT * FROM schedule_generated
           WHERE week_start_iso=?
           ORDER BY day_iso, slot_start, skill""",
        (week_start_iso,),
    ).fetchall()


def week_has_generated(conn: sqlite3.Connection, week_start_iso: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM schedule_generated WHERE week_start_iso=? LIMIT 1", (week_start_iso,)
    ).fetchone()
    return row is not None


def insert_override(
        conn: sqlite3.Connection,
        week_start_iso: str,
        day_iso: str,
        slot_start: str,
        slot_end: str,
        skill: str,
        employee_id: int,
        action: str,
        note: str | None = None,
) -> int:
    cur = conn.execute(
        """INSERT INTO schedule_override
           (week_start_iso, day_iso, slot_start, slot_end, skill, employee_id, action, note)
           VALUES(?,?,?,?,?,?,?,?)""",
        (week_start_iso, day_iso, slot_start, slot_end, skill, employee_id, action, note),
    )
    return int(cur.lastrowid)


def get_effective_assignments(conn: sqlite3.Connection, week_start_iso: str) -> List[Dict[str, Any]]:
    """
    effective = generated + overrides (in order).
    Ritorna lista dict con day_iso, slot_start, slot_end, skill, employee_id, employee_name.
    """
    # base: generated + join employee name
    base_rows = conn.execute(
        """
        SELECT g.day_iso, g.slot_start, g.slot_end, g.skill, g.employee_id, e.name AS employee_name
        FROM schedule_generated g
        JOIN employees e ON e.id = g.employee_id
        WHERE g.week_start_iso=?
        """,
        (week_start_iso,),
    ).fetchall()

    # usiamo una lista mutabile
    effective: List[Dict[str, Any]] = [dict(r) for r in base_rows]

    # overrides in order
    ov_rows = conn.execute(
        """
        SELECT o.id, o.day_iso, o.slot_start, o.slot_end, o.skill, o.employee_id, o.action, e.name AS employee_name
        FROM schedule_override o
        JOIN employees e ON e.id = o.employee_id
        WHERE o.week_start_iso=?
        ORDER BY o.id ASC
        """,
        (week_start_iso,),
    ).fetchall()

    def same_assignment(a: Dict[str, Any], day: str, ss: str, se: str, skill: str, emp_id: int) -> bool:
        return (
                a["day_iso"] == day
                and a["slot_start"] == ss
                and a["slot_end"] == se
                and a["skill"] == skill
                and int(a["employee_id"]) == int(emp_id)
        )

    for o in ov_rows:
        day = o["day_iso"]
        ss = o["slot_start"]
        se = o["slot_end"]
        skill = o["skill"]
        emp_id = int(o["employee_id"])
        action = o["action"]

        if action == "remove":
            effective = [a for a in effective if not same_assignment(a, day, ss, se, skill, emp_id)]

        elif action == "add":
            # evita duplicati identici
            if not any(same_assignment(a, day, ss, se, skill, emp_id) for a in effective):
                effective.append(
                    {
                        "day_iso": day,
                        "slot_start": ss,
                        "slot_end": se,
                        "skill": skill,
                        "employee_id": emp_id,
                        "employee_name": o["employee_name"],
                    }
                )

        elif action == "replace":
            # replace = rimuovi chiunque nello slot+skill e aggiungi questo
            effective = [
                a
                for a in effective
                if not (a["day_iso"] == day and a["slot_start"] == ss and a["slot_end"] == se and a["skill"] == skill)
            ]
            effective.append(
                {
                    "day_iso": day,
                    "slot_start": ss,
                    "slot_end": se,
                    "skill": skill,
                    "employee_id": emp_id,
                    "employee_name": o["employee_name"],
                }
            )

    return effective
