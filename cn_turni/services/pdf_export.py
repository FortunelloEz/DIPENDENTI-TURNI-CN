# cn_turni/services/pdf_export.py
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

ROLE_COLORS = {
    "Cassa":       colors.Color(0.96, 0.87, 0.45, alpha=0.55),
    "Runner":      colors.Color(0.55, 0.76, 0.97, alpha=0.55),
    "Bar":         colors.Color(0.55, 0.90, 0.78, alpha=0.55),
    "Comande":     colors.Color(0.82, 0.70, 0.97, alpha=0.55),
    "Accoglienza": colors.Color(0.97, 0.65, 0.70, alpha=0.55),
    "Jolly":       colors.Color(0.78, 0.84, 0.90, alpha=0.55),
}
ROLE_ORDER = ["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"]

def build_pdf_from_export(export: Dict[str, Any]) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=18,
        rightMargin=18,
        topMargin=18,
        bottomMargin=18,
    )
    styles = getSampleStyleSheet()

    title = Paragraph(f"Export settimana: {export.get('week_key','')}", styles["Title"])

    # Legenda ruoli
    from reportlab.platypus import HRFlowable
    legend_items = []
    for role in ROLE_ORDER:
        c = ROLE_COLORS.get(role)
        if c:
            r_int = int(c.red * 255)
            g_int = int(c.green * 255)
            b_int = int(c.blue * 255)
            legend_items.append(
                Paragraph(
                    f'<font color="#{r_int:02x}{g_int:02x}{b_int:02x}">■</font> {role}',
                    styles["Normal"]
                )
            )

    from reportlab.platypus import Table as RLTable
    legend_data = [legend_items]
    legend_tbl = RLTable(legend_data, hAlign="LEFT")
    legend_tbl.setStyle(TableStyle([
        ("FONTSIZE", (0,0), (-1,-1), 8),
        ("LEFTPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
    ]))

    # Headers
    day_headers = [""]
    slot_headers = [""]
    for h in export["headers"]:
        day_headers.extend([h["label"], ""])
        slot_headers.extend(["MATTINA", "SERA"])
    day_headers.append("")
    slot_headers.append("")

    data: List[List[str]] = [day_headers, slot_headers]
    for r in export["rows"]:
        row = [r["name"]]
        row.extend(r["cells"])
        row.append(r["name"])   # colonna nome finale
        data.append(row)

    tbl = Table(data, repeatRows=2)

    style_cmds = [
        ("FONTNAME", (0,0), (-1,-1), "Helvetica"),
        ("FONTSIZE", (0,0), (-1,1), 8),
        ("FONTSIZE", (0,2), (-1,-1), 8),
        ("BACKGROUND", (0,0), (-1,0), colors.Color(0.93,0.94,0.97)),
        ("BACKGROUND", (0,1), (-1,1), colors.Color(0.86,0.88,0.93)),
        ("FONTNAME", (0,0), (-1,1), "Helvetica-Bold"),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("ALIGN", (0,2), (0,-1), "LEFT"),    # nomi colonna sinistra
        ("ALIGN", (-1,2), (-1,-1), "LEFT"),  # nomi colonna destra
        ("FONTNAME", (-1,2), (-1,-1), "Helvetica"),        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("GRID", (0,0), (-1,-1), 0.25, colors.Color(0.75,0.78,0.85)),
        ("ROWBACKGROUNDS", (0,2), (-1,-1), [colors.white, colors.Color(0.97,0.97,0.99)]),
    ]

    # Span giorni
    for i in range(len(export["headers"])):
        c1 = 1 + i*2
        c2 = c1 + 1
        style_cmds.append(("SPAN", (c1,0), (c2,0)))

    # Colora celle per ruolo
    for row_idx, r in enumerate(export["rows"]):
        pdf_row = row_idx + 2  # +2 per le 2 righe header
        roles = r.get("roles", [""] * len(r["cells"]))
        for col_idx, role in enumerate(roles):
            if role and role in ROLE_COLORS:
                pdf_col = col_idx + 1  # +1 per colonna nome
                style_cmds.append(
                    ("BACKGROUND", (pdf_col, pdf_row), (pdf_col, pdf_row), ROLE_COLORS[role])
                )

    tbl.setStyle(TableStyle(style_cmds))

    story = [title, Spacer(1, 4), legend_tbl, Spacer(1, 8), tbl]
    doc.build(story)
    return buf.getvalue()
