# app/domain/scoring.py
# =========================
# Contiene le funzioni pure di calcolo del punteggio (skill, gradimento, fairness, continuità).
from __future__ import annotations

def score_assignment_candidate(employee_id: int, day_iso: str, skill: str) -> float:
    """
    Stub scoring: da sostituire con:
    - bilanciamento carichi
    - preferenze
    - penalità consecutivi, ecc.
    """
    return 0.0
