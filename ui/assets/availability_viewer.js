// ui/assets/availability_viewer.js
// Mostra disponibilità per giorno come lista: "NOME : 18–24" (basata su window._lastAvailabilityPreview)

const AV_DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

function avEscape(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function avNormName(s){
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}
function avCloseOverlay(){
  document.getElementById("avOverlay")?.remove();
}

function avOpenDay(dayIndex){
  const preview = window._lastAvailabilityPreview;
  if (!preview || !Array.isArray(preview.days) || !preview.days.length){
    uiAlert({ title: "Nessuna disponibilità", message: "Per questa settimana non ci sono disponibilità importate. Usa «Importa CSV» in alto." });
    return;
  }

  const day = preview.days.find(d => Number(d.day_index) === Number(dayIndex));
  if (!day){
    uiAlert({ title: "Nessuna disponibilità", message: "Il CSV importato non contiene questo giorno." });
    return;
  }

  const items = Array.isArray(day.items) ? day.items : [];
  // ===== calcolo "chi è stato inserito in calendario" per quel giorno =====
  const wk =
    (typeof window.currentWeekKey !== "undefined" && window.currentWeekKey)
      ? window.currentWeekKey
      : (typeof weekKeyOf === "function" ? weekKeyOf(currentWeekStart) : null);

  const scheduledIds = new Set();

  // mappa "NOME" -> employeeId (match per label)
  const nameToId = new Map();
  if (Array.isArray(employees)) {
    employees.forEach(e => {
      const k = avNormName(e?.label);
      if (k) nameToId.set(k, e.id);
    });
  }

  // unione di TUTTE le assegnazioni del giorno, su tutti i ruoli e tutte le mezz'ore
  if (wk && Array.isArray(HALF_HOURS) && Array.isArray(ROLES) && typeof getAssignedIdsFor === "function") {
    HALF_HOURS.forEach(t => {
      ROLES.forEach(role => {
        const ids = getAssignedIdsFor(wk, dayIndex, role, t) || [];
        ids.forEach(id => scheduledIds.add(String(id)));
      });
    });
  }

  function isNotScheduled(itName){
    const id = nameToId.get(avNormName(itName));
    if (id === undefined || id === null) return false; // se non matcho il nome, non lo marco rosa
    return !scheduledIds.has(String(id));
  }
  const overlay = document.createElement("div");
  overlay.id = "avOverlay";
  overlay.className = "av-overlay";

  const modal = document.createElement("div");
  modal.className = "av-modal";

  modal.innerHTML = `
    <div class="av-head">
      <div class="av-title">Disponibilità — ${avEscape(AV_DAYS[dayIndex])} (${avEscape(day.iso_day)})</div>
      <button class="av-x" id="avCloseBtn">✕</button>
    </div>

    <div class="av-body-list">
      ${
        items.length
          ? items.map(it => {
              const missing = isNotScheduled(it.name);
              return `
                <div class="av-row ${missing ? "av-missing" : ""}">
                  <div class="av-name">
                    ${avEscape(it.name)}
                    ${missing ? `<span class="av-badge-missing">non inserito</span>` : ``}
                  </div>
                  <div class="av-range">${avEscape(it.range)}</div>
                </div>
              `;
            }).join("")
          : `<div class="av-empty">Nessuno</div>`
      }
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // ===== draggable modal =====
  makeAvDraggable(modal, modal.querySelector(".av-head"));
  document.getElementById("avCloseBtn")?.addEventListener("click", avCloseOverlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) avCloseOverlay();
  });
}

function avRenderButtons(){
  const host = document.getElementById("availabilityActions");
  if (!host) return;

  // evita doppio render
  if (host.dataset.built === "1") return;
  host.dataset.built = "1";

  host.className = "av-csv-section";
  host.innerHTML = `
    <div class="av-csv-title">👁 Vedi disponibilità</div>
    <div class="av-csv-days" id="avBtns"></div>
  `;

  const btns = host.querySelector("#avBtns");
  AV_DAYS.forEach((d, i) => {
    const b = document.createElement("button");
    b.className = "av-day-pill";
    b.textContent = d;
    b.title = `Disponibilità ${d}`;
    b.addEventListener("click", () => avOpenDay(i));
    btns.appendChild(b);
  });
}
function makeAvDraggable(modal, handle){
  if (!modal || !handle) return;

  modal.style.position = "absolute";

  // centra iniziale
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = modal.getBoundingClientRect();
  modal.style.left = `${Math.max(10, (vw - r.width) / 2)}px`;
  modal.style.top  = `${Math.max(10, (vh - r.height) / 2)}px`;

  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;

  handle.style.cursor = "move";
  handle.style.userSelect = "none";
  let isResizing = false;

  // se l'utente sta ridimensionando (drag del resize handle), non trascinare
  modal.addEventListener("mousedown", (e) => {
    const rr = modal.getBoundingClientRect();
    const nearRight = (rr.right - e.clientX) < 18;
    const nearBottom = (rr.bottom - e.clientY) < 18;
    isResizing = nearRight && nearBottom; // angolo resize
  });

  window.addEventListener("mouseup", () => { isResizing = false; });
  handle.addEventListener("mousedown", (e) => {
    if (isResizing) return;
    if (e.target && e.target.closest && e.target.closest(".av-x")) return;

    dragging = true;
    const rr = modal.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rr.left;
    startTop = rr.top;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const rr = modal.getBoundingClientRect();
    const newLeft = Math.min(window.innerWidth - rr.width - 10, Math.max(10, startLeft + dx));
    const newTop  = Math.min(window.innerHeight - rr.height - 10, Math.max(10, startTop + dy));

    modal.style.left = `${newLeft}px`;
    modal.style.top  = `${newTop}px`;
  });

  window.addEventListener("mouseup", () => { dragging = false; });
}
window.bindAvailabilityViewer = function bindAvailabilityViewer(){
  avRenderButtons();
};