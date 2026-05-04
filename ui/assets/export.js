const EXPORT_ROLE_COLORS = {
  "Cassa":       { bg: "rgba(245,201,60,.35)",  border: "rgba(245,158,11,.5)" },
  "Runner":      { bg: "rgba(96,165,250,.30)",  border: "rgba(37,99,235,.45)" },
  "Bar":         { bg: "rgba(52,211,153,.30)",  border: "rgba(16,185,129,.45)" },
  "Comande":     { bg: "rgba(167,139,250,.30)", border: "rgba(139,92,246,.45)" },
  "Accoglienza": { bg: "rgba(251,113,133,.30)", border: "rgba(244,63,94,.45)" },
  "Jolly":       { bg: "rgba(148,163,184,.25)", border: "rgba(100,116,139,.40)" },
};
const EXPORT_ROLE_ORDER = ["Cassa","Runner","Bar","Comande","Accoglienza","Jolly"];

function _empInitials(name) {
  return (name || "?").split(" ").slice(0,2).map(w => w[0]?.toUpperCase() || "").join("");
}

function _empAvatarColor(name) {
  // colore deterministico dall'hash del nome
  let h = 0;
  for (let i = 0; i < (name||"").length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const hues = [210, 160, 280, 20, 340, 140, 50, 190];
  return `hsl(${hues[h % hues.length]}, 55%, 48%)`;
}

function renderExportTable(exportData, wrapId = "exportTableWrap") {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;

  if (!exportData || !exportData.headers || !exportData.rows) {
    wrap.innerHTML = `<div class="export-empty">Nessun export generato.<br>Vai in Home e clicca "Elabora settimana".</div>`;
    return;
  }

  // Legenda ruoli
  const legendHtml = `
    <div class="export-legend">
      ${EXPORT_ROLE_ORDER.map(role => {
        const c = EXPORT_ROLE_COLORS[role];
        return `<span class="export-legend-item" style="background:${c.bg};border-color:${c.border}">${role}</span>`;
      }).join("")}
    </div>
  `;

  const dayHeaders = exportData.headers;

  let html = `<table class="export-table">`;
  html += `<thead>`;

  // riga 1: giorni (colspan=2)
  html += `<tr><th class="export-th-name"></th>`;
  for (let i = 0; i < dayHeaders.length; i++) {
    const split = (i === dayHeaders.length - 1) ? "" : " day-split";
    html += `<th colspan="2" class="${split}">${_escapeHtml(dayHeaders[i].label)}</th>`;
  }
  html += `<th class="export-th-name"></th></tr>`;

  // riga 2: MATTINA/SERA
  html += `<tr><th class="export-th-name"></th>`;
  for (let i = 0; i < dayHeaders.length; i++) {
    const split = (i === dayHeaders.length - 1) ? "" : " day-split";
    html += `<th>MATTINA</th><th class="${split}">SERA</th>`;
  }
  html += `<th class="export-th-name"></th></tr></thead><tbody>`;

  for (let ri = 0; ri < exportData.rows.length; ri++) {
    const r = exportData.rows[ri];
    const roles = r.roles || [];
    const initials = _empInitials(r.name);
    const avatarColor = _empAvatarColor(r.name);
    const zebraClass = ri % 2 === 1 ? " row-alt" : "";

    html += `<tr class="${zebraClass}">`;
    html += `
      <td class="export-td-name">
        <div class="export-emp-row">
          <div class="export-avatar" style="background:${avatarColor}">${_escapeHtml(initials)}</div>
          <span class="export-emp-name">${_escapeHtml(r.name)}</span>
        </div>
      </td>
    `;

    for (let c = 0; c < r.cells.length; c++) {
      const val = r.cells[c] || "";
      const role = roles[c] || "";
      const roleStyle = (val && EXPORT_ROLE_COLORS[role])
        ? `background:${EXPORT_ROLE_COLORS[role].bg};border-left:3px solid ${EXPORT_ROLE_COLORS[role].border};`
        : "";
      const isEndOfDay = (c % 2 === 1);
      const splitClass = (isEndOfDay && c !== r.cells.length - 1) ? " day-split" : "";

      html += `<td class="export-td-cell${splitClass}" style="${roleStyle}">`;
      if (val) {
        const roleLabel = role ? `<div class="export-cell-role">${_escapeHtml(role)}</div>` : "";
        html += `<div class="export-cell-val">${_escapeHtml(val)}</div>${roleLabel}`;
      }
      html += `</td>`;
    }
    html += `
          <td class="export-td-name export-td-name--right">
            <div class="export-emp-row">
              <span class="export-emp-name">${_escapeHtml(r.name)}</span>
              <div class="export-avatar" style="background:${avatarColor}">${_escapeHtml(initials)}</div>
            </div>
          </td>
        `;
        html += `</tr>`;
      }

      html += `</tbody></table>`;
  wrap.innerHTML = legendHtml + html;
}
function _escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  }
}

function initExportView() {
  renderExportTable(window.lastExportData);

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