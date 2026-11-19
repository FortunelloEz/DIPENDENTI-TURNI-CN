// =========================
// Turni CN - CORE UI
// =========================

/* ---------- ROUTING ---------- */
async function loadView(route) {
  window.uiHideTip?.();
  const viewEl = document.getElementById("view");
  const html = await fetch(`./views/${route}.html`).then(r => r.text());
  viewEl.innerHTML = html;

  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelector(`.nav-item[data-route="${route}"]`)?.classList.add("active");

  if (route === "home") initHome();
  if (route === "employees") initEmployees();
  if (route === "squads") initSquadsPage();
  if (route === "export") {
    window.initExportView?.();
  }
  if (route === "report") window.initReportPage?.();
}

/* ---------- BARRA LATERALE ---------- */
// Ridotta/estesa: è una preferenza di vista, quindi resta in localStorage (non è un dato utente).
const SB_COLLAPSED_KEY = "sbCollapsed";
function setSidebarCollapsed(collapsed) {
  document.querySelector(".sidebar")?.classList.toggle("collapsed", collapsed);
  document.querySelector(".app")?.classList.toggle("left-collapsed", collapsed);
  const t = document.getElementById("sbToggle");
  if (t) {
    const label = collapsed ? "Espandi la barra laterale" : "Riduci la barra laterale";
    t.setAttribute("aria-label", label);
    t.title = label;
    t.setAttribute("aria-expanded", String(!collapsed));
  }
}
function initSidebar() {
  const t = document.getElementById("sbToggle");
  if (!t || t.dataset.bound === "1") return;
  t.dataset.bound = "1";
  let saved = false;
  try { saved = localStorage.getItem(SB_COLLAPSED_KEY) === "1"; } catch (_) {}
  setSidebarCollapsed(saved);
  t.addEventListener("click", () => {
    const next = !document.querySelector(".sidebar")?.classList.contains("collapsed");
    setSidebarCollapsed(next);
    try { localStorage.setItem(SB_COLLAPSED_KEY, next ? "1" : "0"); } catch (_) {}
  });
  apiCall("app_version").then(v => {
    const el = document.getElementById("sbVersion");
    if (el && v) el.textContent = `Versione ${v}`;
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
/**
 * Nome da mostrare per un id di turno. Un dipendente eliminato resta nello storico delle
 * settimane passate: si mostra «Ex dipendente» invece di un numero.
 * titleCase: "MARIO ROSSI" -> "Mario Rossi".
 */
function employeeLabel(id, { titleCase = false } = {}){
  const emp = getEmployeeById(id);
  if (!emp) return "Ex dipendente";
  if (!titleCase) return emp.label;
  return emp.label.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
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
let _escKeyHandler = null;

function closeModal(){
  if (_escKeyHandler) { document.removeEventListener("keydown", _escKeyHandler); _escKeyHandler = null; }
  activeModalEl?.remove();
  activeModalEl = null;
}

// showToast(): vedi ui_kit.js

/**
 * Ricarica la settimana dal DB e ridisegna il calendario.
 * Si usa dopo le scritture che toccano più slot e dopo ogni errore di salvataggio:
 * lo schermo mostra sempre e solo ciò che è davvero salvato.
 */
async function resyncWeekFromDb(weekKey){
  await loadWeekFromDb(weekKey);
  recalcSegmentsFromAssignments(weekKey);
  if (weekKey === weekKeyOf(currentWeekStart)) renderCalendar();
  window.chatAiUpdateContext?.();
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

function computeTimeSegmentsForDay(weekKey, dayIndex){
  const segs = [];
  let segStartMin = 8*60;
  let prevSig = null;
  for (let i = 0; i < HALF_HOURS.length; i++){
    const t = HALF_HOURS[i];
    const m = timeToMin(t);
    if (m < 8*60) continue;
    if (m >= 24*60) break;
    const sig = ROLES.map(r =>
      (getAssignedIdsFor(weekKey, dayIndex, r, t) || []).slice().sort().join(",")
    ).join("|");
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

/* ---------- DISPONIBILITÀ HELPER ---------- */
/**
 * Legge un range dell'anteprima disponibilità in ore decimali.
 * Accetta il vecchio formato "08-16" e il nuovo con mezz'ore "12:30-16".
 * "12:30-16" -> [12.5, 16]. Ritorna null se non leggibile.
 */
function parseAvRange(range) {
  const parts = String(range || "").split("-");
  if (parts.length < 2) return null;
  const toHours = s => {
    const [h, m] = s.trim().split(":");
    const v = Number(h) + (m ? Number(m) / 60 : 0);
    return Number.isFinite(v) ? v : NaN;
  };
  const start = toHours(parts[0]);
  const end = toHours(parts[1]);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return [start, end];
}

/** Ore decimali -> "HH:MM" (12.5 -> "12:30"). */
function hoursToLabel(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

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

  return (dayData.items || []).filter(item => {
    // range = "08-16", "16-24", "12:30-16" ecc.
    const parts = parseAvRange(item.range);
    if (!parts) return false;
    const [avStart, avEnd] = parts;
    // Sovrappone con il segmento? (confronto in ore decimali, es. 12.5)
    return avStart < seg.endMin / 60 && avEnd > seg.startMin / 60;
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
/** "25/05 → 31/05" per la settimana che inizia il lunedì `start` (Date locale). */
function weekRangeText(start){
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${formatDate(start)} → ${formatDate(end)}`;
}
function renderWeekLabel(){
  const label = document.getElementById("weekLabel");
  if (!label) return;
  label.textContent = `Settimana: ${weekRangeText(currentWeekStart)}`;
}
async function renderDaySummary() {
  const container = document.getElementById("daySummaryBody");
  if (!container) return;
  let dayAssignments = {};
  try { dayAssignments = await apiCall("day_type_assignments_get") || {}; } catch(e) {}
  const cells = DAYS.map((day, dayIndex) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + dayIndex);
    const dateStr = formatDate(date);
    const typeName = dayAssignments[String(dayIndex)] || dayAssignments[dayIndex] || null;
    const icon = typeName ? `<span class="dt-dot dt-dot--${typeName.toLowerCase()}" aria-hidden="true"></span>` : "—";
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
    // Dot copertura
    const tl = computeDayTrafficLight(weekKey, di);
    const dot = document.createElement("span");
    dot.className = `day-cov-dot day-cov-dot--${tl.color}`;
    dot.setAttribute("aria-hidden", "true");
    th.appendChild(dot);
    // spiegazione su tutta l'intestazione (il pallino da solo è troppo piccolo da puntare)
    th.dataset.tip = `${tl.tooltip}\nClicca per il dettaglio del giorno.`;
    th.tabIndex = 0;
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDayModal(di); } });
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
    tr.dataset.band = seg.startMin < 16 * 60 ? "morning" : "evening";

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
          const namesHtml = ids.map(id => {
            const label = employeeLabel(id);
            return `<span class="tl-name" data-emp-id="${id}" data-emp-name="${label.toLowerCase()}">${label}</span>`;
          }).join(", ");
          return `<div class="tl-role-group" data-role="${role}">
            <span class="tl-role-pill tl-role-${roleCss(role)}">${ROLE_SHORT[role] || role}</span>
            <span class="tl-names">${namesHtml}</span>
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

  // settimana senza turni: si dice cosa fare (le celle restano cliccabili per inserire a mano)
  const hasAny = Array.from(assignments.keys()).some(k => k.startsWith(weekKey + "|"));
  if (!hasAny) {
    const empty = document.createElement("div");
    empty.className = "tl-empty";
    empty.innerHTML = `
      <div class="tl-empty-title">Nessun turno in questa settimana</div>
      <div>Usa <strong>Importa CSV</strong> per generare i turni dalle disponibilità,
      oppure <strong>Aggiungi turno</strong> per inserirli a mano.</div>`;
    wrap.appendChild(empty);
  }

  applyTimelineFilter();
}

/* ===========================================
   FILTRO TIMELINE (solo visivo: evidenzia/sbiadisce)
   Non tocca dati né scheduler.
   =========================================== */
const timelineFilter = { name: "", role: "", band: "" };

function applyTimelineFilter(){
  const table = document.getElementById("timelineWrap")?.querySelector(".timeline-table");
  if (!table) return;
  const q    = (timelineFilter.name || "").trim().toLowerCase();
  const role = timelineFilter.role || "";
  const band = timelineFilter.band || "";
  const active = !!(q || role || band);

  table.classList.toggle("tl-filtering", active);

  table.querySelectorAll(".tl-row").forEach(row => {
    row.classList.toggle("tl-row-dim", active && !!band && row.dataset.band !== band);
  });
  table.querySelectorAll(".tl-role-group").forEach(group => {
    group.classList.toggle("tl-group-dim", active && !!role && group.dataset.role !== role);
  });
  table.querySelectorAll(".tl-name").forEach(nameEl => {
    const match = !q || (nameEl.dataset.empName || "").includes(q);
    nameEl.classList.toggle("tl-name-dim", active && !!q && !match);
    nameEl.classList.toggle("tl-name-hit", active && !!q && match);
  });
}

function bindTimelineFilter(){
  const nameEl  = document.getElementById("tlFilterName");
  const roleEl  = document.getElementById("tlFilterRole");
  const bandEl  = document.getElementById("tlFilterBand");
  const clearEl = document.getElementById("tlFilterClear");

  if (nameEl && !nameEl.dataset.bound){
    nameEl.dataset.bound = "1";
    nameEl.addEventListener("input", () => { timelineFilter.name = nameEl.value; applyTimelineFilter(); });
  }
  if (roleEl && !roleEl.dataset.bound){
    roleEl.dataset.bound = "1";
    roleEl.addEventListener("change", () => { timelineFilter.role = roleEl.value; applyTimelineFilter(); });
  }
  if (bandEl && !bandEl.dataset.bound){
    bandEl.dataset.bound = "1";
    bandEl.addEventListener("change", () => { timelineFilter.band = bandEl.value; applyTimelineFilter(); });
  }
  if (clearEl && !clearEl.dataset.bound){
    clearEl.dataset.bound = "1";
    clearEl.addEventListener("click", () => {
      timelineFilter.name = ""; timelineFilter.role = ""; timelineFilter.band = "";
      if (nameEl) nameEl.value = "";
      if (roleEl) roleEl.value = "";
      if (bandEl) bandEl.value = "";
      applyTimelineFilter();
    });
  }
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
  // titolo + riepilogo copertura (stessa regola dei pallini del calendario)
  const tl = computeDayTrafficLight(weekKey, dayIndex);
  const tlText = tl.tooltip.split("\n").join(" · ");
  titleEl.innerHTML = `${uiEscape(DAY_FULL[dayIndex])} ${uiEscape(formatDate(date))}
    <span class="dm-cov"><span class="day-cov-dot day-cov-dot--${tl.color}" aria-hidden="true"></span>${uiEscape(tlText)}</span>`;

  const segments = computeTimeSegmentsForDay(weekKey, dayIndex);
  bodyEl.innerHTML = "";

  segments.forEach(seg => {
    const timeLabels = segmentToSlots(seg);
    const deficit    = getSquadDeficitForSlot(weekKey, dayIndex, seg);
    const missingRoles = ROLES.filter(r => deficit[r]?.deficit > 0);
    const hasNeed      = ROLES.some(r => (deficit[r]?.required || 0) > 0);
    const hasAssigned  = ROLES.some(r => unionAssignedOverLabels(weekKey, dayIndex, r, timeLabels).length > 0);
    if (!hasNeed && !hasAssigned) return;

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
      const names = ids.map(id => employeeLabel(id, { titleCase: true }));
      const row = document.createElement("div");
      row.className = "dm-role-row";
      row.innerHTML = `
        <span class="sm-role-badge sm-badge-${roleCss(role)} dm-role-badge">${ROLE_SHORT[role]}</span>
        <span class="dm-role-label">${role}</span>
        <span class="dm-role-names">${names.map(uiEscape).join("  ·  ")}</span>
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
      openSlotManageModal({ weekKey, dayIndex: di, seg, timeLabels: segmentToSlots(seg), fromDay: true });
    });
  });

  bd.style.display = "flex";
}

function closeDayModal(){
  const bd = document.getElementById("dayModalBackdrop");
  if (bd) bd.style.display = "none";
}

/* ===========================================
   MODAL UNIFICATO: GESTIONE TURNO — tabella scura
   =========================================== */
function openSlotManageModal({ weekKey, dayIndex, seg, timeLabels, fromDay = false }) {
  closeModal();

  const ROLE_BADGE_CLASS = {
    Cassa:"sm-badge-cassa", Runner:"sm-badge-runner", Bar:"sm-badge-bar",
    Comande:"sm-badge-comande", Accoglienza:"sm-badge-accoglienza", Jolly:"sm-badge-jolly",
  };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) guardedClose(); });

  const modal = document.createElement("div");
  modal.className = "modal slot-manage-modal";

  const head = document.createElement("div");
  head.className = "modal-head";

  if (fromDay) {
    const backBtn = document.createElement("button");
    backBtn.className = "modal-back-btn";
    backBtn.textContent = "← Giorno";
    backBtn.addEventListener("click", () => guardedClose(() => openDayModal(dayIndex)));
    head.appendChild(backBtn);
  }

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  const date = new Date(currentWeekStart);
  date.setDate(date.getDate() + dayIndex);
  titleEl.textContent = `${DAYS[dayIndex]} ${formatDate(date)} · ${seg.label}`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.textContent = "✕";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Chiudi");
  closeBtn.addEventListener("click", () => guardedClose());
  head.appendChild(titleEl);
  head.appendChild(closeBtn);
  modal.appendChild(head);

  const body = document.createElement("div");
  body.className = "modal-body slot-manage-body";
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  activeModalEl = overlay;
  _escKeyHandler = (e) => { if (e.key === "Escape") guardedClose(); };
  document.addEventListener("keydown", _escKeyHandler);

  const localAssigned = {};
  ROLES.forEach(role => {
    localAssigned[role] = new Set(
      unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels).map(String)
    );
  });

  let openDropdownRole = null;

  // Modifiche non salvate: chiudere chiede conferma (prima si perdevano senza avviso)
  const snapshot = () => JSON.stringify(ROLES.map(r => [...localAssigned[r]].sort()));
  const initialSnapshot = snapshot();
  async function guardedClose(after) {
    if (snapshot() !== initialSnapshot) {
      const ok = await uiConfirm({
        title: "Chiudere senza salvare?",
        message: "Le modifiche a questo turno non sono state salvate e andranno perse.",
        confirmText: "Chiudi senza salvare",
        cancelText: "Continua a modificare",
        danger: true,
      });
      if (!ok) return;
    }
    closeModal();
    after?.();
  }

  function getAssignedElsewhere() {
    const elsewhere = new Set();
    computeTimeSegments(weekKey).forEach(otherSeg => {
      if (otherSeg.id === seg.id) return;
      const otherLabels = segmentToSlots(otherSeg);
      ROLES.forEach(r => unionAssignedOverLabels(weekKey, dayIndex, r, otherLabels).forEach(id => elsewhere.add(String(id))));
    });
    return elsewhere;
  }

  function quickAddEmployee(empId) {
    const deficit = getSquadDeficitForSlot(weekKey, dayIndex, seg);
    const missingRoles = ROLES.filter(r => {
      const d = deficit[r];
      return d && d.required > 0 && (localAssigned[r].size < d.required) && !localAssigned[r].has(empId);
    });
    if (missingRoles.length === 1) {
      localAssigned[missingRoles[0]].add(empId);
      openDropdownRole = null;
    } else {
      openDropdownRole = missingRoles.length > 1
        ? missingRoles[0]
        : (ROLES.find(r => !localAssigned[r].has(empId)) || ROLES[0]);
    }
    renderBody();
  }

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
      const assignedIds = Array.from(localAssigned[role]);
      const isMissing   = hasNeed && (assignedIds.length < d.required);

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
          const chip = document.createElement("span");
          chip.className = "sm-chip";
          const name = employeeLabel(empId, { titleCase: true });
          chip.innerHTML = `${uiEscape(name)}<button type="button" class="sm-chip-remove" aria-label="Togli ${uiEscape(name)} da ${uiEscape(role)}" title="Togli dal turno">×</button>`;
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
      addBtn.type = "button";
      addBtn.setAttribute("aria-label", `Aggiungi un dipendente a ${role}`);
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

        const assignedElsewhere = getAssignedElsewhere();
        const avForRole = available
          .filter(av => av.empId && !localAssigned[role].has(String(av.empId)))
          .map(av => {
            const emp = employees.find(e => String(e.id) === String(av.empId));
            return { ...av, skill: Number(emp?.skills?.[role] || 0) };
          })
          .sort((a, b) => b.skill - a.skill);

        if (avForRole.length > 0) {
          const grp = document.createElement("optgroup");
          grp.label = "Disponibili in questo slot";
          avForRole.forEach(av => {
            const opt = document.createElement("option");
            opt.value = av.empId;
            const alreadyStr = assignedElsewhere.has(String(av.empId)) ? " · già in turno" : "";
            opt.textContent = `${av.name}  (${av.range})${alreadyStr}  ★${av.skill}`;
            grp.appendChild(opt);
          });
          sel.appendChild(grp);
        }

        const others = employees
          .filter(e => !localAssigned[role].has(String(e.id)) && !avForRole.find(av => String(av.empId) === String(e.id)))
          .map(e => ({ ...e, skill: Number(e.skills?.[role] || 0) }))
          .sort((a, b) => b.skill - a.skill);

        if (others.length > 0) {
          const grp = document.createElement("optgroup");
          grp.label = "Altri dipendenti";
          others.forEach(e => {
            const opt = document.createElement("option");
            opt.value = e.id;
            const alreadyStr = assignedElsewhere.has(String(e.id)) ? " · già in turno" : "";
            opt.textContent = `${e.label}${alreadyStr}  ★${e.skill}`;
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

    // Disponibili non inseriti — cliccabili per aggiunta rapida
    const notInserted = available.filter(av => av.empId && !allInserted.has(String(av.empId)));
    if (notInserted.length > 0) {
      const bar = document.createElement("div");
      bar.className = "sm-available-bar";
      bar.innerHTML = `<span class="sm-available-label">Disponibili liberi ${infoTip("Hanno dato disponibilità in questa fascia ma non sono ancora in turno. Clicca un nome: se manca un solo ruolo viene aggiunto lì, altrimenti scegli tu il ruolo.")}</span>`;
      notInserted.forEach((av) => {
        const name = employeeLabel(av.empId, { titleCase: true });
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sm-available-quick-btn";
        btn.title = `Aggiungi ${name} al turno`;
        btn.innerHTML = `${uiEscape(name)} <span class="sm-available-range">${uiEscape(av.range)}</span>`;
        btn.addEventListener("click", () => quickAddEmployee(String(av.empId)));
        bar.appendChild(btn);
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
    btnCancel.addEventListener("click", () => guardedClose());
    const btnSave = document.createElement("button");
    btnSave.className = "btn primary";
    btnSave.textContent = "Salva turno";
    btnSave.addEventListener("click", async () => {
      btnSave.disabled = true;
      btnSave.textContent = "Salvataggio...";
      const roleIds = {};
      for (const role of ROLES) {
        roleIds[role] = Array.from(localAssigned[role]).map(Number).filter(Boolean);
      }
      try {
        // prima il DB, poi lo schermo: se il salvataggio fallisce il calendario non cambia
        await apiWrite("overrides_save_slot", weekKey, dayIndex, timeLabels, roleIds);
        for (const role of ROLES) {
          for (const t of timeLabels) setAssignedIdsFor(weekKey, dayIndex, role, t, roleIds[role]);
        }
        recalcSegmentsFromAssignments(weekKey);
        closeModal();
        renderCalendar();
        window.chatAiUpdateContext?.();
        showToast("Turno salvato");
      } catch (err) {
        btnSave.disabled = false;
        btnSave.textContent = "Salva turno";
        showToast(err.message, "err");
      }
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

/* ---------- COPERTURA GIORNO (semaforo colonna calendario) ---------- */
function computeDayTrafficLight(weekKey, dayIndex) {
  const squadData = squads.get(weekKey);
  if (!squadData) return { color: "neutral", tooltip: "Nessun fabbisogno" };

  const daySquad = squadData[dayIndex] || { morning: {}, evening: {} };
  let totalRequired = 0, totalCovered = 0;
  const missing = [];

  for (const shift of ["morning", "evening"]) {
    const shiftNeeded = daySquad[shift] || {};
    const shiftLabels = HALF_HOURS.filter(t => {
      const h = parseInt(t.split(":")[0]);
      return shift === "morning" ? h < 16 : h >= 16;
    });
    ROLES.forEach(role => {
      const req = parseInt(shiftNeeded[role] || 0);
      if (req <= 0) return;
      totalRequired += req;
      const assigned = unionAssignedOverLabels(weekKey, dayIndex, role, shiftLabels).length;
      const covered = Math.min(assigned, req);
      totalCovered += covered;
      if (covered < req) missing.push(`${role} ${shift === "morning" ? "mattina" : "pomeriggio"} ${covered}/${req}`);
    });
  }

  if (totalRequired === 0) return { color: "neutral", tooltip: "Nessun fabbisogno" };
  const ratio = totalCovered / totalRequired;
  const pct = Math.round(ratio * 100);
  // verde solo se non manca nessuno: un giorno con un ruolo scoperto non è "tutto ok"
  const color = missing.length === 0 ? "green" : ratio >= 0.5 ? "yellow" : "red";
  const tooltip = missing.length
    ? `Copertura: ${pct}%\nScoperti: ${missing.join(", ")}`
    : `Copertura: ${pct}% — tutto ok`;
  return { color, tooltip };
}

/* ---------- INIT HOME ---------- */
async function initHome(){

  if (!currentWeekStart) {
    let saved = localStorage.getItem('lastWeekKey');
    if (!saved) {
      saved = await apiCall('settings_get', 'lastWeekKey');
    }
    currentWeekStart = saved ? mondayDateFromWeekKey(saved) : getNextWeekMonday(new Date());
    console.log(`[Boot] settimana ripristinata: ${saved || 'default (prossimo lunedì)'}`);
  }
  const wk = weekKeyOf(currentWeekStart);
  window.currentWeekKey = wk;
  localStorage.setItem('lastWeekKey', wk);
  apiCall('settings_set', 'lastWeekKey', wk);

  await retryUntil(
    async () => { await loadEmployeesFromDb(); },
    () => Array.isArray(employees) && employees.length > 0,
    { tries: 20, delayMs: 100 }
  );

  await loadWeekFromDb(wk);

  renderEmployees();
  renderWeekLabel();
  renderCalendar();
  bindTimelineFilter();
  window.chatAiUpdateContext?.();
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
          await uiAlert({ kind: "error", message: "L'app non è ancora pronta. Riprova tra qualche secondo." });
          return;
        }
        clone.disabled = true;
        try {
          window.lastExportData = await window.pywebview.api.export_week(wk2);
          await loadView("export");
        } catch (err) {
          console.error("[Export] export_week", err);
          await uiAlert({ kind: "error", message: `Non è stato possibile preparare la tabella export.\n${err?.message || err}` });
        } finally {
          clone.disabled = false;
        }
      });
    }
  }

  // Modal dettaglio giorno
  document.getElementById("dayModalClose")?.addEventListener("click", closeDayModal);
  document.getElementById("dayModalBackdrop")?.addEventListener("mousedown", (e) => {
    if (e.target === document.getElementById("dayModalBackdrop")) closeDayModal();
  });
  if (!window._dayModalEscBound) {
    window._dayModalEscBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || activeModalEl) return;
      const bd = document.getElementById("dayModalBackdrop");
      if (bd && bd.style.display !== "none") closeDayModal();
    });
  }

  // Navigazione settimana
  const navWeek = async (delta) => {
    currentWeekStart.setDate(currentWeekStart.getDate() + delta);
    const wk2 = weekKeyOf(currentWeekStart);
    window.currentWeekKey = wk2;
    localStorage.setItem('lastWeekKey', wk2);
    apiCall('settings_set', 'lastWeekKey', wk2);
    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
    window.chatAiUpdateContext?.();
    await renderDaySummary();
  };
  document.getElementById("btnPrevWeek")?.addEventListener("click", () => navWeek(-7));
  document.getElementById("btnNextWeek")?.addEventListener("click", () => navWeek(+7));
  document.getElementById("btnToday")?.addEventListener("click", async () => {
    currentWeekStart = getMondayOfCurrentWeek(new Date());
    await navWeek(0);
  });
  document.getElementById("btnClear")?.addEventListener("click", async () => {
    const wk2 = weekKeyOf(currentWeekStart);
    // Operazione irreversibile: cancella tutti i turni della settimana dal DB.
    const ok = await uiConfirm({
      title: "Svuotare la settimana?",
      message: `Tutti i turni della settimana ${weekRangeText(currentWeekStart)} vengono cancellati.\nL'operazione non si può annullare.`,
      confirmText: "Svuota settimana",
      danger: true,
    });
    if (!ok) return;
    try {
      await clearWeekOverridesOnDb(wk2);
      showToast("Settimana svuotata");
    } catch (err) {
      showToast(err.message, "err");
    }
    await resyncWeekFromDb(wk2);
    await renderDaySummary();
  });
  document.getElementById("btnPermManage")?.addEventListener("click", () => openPermanentModal?.());

  initQuickInsert();
  initQuickRemove();

  document.getElementById("btnCopyPrevWeek")?.addEventListener("click", async () => {
    const prev = new Date(currentWeekStart);
    prev.setDate(prev.getDate() - 7);
    const prevKey = weekKeyOf(prev);
    const curKey = weekKeyOf(currentWeekStart);
    const ok = await uiConfirm({
      title: "Copiare la settimana precedente?",
      message: `I turni della settimana ${weekRangeText(prev)} vengono copiati su questa (${weekRangeText(currentWeekStart)}).\nI turni già presenti in questa settimana vengono sostituiti.`,
      confirmText: "Copia turni",
      danger: true,
    });
    if (!ok) return;
    let res;
    try {
      res = await apiWrite("overrides_copy_week", prevKey, curKey);
    } catch (err) {
      showToast(err.message, "err");
      await resyncWeekFromDb(curKey);
      return;
    }
    if (res?.copied === 0) {
      showToast("La settimana precedente non ha turni: niente da copiare", "info");
      return;
    }
    await resyncWeekFromDb(curKey);
    showToast(`Turni copiati dalla settimana ${weekRangeText(prev)}`);
  });
}

/**
 * Giorno da proporre nelle finestre Aggiungi/Rimuovi turno.
 * Oggi se cade nella settimana mostrata; altrimenti il primo giorno con fabbisogno ("need")
 * o con turni assegnati ("shifts"); in mancanza, lunedì.
 */
function suggestedDayIndex(kind) {
  const weekKey = weekKeyOf(currentWeekStart);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - currentWeekStart) / 86400000);
  if (diff >= 0 && diff <= 6) return diff;
  for (let d = 0; d < 7; d++) {
    if (kind === "need") {
      const sq = getWeekSquad(weekKey)?.[d] || {};
      const total = ["morning", "evening"].reduce((acc, sh) =>
        acc + ROLES.reduce((a, r) => a + Number(sq[sh]?.[r] || 0), 0), 0);
      if (total > 0) return d;
    } else if (Array.from(assignments.keys()).some(k => k.startsWith(`${weekKey}|${d}|`))) {
      return d;
    }
  }
  return 0;
}

/* ---------- INSERIMENTO RAPIDO ---------- */
function initQuickInsert() {
  const backdrop = document.getElementById("qiModalBackdrop");
  if (!backdrop) return;

  // Popola select orari personalizzati una volta sola
  function _buildTimeOpts(startH, endH, includeClosing) {
    const opts = [];
    for (let h = startH; h < endH; h++) {
      opts.push(`${String(h).padStart(2,'0')}:00`);
      opts.push(`${String(h).padStart(2,'0')}:30`);
    }
    if (includeClosing) opts.push("24:00");
    return opts;
  }
  const startSel = document.getElementById("qiTimeStart");
  const endSel   = document.getElementById("qiTimeEnd");
  _buildTimeOpts(8, 24, false).forEach(t => {
    const o = document.createElement("option"); o.value = t; o.textContent = t;
    startSel?.appendChild(o);
  });
  _buildTimeOpts(8, 24, true).filter(t => t !== "08:00").forEach(t => {
    const o = document.createElement("option"); o.value = t; o.textContent = t;
    endSel?.appendChild(o);
  });
  if (startSel) startSel.value = "08:00";
  if (endSel)   endSel.value   = "16:00";

  let _qiShift   = null;
  let _qiAvRange = null;  // { start: number, end: number } | null — disponibilità CSV employee corrente

  /* -------- STEP LOCK / UNLOCK -------- */
  function _setStep(n, locked) {
    document.getElementById(`qiStep${n}`)?.classList.toggle("qi-step--locked", locked);
    if (n === 2) { const el = document.getElementById("qiRole"); if (el) el.disabled = locked; }
    if (n === 3) { const el = document.getElementById("qiEmployee"); if (el) el.disabled = locked; }
    if (n === 4) backdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.disabled = locked; });
  }

  /* -------- COVERAGE BADGE -------- */
  function _updateCoverage(dayIdx, role) {
    const el = document.getElementById("qiCoverage");
    if (!el) return;
    const weekKey = weekKeyOf(currentWeekStart);
    const sq = squads.get(weekKey);
    if (!sq || !role) { el.textContent = ""; el.className = "qi-coverage"; return; }
    const daySquad = sq[dayIdx] || { morning: {}, evening: {} };
    const mReq = parseInt(daySquad.morning?.[role] || 0);
    const eReq = parseInt(daySquad.evening?.[role] || 0);
    const totalReq = mReq + eReq;
    if (totalReq === 0) { el.textContent = ""; el.className = "qi-coverage"; return; }

    const mSet = new Set(), eSet = new Set();
    for (let h = 8; h < 24; h++) {
      for (const m of ["00","30"]) {
        const tl = `${String(h).padStart(2,'0')}:${m}`;
        const ids = assignments.get(keyOf(weekKey, dayIdx, role, tl)) || [];
        ids.forEach(id => (h < 16 ? mSet : eSet).add(String(id)));
      }
    }
    const covered = Math.min(mSet.size, mReq) + Math.min(eSet.size, eReq);
    el.textContent = `${covered}/${totalReq} coperti`;
    el.className = `qi-coverage qi-coverage--${covered >= totalReq ? "ok" : "bad"}`;
  }

  /* -------- EMPLOYEE DROPDOWN -------- */
  function _rebuildEmpDropdown(dayIdx, role) {
    const sel = document.getElementById("qiEmployee");
    if (!sel) return;
    sel.innerHTML = '<option value="">— seleziona dipendente —</option>';

    const weekKey  = weekKeyOf(currentWeekStart);
    const preview  = window._lastAvailabilityPreview;
    const dayAvail = preview?.days?.find(d => d.day_index === dayIdx);

    // "Già in turno" quel giorno: empId → { ruolo → [ore] }, per mostrare ruolo e orario
    const alreadyMap = new Map();
    for (let h = 8; h < 24; h++) {
      for (const m of ["00","30"]) {
        const tl = `${String(h).padStart(2,'0')}:${m}`;
        ROLES.forEach(r => {
          (assignments.get(keyOf(weekKey, dayIdx, r, tl)) || []).forEach(id => {
            const k = String(id);
            if (!alreadyMap.has(k)) alreadyMap.set(k, {});
            (alreadyMap.get(k)[r] ||= []).push(h + (m === "30" ? 0.5 : 0));
          });
        });
      }
    }
    const fmtH = (x) => (x >= 24 ? "ch" : (x % 1 ? `${Math.floor(x)}:30` : String(x)));
    const alreadyRange = (k) => {
      const byRole = alreadyMap.get(k);
      if (!byRole) return "";
      const parts = Object.entries(byRole).map(([r, hs]) =>
        `${r} ${fmtH(Math.min(...hs))}–${fmtH(Math.max(...hs) + 0.5)}`);
      return ` · già in turno: ${parts.join(", ")}`;
    };

    // Gruppo 1: disponibili da CSV
    const availEmps = [];
    if (dayAvail) {
      (dayAvail.items || []).forEach(item => {
        const emp = (employees || []).find(e => e.label.toUpperCase() === (item.name || "").toUpperCase());
        if (emp) availEmps.push({ id: emp.id, label: emp.label, range: item.range, skill: Number(emp.skills?.[role] || 0) });
      });
      availEmps.sort((a, b) => b.skill - a.skill);
    }
    const availIds = new Set(availEmps.map(e => String(e.id)));

    if (availEmps.length > 0) {
      const grp = document.createElement("optgroup");
      grp.label = "✓ Disponibili (CSV)";
      availEmps.forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.id;
        opt.textContent = `${e.label}  (${e.range})${alreadyRange(String(e.id))}  ★${e.skill}`;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    }

    // Gruppo 2: altri
    const others = (employees || [])
      .filter(e => !availIds.has(String(e.id)))
      .map(e => ({ ...e, skill: Number(e.skills?.[role] || 0) }))
      .sort((a, b) => b.skill - a.skill);

    if (others.length > 0) {
      const grp = document.createElement("optgroup");
      grp.label = "Altri dipendenti";
      others.forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.id;
        opt.textContent = `${e.label}${alreadyRange(String(e.id))}  ★${e.skill}`;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    }
  }

  /* -------- EMPLOYEE INFO PANEL -------- */
  function _showEmpInfo(empId, dayIdx) {
    const el = document.getElementById("qiEmpInfo");
    if (!el || !empId) { if (el) el.innerHTML = ""; return; }
    const emp = (employees || []).find(e => String(e.id) === String(empId));
    if (!emp) { el.innerHTML = ""; return; }

    const preview  = window._lastAvailabilityPreview;
    const dayAvail = preview?.days?.find(d => d.day_index === dayIdx);
    const avItem   = dayAvail?.items?.find(i => i.name?.toUpperCase() === emp.label.toUpperCase());
    const avRange  = avItem?.range ?? null;

    // Ore già lavorate questa settimana
    const weekKey = weekKeyOf(currentWeekStart);
    const slotSet = new Set();
    for (let d = 0; d < 7; d++) {
      for (const r of ROLES) {
        for (let h = 8; h < 24; h++) {
          for (const m of ["00","30"]) {
            const tl = `${String(h).padStart(2,'0')}:${m}`;
            if ((assignments.get(keyOf(weekKey, d, r, tl)) || []).map(String).includes(String(empId)))
              slotSet.add(`${d}|${tl}`);
          }
        }
      }
    }
    const weekH = (slotSet.size * 0.5).toFixed(1);

    el.innerHTML = `
      <div class="qi-emp-detail">
        <span class="qi-emp-detail-item"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>${avRange ? `Disponibile ${avRange}` : "Nessuna disponibilità CSV"}</span>
        <span class="qi-emp-detail-sep">·</span>
        <span class="qi-emp-detail-item"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${Number(weekH) > 0 ? weekH + "h questa sett." : "Nessun turno questa sett."}</span>
      </div>`;
  }

  /* -------- AUTO-SELECT SHIFT -------- */
  function _autoSelectShift(empId, dayIdx) {
    const preview  = window._lastAvailabilityPreview;
    const dayAvail = preview?.days?.find(d => d.day_index === dayIdx);
    const emp      = (employees || []).find(e => String(e.id) === String(empId));
    const avItem   = dayAvail?.items?.find(i => i.name?.toUpperCase() === emp?.label.toUpperCase());

    const morningBtn = backdrop.querySelector('[data-shift="morning"]');
    const eveningBtn = backdrop.querySelector('[data-shift="evening"]');

    // Reset disable state first
    backdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.disabled = false; b.title = ""; });

    if (!avItem) { _qiAvRange = null; return; } // nessun dato CSV → tutti i pulsanti abilitati, nessuna selezione automatica

    const parts = parseAvRange(avItem.range);
    if (!parts) { _qiAvRange = null; return; }
    const [avS, avE] = parts;
    _qiAvRange = { start: avS, end: avE };
    const hasMorning = avS < 16 && avE > 8;
    const hasEvening = avS < 24 && avE > 16;

    if (morningBtn && !hasMorning) { morningBtn.disabled = true; morningBtn.title = "Non disponibile"; }
    if (eveningBtn && !hasEvening) { eveningBtn.disabled = true; eveningBtn.title = "Non disponibile"; }

    // Preseleziona se solo una opzione disponibile
    if (hasMorning && !hasEvening)  _selectShift("morning");
    else if (hasEvening && !hasMorning) _selectShift("evening");
  }

  function _selectShift(shift) {
    backdrop.querySelectorAll(".qi-shift-btn").forEach(b => b.classList.toggle("active", b.dataset.shift === shift));
    _qiShift = shift;
    document.getElementById("qiCustomTimes").style.display = shift === "custom" ? "block" : "none";
    if (shift === "custom" && _qiAvRange) {
      const s = hoursToLabel(_qiAvRange.start);
      const e = hoursToLabel(_qiAvRange.end);
      if (startSel && [...startSel.options].some(o => o.value === s)) startSel.value = s;
      if (endSel   && [...endSel.options].some(o => o.value === e))   endSel.value   = e;
    }
    document.getElementById("qiModalSave").disabled = false;
    _qiShowBanner("", "");
  }

  /* -------- EVENTS -------- */
  document.getElementById("qiDay")?.addEventListener("change", () => {
    const dayIdx = parseInt(document.getElementById("qiDay").value);
    const role   = document.getElementById("qiRole")?.value;
    // reset step 3+4
    document.getElementById("qiEmployee").value = "";
    document.getElementById("qiEmpInfo").innerHTML = "";
    _qiShift = null;
    _qiAvRange = null;
    document.getElementById("qiModalSave").disabled = true;
    backdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.classList.remove("active"); b.disabled = false; b.title = ""; });
    document.getElementById("qiCustomTimes").style.display = "none";
    _qiShowBanner("", "");
    _setStep(4, true);
    // step 3 rimane sbloccato, aggiorna dropdown e copertura
    _updateCoverage(dayIdx, role);
    _rebuildEmpDropdown(dayIdx, role);
  });

  document.getElementById("qiRole")?.addEventListener("change", () => {
    const dayIdx = parseInt(document.getElementById("qiDay").value);
    const role   = document.getElementById("qiRole").value;
    // reset step 3+4
    document.getElementById("qiEmployee").value = "";
    document.getElementById("qiEmpInfo").innerHTML = "";
    _qiShift = null;
    _qiAvRange = null;
    document.getElementById("qiModalSave").disabled = true;
    backdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.classList.remove("active"); b.disabled = false; b.title = ""; });
    document.getElementById("qiCustomTimes").style.display = "none";
    _qiShowBanner("", "");
    _setStep(4, true);
    _updateCoverage(dayIdx, role);
    _rebuildEmpDropdown(dayIdx, role);
  });

  document.getElementById("qiEmployee")?.addEventListener("change", () => {
    const empId  = document.getElementById("qiEmployee").value;
    const dayIdx = parseInt(document.getElementById("qiDay").value);
    _qiShift = null;
    _qiAvRange = null;
    document.getElementById("qiModalSave").disabled = true;
    backdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.classList.remove("active"); b.disabled = false; b.title = ""; });
    document.getElementById("qiCustomTimes").style.display = "none";
    _qiShowBanner("", "");
    if (!empId) { _setStep(4, true); document.getElementById("qiEmpInfo").innerHTML = ""; return; }
    _setStep(4, false);
    _showEmpInfo(empId, dayIdx);
    _autoSelectShift(empId, dayIdx);
  });

  backdrop.querySelectorAll(".qi-shift-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      _selectShift(btn.dataset.shift);
    });
  });

  startSel?.addEventListener("change", () => {
    if (endSel && parseFloat(startSel.value) >= parseFloat(endSel.value)) {
      const idx = [...endSel.options].findIndex(o => parseFloat(o.value) > parseFloat(startSel.value));
      if (idx >= 0) endSel.selectedIndex = idx;
    }
  });

  /* -------- OPEN / CLOSE -------- */
  function openQiModal() {
    // Giorno proposto: oggi se è in questa settimana, altrimenti il primo giorno con fabbisogno
    const dayEl = document.getElementById("qiDay");
    if (dayEl && currentWeekStart) dayEl.value = String(suggestedDayIndex("need"));

    // Reset completo
    document.getElementById("qiRole").value = "Cassa";
    document.getElementById("qiEmployee").value = "";
    document.getElementById("qiEmpInfo").innerHTML = "";
    document.getElementById("qiCoverage").textContent = "";
    document.getElementById("qiCoverage").className = "qi-coverage";
    _qiShift = null;
    _qiAvRange = null;
    backdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.classList.remove("active"); b.disabled = false; b.title = ""; });
    document.getElementById("qiCustomTimes").style.display = "none";
    if (startSel) startSel.value = "08:00";
    if (endSel)   endSel.value   = "16:00";
    document.getElementById("qiModalSave").disabled = true;
    _qiShowBanner("", "");

    // Step 1+2 subito aperti; step 3 sbloccato e popolato; step 4 locked
    _setStep(2, false);
    _setStep(3, false);
    _setStep(4, true);

    const dayIdx = parseInt(dayEl?.value ?? "0");
    _updateCoverage(dayIdx, "Cassa");
    _rebuildEmpDropdown(dayIdx, "Cassa");

    backdrop.style.display = "flex";
  }

  function closeQiModal() { backdrop.style.display = "none"; }

  /* -------- BANNER -------- */
  function _qiShowBanner(msg, kind) {
    const b = document.getElementById("qiBanner");
    if (!b) return;
    if (!msg) { b.style.display = "none"; b.textContent = ""; return; }
    b.style.display = "block";
    b.textContent = msg;
    b.className = `qi-banner qi-banner--${kind}`;
  }

  /* -------- SAVE -------- */
  async function saveQiModal() {
    const empId  = document.getElementById("qiEmployee")?.value;
    const dayIdx = parseInt(document.getElementById("qiDay")?.value ?? "0");
    const role   = document.getElementById("qiRole")?.value;

    if (!empId)    { _qiShowBanner("Seleziona un dipendente.", "error"); return; }
    if (!_qiShift) { _qiShowBanner("Seleziona la fascia oraria.", "error"); return; }

    function parseTimeToHalf(t) {
      if (t === "24:00") return 24;
      const [h, m] = t.split(":").map(Number);
      return h + (m === 30 ? 0.5 : 0);
    }

    let startHalf = 8, endHalf = 16;
    if (_qiShift === "evening") { startHalf = 16; endHalf = 24; }
    if (_qiShift === "custom") {
      startHalf = parseTimeToHalf(document.getElementById("qiTimeStart")?.value || "08:00");
      endHalf   = parseTimeToHalf(document.getElementById("qiTimeEnd")?.value   || "16:00");
      if (startHalf >= endHalf) { _qiShowBanner("L'ora di fine deve essere dopo l'inizio.", "error"); return; }
    }

    const timeLabels = [];
    for (let cur = startHalf; cur < endHalf; cur += 0.5) {
      const h = Math.floor(cur), m = (cur % 1 !== 0) ? 30 : 0;
      timeLabels.push(`${String(h).padStart(2,'0')}:${m === 0 ? "00" : "30"}`);
    }
    if (!timeLabels.length) { _qiShowBanner("Nessuno slot nel range.", "error"); return; }

    const weekKey = weekKeyOf(currentWeekStart);
    const saveBtn = document.getElementById("qiModalSave");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvataggio..."; }

    try {
      const ovList = await apiCall("overrides_get_week", weekKey) || [];
      const items  = timeLabels.map(tl => {
        const existing = ovList.find(o => o.day_index === dayIdx && o.role === role && o.time_label === tl);
        const ids = [...(existing?.employee_ids || [])];
        if (!ids.map(String).includes(String(empId))) ids.push(Number(empId));
        return { time_label: tl, employee_ids: ids };
      });

      await apiWrite("overrides_set_many", weekKey, dayIdx, role, items);
      items.forEach(({ time_label, employee_ids }) => {
        setAssignedIdsFor(weekKey, dayIdx, role, time_label, employee_ids);
      });
      recalcSegmentsFromAssignments(weekKey);
      renderCalendar();
      window.chatAiUpdateContext?.();

      const empName   = employeeLabel(empId);
      // fine turno = inizio dell'ultima mezz'ora + 30 minuti (es. ultima "15:30" -> "16:00")
      const shiftLbl  = _qiShift === "morning" ? "Mattina" : _qiShift === "evening" ? "Pomeriggio"
                        : `${timeLabels[0]}–${hoursToLabel(endHalf)}`;
      showToast(`${empName} aggiunto — ${DAYS[dayIdx]} ${shiftLbl} (${role})`);

      // Resetta solo step 3+4, mantieni giorno e ruolo
      _qiShift = null;
      _qiAvRange = null;
      document.getElementById("qiEmployee").value = "";
      document.getElementById("qiEmpInfo").innerHTML = "";
      backdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.classList.remove("active"); b.disabled = false; b.title = ""; });
      document.getElementById("qiCustomTimes").style.display = "none";
      _setStep(4, true);
      document.getElementById("qiModalSave").disabled = true;
      _qiShowBanner("", "");

      // Aggiorna copertura e dropdown con le nuove assegnazioni
      _updateCoverage(dayIdx, role);
      _rebuildEmpDropdown(dayIdx, role);

    } catch (err) {
      _qiShowBanner(err.message, "error");
    } finally {
      // attivo solo se c'è di nuovo un dipendente scelto (dopo un successo il campo è azzerato)
      if (saveBtn) {
        saveBtn.textContent = "Aggiungi turno";
        saveBtn.disabled = !document.getElementById("qiEmployee")?.value;
      }
    }
  }

  document.getElementById("btnQuickInsert")?.addEventListener("click", openQiModal);
  document.getElementById("qiModalClose")?.addEventListener("click", closeQiModal);
  document.getElementById("qiModalClose2")?.addEventListener("click", closeQiModal);
  backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) closeQiModal(); });
  document.getElementById("qiModalSave")?.addEventListener("click", saveQiModal);
}

/* ---------- RIMOZIONE RAPIDA ---------- */
function initQuickRemove() {
  const rmBackdrop = document.getElementById("rmModalBackdrop");
  if (!rmBackdrop) return;

  let _rmShift = null;

  /* -------- SELETTORI ORARIO PERSONALIZZATO -------- */
  const rmStartSel = document.getElementById("rmTimeStart");
  const rmEndSel   = document.getElementById("rmTimeEnd");
  (() => {
    const makeOpts = (sH, eH, closing) => {
      const a = [];
      for (let h = sH; h < eH; h++) { a.push(`${String(h).padStart(2,'0')}:00`); a.push(`${String(h).padStart(2,'0')}:30`); }
      if (closing) a.push("24:00");
      return a;
    };
    makeOpts(8, 24, false).forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; rmStartSel?.appendChild(o); });
    makeOpts(8, 24, true).filter(t => t !== "08:00").forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; rmEndSel?.appendChild(o); });
    if (rmStartSel) rmStartSel.value = "08:00";
    if (rmEndSel)   rmEndSel.value   = "16:00";
  })();

  rmStartSel?.addEventListener("change", () => {
    if (rmEndSel && parseFloat(rmStartSel.value) >= parseFloat(rmEndSel.value)) {
      const idx = [...rmEndSel.options].findIndex(o => parseFloat(o.value) > parseFloat(rmStartSel.value));
      if (idx >= 0) rmEndSel.selectedIndex = idx;
    }
  });

  /* -------- STEP LOCK / UNLOCK -------- */
  function _rmSetStep(n, locked) {
    document.getElementById(`rmStep${n}`)?.classList.toggle("qi-step--locked", locked);
    if (n === 2) { const el = document.getElementById("rmEmployee"); if (el) el.disabled = locked; }
    if (n === 3) rmBackdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.disabled = locked; });
  }

  function _rmResetStep3() {
    _rmShift = null;
    document.getElementById("rmCustomTimes").style.display = "none";
    document.getElementById("rmModalSave").disabled = true;
    rmBackdrop.querySelectorAll(".qi-shift-btn").forEach(b => { b.classList.remove("active"); b.disabled = true; b.title = ""; });
    _rmSetStep(3, true);
  }

  /* -------- EMPLOYEE DROPDOWN (solo chi ha slot nel giorno) -------- */
  function _buildRmEmpDropdown(dayIdx) {
    const sel = document.getElementById("rmEmployee");
    if (!sel) return;
    sel.innerHTML = '<option value="">— seleziona dipendente —</option>';

    const weekKey  = weekKeyOf(currentWeekStart);
    const empSlots = new Map(); // empId -> { hasMorning, hasEvening, roles }

    for (let h = 8; h < 24; h++) {
      for (const m of ["00","30"]) {
        const tl = `${String(h).padStart(2,'0')}:${m}`;
        ROLES.forEach(role => {
          (assignments.get(keyOf(weekKey, dayIdx, role, tl)) || []).forEach(id => {
            const k = String(id);
            if (!empSlots.has(k)) empSlots.set(k, { hasMorning: false, hasEvening: false, roles: new Set() });
            const s = empSlots.get(k);
            if (h < 16) s.hasMorning = true; else s.hasEvening = true;
            s.roles.add(role);
          });
        });
      }
    }

    if (empSlots.size === 0) {
      const o = document.createElement("option");
      o.disabled = true;
      o.textContent = "Nessun dipendente in turno questo giorno";
      sel.appendChild(o);
      _rmSetStep(2, true);
      return;
    }

    [...empSlots.entries()].forEach(([empId, info]) => {
      const emp = (employees || []).find(e => String(e.id) === empId);
      if (!emp) return;
      const shifts = [info.hasMorning && "mattina", info.hasEvening && "pomeriggio"].filter(Boolean).join(" e ");
      const opt = document.createElement("option");
      opt.value = empId;
      opt.textContent = `${emp.label} — ${[...info.roles].join(", ")} (${shifts})`;
      sel.appendChild(opt);
    });

    _rmSetStep(2, false);
  }

  /* -------- EMP INFO (fasce e ruoli assegnati) -------- */
  function _showRmEmpInfo(empId, dayIdx) {
    const el = document.getElementById("rmEmpInfo");
    if (!el) return;
    if (!empId) { el.innerHTML = ""; return; }

    const weekKey = weekKeyOf(currentWeekStart);
    const mRoles  = new Set(), eRoles = new Set();

    for (let h = 8; h < 24; h++) {
      for (const m of ["00","30"]) {
        const tl = `${String(h).padStart(2,'0')}:${m}`;
        ROLES.forEach(role => {
          const ids = assignments.get(keyOf(weekKey, dayIdx, role, tl)) || [];
          if (ids.map(String).includes(String(empId)))
            (h < 16 ? mRoles : eRoles).add(role);
        });
      }
    }

    const parts = [];
    if (mRoles.size) parts.push(`<span class="qi-emp-detail-item"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>Mattina: ${[...mRoles].join(", ")}</span>`);
    if (eRoles.size) parts.push(`<span class="qi-emp-detail-item"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>Pomeriggio: ${[...eRoles].join(", ")}</span>`);
    el.innerHTML = `<div class="qi-emp-detail">${parts.join('<span class="qi-emp-detail-sep">·</span>')}</div>`;
  }

  /* -------- SHIFT BUTTONS (abilita solo le fasce presenti; custom sempre attivo) -------- */
  function _rmSetupShiftBtns(empId, dayIdx) {
    const weekKey = weekKeyOf(currentWeekStart);
    let hasMorning = false, hasEvening = false;

    for (let h = 8; h < 24; h++) {
      for (const m of ["00","30"]) {
        const tl = `${String(h).padStart(2,'0')}:${m}`;
        ROLES.forEach(role => {
          const ids = assignments.get(keyOf(weekKey, dayIdx, role, tl)) || [];
          if (ids.map(String).includes(String(empId))) {
            if (h < 16) hasMorning = true; else hasEvening = true;
          }
        });
      }
    }

    rmBackdrop.querySelectorAll(".qi-shift-btn").forEach(b => {
      b.disabled = false; b.classList.remove("active"); b.title = "";
    });

    const mBtn = rmBackdrop.querySelector('[data-rmshift="morning"]');
    const eBtn = rmBackdrop.querySelector('[data-rmshift="evening"]');
    const bBtn = rmBackdrop.querySelector('[data-rmshift="both"]');

    if (!hasMorning) { mBtn.disabled = true; mBtn.title = "Nessun turno mattina"; }
    if (!hasEvening) { eBtn.disabled = true; eBtn.title = "Nessun turno pomeriggio"; }
    if (!(hasMorning && hasEvening)) { bBtn.disabled = true; bBtn.title = "Non presente in entrambe le fasce"; }
    // custom sempre abilitato — l'utente può definire qualunque range

    if (hasMorning && !hasEvening)      _rmSelectShift("morning");
    else if (hasEvening && !hasMorning) _rmSelectShift("evening");
  }

  function _rmSelectShift(shift) {
    rmBackdrop.querySelectorAll(".qi-shift-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.rmshift === shift)
    );
    _rmShift = shift;
    document.getElementById("rmCustomTimes").style.display = shift === "custom" ? "block" : "none";
    document.getElementById("rmModalSave").disabled = false;
  }

  /* -------- EVENTS -------- */
  document.getElementById("rmDay")?.addEventListener("change", () => {
    const dayIdx = parseInt(document.getElementById("rmDay").value);
    document.getElementById("rmEmployee").value = "";
    document.getElementById("rmEmpInfo").innerHTML = "";
    _rmResetStep3();
    _buildRmEmpDropdown(dayIdx);
  });

  document.getElementById("rmEmployee")?.addEventListener("change", () => {
    const empId  = document.getElementById("rmEmployee").value;
    const dayIdx = parseInt(document.getElementById("rmDay").value);
    document.getElementById("rmEmpInfo").innerHTML = "";
    _rmResetStep3();
    if (!empId) return;
    _showRmEmpInfo(empId, dayIdx);
    _rmSetStep(3, false);
    _rmSetupShiftBtns(empId, dayIdx);
  });

  rmBackdrop.querySelectorAll(".qi-shift-btn").forEach(btn => {
    btn.addEventListener("click", () => { if (!btn.disabled) _rmSelectShift(btn.dataset.rmshift); });
  });

  /* -------- OPEN / CLOSE -------- */
  function openRmModal() {
    // Giorno proposto: oggi se è in questa settimana, altrimenti il primo giorno con turni
    const dayEl = document.getElementById("rmDay");
    if (dayEl && currentWeekStart) dayEl.value = String(suggestedDayIndex("shifts"));
    document.getElementById("rmEmployee").value = "";
    document.getElementById("rmEmpInfo").innerHTML = "";
    _rmResetStep3();
    _buildRmEmpDropdown(parseInt(dayEl?.value ?? "0"));
    rmBackdrop.style.display = "flex";
  }

  function closeRmModal() { rmBackdrop.style.display = "none"; }

  /* -------- UTILITY -------- */
  function _parseHalf(t) {
    if (t === "24:00") return 24;
    const [h, m] = t.split(":").map(Number);
    return h + (m === 30 ? 0.5 : 0);
  }
  function _halfToLabel(v) {
    if (v >= 24) return "ch";
    return `${String(Math.floor(v)).padStart(2,'0')}:${v % 1 ? "30" : "00"}`;
  }

  /* -------- SAVE -------- */
  async function saveRmModal() {
    const empId  = document.getElementById("rmEmployee")?.value;
    const dayIdx = parseInt(document.getElementById("rmDay")?.value ?? "0");
    if (!empId || !_rmShift) return;

    let shiftStart, shiftEnd, shiftLbl;
    if (_rmShift === "morning")  { shiftStart = 8;  shiftEnd = 16; shiftLbl = "Mattina"; }
    else if (_rmShift === "evening") { shiftStart = 16; shiftEnd = 24; shiftLbl = "Pomeriggio"; }
    else if (_rmShift === "both") { shiftStart = 8;  shiftEnd = 24; shiftLbl = "tutto il giorno"; }
    else if (_rmShift === "custom") {
      shiftStart = _parseHalf(rmStartSel?.value || "08:00");
      shiftEnd   = _parseHalf(rmEndSel?.value   || "16:00");
      if (shiftStart >= shiftEnd) { showToast("L'ora di fine deve essere dopo l'inizio.", "err"); return; }
      shiftLbl = `${_halfToLabel(shiftStart)}–${_halfToLabel(shiftEnd)}`;
    }

    const weekKey = weekKeyOf(currentWeekStart);
    const saveBtn = document.getElementById("rmModalSave");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Rimozione..."; }

    try {
      const ovList = await apiCall("overrides_get_week", weekKey) || [];

      // Raggruppa override del giorno/fascia per ruolo (precisione mezz'ora)
      const byRole = {};
      ovList.filter(ov => {
        if (ov.day_index !== dayIdx) return false;
        const halfH = _parseHalf(ov.time_label || "0:00");
        return halfH >= shiftStart && halfH < shiftEnd;
      }).forEach(ov => {
        if (!byRole[ov.role]) byRole[ov.role] = [];
        byRole[ov.role].push(ov);
      });

      // Salva ogni ruolo con il dipendente rimosso
      for (const [role, ovs] of Object.entries(byRole)) {
        const items = ovs.map(ov => ({
          time_label:   ov.time_label,
          employee_ids: (ov.employee_ids || []).filter(id => String(id) !== String(empId))
        }));
        await apiWrite("overrides_set_many", weekKey, dayIdx, role, items);
        items.forEach(({ time_label, employee_ids }) => {
          setAssignedIdsFor(weekKey, dayIdx, role, time_label, employee_ids);
        });
      }

      recalcSegmentsFromAssignments(weekKey);
      renderCalendar();
      window.chatAiUpdateContext?.();

      const empName = employeeLabel(empId);
      showToast(`${empName} rimosso — ${DAYS[dayIdx]} ${shiftLbl}`);

      // Reset step 2+3, mantieni giorno per rimuovere altri
      document.getElementById("rmEmployee").value = "";
      document.getElementById("rmEmpInfo").innerHTML = "";
      _rmResetStep3();
      _buildRmEmpDropdown(dayIdx);

    } catch (err) {
      showToast(err.message, "err");
      // una scrittura per ruolo: se una fallisce a metà, lo schermo torna uguale al DB
      await resyncWeekFromDb(weekKey);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Rimuovi turno"; }
    }
  }

  document.getElementById("btnQuickRemove")?.addEventListener("click", openRmModal);
  document.getElementById("rmModalClose")?.addEventListener("click", closeRmModal);
  document.getElementById("rmModalClose2")?.addEventListener("click", closeRmModal);
  rmBackdrop.addEventListener("mousedown", e => { if (e.target === rmBackdrop) closeRmModal(); });
  document.getElementById("rmModalSave")?.addEventListener("click", saveRmModal);
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
  initSidebar();
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