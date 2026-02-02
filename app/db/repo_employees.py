# app/db/repo_employees.py
# =========================
# Repository per il CRUD di dipendenti, skill, livelli, gradimenti e attributi anagrafici.
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Dict, Any, List

@dataclass
class Employee:
    id: int
    name: str
    active: int
    skills: List[str]

def list_employees(conn: sqlite3.Connection) -> List[Employee]:
    rows = conn.execute("SELECT id,name,active FROM employees ORDER BY name").fetchall()
    out: List[Employee] = []
    for r in rows:
        skills = [x["skill"] for x in conn.execute(
            "SELECT skill FROM employee_skills WHERE employee_id=? ORDER BY skill", (r["id"],)
        ).fetchall()]
        out.append(Employee(id=r["id"], name=r["name"], active=r["active"], skills=skills))
    return out

def create_employee(conn: sqlite3.Connection, payload: Dict[str, Any]) -> Employee:
    name = (payload.get("name") or "").strip()
    active = 1 if payload.get("active", True) else 0
    cur = conn.execute("INSERT INTO employees(name,active) VALUES(?,?)", (name, active))
    emp_id = cur.lastrowid
    skills = payload.get("skills", []) or []
    set_employee_skills(conn, emp_id, skills)
    return Employee(id=emp_id, name=name, active=active, skills=sorted(skills))

def update_employee(conn: sqlite3.Connection, emp_id: int, payload: Dict[str, Any]) -> Employee:
    name = (payload.get("name") or "").strip()
    active = 1 if payload.get("active", True) else 0
    conn.execute("UPDATE employees SET name=?, active=? WHERE id=?", (name, active, emp_id))
    skills = payload.get("skills", None)
    if skills is not None:
        set_employee_skills(conn, emp_id, skills)
    skills_list = [x["skill"] for x in conn.execute(
        "SELECT skill FROM employee_skills WHERE employee_id=? ORDER BY skill", (emp_id,)
    ).fetchall()]
    return Employee(id=emp_id, name=name, active=active, skills=skills_list)

def delete_employee(conn: sqlite3.Connection, emp_id: int) -> None:
    conn.execute("DELETE FROM employees WHERE id=?", (emp_id,))

def set_employee_skills(conn: sqlite3.Connection, emp_id: int, skills: List[str]) -> None:
    skills = sorted({(s or "").strip() for s in skills if (s or "").strip()})
    conn.execute("DELETE FROM employee_skills WHERE employee_id=?", (emp_id,))
    for s in skills:
        conn.execute("INSERT INTO employee_skills(employee_id, skill) VALUES(?,?)", (emp_id, s))
