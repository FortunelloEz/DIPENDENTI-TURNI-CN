from __future__ import annotations

import base64
import hashlib
import json
import os
import platform
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from cn_turni.paths import paths

# ---------- Cifratura API key (XOR + SHA-256 machine-specific) ----------

def _machine_key() -> bytes:
    """Chiave derivata da dati della macchina corrente — non trasportabile."""
    seed = platform.node() + os.getenv("USERNAME", "") + os.getenv("COMPUTERNAME", "") + "turni_cn_v1"
    return hashlib.sha256(seed.encode("utf-8", errors="replace")).digest()

def _encrypt_value(plaintext: str) -> str:
    data = plaintext.encode("utf-8")
    key  = _machine_key()
    enc  = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
    return base64.b64encode(enc).decode("ascii")

def _decrypt_value(ciphertext: str) -> str:
    enc  = base64.b64decode(ciphertext.encode("ascii"))
    key  = _machine_key()
    data = bytes(b ^ key[i % len(key)] for i, b in enumerate(enc))
    return data.decode("utf-8")

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
    return str(paths.db_path)


def get_db() -> "Db":
    global _DB
    if _DB is None:
        _DB = Db(default_db_path())
    return _DB


def init_db() -> None:
    """Usata da main.py: crea schema se manca."""
    get_db()


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

                CREATE TABLE IF NOT EXISTS imported_files (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename    TEXT NOT NULL,
                    file_path   TEXT NOT NULL DEFAULT '',
                    week_key    TEXT NOT NULL,
                    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS availability_cache (
                    week_id       TEXT NOT NULL,
                    employee_name TEXT NOT NULL,
                    iso_date      TEXT NOT NULL,
                    range_label   TEXT,
                    raw_json      TEXT,
                    PRIMARY KEY (week_id, employee_name, iso_date)
                );

                CREATE INDEX IF NOT EXISTS idx_override_week ON schedule_override(week_id);
                CREATE INDEX IF NOT EXISTS idx_squads_week ON squads_required(week_id);
                CREATE INDEX IF NOT EXISTS idx_perm_week ON permanent_week(week_id);
                CREATE INDEX IF NOT EXISTS idx_imported_files_week ON imported_files(week_key);
                CREATE INDEX IF NOT EXISTS idx_avail_week ON availability_cache(week_id);
                """
            )
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
            self._ensure_column(conn, "employees", "weekly_hours_target", "weekly_hours_target INTEGER NULL")
            self._ensure_column(conn, "imported_files", "file_path", "file_path TEXT NOT NULL DEFAULT ''")
            # Migration: rimuove UNIQUE su imported_files.filename (unico per filename+week_key)
            row = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='imported_files'"
            ).fetchone()
            if row and "UNIQUE" in (row["sql"] or ""):
                conn.executescript("""
                    ALTER TABLE imported_files RENAME TO _imported_files_bak;
                    CREATE TABLE imported_files (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        filename    TEXT NOT NULL,
                        file_path   TEXT NOT NULL DEFAULT '',
                        week_key    TEXT NOT NULL,
                        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    INSERT INTO imported_files SELECT * FROM _imported_files_bak;
                    DROP TABLE _imported_files_bak;
                    CREATE INDEX IF NOT EXISTS idx_imported_files_week ON imported_files(week_key);
                """)
    # ---------- Settings generici ----------
    def _setting_get(self, key: str) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return row["value"] if row else None

    def _setting_set(self, key: str, value: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO settings(key, value) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    def _setting_delete(self, key: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM settings WHERE key=?", (key,))

    # ---------- Settings pubblici (generico, non cifrato) ----------
    def settings_get(self, key: str) -> Optional[str]:
        return self._setting_get(key)

    def settings_set(self, key: str, value: str) -> None:
        self._setting_set(key, value)

    def settings_delete(self, key: str) -> None:
        self._setting_delete(key)

    # ---------- Gemini API key (cifrata) ----------
    def gemini_key_get(self) -> Optional[str]:
        encrypted = self._setting_get("gemini_api_key")
        if not encrypted:
            return None
        try:
            return _decrypt_value(encrypted)
        except Exception:
            return None

    def gemini_key_set(self, api_key: str) -> None:
        self._setting_set("gemini_api_key", _encrypt_value(api_key))

    def gemini_key_delete(self) -> None:
        self._setting_delete("gemini_api_key")

    # ---------- Availability cache ----------
    def availability_save(self, week_id: str, preview_json: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM availability_cache WHERE week_id=?", (week_id,))
            conn.execute(
                "INSERT INTO availability_cache(week_id, employee_name, iso_date, raw_json) "
                "VALUES (?,?,?,?)",
                (week_id, "_preview", week_id, str(preview_json)),
            )

    def availability_get(self, week_id: str) -> dict:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT raw_json FROM availability_cache "
                "WHERE week_id=? AND employee_name='_preview'",
                (week_id,),
            ).fetchone()
            if not row or not row["raw_json"]:
                return {"ok": False}
            return {"ok": True, "data": row["raw_json"]}

    def availability_clear(self, week_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM availability_cache WHERE week_id=?", (week_id,))

    # ---------- Retention ----------
    def purge_old_weeks(self, months: int = 6) -> int:
        cutoff = date.today() - timedelta(days=int(30.5 * months))
        cutoff_iso = cutoff.isoformat()
        with self._connect() as conn:
            n = 0
            for table in ("schedule_override", "squads_required", "permanent_week", "availability_cache"):
                cur = conn.execute(f"SELECT COUNT(*) as n FROM {table} WHERE week_id < ?", (cutoff_iso,))
                n += int(cur.fetchone()["n"])
                conn.execute(f"DELETE FROM {table} WHERE week_id < ?", (cutoff_iso,))
            cur = conn.execute("SELECT COUNT(*) as n FROM imported_files WHERE week_key < ?", (cutoff_iso,))
            n += int(cur.fetchone()["n"])
            conn.execute("DELETE FROM imported_files WHERE week_key < ?", (cutoff_iso,))
            return n

    # ---------- Imported Files ----------
    def imported_files_list(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, filename, week_key, imported_at FROM imported_files ORDER BY imported_at DESC"
            ).fetchall()
            return [
                dict(id=int(r["id"]), filename=r["filename"], week_key=r["week_key"], imported_at=r["imported_at"])
                for r in rows
            ]

    def imported_files_add(self, filename: str, file_path: str, week_key: str) -> int:
        with self._connect() as conn:
            # Unico per (filename, week_key): stesso file stesso settimana = aggiorna path
            existing = conn.execute(
                "SELECT id FROM imported_files WHERE filename=? AND week_key=?",
                (str(filename), str(week_key)),
            ).fetchone()

            if existing:
                conn.execute(
                    "UPDATE imported_files SET file_path=?, imported_at=datetime('now') WHERE id=?",
                    (str(file_path), int(existing["id"])),
                )
                return int(existing["id"])
            else:
                cur = conn.execute(
                    "INSERT INTO imported_files(filename, file_path, week_key) VALUES (?, ?, ?)",
                    (str(filename), str(file_path), str(week_key)),
                )
                return int(cur.lastrowid)

    def imported_files_get_content(self, file_id: int) -> dict:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT file_path FROM imported_files WHERE id=?", (int(file_id),)
            ).fetchone()
            if not row:
                return {"ok": False, "error": "File non trovato in lista"}
            path = row["file_path"]
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                content = f.read()
            return {"ok": True, "csv_text": content}
        except FileNotFoundError:
            return {"ok": False, "error": f"File non trovato su disco: {path}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def imported_files_delete(self, file_id: int) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM imported_files WHERE id=?", (int(file_id),))

    def imported_files_clear(self) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM imported_files")

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
                        weekly_hours_target=int(r["weekly_hours_target"]) if r["weekly_hours_target"] is not None else None,
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
                weekly_hours_target = payload.get("weekly_hours_target")
                weekly_hours_target = int(weekly_hours_target) if weekly_hours_target not in (None, "", "null") else None
                cur = conn.execute(
                    "INSERT INTO employees(name,is_permanent,preferred_role,slot_morning,slot_evening,aliases,work_days,max_daily_hours,weekly_hours_target) VALUES (?,?,?,?,?,?,?,?,?)",
                    (name, is_perm, pref, slot_morning, slot_evening, aliases, work_days, max_daily_hours, weekly_hours_target),
                )
                emp_id = int(cur.lastrowid)

                for role, rank in skills.items():
                    conn.execute(
                        "INSERT INTO employee_skills(employee_id,role,rank) VALUES (?,?,?)",
                        (emp_id, str(role), int(rank)),
                    )

                return emp_id

        except sqlite3.IntegrityError as e:
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
            max_daily_hours = float(max_daily_hours) if max_daily_hours not in (None, "", "null") else None
            weekly_hours_target = payload.get("weekly_hours_target")
            weekly_hours_target = int(weekly_hours_target) if weekly_hours_target not in (None, "", "null") else None
            conn.execute(
                "UPDATE employees SET name=?, is_permanent=?, preferred_role=?, slot_morning=?, slot_evening=?, aliases=?, work_days=?, max_daily_hours=?, weekly_hours_target=? WHERE id=?",
                (name, is_perm, pref, slot_morning, slot_evening, aliases, work_days, max_daily_hours, weekly_hours_target, emp_id),
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

    def overrides_bulk_save(self, week_id: str, items: list) -> int:
        """
        Atomic: cancella la settimana e reinserisce tutti i record in un'unica transazione.
        items: [{"day_index": int, "role": str, "time_label": str, "employee_ids": list}, ...]
        Restituisce il numero di righe inserite.
        """
        count = 0
        with self._connect() as conn:
            conn.execute("DELETE FROM schedule_override WHERE week_id=?", (week_id,))
            for it in items:
                ids = it.get("employee_ids") or []
                if not ids:
                    continue
                conn.execute(
                    "INSERT INTO schedule_override(week_id, day_index, role, time_label, employee_ids) "
                    "VALUES (?,?,?,?,?)",
                    (week_id, int(it["day_index"]), str(it["role"]), str(it["time_label"]), json.dumps(ids)),
                )
                count += 1
        return count

    def overrides_save_slot(self, week_id: str, day_index: int, time_labels: list, role_ids: dict) -> None:
        """
        Salva atomicamente tutti i ruoli per tutti i time_labels di uno slot.
        role_ids: {role: [employee_id, ...]}
        """
        with self._connect() as conn:
            for role, ids in (role_ids or {}).items():
                for t in (time_labels or []):
                    if not ids:
                        conn.execute(
                            "DELETE FROM schedule_override WHERE week_id=? AND day_index=? AND role=? AND time_label=?",
                            (week_id, int(day_index), str(role), str(t)),
                        )
                    else:
                        conn.execute(
                            "INSERT INTO schedule_override(week_id, day_index, role, time_label, employee_ids) "
                            "VALUES (?,?,?,?,?) "
                            "ON CONFLICT(week_id, day_index, role, time_label) DO UPDATE SET "
                            "employee_ids=excluded.employee_ids, updated_at=datetime('now')",
                            (week_id, int(day_index), str(role), str(t), json.dumps(ids)),
                        )

    def overrides_copy_week(self, from_week_id: str, to_week_id: str) -> int:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT day_index, role, time_label, employee_ids "
                "FROM schedule_override WHERE week_id=?",
                (from_week_id,),
            ).fetchall()
            conn.execute("DELETE FROM schedule_override WHERE week_id=?", (to_week_id,))
            for r in rows:
                conn.execute(
                    "INSERT INTO schedule_override(week_id, day_index, role, time_label, employee_ids) "
                    "VALUES (?,?,?,?,?)",
                    (to_week_id, r["day_index"], r["role"], r["time_label"], r["employee_ids"]),
                )
            return len(rows)

    # ---------- Squads / fabbisogni ----------
    def squads_week_get(self, week_id: str) -> Dict[str, Any]:
        def mk() -> Dict[str, Dict[str, int]]:
            return {"morning": {}, "evening": {}}

        out: Dict[int, Dict[str, Dict[str, int]]] = {i: mk() for i in range(7)}

        with self._connect() as conn:
            rows = conn.execute(
                "SELECT day_index, shift, role, required FROM squads_required WHERE week_id=?",
                (week_id,),
            ).fetchall()

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
        with self._connect() as conn:
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
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT day_index, type_name FROM day_type_assignments"
            ).fetchall()
            return {int(r["day_index"]): r["type_name"] for r in rows}

    def day_type_assignments_set(self, day_index: int, type_name: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO day_type_assignments(day_index, type_name)
                VALUES (?, ?)
                ON CONFLICT(day_index) DO UPDATE SET type_name = excluded.type_name
                """,
                (int(day_index), str(type_name)),
            )