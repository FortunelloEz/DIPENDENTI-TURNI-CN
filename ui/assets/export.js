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
    wrap.innerHTML = `
      <div class="export-empty">
        <div class="export-empty-title">Nessuna tabella pronta</div>
        <div>In Home scegli la settimana e clicca «Elabora tabella Export».</div>
        <button type="button" class="btn primary" data-route-go="home">Vai alla Home</button>
      </div>`;
    wrap.querySelector("[data-route-go]")?.addEventListener("click", () => loadView("home"));
    return;
  }
  if (exportData.rows.length === 0) {
    wrap.innerHTML = `
      <div class="export-empty">
        <div class="export-empty-title">Nessun turno in questa settimana</div>
        <div>Importa le disponibilità o aggiungi i turni in Home, poi elabora di nuovo la tabella.</div>
      </div>`;
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

const _EXPORT_API = {
  pdf:   { full: "export_week_pdf_save_dialog",        simple: "export_week_simple_pdf_save_dialog"   },
  excel: { full: "export_week_excel_save_dialog",      simple: "export_week_simple_excel_save_dialog" },
};

function _exportFormat() {
  return document.getElementById("exportFormat")?.value || "pdf";
}

async function _doExport(type) {
  const wk = window.lastWeekKey;
  if (!wk) { await uiAlert({ title: "Nessuna tabella da esportare", message: "In Home scegli la settimana e clicca «Elabora tabella Export»." }); return; }
  const fmt    = _exportFormat();
  const method = _EXPORT_API[fmt]?.[type];
  if (!method) return;

  const btnId  = type === "full" ? "btnExportFull" : "btnExportSimple";
  const btn    = document.getElementById(btnId);
  // spinner sul pulsante (il contenuto, icona compresa, resta intatto)
  if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }

  try {
    const res = await window.pywebview.api[method](wk);
    if (res?.saved) {
      const name = String(res.path || "").split(/[\\/]/).pop();
      showToast(name ? `File salvato: ${name}` : "File salvato");
    }
  } catch (err) {
    console.error("[Export]", err);
    const detail = String(err?.message || err || "").replace(/^\w*Error:\s*/, "");
    await uiAlert({
      kind: "error",
      title: "Esportazione non riuscita",
      message: `${detail || "Errore sconosciuto."}\nSe il file è aperto in Excel o in un lettore PDF, chiudilo e riprova.`,
    });
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
  }
}

function initExportView() {
  const data = window.lastExportData;
  renderExportTable(data);

  // senza tabella (o senza turni) non c'è niente da esportare: pulsanti spenti
  const hasRows = !!(data && Array.isArray(data.rows) && data.rows.length);
  ["btnExportFull", "btnExportSimple", "exportFormat"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !hasRows;
  });
  const sub = document.getElementById("exportSubtitle");
  const isos = (data?.headers || []).map(h => h.iso).filter(Boolean);
  if (sub && isos.length) {
    const f = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
    sub.textContent = `Settimana ${f(isos[0])} → ${f(isos[isos.length - 1])} · anteprima da salvare in PDF o Excel.`;
  }

  for (const [id, type] of [["btnExportFull", "full"], ["btnExportSimple", "simple"]]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener("click", () => _doExport(type));
  }
}

window.initExportView = initExportView;
window.renderExportTable = renderExportTable;