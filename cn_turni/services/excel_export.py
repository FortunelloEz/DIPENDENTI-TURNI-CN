# cn_turni/services/excel_export.py
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict

from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

ROLE_ORDER = ["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"]

EXCEL_ROLE_FILLS = {
    "Cassa":       PatternFill("solid", fgColor="FFF5E8A0"),
    "Runner":      PatternFill("solid", fgColor="FFB3D4FC"),
    "Bar":         PatternFill("solid", fgColor="FFA8EDD4"),
    "Comande":     PatternFill("solid", fgColor="FFD5C5FD"),
    "Accoglienza": PatternFill("solid", fgColor="FFFDB8C2"),
    "Jolly":       PatternFill("solid", fgColor="FFD8E0EC"),
}

_HDR1_FILL = PatternFill("solid", fgColor="FFECEFF5")
_HDR2_FILL = PatternFill("solid", fgColor="FFD9DDE8")
_ALT_FILL  = PatternFill("solid", fgColor="FFF7F8FC")
_WHT_FILL  = PatternFill("solid", fgColor="FFFFFFFF")

_HDR1_FONT = Font(bold=True, size=9)
_HDR2_FONT = Font(bold=True, size=8)
_DATA_FONT = Font(size=9)
_NAME_FONT = Font(bold=True, size=9)

_CENTER = Alignment(horizontal="center", vertical="center")
_LEFT   = Alignment(horizontal="left",   vertical="center")

_side   = Side(border_style="thin", color="FFB8BDC9")
_BORDER = Border(left=_side, right=_side, top=_side, bottom=_side)


def _cell(ws, row: int, col: int, value, font=None, fill=None, align=None):
    c = ws.cell(row=row, column=col, value=value)
    if font:  c.font  = font
    if fill:  c.fill  = fill
    if align: c.alignment = align
    c.border = _BORDER
    return c


def build_excel_from_export(export: Dict[str, Any]) -> bytes:
    """Excel normale: 2 righe header (giorno + MATTINA/SERA), colori per ruolo."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Turni"

    headers = export["headers"]
    n_days  = len(headers)

    col_name_l = 1
    col_name_r = 2 + n_days * 2

    # ── Riga 1: nome giorno (merge su 2 colonne) ──
    _cell(ws, 1, col_name_l, "", fill=_HDR1_FILL, align=_CENTER)
    _cell(ws, 1, col_name_r, "", fill=_HDR1_FILL, align=_CENTER)
    for i, h in enumerate(headers):
        c1 = 2 + i * 2
        _cell(ws, 1, c1,     h["label"], font=_HDR1_FONT, fill=_HDR1_FILL, align=_CENTER)
        _cell(ws, 1, c1 + 1, "",         fill=_HDR1_FILL, align=_CENTER)
        ws.merge_cells(start_row=1, start_column=c1, end_row=1, end_column=c1 + 1)

    # ── Riga 2: MATTINA / SERA ──
    _cell(ws, 2, col_name_l, "", fill=_HDR2_FILL)
    _cell(ws, 2, col_name_r, "", fill=_HDR2_FILL)
    for i in range(n_days):
        c_m = 2 + i * 2
        _cell(ws, 2, c_m,     "MATTINA", font=_HDR2_FONT, fill=_HDR2_FILL, align=_CENTER)
        _cell(ws, 2, c_m + 1, "SERA",    font=_HDR2_FONT, fill=_HDR2_FILL, align=_CENTER)

    # ── Dati ──
    for ri, r in enumerate(export["rows"]):
        row      = 3 + ri
        row_fill = _WHT_FILL if ri % 2 == 0 else _ALT_FILL
        roles    = r.get("roles", [""] * len(r["cells"]))

        _cell(ws, row, col_name_l, r["name"], font=_NAME_FONT, fill=row_fill, align=_LEFT)
        _cell(ws, row, col_name_r, r["name"], font=_NAME_FONT, fill=row_fill, align=_LEFT)

        for ci, (val, role) in enumerate(zip(r["cells"], roles)):
            cf = EXCEL_ROLE_FILLS.get(role, row_fill) if val else row_fill
            _cell(ws, row, 2 + ci, val or "", font=_DATA_FONT, fill=cf, align=_CENTER)

    # ── Larghezze ──
    ws.column_dimensions[get_column_letter(col_name_l)].width = 20
    ws.column_dimensions[get_column_letter(col_name_r)].width = 20
    for i in range(n_days * 2):
        ws.column_dimensions[get_column_letter(2 + i)].width = 8
    ws.row_dimensions[1].height = 16
    ws.row_dimensions[2].height = 14

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_excel_from_export_simple(export: Dict[str, Any]) -> bytes:
    """Excel semplificato: 1 riga header (giorni), 1 colonna per giorno."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Turni"

    headers = export["headers"]
    n_days  = len(headers)

    col_name_l = 1
    col_name_r = 2 + n_days

    # ── Riga 1: giorni ──
    _cell(ws, 1, col_name_l, "", fill=_HDR1_FILL)
    _cell(ws, 1, col_name_r, "", fill=_HDR1_FILL)
    for i, h in enumerate(headers):
        _cell(ws, 1, 2 + i, h["label"], font=_HDR1_FONT, fill=_HDR1_FILL, align=_CENTER)

    # ── Dati ──
    for ri, r in enumerate(export["rows"]):
        row      = 2 + ri
        row_fill = _WHT_FILL if ri % 2 == 0 else _ALT_FILL
        roles    = r.get("roles", [""] * len(r["cells"]))

        _cell(ws, row, col_name_l, r["name"], font=_NAME_FONT, fill=row_fill, align=_LEFT)
        _cell(ws, row, col_name_r, r["name"], font=_NAME_FONT, fill=row_fill, align=_LEFT)

        for ci, (val, role) in enumerate(zip(r["cells"], roles)):
            cf = EXCEL_ROLE_FILLS.get(role, row_fill) if val else row_fill
            _cell(ws, row, 2 + ci, val or "", font=_DATA_FONT, fill=cf, align=_CENTER)

    # ── Larghezze ──
    ws.column_dimensions[get_column_letter(col_name_l)].width = 20
    ws.column_dimensions[get_column_letter(col_name_r)].width = 20
    for i in range(n_days):
        ws.column_dimensions[get_column_letter(2 + i)].width = 11
    ws.row_dimensions[1].height = 16

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
