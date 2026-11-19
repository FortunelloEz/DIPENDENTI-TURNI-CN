// ui/assets/availability_viewer.js
// "Vedi disponibilità": per un giorno, chi ha dato disponibilità nel CSV importato
// e chi di loro è già in turno (dati: window._lastAvailabilityPreview + calendario).

const AV_DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const AV_DAYS_FULL = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

function avNormName(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/** "2026-05-30" -> "30/05" (senza passare da Date/UTC) */
function avDayMonth(iso) {
  const [, m, d] = String(iso || "").split("-");
  return d && m ? `${d}/${m}` : "";
}

let _avCleanup = null;
function avCloseOverlay() {
  _avCleanup?.();
  _avCleanup = null;
  document.getElementById("avOverlay")?.remove();
}

function avOpenDay(dayIndex) {
  const preview = window._lastAvailabilityPreview;
  if (!preview || !Array.isArray(preview.days) || !preview.days.length) {
    uiAlert({ title: "Nessuna disponibilità", message: "Per questa settimana non ci sono disponibilità importate. Usa «Importa CSV» in alto." });
    return;
  }
  const day = preview.days.find(d => Number(d.day_index) === Number(dayIndex));
  if (!day) {
    uiAlert({ title: "Nessuna disponibilità", message: "Il CSV importato non contiene questo giorno." });
    return;
  }
  avCloseOverlay();

  const items = Array.isArray(day.items) ? day.items : [];
  const wk = weekKeyOf(currentWeekStart);

  // nome (normalizzato) -> dipendente
  const byName = new Map();
  (employees || []).forEach(e => { if (e?.label) byName.set(avNormName(e.label), e); });

  // ruoli svolti quel giorno da ogni dipendente (tutte le mezz'ore, tutti i ruoli)
  const rolesById = new Map();
  HALF_HOURS.forEach(t => {
    ROLES.forEach(role => {
      (getAssignedIdsFor(wk, dayIndex, role, t) || []).forEach(id => {
        const k = String(id);
        if (!rolesById.has(k)) rolesById.set(k, new Set());
        rolesById.get(k).add(role);
      });
    });
  });

  const rows = items.map(it => {
    const emp = byName.get(avNormName(it.name));
    const roles = emp ? [...(rolesById.get(String(emp.id)) || [])] : [];
    return { name: emp?.label || it.name, range: it.range, roles, known: !!emp };
  }).sort((a, b) => a.name.localeCompare(b.name, "it"));

  const free = rows.filter(r => r.roles.length === 0);
  const busy = rows.filter(r => r.roles.length > 0);

  const rowHtml = (r) => `
    <div class="av-row${r.roles.length ? " is-busy" : ""}">
      <div class="av-name">${uiEscape(r.name)}</div>
      ${r.roles.length
        ? `<div class="av-roles">${r.roles.map(role => `<span class="sm-role-badge sm-badge-${roleCss(role)}" title="${uiEscape(role)}">${uiEscape(ROLE_SHORT[role] || role)}</span>`).join("")}</div>`
        : ""}
      <div class="av-range" title="Disponibile dalle alle">${uiEscape(r.range)}</div>
    </div>`;

  const overlay = document.createElement("div");
  overlay.id = "avOverlay";
  overlay.className = "av-overlay";
  overlay.innerHTML = `
    <div class="av-modal" role="dialog" aria-modal="true" aria-labelledby="avTitle">
      <div class="av-head">
        <div>
          <div class="av-title" id="avTitle">Disponibilità · ${uiEscape(AV_DAYS_FULL[dayIndex])} ${uiEscape(avDayMonth(day.iso_day))}</div>
          <div class="av-sub">${rows.length} ${rows.length === 1 ? "persona disponibile" : "persone disponibili"} nel CSV · ${free.length} non ancora in turno</div>
        </div>
        <button type="button" class="modal-close" id="avCloseBtn" aria-label="Chiudi">✕</button>
      </div>
      <div class="av-body">
        ${rows.length === 0 ? `<div class="av-empty">Nessuno ha dato disponibilità per questo giorno.</div>` : ""}
        ${free.length ? `
          <div class="av-group-title">Non ancora in turno
            ${infoTip("Hanno dato disponibilità ma non sono in nessun turno di questo giorno: sono le persone a cui pensare per coprire i buchi.")}
          </div>
          ${free.map(rowHtml).join("")}` : ""}
        ${busy.length ? `
          <div class="av-group-title">In turno <span class="av-group-hint">con il ruolo svolto</span></div>
          ${busy.map(rowHtml).join("")}` : ""}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const modal = overlay.querySelector(".av-modal");
  const stopDrag = makeAvDraggable(modal, overlay.querySelector(".av-head"));
  const onKey = (e) => { if (e.key === "Escape") avCloseOverlay(); };
  document.addEventListener("keydown", onKey);
  _avCleanup = () => { stopDrag(); document.removeEventListener("keydown", onKey); };

  overlay.querySelector("#avCloseBtn").addEventListener("click", avCloseOverlay);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) avCloseOverlay(); });
  overlay.querySelector("#avCloseBtn").focus();
}

function avRenderButtons() {
  const host = document.getElementById("availabilityActions");
  if (!host || host.dataset.built === "1") return;
  host.dataset.built = "1";
  host.className = "av-csv-section";
  host.innerHTML = `
    <div class="av-csv-title">Vedi disponibilità
      ${infoTip("Per ogni giorno: chi ha dato disponibilità nel CSV importato e chi di loro è già in turno.")}
    </div>
    <div class="av-csv-days" id="avBtns"></div>`;
  const btns = host.querySelector("#avBtns");
  AV_DAYS.forEach((d, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "av-day-pill";
    b.textContent = d;
    b.title = `Disponibilità di ${AV_DAYS_FULL[i].toLowerCase()}`;
    b.addEventListener("click", () => avOpenDay(i));
    btns.appendChild(b);
  });
}

/**
 * Finestra trascinabile dall'intestazione. Restituisce la funzione che rimuove i listener
 * (prima venivano aggiunti a window a ogni apertura e non tolti mai).
 */
function makeAvDraggable(modal, handle) {
  if (!modal || !handle) return () => {};
  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

  const onDown = (e) => {
    if (e.target.closest("button")) return;
    const r = modal.getBoundingClientRect();
    modal.style.position = "fixed";
    modal.style.margin = "0";
    modal.style.left = `${r.left}px`;
    modal.style.top = `${r.top}px`;
    dragging = true;
    startX = e.clientX; startY = e.clientY; startLeft = r.left; startTop = r.top;
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const r = modal.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 10, Math.max(10, startLeft + e.clientX - startX));
    const top = Math.min(window.innerHeight - r.height - 10, Math.max(10, startTop + e.clientY - startY));
    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
  };
  const onUp = () => { dragging = false; };

  handle.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  return () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
}

window.bindAvailabilityViewer = function bindAvailabilityViewer() {
  avRenderButtons();
};
