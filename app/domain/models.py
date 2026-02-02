# app/domain/models.py
# =========================
# Definisce i modelli di dominio (dataclass) come Employee, Skill, Slot e Assignment, indipendenti da DB e UI.
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

@dataclass(frozen=True)
class Employee:
    id: int
    name: str
    active: bool = True

@dataclass(frozen=True)
class Slot:
    day_iso: str
    start: str
    end: str
    skill: str

@dataclass(frozen=True)
class Assignment:
    slot: Slot
    employee_id: int
    score: float = 0.0
    note: Optional[str] = None
