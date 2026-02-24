# cn_turni/services/pdf_export.py
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet


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
    subtitle = Paragraph("Turni settimana", styles["Normal"])

    day_headers = [""]
    slot_headers = [""]

    for h in export["headers"]:
        day_headers.extend([h["label"], ""])
        slot_headers.extend(["MATTINA", "SERA"])

    data: List[List[str]] = [day_headers, slot_headers]

    for r in export["rows"]:
        row = [r["name"]]
        row.extend(r["cells"])
        data.append(row)

    tbl = Table(data, repeatRows=2)
    style = TableStyle([
        ("FONTNAME", (0,0), (-1,-1), "Helvetica"),
        ("FONTSIZE", (0,0), (-1,1), 9),
        ("FONTSIZE", (0,2), (-1,-1), 9),
        ("BACKGROUND", (0,0), (-1,0), colors.whitesmoke),
        ("BACKGROUND", (0,1), (-1,1), colors.lightgrey),
        ("ALIGN", (1,0), (-1,1), "CENTER"),
        ("ALIGN", (1,2), (-1,-1), "CENTER"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("GRID", (0,0), (-1,-1), 0.25, colors.grey),
    ])

    # span giorni (colspan 2)
    # col 0 = nome, poi coppie (1,2), (3,4)...
    for i in range(len(export["headers"])):
        c1 = 1 + i*2
        c2 = c1 + 1
        style.add("SPAN", (c1,0), (c2,0))

    tbl.setStyle(style)

    story = [title, Spacer(1, 6), subtitle, Spacer(1, 12), tbl]
    doc.build(story)
    return buf.getvalue()
