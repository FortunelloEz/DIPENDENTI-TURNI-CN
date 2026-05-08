// =========================
// Turni CN - CORE UI
// =========================

/* ---------- ROUTING ---------- */
async function loadView(route) {
  const viewEl = document.getElementById("view");
  const html = await fetch(`./views/${route}.html`).then(r => r.text());
  viewEl.innerHTML = html;

  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelector(`.nav-item[data-route="${route}"]`)?.classList.add("active");

  if (route === "home") initHome();
  if (route === "employees") initEmployees();
  if (route === "squads") initSquadsPage();
  if (route === "export") {
    console.log("[export] view loaded");
    window.initExportView?.();
  }
}

/* ---------- ACCORDION UI ---------- */
function initAccordions() {
  document.querySelectorAll(".accordion").forEach(btn => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const accId = btn.getAttribute("data-acc");
      const panel = document.getElementById(`acc-${accId}`);
      if (accId === "main") {
        const sidebar = document.querySelector(".sidebar");
        const isCollapsed = sidebar.classList.toggle("collapsed");
        document.querySelector(".app")?.classList.toggle("left-collapsed", isCollapsed);
        btn.classList.toggle("open", !isCollapsed);
        panel?.classList.toggle("open", !isCollapsed);
        return;
      }
      if (accId === "employees") {
        const rightbar = btn.closest(".rightbar");
        if (!rightbar) return;
        const isCollapsed = rightbar.classList.toggle("collapsed");
        btn.classList.toggle("open", !isCollapsed);
        panel?.classList.toggle("open", !isCollapsed);
        return;
      }
      const isOpen = panel?.classList.contains("open");
      panel?.classList.toggle("open", !isOpen);
      btn.classList.toggle("open", !isOpen);
    });
  });
}

/* ---------- DATI STATICI ---------- */
const DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const ROLES = ["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"];
const ROLE_SHORT = { Cassa:"C", Runner:"R", Bar:"B", Comande:"Co", Accoglienza:"A", Jolly:"J" };
function roleCss(role){
  return (role || '').toLowerCase().replace(/\s+/g,'-').replace('à','a');
}

/* ---------- EMPLOYEES ---------- */
let employees = [];
function getEmployeeById(id){
  return employees.find(e => String(e.id) === String(id)) || null;
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function retryUntil(fn, predicate, { tries = 15, delayMs = 120 } = {}){
  for (let i = 0; i < tries; i++){
    try { await fn(); } catch (e) {}
    try { if (predicate()) return true; } catch (e) {}
    await sleep(delayMs);
  }
  return false;
}

/* ---------- TEMPI ---------- */
function buildTimeSlots_30min(startMin, endMinExclusive){
  const out = [];
  for (let m = startMin; m < endMinExclusive; m += 30){
    const hh = String(Math.floor(m/60)).padStart(2,"0");
    const mm = String(m%60).padStart(2,"0");
    out.push(`${hh}:${mm}`);
  }
  return out;
}
const HALF_HOURS = buildTimeSlots_30min(8*60, 24*60);

function timeToMin(t){
  const [h,m] = t.split(":").map(Number);
  return h*60 + m;
}
function minToTime(min){
  const h = String(Math.floor(min/60)).padStart(2,"0");
  const m = String(min%60).padStart(2,"0");
  return `${h}:${m}`;
}
function bandLabel(startMin,endMin){
  const s = minToTime(startMin).replace(/:00$/,"");
  const e = endMin === 24*60 ? "24" : minToTime(endMin).replace(/:00$/,"");
  return `${s}–${e}`;
}
function baseSegments(){
  return [
    { startMin:8*60,  endMin:16*60, id:'480-960',  label:'08–16' },
    { startMin:16*60, endMin:24*60, id:'960-1440', label:'16–24' },
  ];
}
function segmentToSlots(seg){
  const start = minToTime(seg.startMin);
  const end   = minToTime(seg.endMin);
  const startIdx = HALF_HOURS.indexOf(start);
  const endIdx   = (end === '24:00') ? HALF_HOURS.length : HALF_HOURS.indexOf(end);
  return HALF_HOURS.slice(startIdx, endIdx);
}

/* ---------- DATE/WEEK ---------- */
function formatDate(d){
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  return `${dd}/${mm}`;
}
function getMondayOfCurrentWeek(date){
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}
function getNextWeekMonday(date){
  const monday = getMondayOfCurrentWeek(date);
  monday.setDate(monday.getDate() + 7);
  return monday;
}
function weekKeyOf(weekStartDate){
  const y = weekStartDate.getFullYear();
  const m = String(weekStartDate.getMonth()+1).padStart(2,"0");
  const d = String(weekStartDate.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function mondayDateFromWeekKey(weekKey){
  const [y, m, d] = String(weekKey).split("-").map(Number);
  return new Date(y, (m - 1), d, 0, 0, 0, 0);
}

/* ---------- STATO UI ---------- */
let currentWeekStart = null;
let assignments = new Map();
let weekSegments = new Map();
let squads = new Map();
let activeModalEl = null;

function closeModal(){
  activeModalEl?.remove();
  activeModalEl = null;
}

/* ---------- ASSIGNMENTS HELPERS ---------- */
function keyOf(weekKey, dayIndex, role, timeLabel){
  return `${weekKey}|${dayIndex}|${role}|${timeLabel}`;
}
function getAssignedIdsFor(weekKey, dayIndex, role, timeLabel){
  return assignments.get(keyOf(weekKey, dayIndex, role, timeLabel)) || [];
}
function setAssignedIdsFor(weekKey, dayIndex, role, timeLabel, ids){
  const k = keyOf(weekKey, dayIndex, role, timeLabel);
  const clean = Array.from(new Set(ids)).filter(v => v !== null && v !== undefined && String(v) !== "");
  if (clean.length === 0) assignments.delete(k);
  else assignments.set(k, clean);
}
function unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels){
  const set = new Set();
  timeLabels.forEach(t => getAssignedIdsFor(weekKey, dayIndex, role, t).forEach(id => set.add(id)));
  return Array.from(set);
}
function hasAnyAssignmentsForWeek(weekKey){
  for (const k of assignments.keys()){
    if (k.startsWith(weekKey + "|")) return true;
  }
  return false;
}
function tableSignatureAt(weekKey, timeLabel){
  const parts = [];
  for (let d=0; d<DAYS.length; d++){
    for (let r=0; r<ROLES.length; r++){
      const ids = getAssignedIdsFor(weekKey, d, ROLES[r], timeLabel).slice().sort();
      parts.push(ids.join(","), "|");
    }
    parts.push("||");
  }
  return parts.join("");
}
function computeTimeSegments(weekKey){
  if (!hasAnyAssignmentsForWeek(weekKey)) return baseSegments();
  const segs = [];
  let segStartMin = 8*60;
  let prevSig = null;
  for (let i=0; i<HALF_HOURS.length; i++){
    const t = HALF_HOURS[i];
    const m = timeToMin(t);
    if (m < 8*60) continue;
    if (m >= 24*60) break;
    const sig = tableSignatureAt(weekKey, t);
    if (prevSig === null){ prevSig = sig; segStartMin = m; continue; }
    if (sig !== prevSig){
      segs.push({ startMin: segStartMin, endMin: m, id: `${segStartMin}-${m}`, label: bandLabel(segStartMin, m) });
      segStartMin = m;
      prevSig = sig;
    }
  }
  segs.push({ startMin: segStartMin, endMin: 24*60, id: `${segStartMin}-${24*60}`, label: bandLabel(segStartMin, 24*60) });
  if (segs.length === 1 && segs[0].startMin === 8*60 && segs[0].endMin === 24*60) return baseSegments();
  return segs;
}
function recalcSegmentsFromAssignments(weekKey){
  weekSegments.set(weekKey, computeTimeSegments(weekKey));
}

/* ---------- DISPONIBILITÀ HELPER ---------- */
/**
 * Dato il preview disponibilità e un dayIndex+seg, restituisce:
 * [{ name, range, empId|null }] — chi è disponibile in quella fascia
 * I dati vengono dal _lastAvailabilityPreview salvato dopo l'import.
 */
function getAvailableForSlot(dayIndex, seg) {
  const preview = window._lastAvailabilityPreview;
  if (!preview || !preview.days) return [];

  const dayData = preview.days.find(d => d.day_index === dayIndex);
  if (!dayData) return [];

  // Converti seg in ore di inizio/fine
  const segStartH = Math.floor(seg.startMin / 60);
  const segEndH   = Math.floor(seg.endMin   / 60);

  return (dayData.items || []).filter(item => {
    // range = "08-16" o "16-24" ecc.
    const parts = (item.range || "").split("-").map(Number);
    if (parts.length < 2) return false;
    const [avStart, avEnd] = parts;
    // Sovrappone con il segmento?
    return avStart < segEndH && avEnd > segStartH;
  }).map(item => {
    // Cerca l'empId corrispondente al nome
    const emp = employees.find(e =>
      e.label.toUpperCase() === (item.name || "").toUpperCase()
    );
    return { name: item.name, range: item.range, empId: emp ? emp.id : null };
  });
}

/**
 * Dato il fabbisogno squadra e le assegnazioni correnti per giorno+seg,
 * restituisce per ogni ruolo { required, assigned, deficit }.
 * seg viene mappato su "morning" o "evening" (o entrambi se si sovrappone).
 */
function getSquadDeficitForSlot(weekKey, dayIndex, seg) {
  const squadData = squads.get(weekKey);
  if (!squadData) return {};

  const daySquad = squadData[dayIndex] || { morning: {}, evening: {} };
  const timeLabels = segmentToSlots(seg);
  const segStartH = Math.floor(seg.startMin / 60);
  const segEndH   = Math.floor(seg.endMin   / 60);

  // Determina quali slot (morning/evening) questo segmento copre
  const coversMorning = segStartH < 16 && segEndH > 8;
  const coversEvening = segStartH < 24 && segEndH > 16;

  const result = {};
  ROLES.forEach(role => {
    let required = 0;
    if (coversMorning) required += parseInt(daySquad.morning?.[role] || 0);
    if (coversEvening) required += parseInt(daySquad.evening?.[role] || 0);

    const assigned = unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels).length;
    result[role] = { required, assigned, deficit: Math.max(0, required - assigned) };
  });

  return result;
}

/* ---------- UI HELPERS ---------- */
function makeCell(text, className){
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}
function renderEmployees(){
  const list = document.getElementById("empList");
  if (!list) return;
  list.innerHTML = "";
  employees.slice().sort((a,b) => a.label.localeCompare(b.label, "it")).forEach(e => {
    const item = document.createElement("div");
    item.className = "emp-item";
    item.innerHTML = `<span class="emp-dot"></span><span>${e.label}</span>`;
    list.appendChild(item);
  });
}
function renderWeekLabel(){
  const label = document.getElementById("weekLabel");
  if (!label) return;
  const end = new Date(currentWeekStart);
  end.setDate(end.getDate() + 6);
  label.textContent = `Settimana: ${formatDate(currentWeekStart)} → ${formatDate(end)}`;
}
async function renderDaySummary() {
  const container = document.getElementById("daySummaryBody");
  if (!container) return;
  const DAY_TYPE_ICONS = { "Leggera": "🟢", "Normale": "🟡", "Pesante": "🔴" };
  let dayAssignments = {};
  try { dayAssignments = await apiCall("day_type_assignments_get") || {}; } catch(e) {}
  const cells = DAYS.map((day, dayIndex) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + dayIndex);
    const dateStr = formatDate(date);
    const typeName = dayAssignments[String(dayIndex)] || dayAssignments[dayIndex] || null;
    const icon = typeName ? (DAY_TYPE_ICONS[typeName] || "") : "—";
    const typeColors = { "Leggera": "rgba(16,185,129,.10)", "Normale": "rgba(245,158,11,.10)", "Pesante": "rgba(239,68,68,.10)" };
    const typeBorders = { "Leggera": "rgba(16,185,129,.30)", "Normale": "rgba(245,158,11,.30)", "Pesante": "rgba(239,68,68,.30)" };
    const bg = typeName ? typeColors[typeName] : "transparent";
    const border = typeName ? typeBorders[typeName] : "rgba(15,23,42,.08)";
    return `<div class="ds-item ${typeName ? "ds-item--set" : ""}" style="background:${bg};border-color:${border};">
      <div class="ds-item-head"><span class="ds-item-day">${day}</span><span class="ds-item-date">${dateStr}</span></div>
      <div class="ds-item-type">${icon} ${typeName || "Non assegnata"}</div>
    </div>`;
  }).join("");
  container.innerHTML = cells;
}

/* ---------- CALENDARIO ---------- */
function renderCalendar(){
  const wrap = document.getElementById("timelineWrap");
  if (!wrap) return;

  const weekKey = weekKeyOf(currentWeekStart);
  const segments = computeTimeSegments(weekKey);

  const table = document.createElement("table");
  table.className = "timeline-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const thTime = document.createElement("th");
  thTime.className = "tl-th tl-th-time";
  thTime.textContent = "Fascia";
  headerRow.appendChild(thTime);

  DAYS.forEach((day, di) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + di);
    const th = document.createElement("th");
    th.className = `tl-th tl-th-day day-col-${di}`;
    th.innerHTML = `<div class="tl-day-name">${day}</div><div class="tl-day-date">${formatDate(date)}</div>`;
    th.title = "Clicca per vedere il dettaglio del giorno";
    th.style.cursor = "pointer";
    th.addEventListener("click", () => openDayModal(di));
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  segments.forEach(seg => {
    const timeLabels = segmentToSlots(seg);
    const tr = document.createElement("tr");
    tr.className = "tl-row";

    const tdTime = document.createElement("td");
    tdTime.className = "tl-time";
    tdTime.textContent = seg.label;
    tr.appendChild(tdTime);

    DAYS.forEach((_, di) => {
      const td = document.createElement("td");
      td.className = `tl-cell day-col-${di}`;
      td.dataset.dayIndex = di;
      td.dataset.segId = seg.id;
      td.title = "Clicca per gestire questo turno";

      const byRole = {};
      ROLES.forEach(role => {
        const ids = unionAssignedOverLabels(weekKey, di, role, timeLabels);
        if (ids.length) byRole[role] = ids;
      });

      if (Object.keys(byRole).length === 0) {
        td.classList.add("tl-empty");
        td.innerHTML = `<span class="tl-empty-dash">—</span>`;
      } else {
        td.classList.add("tl-filled");
        td.innerHTML = Object.entries(byRole).map(([role, ids]) => {
          const names = ids.map(id => getEmployeeById(id)?.label || String(id));
          return `<div class="tl-role-group">
            <span class="tl-role-pill tl-role-${roleCss(role)}">${ROLE_SHORT[role] || role}</span>
            <span class="tl-names">${names.join(", ")}</span>
          </div>`;
        }).join("");
      }

      // Click sulla cella → modal gestione turno unificato
      td.addEventListener("click", () => {
        openSlotManageModal({ weekKey, dayIndex: di, seg, timeLabels });
      });

      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

/* ===========================================
   MODAL: DETTAGLIO GIORNO — card scure per fascia
   =========================================== */
function openDayModal(dayIndex){
  const weekKey = weekKeyOf(currentWeekStart);
  const date = new Date(currentWeekStart);
  date.setDate(date.getDate() + dayIndex);

  const bd = document.getElementById("dayModalBackdrop");
  const titleEl = document.getElementById("dayModalTitle");
  const bodyEl  = document.getElementById("dayModalBody");
  if (!bd || !titleEl || !bodyEl) return;

  const DAY_FULL = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  titleEl.textContent = `${DAY_FULL[dayIndex]} ${formatDate(date)}`;

  const segments = computeTimeSegments(weekKey);
  bodyEl.innerHTML = "";

  segments.forEach(seg => {
    const timeLabels = segmentToSlots(seg);
    const deficit    = getSquadDeficitForSlot(weekKey, dayIndex, seg);
    const missingRoles = ROLES.filter(r => deficit[r]?.deficit > 0);
    const hasNeed      = ROLES.some(r => (deficit[r]?.required || 0) > 0);
    const allCovered   = hasNeed && missingRoles.length === 0;
    const someMissing  = missingRoles.length > 0;

    const card = document.createElement("div");
    card.className = "dm-card" + (someMissing ? " dm-card-missing" : allCovered ? " dm-card-ok" : "");

    // Header card
    const cardHead = document.createElement("div");
    cardHead.className = "dm-card-head";

    const headLeft = document.createElement("div");
    headLeft.className = "dm-head-left";

    const statusDot = document.createElement("span");
    statusDot.className = "dm-status-dot" + (someMissing ? " dm-dot-bad" : allCovered ? " dm-dot-ok" : " dm-dot-neutral");
    headLeft.appendChild(statusDot);

    const segLabel = document.createElement("span");
    segLabel.className = "dm-seg-label";
    segLabel.textContent = seg.label;
    headLeft.appendChild(segLabel);

    if (hasNeed) {
      const chips = document.createElement("div");
      chips.className = "dm-chips";
      ROLES.forEach(role => {
        const d = deficit[role];
        if (!d || d.required === 0) return;
        const ok = d.deficit === 0;
        const chip = document.createElement("span");
        chip.className = "dm-chip" + (ok ? " dm-chip-ok" : " dm-chip-bad");
        chip.textContent = `${ROLE_SHORT[role]} ${d.assigned}/${d.required}`;
        chips.appendChild(chip);
      });
      headLeft.appendChild(chips);
    }

    cardHead.appendChild(headLeft);

    const manageBtn = document.createElement("button");
    manageBtn.className = "dm-manage-btn";
    manageBtn.dataset.segStart = seg.startMin;
    manageBtn.dataset.segEnd   = seg.endMin;
    manageBtn.dataset.day      = dayIndex;
    manageBtn.textContent      = "Gestisci →";
    cardHead.appendChild(manageBtn);
    card.appendChild(cardHead);

    // Corpo card: righe ruolo
    const cardBody = document.createElement("div");
    cardBody.className = "dm-card-body";
    let hasAnyone = false;

    ROLES.forEach(role => {
      const ids = unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels);
      if (!ids.length) return;
      hasAnyone = true;
      const names = ids.map(id => {
        const emp = getEmployeeById(id);
        if (!emp) return String(id);
        return emp.label.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      });
      const row = document.createElement("div");
      row.className = "dm-role-row";
      row.innerHTML = `
        <span class="sm-role-badge sm-badge-${roleCss(role)} dm-role-badge">${ROLE_SHORT[role]}</span>
        <span class="dm-role-label">${role}</span>
        <span class="dm-role-names">${names.join("  ·  ")}</span>
      `;
      cardBody.appendChild(row);
    });

    // Ruoli scoperti (fabbisogno > 0, nessuno assegnato)
    ROLES.forEach(role => {
      const d   = deficit[role];
      const ids = unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels);
      if (!d || d.required === 0 || ids.length > 0) return;
      hasAnyone = true;
      const row = document.createElement("div");
      row.className = "dm-role-row dm-role-row-missing";
      row.innerHTML = `
        <span class="sm-role-badge sm-badge-${roleCss(role)} dm-role-badge">${ROLE_SHORT[role]}</span>
        <span class="dm-role-label">${role}</span>
        <span class="dm-role-names dm-role-uncovered">Scoperto — servono ${d.required}</span>
      `;
      cardBody.appendChild(row);
    });

    if (!hasAnyone) {
      cardBody.innerHTML = `<div class="dm-empty">Nessun dipendente assegnato</div>`;
    }

    card.appendChild(cardBody);
    bodyEl.appendChild(card);
  });

  bodyEl.querySelectorAll(".dm-manage-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const startMin = Number(btn.dataset.segStart);
      const endMin   = Number(btn.dataset.segEnd);
      const di       = Number(btn.dataset.day);
      const seg      = { startMin, endMin, id: `${startMin}-${endMin}`, label: bandLabel(startMin, endMin) };
      closeDayModal();
      openSlotManageModal({ weekKey, dayIndex: di, seg, timeLabels: segmentToSlots(seg) });
    });
  });

  const qaBtn = document.getElementById("dayModalQaBtn");
  const qdBtn = document.getElementById("dayModalQdBtn");
  if (qaBtn) qaBtn.style.display = "none";
  if (qdBtn) qdBtn.style.display = "none";

  bd.style.display = "flex";
}

function closeDayModal(){
  const bd = document.getElementById("dayModalBackdrop");
  if (bd) bd.style.display = "none";
}

/* ===========================================
   MODAL UNIFICATO: GESTIONE TURNO — tabella scura
   =========================================== */
function openSlotManageModal({ weekKey, dayIndex, seg, timeLabels }) {
  closeModal();

  const ROLE_BADGE_CLASS = {
    Cassa:"sm-badge-cassa", Runner:"sm-badge-runner", Bar:"sm-badge-bar",
    Comande:"sm-badge-comande", Accoglienza:"sm-badge-accoglienza", Jolly:"sm-badge-jolly",
  };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });

  const modal = document.createElement("div");
  modal.className = "modal slot-manage-modal";

  const head = document.createElement("div");
  head.className = "modal-head";
  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  const date = new Date(currentWeekStart);
  date.setDate(date.getDate() + dayIndex);
  titleEl.textContent = `${DAYS[dayIndex]} ${formatDate(date)} · ${seg.label}`;
  const closeBtn = document.createElement("div");
  closeBtn.className = "modal-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closeModal);
  head.appendChild(titleEl);
  head.appendChild(closeBtn);
  modal.appendChild(head);

  const body = document.createElement("div");
  body.className = "modal-body slot-manage-body";
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  activeModalEl = overlay;

  const localAssigned = {};
  ROLES.forEach(role => {
    localAssigned[role] = new Set(
      unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels).map(String)
    );
  });

  let openDropdownRole = null;

  function renderBody() {
    body.innerHTML = "";
    const deficit   = getSquadDeficitForSlot(weekKey, dayIndex, seg);
    const available = getAvailableForSlot(dayIndex, seg);

    const allInserted = new Set();
    ROLES.forEach(r => localAssigned[r].forEach(id => allInserted.add(String(id))));

    // Tabella
    const table = document.createElement("table");
    table.className = "sm-table";
    table.innerHTML = `<colgroup>
      <col class="col-role"><col class="col-chips"><col class="col-count"><col class="col-action">
    </colgroup>
    <thead><tr>
      <th>Ruolo</th><th>Assegnati</th><th style="text-align:center">Obiett.</th><th></th>
    </tr></thead>`;

    const tbody = document.createElement("tbody");

    ROLES.forEach(role => {
      const d           = deficit[role];
      const hasNeed     = d && d.required > 0;
      const isMissing   = hasNeed && d.deficit > 0;
      const assignedIds = Array.from(localAssigned[role]);

      // Riga ruolo
      const tr = document.createElement("tr");
      tr.className = "sm-tr" + (isMissing ? " sm-tr-missing" : "");

      const tdRole = document.createElement("td");
      tdRole.className = "sm-td-role";
      tdRole.innerHTML = `<div class="sm-role-cell">
        <span class="sm-role-badge ${ROLE_BADGE_CLASS[role]}">${ROLE_SHORT[role]}</span>
        <span class="sm-role-name">${role}</span>
      </div>`;

      const tdChips = document.createElement("td");
      tdChips.className = "sm-td-chips";
      const chipsWrap = document.createElement("div");
      chipsWrap.className = "sm-chips-wrap";
      if (assignedIds.length === 0) {
        chipsWrap.innerHTML = `<span class="sm-none-text">—</span>`;
      } else {
        assignedIds.forEach(empId => {
          const emp  = getEmployeeById(empId);
          const chip = document.createElement("span");
          chip.className = "sm-chip";
          const name = emp ? emp.label.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : empId;
          chip.innerHTML = `${name}<button class="sm-chip-remove" title="Rimuovi">×</button>`;
          chip.querySelector(".sm-chip-remove").addEventListener("click", () => {
            localAssigned[role].delete(String(empId));
            renderBody();
          });
          chipsWrap.appendChild(chip);
        });
      }
      tdChips.appendChild(chipsWrap);

      const tdCount = document.createElement("td");
      tdCount.className = "sm-td-count";
      if (hasNeed) {
        tdCount.innerHTML = `<span class="${isMissing ? "sm-count-bad" : "sm-count-ok"}">${assignedIds.length}/${d.required}</span>`;
      } else {
        tdCount.innerHTML = `<span class="sm-count-neutral">—</span>`;
      }

      const tdAction = document.createElement("td");
      tdAction.className = "sm-td-action";
      const addBtn = document.createElement("button");
      addBtn.className = "sm-add-btn";
      addBtn.title = `Aggiungi a ${role}`;
      addBtn.textContent = "+";
      addBtn.addEventListener("click", () => {
        openDropdownRole = openDropdownRole === role ? null : role;
        renderBody();
      });
      tdAction.appendChild(addBtn);

      tr.appendChild(tdRole);
      tr.appendChild(tdChips);
      tr.appendChild(tdCount);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);

      // Dropdown inline
      if (openDropdownRole === role) {
        const trDrop = document.createElement("tr");
        trDrop.className = "sm-tr-dropdown";
        const tdDrop = document.createElement("td");
        tdDrop.setAttribute("colspan", "4");

        const dropLabel = document.createElement("div");
        dropLabel.className = "sm-dropdown-label";
        dropLabel.textContent = `Aggiungi a ${role}`;

        const sel = document.createElement("select");
        sel.className = "sm-dropdown-select";
        sel.innerHTML = `<option value="">— Seleziona dipendente —</option>`;

        const avForRole = available.filter(av => av.empId && !localAssigned[role].has(String(av.empId)));
        if (avForRole.length > 0) {
          const grp = document.createElement("optgroup");
          grp.label = "Disponibili in questo slot";
          avForRole.forEach(av => {
            const opt = document.createElement("option");
            opt.value = av.empId;
            opt.textContent = `${av.name}  (${av.range})`;
            grp.appendChild(opt);
          });
          sel.appendChild(grp);
        }

        const others = employees.filter(e =>
          !localAssigned[role].has(String(e.id)) &&
          !avForRole.find(av => String(av.empId) === String(e.id))
        );
        if (others.length > 0) {
          const grp = document.createElement("optgroup");
          grp.label = "Altri dipendenti";
          others.forEach(e => {
            const opt = document.createElement("option");
            opt.value = e.id;
            opt.textContent = e.label;
            grp.appendChild(opt);
          });
          sel.appendChild(grp);
        }

        sel.addEventListener("change", () => {
          if (!sel.value) return;
          localAssigned[role].add(String(sel.value));
          openDropdownRole = null;
          renderBody();
        });

        tdDrop.appendChild(dropLabel);
        tdDrop.appendChild(sel);
        trDrop.appendChild(tdDrop);
        tbody.appendChild(trDrop);
      }
    });

    table.appendChild(tbody);
    body.appendChild(table);

    // Disponibili non inseriti — riga compatta in fondo
    const notInserted = available.filter(av => av.empId && !allInserted.has(String(av.empId)));
    if (notInserted.length > 0) {
      const bar = document.createElement("div");
      bar.className = "sm-available-bar";
      bar.innerHTML = `<span class="sm-available-label">Disponibili non assegnati</span>`;
      notInserted.forEach((av, i) => {
        if (i > 0) { const sep = document.createElement("span"); sep.className = "sm-available-sep"; sep.textContent = "·"; bar.appendChild(sep); }
        const span = document.createElement("span");
        span.innerHTML = `<span class="sm-available-name">${av.name}</span> <span class="sm-available-range">${av.range}</span>`;
        bar.appendChild(span);
      });
      body.appendChild(bar);
    }

    // Footer
    const existingFoot = modal.querySelector(".slot-manage-foot");
    if (existingFoot) existingFoot.remove();
    const foot = document.createElement("div");
    foot.className = "modal-foot slot-manage-foot";
    const btnCancel = document.createElement("button");
    btnCancel.className = "btn btn-ghost";
    btnCancel.textContent = "Annulla";
    btnCancel.addEventListener("click", closeModal);
    const btnSave = document.createElement("button");
    btnSave.className = "btn primary";
    btnSave.textContent = "Salva turno";
    btnSave.addEventListener("click", async () => {
      btnSave.disabled = true;
      btnSave.textContent = "Salvataggio...";
      for (const role of ROLES) {
        const idsArr = Array.from(localAssigned[role]).map(Number).filter(Boolean);
        for (const t of timeLabels) {
          setAssignedIdsFor(weekKey, dayIndex, role, t, idsArr);
          await saveSlotOverrideToDb(weekKey, dayIndex, role, t, idsArr);
        }
      }
      recalcSegmentsFromAssignments(weekKey);
      closeModal();
      renderCalendar();
    });
    foot.appendChild(btnCancel);
    foot.appendChild(btnSave);
    modal.appendChild(foot);
  }

  renderBody();
}

/* ---------- SQUADRE ---------- */
function defaultSquadDay(){
  const mk = () => Object.fromEntries(ROLES.map(r => [r, 0]));
  return { morning: mk(), evening: mk() };
}
function getWeekSquad(weekKey){
  if (!squads.has(weekKey)){
    const base = {};
    DAYS.forEach((_, i) => base[i] = defaultSquadDay());
    squads.set(weekKey, base);
  }
  return squads.get(weekKey);
}

/* ---------- INIT HOME ---------- */
async function initHome(){
  initAccordions();

  if (!currentWeekStart) currentWeekStart = getNextWeekMonday(new Date());
  const wk = weekKeyOf(currentWeekStart);
  window.currentWeekKey = wk;

  await retryUntil(
    async () => { await loadEmployeesFromDb(); },
    () => Array.isArray(employees) && employees.length > 0,
    { tries: 20, delayMs: 100 }
  );

  await loadWeekFromDb(wk);

  renderEmployees();
  renderWeekLabel();
  renderCalendar();
  renderDaySummary();

  await window.renderCsvFilePanel?.();
  window.bindCsvPanelActions?.();
  window.bindImportAvailability?.();
  window.bindElaboraSelectedFile?.();
  window.bindAvailabilityViewer?.();

  // Bottone "Elabora tabella Export"
  {
    const btn = document.getElementById("btnElaboraWeek");
    if (btn) {
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      clone.addEventListener("click", async () => {
        const wk2 = weekKeyOf(currentWeekStart);
        window.lastWeekKey = wk2;
        if (!window.pywebview?.api?.export_week) {
          alert("API non pronta: pywebview.api.export_week non disponibile.");
          return;
        }
        window.lastExportData = await window.pywebview.api.export_week(wk2);
        await loadView("export");
      });
    }
  }

  // Modal dettaglio giorno
  document.getElementById("dayModalClose")?.addEventListener("click", closeDayModal);
  document.getElementById("dayModalBackdrop")?.addEventListener("mousedown", (e) => {
    if (e.target === document.getElementById("dayModalBackdrop")) closeDayModal();
  });

  // Navigazione settimana
  const navWeek = async (delta) => {
    currentWeekStart.setDate(currentWeekStart.getDate() + delta);
    const wk2 = weekKeyOf(currentWeekStart);
    window.currentWeekKey = wk2;
    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
    await renderDaySummary();
  };
  document.getElementById("btnPrevWeek")?.addEventListener("click", () => navWeek(-7));
  document.getElementById("btnNextWeek")?.addEventListener("click", () => navWeek(+7));
  document.getElementById("btnToday")?.addEventListener("click", async () => {
    currentWeekStart = getNextWeekMonday(new Date());
    await navWeek(0);
  });
  document.getElementById("btnTodayTop")?.addEventListener("click", async () => {
    currentWeekStart = getNextWeekMonday(new Date());
    await navWeek(0);
  });
  document.getElementById("btnClear")?.addEventListener("click", async () => {
    const wk2 = weekKeyOf(currentWeekStart);
    Array.from(assignments.keys()).forEach(k => { if (k.startsWith(wk2 + "|")) assignments.delete(k); });
    await clearWeekOverridesOnDb(wk2);
    recalcSegmentsFromAssignments(wk2);
    renderCalendar();
    await renderDaySummary();
  });
  document.getElementById("btnPermManage")?.addEventListener("click", () => openPermanentModal?.());
}

/* ---------- NAV ---------- */
let _navBound = false;
function bindNavigation(){
  if (_navBound) return;
  _navBound = true;
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const route = btn.getAttribute("data-route");
      if (!route) return;
      loadView(route);
    });
  });
}

/* ---------- BOOT ---------- */
let _booted = false;
function boot() {
  if (_booted) return;
  _booted = true;
  bindNavigation();
  loadView("home");
}
function isPywebviewApiReady(){
  return !!(window.pywebview && window.pywebview.api);
}
function bootWhenReady(){
  const inPyWebView = typeof window.pywebview !== "undefined";
  if (!inPyWebView) { boot(); return; }
  const tick = () => {
    if (_booted) return;
    if (isPywebviewApiReady()) { boot(); return; }
    setTimeout(tick, 50);
  };
  tick();
}
window.addEventListener("pywebviewready", bootWhenReady);
window.addEventListener("DOMContentLoaded", bootWhenReady);