from __future__ import annotations

import json
import os
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from cn_turni.paths import paths

# Singleton DB (semplice e robusto per MVP)
_DB: Optional["Db"] = None
GLOBAL_SQUADS_WEEK_ID = "__GLOBAL__"
def week_id_from_ui_weekkey(week_key: str) -> str:
    """
    week_id blindato = martedì.
    Per ora la UI passa week_key = lunedì => week_id = lunedì + 1 giorno.
    """
    d = date.fromisoformat(week_key)
    return (d + timedelta(days=1)).isoformat()

def default_db_path() -> str:
    """
    Path DB centralizzato.
    In dev usa ./data/app.db
    In exe usa %APPDATA%/TurniCascina/app.db
    """
    return str(paths.db_path)

##def default_db_path() -> str:
##  """
##  DB locale: /data/turni_cn.db (accanto al progetto, come MVP).
##  Se poi vuoi AppData per exe, lo cambiamo in paths.py senza toccare UI.
##  """
##  base_dir = Path(__file__).resolve().parent  # .../cn_turni
##  data_dir = (base_dir / ".." / "data").resolve()
##  data_dir.mkdir(parents=True, exist_ok=True)
##  return str(data_dir / "turni_cn.db")


def get_db() -> "Db":
    global _DB
    if _DB is None:
        _DB = Db(default_db_path())
    return _DB


def init_db() -> None:
    """Usata da main.py: crea schema se manca."""
    get_db()  # istanzia e fa _init_schema()


def apply_retention(months: int = 6) -> int:
    """Usata da main.py: elimina settimane vecchie."""
    return get_db().purge_old_weeks(months=months)


class Db:
    def squads_template_save(self, name: str, payload: dict) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO squads_templates(name, payload_json) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET payload_json=excluded.payload_json",
                (name, json.dumps(payload, ensure_ascii=False)),
            )

    def squads_template_list(self) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT name FROM squads_templates ORDER BY name COLLATE NOCASE"
            ).fetchall()
            return [r["name"] for r in rows]

    def squads_template_get(self, name: str) -> dict:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM squads_templates WHERE name=?",
                (name,),
            ).fetchone()
            if not row:
                raise ValueError(f"Template '{name}' non trovato")
            return json.loads(row["payload_json"])
    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(os.path.dirname(db_path)).mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn
    def _ensure_column(self, conn: sqlite3.Connection, table: str, col: str, ddl: str) -> None:
        cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS employees (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    name            TEXT NOT NULL UNIQUE,
                    is_permanent    INTEGER NOT NULL DEFAULT 0,
                    preferred_role  TEXT NULL,
                    slot_morning    INTEGER NOT NULL DEFAULT 1,
                    slot_evening    INTEGER NOT NULL DEFAULT 1,
                    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
                );
                
                CREATE TABLE IF NOT EXISTS employee_skills (
                    employee_id INTEGER NOT NULL,
                    role        TEXT NOT NULL,
                    rank        INTEGER NOT NULL,
                    PRIMARY KEY (employee_id, role),
                    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
                );
    
                CREATE TABLE IF NOT EXISTS schedule_override (
                    week_id      TEXT NOT NULL,
                    day_index    INTEGER NOT NULL,
                    role         TEXT NOT NULL,
                    time_label   TEXT NOT NULL,
                    employee_ids TEXT NOT NULL,
                    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
                    PRIMARY KEY (week_id, day_index, role, time_label)
                );
    
                CREATE TABLE IF NOT EXISTS squads_required (
                    week_id     TEXT NOT NULL,
                    day_index   INTEGER NOT NULL,
                    shift       TEXT NOT NULL,
                    role        TEXT NOT NULL,
                    required    INTEGER NOT NULL,
                    PRIMARY KEY (week_id, day_index, shift, role)
                );
    
                CREATE TABLE IF NOT EXISTS permanent_week (
                    week_id       TEXT NOT NULL,
                    employee_id   INTEGER NOT NULL,
                    day_off       INTEGER NULL,
                    target_hours  INTEGER NOT NULL DEFAULT 40,
                    PRIMARY KEY (week_id, employee_id),
                    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
                );
    
                CREATE TABLE IF NOT EXISTS squads_templates (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    name         TEXT NOT NULL UNIQUE,
                    payload_json TEXT NOT NULL,
                    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS day_type_presets (
                    name         TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_override_week ON schedule_override(week_id);
                CREATE INDEX IF NOT EXISTS idx_squads_week ON squads_required(week_id);
                CREATE INDEX IF NOT EXISTS idx_perm_week ON permanent_week(week_id);
                """
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS day_type_presets(
                    name TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS day_type_assignments(
                    day_index INTEGER PRIMARY KEY,
                    type_name TEXT NOT NULL
                )
            """)
            self._ensure_column(conn, "employees", "aliases", "aliases TEXT NULL")
            self._ensure_column(conn, "employees", "slot_morning", "slot_morning INTEGER NOT NULL DEFAULT 1")
            self._ensure_column(conn, "employees", "slot_evening", "slot_evening INTEGER NOT NULL DEFAULT 1")
            self._ensure_column(conn, "employees", "work_days", "work_days TEXT NULL")
            self._ensure_column(conn, "employees", "max_daily_hours", "max_daily_hours INTEGER NULL")
    # ---------- Retention ----------
    def purge_old_weeks(self, months: int = 6) -> int:
        cutoff = date.today() - timedelta(days=int(30.5 * months))
        cutoff_iso = cutoff.isoformat()
        with self._connect() as conn:
            n = 0
            for table in ("schedule_override", "squads_required", "permanent_week"):
                cur = conn.execute(f"SELECT COUNT(*) as n FROM {table} WHERE week_id < ?", (cutoff_iso,))
                n += int(cur.fetchone()["n"])
                conn.execute(f"DELETE FROM {table} WHERE week_id < ?", (cutoff_iso,))
            return n

    # ---------- Employees ----------
    def employees_list(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM employees ORDER BY name COLLATE NOCASE").fetchall()
            out: List[Dict[str, Any]] = []
            for r in rows:
                emp_id = int(r["id"])
                skills = conn.execute(
                    "SELECT role, rank FROM employee_skills WHERE employee_id=?",
                    (emp_id,),
                ).fetchall()
                out.append(
                    dict(
                        id=emp_id,
                        name=r["name"],
                        is_permanent=bool(r["is_permanent"]),
                        preferred_role=r["preferred_role"],
                        slot_morning=int(r["slot_morning"]) if r["slot_morning"] is not None else 1,
                        slot_evening=int(r["slot_evening"]) if r["slot_evening"] is not None else 1,
                        skills={s["role"]: int(s["rank"]) for s in skills},
                        aliases=r["aliases"] or "",
                        work_days=r["work_days"] or "",
                        max_daily_hours=float(r["max_daily_hours"]) if r["max_daily_hours"] is not None else None,
                    )
                )
            return out

    def employee_create(self, payload: Dict[str, Any]) -> int:
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValueError("name required")

        is_perm = 1 if payload.get("is_permanent") else 0
        pref = payload.get("preferred_role") or None
        skills: Dict[str, int] = payload.get("skills") or {}
        slot_morning = 1 if payload.get("slot_morning", 1) else 0
        slot_evening = 1 if payload.get("slot_evening", 1) else 0

        try:
            with self._connect() as conn:
                aliases = (payload.get("aliases") or payload.get("alias") or "").strip()

                work_days = (payload.get("work_days") or "").strip()
                max_daily_hours = payload.get("max_daily_hours")
                max_daily_hours = float(max_daily_hours) if max_daily_hours not in (None, "", "null") else None
                cur = conn.execute(
                    "INSERT INTO employees(name,is_permanent,preferred_role,slot_morning,slot_evening,aliases,work_days,max_daily_hours) VALUES (?,?,?,?,?,?,?,?)",
                    (name, is_perm, pref, slot_morning, slot_evening, aliases, work_days, max_daily_hours),
                )
                emp_id = int(cur.lastrowid)

                for role, rank in skills.items():
                    conn.execute(
                        "INSERT INTO employee_skills(employee_id,role,rank) VALUES (?,?,?)",
                        (emp_id, str(role), int(rank)),
                    )

                return emp_id

        except sqlite3.IntegrityError as e:
            # intercettiamo duplicato nome
            if "UNIQUE constraint failed: employees.name" in str(e):
                raise ValueError("Esiste già un dipendente con questo nome.")
            raise

    def employee_update(self, payload: Dict[str, Any]) -> None:
        emp_id = int(payload["id"])
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValueError("name required")

        is_perm = 1 if payload.get("is_permanent") else 0
        pref = payload.get("preferred_role") or None
        skills: Dict[str, int] = payload.get("skills") or {}
        slot_morning = 1 if payload.get("slot_morning", 1) else 0
        slot_evening = 1 if payload.get("slot_evening", 1) else 0
        with self._connect() as conn:
            aliases = (payload.get("aliases") or payload.get("alias") or "").strip()
            work_days = (payload.get("work_days") or "").strip()
            max_daily_hours = payload.get("max_daily_hours")
            max_daily_hours = int(max_daily_hours) if max_daily_hours not in (None, "", "null") else None
            conn.execute(
                "UPDATE employees SET name=?, is_permanent=?, preferred_role=?, slot_morning=?, slot_evening=?, aliases=?, work_days=?, max_daily_hours=? WHERE id=?",
                (name, is_perm, pref, slot_morning, slot_evening, aliases, work_days, max_daily_hours, emp_id),
            )
            conn.execute("DELETE FROM employee_skills WHERE employee_id=?", (emp_id,))
            for role, rank in skills.items():
                conn.execute(
                    "INSERT INTO employee_skills(employee_id,role,rank) VALUES (?,?,?)",
                    (emp_id, str(role), int(rank)),
                )

    def employees_bulk_set_skill(self, role: str, value: int) -> int:
        allowed_roles = {"Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"}
        if role not in allowed_roles:
            raise ValueError(f"Ruolo non valido: {role}")

        value = int(value)
        if value < 0 or value > 10:
            raise ValueError("Il valore skill deve essere compreso tra 0 e 10.")
        with self._connect() as conn:
            emp_rows = conn.execute("SELECT id FROM employees").fetchall()

            for r in emp_rows:
                emp_id = int(r["id"])
                conn.execute(
                    """
                    INSERT INTO employee_skills(employee_id, role, rank)
                    VALUES (?, ?, ?)
                    ON CONFLICT(employee_id, role) DO UPDATE SET rank=excluded.rank
                    """,
                    (emp_id, role, value),
                )

            return len(emp_rows)

    def employee_delete(self, emp_id: int) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM employees WHERE id=?", (int(emp_id),))

    # ---------- Permanent week ----------
    def permanent_week_get(self, week_id: str) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT week_id, employee_id, day_off, target_hours FROM permanent_week WHERE week_id=?",
                (week_id,),
            ).fetchall()
            return [
                dict(
                    week_id=r["week_id"],
                    employee_id=int(r["employee_id"]),
                    day_off=(int(r["day_off"]) if r["day_off"] is not None else None),
                    target_hours=int(r["target_hours"]),
                )
                for r in rows
            ]

    def permanent_week_set(self, week_id: str, items: List[Dict[str, Any]]) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM permanent_week WHERE week_id=?", (week_id,))
            for it in items:
                conn.execute(
                    "INSERT INTO permanent_week(week_id, employee_id, day_off, target_hours) VALUES (?,?,?,?)",
                    (week_id, int(it["employee_id"]), it.get("day_off"), int(it.get("target_hours") or 40)),
                )

    # ---------- Overrides (calendario) ----------
    def overrides_week_get(self, week_id: str) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT week_id, day_index, role, time_label, employee_ids, updated_at "
                "FROM schedule_override WHERE week_id=?",
                (week_id,),
            ).fetchall()
            out: List[Dict[str, Any]] = []
            for r in rows:
                out.append(
                    dict(
                        week_id=r["week_id"],
                        day_index=int(r["day_index"]),
                        role=r["role"],
                        time_label=r["time_label"],
                        employee_ids=json.loads(r["employee_ids"]) if r["employee_ids"] else [],
                        updated_at=r["updated_at"],
                    )
                )
            return out

    def overrides_set_many(self, week_id: str, day_index: int, role: str, items: List[Dict[str, Any]]) -> None:
        """
        items: [{time_label:"10:00", employee_ids:[1,2]}, ...]
        Se employee_ids è vuoto -> delete della riga.
        """
        with self._connect() as conn:
            for it in items:
                t = str(it["time_label"])
                ids = it.get("employee_ids") or []
                if not ids:
                    conn.execute(
                        "DELETE FROM schedule_override WHERE week_id=? AND day_index=? AND role=? AND time_label=?",
                        (week_id, int(day_index), role, t),
                    )
                else:
                    conn.execute(
                        "INSERT INTO schedule_override(week_id, day_index, role, time_label, employee_ids) "
                        "VALUES (?,?,?,?,?) "
                        "ON CONFLICT(week_id, day_index, role, time_label) DO UPDATE SET "
                        "employee_ids=excluded.employee_ids, updated_at=datetime('now')",
                        (week_id, int(day_index), role, t, json.dumps(ids)),
                    )

    def overrides_clear_week(self, week_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM schedule_override WHERE week_id=?", (week_id,))

    # ---------- Squads / fabbisogni ----------
    def squads_week_get(self, week_id: str) -> Dict[str, Any]:
        """
        Ritorna struttura:
        { "0": {"morning":{role:required}, "evening":{role:required}}, ... "6": {...} }
        """
        def mk() -> Dict[str, Dict[str, int]]:
            return {"morning": {}, "evening": {}}

        out: Dict[int, Dict[str, Dict[str, int]]] = {i: mk() for i in range(7)}

        with self._connect() as conn:
            rows = conn.execute(
                "SELECT day_index, shift, role, required FROM squads_required WHERE week_id=?",
                (week_id,),
            ).fetchall()

            # ✅ fallback: se la settimana non ha squadre salvate, usa il profilo globale
            if (not rows) and week_id != GLOBAL_SQUADS_WEEK_ID:
                rows = conn.execute(
                    "SELECT day_index, shift, role, required FROM squads_required WHERE week_id=?",
                    (GLOBAL_SQUADS_WEEK_ID,),
                ).fetchall()

            for r in rows:
                d = int(r["day_index"])
                shift = r["shift"]
                role = r["role"]
                out.setdefault(d, mk())
                out[d].setdefault(shift, {})
                out[d][shift][role] = int(r["required"])

        return {str(k): v for k, v in out.items()}

    def squads_week_set(self, week_id: str, data: Dict[str, Any]) -> None:
        """data come squads_week_get."""
        with self._connect() as conn:
            # ✅ salva sempre anche la versione globale
            target_week_ids = {week_id, GLOBAL_SQUADS_WEEK_ID}

            for wid in target_week_ids:
                conn.execute("DELETE FROM squads_required WHERE week_id=?", (wid,))

            for day_index_str, bands in (data or {}).items():
                d = int(day_index_str)
                for shift_key, roles_map in (bands or {}).items():
                    shift = shift_key
                    if shift_key == "mattina":
                        shift = "morning"
                    if shift_key == "pomeriggio":
                        shift = "evening"

                    for role, req in (roles_map or {}).items():
                        for wid in target_week_ids:
                            conn.execute(
                                "INSERT INTO squads_required(week_id, day_index, shift, role, required) VALUES (?,?,?,?,?)",
                                (wid, d, shift, str(role), int(req or 0)),
                            )
    def squads_template_delete(self, name: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM squads_templates WHERE name=?", (name,))
            try:
                conn.execute("DELETE FROM squads_templates_required WHERE template_name=?", (name,))
            except sqlite3.OperationalError:
                # tabella non presente nello schema (vecchie versioni)
                pass






    def day_type_presets_get(self) -> dict:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT name, payload_json FROM day_type_presets"
            ).fetchall()

            out = {}
            for r in rows:
                out[r["name"]] = json.loads(r["payload_json"])

            return out


    def day_type_presets_set(self, payload: dict) -> None:
        with self._connect() as conn:
            for name, data in (payload or {}).items():
                conn.execute(
                    """
                    INSERT INTO day_type_presets(name, payload_json, updated_at)
                    VALUES (?, ?, datetime('now'))
                    ON CONFLICT(name) DO UPDATE SET
                        payload_json = excluded.payload_json,
                        updated_at = datetime('now')
                    """,
                    (name, json.dumps(data, ensure_ascii=False)),
                )
    def day_type_assignments_get(self) -> dict:
        """Ritorna {day_index: type_name} per tutti i giorni configurati."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT day_index, type_name FROM day_type_assignments"
            ).fetchall()
            return {int(r["day_index"]): r["type_name"] for r in rows}

    def day_type_assignments_set(self, day_index: int, type_name: str) -> None:
        """Salva o aggiorna l'assegnazione per un giorno."""
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO day_type_assignments(day_index, type_name)
                VALUES (?, ?)
                ON CONFLICT(day_index) DO UPDATE SET type_name = excluded.type_name
                """,
                (int(day_index), str(type_name)),
            )