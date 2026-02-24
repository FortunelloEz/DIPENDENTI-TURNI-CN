function _escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderExportTable(exportData, wrapId = "exportTableWrap") {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;

  if (!exportData || !exportData.headers || !exportData.rows) {
    wrap.innerHTML = `<div class="muted">Nessun export generato. Vai in Home e clicca “Elabora settimana”.</div>`;
    return;
  }

  const dayHeaders = exportData.headers;

  let html = `<table class="export-table">`;
  html += `<thead>`;

  // riga 1: giorni (colspan=2)
  html += `<tr><th></th>`;
  for (let i = 0; i < dayHeaders.length; i++) {
    const h = dayHeaders[i];
    const split = (i === dayHeaders.length - 1) ? "" : " day-split";
    html += `<th colspan="2" class="${split}">${_escapeHtml(h.label)}</th>`;
  }
  html += `</tr>`;

  // riga 2: MATTINA/SERA
  html += `<tr><th></th>`;
  for (let i = 0; i < dayHeaders.length; i++) {
    const split = (i === dayHeaders.length - 1) ? "" : " day-split";
    html += `<th>MATTINA</th><th class="${split}">SERA</th>`;
  }
  html += `</tr>`;

  html += `</thead><tbody>`;

  // righe dipendenti (già filtrate lato backend: solo chi ha almeno una cella piena)
  for (const r of exportData.rows) {
    html += `<tr><td><b>${_escapeHtml(r.name)}</b></td>`;

    for (let c = 0; c < r.cells.length; c++) {
      const val = r.cells[c] || "";
      const filled = val ? "filled" : "";
      // separatore ogni 2 celle (fine giorno)
      const isEndOfDay = ((c % 2) === 1);
      const split = (isEndOfDay && c !== r.cells.length - 1) ? " day-split" : "";
      html += `<td class="${filled}${split}" style="text-align:center">${_escapeHtml(val)}</td>`;
    }

    html += `</tr>`;
  }

  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

async function downloadExportPdf() {
  const wk = window.lastWeekKey;

  if (!wk) {
    alert("Prima elabora una settimana dalla Home.");
    return;
  }

  const res = await window.pywebview.api.export_week_pdf_save_dialog(wk);

  if (res?.saved) {
    alert("PDF salvato correttamente.");
  } else {
    // annullato dall’utente → niente
  }
}
function initExportView() {
  console.log("[export] initExportView");
  renderExportTable(window.lastExportData);

  const btn = document.getElementById("btnExportPdf");
  console.log("[export] btnExportPdf found?", !!btn);

  if (btn) {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);

    clone.addEventListener("click", async () => {
      console.log("[export] click pdf");
      await downloadExportPdf();
    });
  }
}
function initExportView() {
  renderExportTable(window.lastExportData);

  // bind “pulito” (evita doppi listener se rientri nella view)
  const btn = document.getElementById("btnExportPdf");
  if (btn) {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);

    clone.addEventListener("click", () => {
      downloadExportPdf().catch(err => {
        console.error(err);
        alert("Errore export PDF. Controlla console.");
      });
    });
  }
}

window.initExportView = initExportView;
window.renderExportTable = renderExportTable;