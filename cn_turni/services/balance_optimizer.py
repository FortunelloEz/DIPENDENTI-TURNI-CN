# cn_turni/services/balance_optimizer.py
"""
Ottimizzatore di bilanciamento dei ruoli (sostituisce skill-upgrade e 2-opt).

Obiettivo dell'utente: a parità di copertura, una squadra EQUILIBRATA
(meglio 6 + 7 che 10 + 1). Per ogni giorno e fascia si raggruppano le persone che
fanno lo stesso orario con un solo ruolo: dentro un gruppo i posti (ruoli) sono fissi,
quindi copertura e continuità dei turni non cambiano. I posti vengono riassegnati tra
i membri e le persone libere che possono coprire tutto quell'orario, scegliendo
la soluzione ESATTA che, nell'ordine:
  1) porta più in alto la skill più bassa del gruppo (max-min);
  2) a parità, ha il totale di skill più alto;
  3) a parità, rispetta di più la mansione preferita;
  4) a parità, lascia le persone dove già sono (nessun cambio inutile).
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional, Sequence, Set, Tuple

INF = float("inf")


def _hungarian_max(weights: List[List[Optional[float]]]) -> Optional[List[int]]:
    """
    Assegnazione di peso massimo righe -> colonne (righe <= colonne), ogni riga assegnata.
    weights[i][j] = None se l'abbinamento non è permesso. Restituisce col per ogni riga,
    oppure None se un'assegnazione completa non esiste.
    Algoritmo ungherese (versione con potenziali), O(n^2 m).
    """
    n = len(weights)
    if n == 0:
        return []
    m = len(weights[0])
    big = 1e9
    # costo da minimizzare; vietato = big (se scelto, la soluzione non è valida)
    cost = [[(-w if w is not None else big) for w in row] for row in weights]
    u = [0.0] * (n + 1)
    v = [0.0] * (m + 1)
    p = [0] * (m + 1)
    way = [0] * (m + 1)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [INF] * (m + 1)
        used = [False] * (m + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = INF
            j1 = 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    res = [0] * n
    for j in range(1, m + 1):
        if p[j]:
            res[p[j] - 1] = j - 1
    if any(weights[i][res[i]] is None for i in range(n)):
        return None
    return res


def best_assignment(
    slots: Sequence[str],
    candidates: Sequence[int],
    skill: Callable[[int, str], int],
    current: Dict[int, str],
    preferred: Callable[[int], Optional[str]] = lambda _c: None,
) -> Optional[Dict[int, str]]:
    """
    Assegna i posti (ruoli in `slots`) a candidati diversi con skill > 0.
    I posti possono essere PIÙ dei candidati: alcuni restano vuoti e si sceglie quali.
    Priorità: 1) più posti coperti; 2) skill minima più alta; 3) totale più alto;
    4) mansione preferita; 5) lasciare le persone dove sono (`current` = {candidato: ruolo}).
    Restituisce {candidato: ruolo} oppure None se nessuno può coprire nessun posto.
    """
    n = len(slots)
    cands = list(candidates)
    if n == 0 or not cands:
        return {} if n == 0 else None
    values = sorted({skill(c, r) for c in cands for r in slots if skill(c, r) > 0}, reverse=True)
    if not values:
        return None
    BIG = 1_000_000  # ogni posto coperto vale più di qualunque differenza di skill: prima si copre

    def solve(threshold: int) -> Tuple[int, Dict[int, str]]:
        # colonne: candidati + un "posto vuoto" per ogni riga (sempre ammesso, peso 0)
        weights = []
        for r in slots:
            row: List[Optional[float]] = []
            for c in cands:
                sk = skill(c, r)
                row.append(None if sk < threshold or sk <= 0 else
                           BIG + sk * 1000 + (10 if preferred(c) == r else 0) + (1 if current.get(c) == r else 0))
            row += [0.0] * n
            weights.append(row)
        sol = _hungarian_max(weights)
        assigned = {cands[j]: slots[i] for i, j in enumerate(sol) if j < len(cands)}
        return len(assigned), assigned

    best_count, _ = solve(values[-1])  # massimo di posti coprili con chiunque abbia skill > 0
    for threshold in values:           # dalla soglia più alta: la prima che copre lo stesso numero è il max-min
        count, assigned = solve(threshold)
        if count == best_count:
            return assigned
    return None


def rebalance(
    by_cell: Dict[Tuple[int, str, str], List[int]],
    days: Sequence[int],
    shifts: Dict[str, List[str]],
    skill: Callable[[int, str], int],
    preferred: Callable[[int], Optional[str]],
    free_candidates: Callable[[int, Set[str]], List[int]],
    on_replace: Callable[[int, int, int, Set[str]], None],
    required: Callable[[int, str, str], int] = lambda d, shift, role: 0,
    roles: Sequence[str] = (),
) -> int:
    """
    Applica il bilanciamento a tutti i gruppi. Modifica `by_cell` sul posto.
    free_candidates(day, labels) -> persone libere che possono coprire TUTTE quelle mezz'ore.
    on_replace(day, uscente, entrante, labels) -> aggiorna i contatori di ore/occupazione del chiamante.
    Restituisce il numero di persone spostate o sostituite.
    """
    changes = 0
    for d in days:
        for _shift, labels in shifts.items():
            label_set = set(labels)
            # ruoli e mezz'ore di ogni persona in questa fascia
            per: Dict[int, Dict[str, Set[str]]] = {}
            for (dd, t, role), ids in by_cell.items():
                if dd == d and t in label_set:
                    for e in ids:
                        per.setdefault(e, {}).setdefault(role, set()).add(t)
            # gruppi: stesso orario esatto, un solo ruolo (chi fa più ruoli resta com'è)
            groups: Dict[frozenset, Dict[int, str]] = {}
            for e, emp_roles in per.items():
                if len(emp_roles) == 1:
                    (role, ts), = emp_roles.items()
                    groups.setdefault(frozenset(ts), {})[e] = role
            # prima i gruppi più grandi (più posti da bilanciare)
            for span, members in sorted(groups.items(), key=lambda g: (-len(g[1]), sorted(g[0]))):
                slots = sorted(members.values())
                # posti ancora scoperti per TUTTO l'orario del gruppo: si può scegliere di coprire
                # quelli al posto di altri, a parità di copertura totale
                for role in roles:
                    missing = min(required(d, _shift, role) - len(by_cell.get((d, t, role), [])) for t in span)
                    slots += [role] * max(0, missing)
                outsiders = [c for c in free_candidates(d, set(span)) if c not in members]
                cands = list(members) + outsiders
                sol = best_assignment(slots, cands, skill, members, preferred)
                if sol is None or sol == members or len(sol) < len(members):
                    continue
                # scrive il nuovo assetto sulle mezz'ore del gruppo
                for t in span:
                    for e, role in members.items():
                        cell = by_cell.get((d, t, role), [])
                        if e in cell:
                            cell.remove(e)
                    for e, role in sol.items():
                        cell = by_cell.setdefault((d, t, role), [])
                        if e not in cell:
                            cell.append(e)
                leaving = [e for e in members if e not in sol]
                entering = [e for e in sol if e not in members]
                for i in range(max(len(leaving), len(entering))):
                    on_replace(d, leaving[i] if i < len(leaving) else None,
                               entering[i] if i < len(entering) else None, set(span))
                changes += sum(1 for e in sol if members.get(e) != sol[e])
    return changes
