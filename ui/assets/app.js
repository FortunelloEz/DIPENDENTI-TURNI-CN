// =========================
// Turni CN - CORE UI (calendario, modali, routing)
// File "core": niente chiamate DB dirette.
// Dipendenze: db_adapter.js deve essere caricato PRIMA (espone: apiCall, loadEmployeesFromDb, loadWeekFromDb, saveSlotOverrideToDb, saveDayRoleOverridesToDb, saveSquadsToDb, clearWeekOverridesOnDb, loadPermanentWeekFromDb, savePermanentWeekToDb)
// =========================

/* ---------- ROUTING SEMPLICE ---------- */
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
  // importante: home viene ricaricata via loadView, quindi la rightbar cambia.
  document.querySelectorAll(".accordion").forEach(btn => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", () => {
      const accId = btn.getAttribute("data-acc");
      const panel = document.getElementById(`acc-${accId}`);

      // Sidebar sinistra: Navigazione
      if (accId === "main") {
        const sidebar = document.querySelector(".sidebar");
        const isCollapsed = sidebar.classList.toggle("collapsed");
        document.querySelector(".app")?.classList.toggle("left-collapsed", isCollapsed);
        btn.classList.toggle("open", !isCollapsed);
        panel?.classList.toggle("open", !isCollapsed);
        return;
      }

      // Barra destra: Dipendenti (esiste solo in home)
      if (accId === "employees") {
        const rightbar = btn.closest(".rightbar");
        if (!rightbar) return;
        const isCollapsed = rightbar.classList.toggle("collapsed");
        btn.classList.toggle("open", !isCollapsed);
        panel?.classList.toggle("open", !isCollapsed);
        return;
      }

      // Default: accordion generico
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

/* ---------- EMPLOYEES IN MEMORIA (popolati dal db_adapter) ---------- */
// employees = [{ id:number|string, label:string, is_permanent?:bool, preferred_role?:string, skills?:{[role]:rank} }]
let employees = [];
function getEmployeeById(id){
  return employees.find(e => String(e.id) === String(id)) || null;
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function nextFrame(){
  return new Promise(r => requestAnimationFrame(() => r()));
}
async function retryUntil(fn, predicate, { tries = 15, delayMs = 120 } = {}){
  for (let i = 0; i < tries; i++){
    try { await fn(); } catch (e) { /* ignora e ritenta */ }
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
  const sH = String(Math.floor(startMin/60)).padStart(2,"0");
  const sM = String(startMin%60).padStart(2,"0");
  const eH = String(Math.floor(endMin/60)).padStart(2,"0");
  const eM = String(endMin%60).padStart(2,"0");
  const s = (sM === "00") ? sH : `${sH}:${sM}`;
  const e = (eM === "00") ? eH : `${eH}:${eM}`;
  return `${s}–${e}`;
}

function baseSegments(){
  return [
    { startMin:8*60, endMin:16*60, id:'480-960', label:'08–16' },
    { startMin:16*60, endMin:24*60, id:'960-1440', label:'16–24' },
  ];
}
function segmentToSlots(seg){
  const start = minToTime(seg.startMin);
  const end = minToTime(seg.endMin);
  const startIdx = HALF_HOURS.indexOf(start);
  const endIdx = (end === '24:00') ? HALF_HOURS.length : HALF_HOURS.indexOf(end);
  return HALF_HOURS.slice(startIdx, endIdx);
}

/* ---------- helpers date/week ---------- */
function formatDate(d){
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  return `${dd}/${mm}`;
}
function getMondayOfCurrentWeek(date){
  const d = new Date(date);
  const day = d.getDay(); // 0 dom
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
let expandedDays = new Set();       // dayIndex espansi (mostrano ruoli)
let expandedRanges = new Set();     // fasce espanse (mostrano mezz'ore)
let _visibleRowsCache = [];         // ultimo render: righe visibili per calcolare selezioni
let isSelecting = false;
let sel = { dayIndex:null, role:null, labels:[], rowStart:null, rowEnd:null };

/**
 * assignments: Map<key, string[]|number[]>
 * key = `${weekKey}|${dayIndex}|${role}|${timeLabel}`
 * timeLabel è SEMPRE una mezz'ora ("08:00" ... "23:30")
 */
let assignments = new Map();

// Segmenti per settimana (calcolati dinamicamente in base a dove cambia la tabella)
let weekSegments = new Map(); // Map<weekKey, segments[]>

/**
 * squads: Map<weekKey, data>
 * data: { [dayIndex]: { morning:{role->qty}, evening:{role->qty} } }
 */
let squads = new Map();

/* ---------- ASSIGNMENTS HELPERS ---------- */
function keyOf(weekKey, dayIndex, role, timeLabel){
  return `${weekKey}|${dayIndex}|${role}|${timeLabel}`;
}
function getAssignedIdsFor(weekKey, dayIndex, role, timeLabel){
  const k = keyOf(weekKey, dayIndex, role, timeLabel);
  return assignments.get(k) || [];
}
function setAssignedIdsFor(weekKey, dayIndex, role, timeLabel, ids){
  const k = keyOf(weekKey, dayIndex, role, timeLabel);
  const clean = Array.from(new Set(ids)).filter(v => v !== null && v !== undefined && String(v) !== "");
  if (clean.length === 0) assignments.delete(k);
  else assignments.set(k, clean);
}

/* ---------- Segmenti dinamici: “merge” dove la tabella non cambia ---------- */
function tableSignatureAt(weekKey, timeLabel){
  const parts = [];
  for (let d=0; d<DAYS.length; d++){
    for (let r=0; r<ROLES.length; r++){
      const role = ROLES[r];
      const ids = getAssignedIdsFor(weekKey, d, role, timeLabel).slice().sort();
      parts.push(ids.join(","));
      parts.push("|");
    }
    parts.push("||");
  }
  return parts.join("");
}
function hasAnyAssignmentsForWeek(weekKey){
  for (const k of assignments.keys()){
    if (k.startsWith(weekKey + "|")) return true;
  }
  return false;
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
    if (prevSig === null){
      prevSig = sig;
      segStartMin = m;
      continue;
    }
    if (sig !== prevSig){
      segs.push({ startMin: segStartMin, endMin: m, id: `${segStartMin}-${m}`, label: bandLabel(segStartMin, m) });
      segStartMin = m;
      prevSig = sig;
    }
  }
  segs.push({ startMin: segStartMin, endMin: 24*60, id: `${segStartMin}-${24*60}`, label: bandLabel(segStartMin, 24*60) });

  if (segs.length === 1 && segs[0].startMin === 8*60 && segs[0].endMin === 24*60){
    return baseSegments();
  }
  return segs;
}
function recalcSegmentsFromAssignments(weekKey){
  // opzionale: teniamo in cache eventuali segmenti già calcolati (non strettamente necessario ora)
  weekSegments.set(weekKey, computeTimeSegments(weekKey));
}

/* ---------- UI HELPERS ---------- */
function makeCell(text, className){
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}
function clearSelection(){
  isSelecting = false;
  sel = { dayIndex:null, role:null, labels:[], rowStart:null, rowEnd:null };
  document.querySelectorAll(".cell.slot.selected").forEach(el => el.classList.remove("selected"));
}
function renderEmployees(){
  const list = document.getElementById("empList");
  if (!list) return;
  list.innerHTML = "";
  employees
    .slice()
    .sort((a,b) => a.label.localeCompare(b.label, "it"))
    .forEach(e => {
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

  let assignments = {};
  try {
    assignments = await apiCall("day_type_assignments_get") || {};
  } catch(e) {}

  const cells = DAYS.map((day, dayIndex) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + dayIndex);
    const dateStr = formatDate(date);
    const typeName = assignments[String(dayIndex)] || assignments[dayIndex] || null;
    const icon = typeName ? (DAY_TYPE_ICONS[typeName] || "") : "—";
    const typeLabel = typeName || "Non assegnata";

    const typeColors = {
      "Leggera": "rgba(16,185,129,.10)",
      "Normale": "rgba(245,158,11,.10)",
      "Pesante": "rgba(239,68,68,.10)",
    };
    const typeBorders = {
      "Leggera": "rgba(16,185,129,.30)",
      "Normale": "rgba(245,158,11,.30)",
      "Pesante": "rgba(239,68,68,.30)",
    };
    const bg = typeName ? typeColors[typeName] : "transparent";
    const border = typeName ? typeBorders[typeName] : "rgba(15,23,42,.08)";

    return `
      <div class="ds-item ${typeName ? "ds-item--set" : ""}" style="background:${bg};border-color:${border};">
        <div class="ds-item-head">
          <span class="ds-item-day">${day}</span>
          <span class="ds-item-date">${dateStr}</span>
        </div>
        <div class="ds-item-type">${icon} ${typeLabel}</div>
      </div>
    `;
  }).join("");

  container.innerHTML = cells;
}
function initQuickAdd() {
  const bar = document.getElementById("quickAddBar");
  if (!bar) return;

  // Popola dipendenti
  const selEmp = document.getElementById("qaEmployee");
  selEmp.innerHTML = `<option value="">— Dipendente —</option>` +
    employees.slice().sort((a,b) => a.label.localeCompare(b.label, "it"))
      .map(e => `<option value="${e.id}">${e.label}</option>`).join("");

  // Popola giorni
  const selDay = document.getElementById("qaDay");
  selDay.innerHTML = `<option value="">— Giorno —</option>` +
    DAYS.map((d, i) => {
      const date = new Date(currentWeekStart);
      date.setDate(date.getDate() + i);
      return `<option value="${i}">${d} ${formatDate(date)}</option>`;
    }).join("");

  // Popola ruoli
  const selRole = document.getElementById("qaRole");
  selRole.innerHTML = `<option value="">— Mansione —</option>` +
    ROLES.map(r => `<option value="${r}">${r}</option>`).join("");

  // Popola orari
  const hours = [];
  for (let h = 8; h <= 24; h++) hours.push(`${String(h).padStart(2,"0")}:00`);
  const selFrom = document.getElementById("qaFrom");
  const selTo   = document.getElementById("qaTo");
  selFrom.innerHTML = `<option value="">— Dalle —</option>` + hours.map(h => `<option value="${h}">${h}</option>`).join("");
  selTo.innerHTML   = `<option value="">— Alle —</option>`  + hours.map(h => `<option value="${h}">${h}</option>`).join("");

  // Confirm
  const btnConfirm = document.getElementById("qaConfirm");
  if (btnConfirm.dataset.bound === "1") return;
  btnConfirm.dataset.bound = "1";

  btnConfirm.addEventListener("click", async () => {
    const empId  = Number(selEmp.value);
    const dayIdx = Number(selDay.value);
    const role   = selRole.value;
    const from   = selFrom.value;
    const to     = selTo.value;

    if (!empId || selDay.value === "" || !role || !from || !to) {
      alert("Compila tutti i campi prima di aggiungere.");
      return;
    }

    const fromH = parseInt(from);
    const toH   = parseInt(to);
    if (toH <= fromH) {
      alert("L'orario di fine deve essere successivo a quello di inizio.");
      return;
    }

    const weekKey = weekKeyOf(currentWeekStart);

    // genera le mezz'ore nell'intervallo
    const halfHoursToAdd = [];
    for (let h = fromH; h < toH; h++) {
      halfHoursToAdd.push(`${String(h).padStart(2,"0")}:00`);
      halfHoursToAdd.push(`${String(h).padStart(2,"0")}:30`);
    }

    // aggiunge il dipendente alle mezz'ore, senza sovrascrivere gli altri
    for (const t of halfHoursToAdd) {
      const current = getAssignedIdsFor(weekKey, dayIdx, role, t) || [];
      if (!current.includes(empId)) {
        const updated = [...current, empId];
        setAssignedIdsFor(weekKey, dayIdx, role, t, updated);
        await saveSlotOverrideToDb(weekKey, dayIdx, role, t, updated);
      }
    }

    recalcSegmentsFromAssignments(weekKey);
    renderCalendar();

    // reset selezioni (mantieni dipendente per aggiunta rapida multipla)
    selDay.value  = "";
    selRole.value = "";
    selFrom.value = "";
    selTo.value   = "";
  });
}
/* ---------- CALENDARIO ---------- */
function buildDayColumns(){
  const cols = [];
  DAYS.forEach((day, dayIndex) => {
    if (expandedDays.has(dayIndex)){
      ROLES.forEach((role, ri) => cols.push({ dayIndex, role, collapsed:false, isDayEnd: ri === ROLES.length-1 }));
    } else {
      cols.push({ dayIndex, role:null, collapsed:true, isDayEnd:true });
    }
  });
  return cols;
}

function unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels){
  const set = new Set();
  timeLabels.forEach(t => {
    getAssignedIdsFor(weekKey, dayIndex, role, t).forEach(id => set.add(id));
  });
  return Array.from(set);
}

function buildCollapsedSummary(weekKey, dayIndex, row){
  if (row.kind === "slot") return { hasSomething:false, html:"" };
  const timeLabels = (row.kind === 'range' || row.kind === 'rangeHeader')
    ? segmentToSlots(row.seg)
    : [row.timeLabel];

  const lines = [];
  ROLES.forEach(role => {
    const ids = unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels);
    if (!ids.length) return;
    const names = ids.map(id => getEmployeeById(id)?.label || id);
    const shown = names.slice(0,2).join(", ");
    const more = names.length > 2 ? ` +${names.length-2}` : "";
    lines.push(`<div class="summary-line"><b class="role-tag role-${roleCss(role)}">${ROLE_SHORT[role] || role}</b><span>${shown}${more}</span></div>`);
  });

  return { hasSomething: lines.length > 0, html: lines.join("") };
}

function labelsForRow(row){
  if (!row) return [];
  if (row.kind === 'slot') return [row.timeLabel];
  if (row.kind === 'range' || row.kind === 'rangeHeader') return segmentToSlots(row.seg);
  return [];
}
function labelsForRowSpan(rowStartIdx, rowEndIdx){
  const a = Math.min(rowStartIdx, rowEndIdx);
  const b = Math.max(rowStartIdx, rowEndIdx);
  const goingDown = rowEndIdx >= rowStartIdx;
  const out = [];
  for (let i=a; i<=b; i++){
    const row = _visibleRowsCache[i];
    if (!row) continue;
    if (row.kind === 'slot') {
      out.push(row.timeLabel);
    } else if (row.kind === 'range' || row.kind === 'rangeHeader') {
      // fascia intermedia: prendi tutte le sue mezz'ore
      // fascia di bordo (primo o ultimo elemento dello span):
      // se è la riga di arrivo del drag, prendi solo
      // la prima mezz'ora (drag verso giù) o l'ultima (drag verso su)
      const slots = segmentToSlots(row.seg);
      if (i === a && i !== b) {
        // bordo superiore: drag verso giù → prendi tutto dalla prima in poi
        out.push(...slots);
      } else if (i === b && i !== a) {
        // bordo inferiore: drag verso su → prendi solo fino all'ultima
        if (goingDown) {
          // arrivati qui scendendo: solo la prima mezz'ora della fascia
          out.push(slots[0]);
        } else {
          // arrivati qui salendo: solo l'ultima mezz'ora della fascia
          out.push(slots[slots.length - 1]);
        }
      } else {
        // fascia interna allo span: prendi tutto
        out.push(...slots);
      }
    }
  }
  const set = new Set(out);
  return HALF_HOURS.filter(t => set.has(t));
}
function applySelectionUI(){
  document.querySelectorAll(".cell.slot").forEach(el => el.classList.remove("selected"));
  if (!isSelecting || !sel.labels.length) return;

  const dayIndex = String(sel.dayIndex);
  const role = sel.role;
  const want = new Set(sel.labels);

  document
    .querySelectorAll(`.cell.slot[data-day-index="${dayIndex}"][data-role="${CSS.escape(role)}"]`)
    .forEach(el => {
      const kind = el.dataset.kind;

      // mezz’ora: match diretto
      if (kind === "slot") {
        const t = el.dataset.timeLabel;
        if (t && want.has(t)) el.classList.add("selected");
        return;
      }

      // fascia (range/rangeHeader): se interseca almeno una mezz’ora selezionata -> evidenzia
      const labels = (el.dataset.timeLabels || "").split(",").filter(Boolean);
      for (const t of labels) {
        if (want.has(t)) {
          el.classList.add("selected");
          break;
        }
      }
    });
}

function renderCalendar(){
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;

  clearSelection();

  const weekKey = weekKeyOf(currentWeekStart);
  const cols = buildDayColumns();

  grid.style.gridTemplateColumns = [
    "160px",
    ...cols.map(c => c.collapsed ? "70px" : "minmax(140px, 1fr)")
  ].join(" ");
  grid.innerHTML = "";

  /* ===== HEADER 1: GIORNI ===== */
  grid.appendChild(makeCell("Orario", "cell header"));

  DAYS.forEach((day, dayIndex) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + dayIndex);

    const span = expandedDays.has(dayIndex) ? ROLES.length : 1;
    const isCollapsed = !expandedDays.has(dayIndex);
    const cell = makeCell(`${day}\n${formatDate(date)}`,
      "cell header day-toggle day-" + dayIndex + " day-end" + (isCollapsed ? " day-collapsed-hdr" : "")
    );
    cell.style.gridColumn = `span ${span}`;
    cell.addEventListener("click", () => {
      if (expandedDays.has(dayIndex)) expandedDays.delete(dayIndex);
      else expandedDays.add(dayIndex);
      renderCalendar();
    });
    grid.appendChild(cell);
  });

  /* ===== HEADER 2: RUOLI ===== */
  grid.appendChild(makeCell("", "cell header"));
  DAYS.forEach((_, dayIndex) => {
    if (expandedDays.has(dayIndex)){
      ROLES.forEach((role, ri) => {
        const c = makeCell(role, "cell header day-" + dayIndex + (ri === ROLES.length-1 ? " day-end" : ""));
        c.title = role;
        grid.appendChild(c);
      });
    } else {
      const c = makeCell("", "cell header day-" + dayIndex + " day-end micro-hdr");
      c.innerHTML = ``; // niente testo
      grid.appendChild(c);
    }
  });

  /* ===== RIGHE ORARIE VISIBILI ===== */
  const segments = computeTimeSegments(weekKey);
  const visibleRows = [];

  segments.forEach(seg => {
    if (expandedRanges.has(seg.id)){
      visibleRows.push({ kind:'rangeHeader', rangeId:seg.id, seg, label: seg.label + ' ▴' });
      segmentToSlots(seg).forEach(t => visibleRows.push({ kind:'slot', rangeId:seg.id, seg, timeLabel:t, label:t }));
    } else {
      visibleRows.push({ kind:'range', rangeId:seg.id, seg, label: seg.label });
    }
  });
  _visibleRowsCache = visibleRows;

  const prevSigByCol = new Map(); // key: dayIndex|role -> sig

  visibleRows.forEach((row, rIdx) => {
    const timeCell = makeCell(row.label, "cell time " + ((row.kind === "range" || row.kind === "rangeHeader") ? "toggle" : ""));
    if (row.kind === "range" || row.kind === "rangeHeader"){
      timeCell.title = "Clicca per espandere / comprimere";
      timeCell.addEventListener("click", () => {
        if (expandedRanges.has(row.rangeId)) expandedRanges.delete(row.rangeId);
        else expandedRanges.add(row.rangeId);
        renderCalendar();
      });
    }
    grid.appendChild(timeCell);

    cols.forEach(col => {
      if (col.collapsed){
        const cell = document.createElement("div");
        cell.className = "cell slot day-collapsed micro day-" + col.dayIndex + (col.isDayEnd ? " day-end" : "");
        cell.dataset.dayIndex = col.dayIndex;

        // click per ri-espandere il giorno
        cell.addEventListener("click", () => {
          expandedDays.add(col.dayIndex);
          renderCalendar();
        });

        // ✅ niente riepilogo: sempre colonna micro
        // Se vuoi un hint minimo quando c'è qualcosa, mettiamo solo un pallino
        const timeLabels = (row.kind === 'range' || row.kind === 'rangeHeader')
          ? segmentToSlots(row.seg)
          : (row.kind === "slot" ? [row.timeLabel] : []);

        // c'è qualsiasi assegnazione in QUALSIASI ruolo in quel giorno su quelle label?
        let hasAny = false;
        if (timeLabels.length){
          for (const role of ROLES){
            const ids = unionAssignedOverLabels(weekKey, col.dayIndex, role, timeLabels);
            if (ids.length){ hasAny = true; break; }
          }
        }

        cell.classList.toggle("filled", hasAny);
        cell.classList.toggle("empty", !hasAny);

        // icona minimal: • se pieno, — se vuoto
        let total = 0;
        if (timeLabels.length){
          const set = new Set();
          for (const role of ROLES){
            unionAssignedOverLabels(weekKey, col.dayIndex, role, timeLabels).forEach(id => set.add(id));
          }
          total = set.size;
        }
        cell.innerHTML = total ? `<span class="micro-count">${total}</span>` : `<span class="micro-dash">—</span>`;

        grid.appendChild(cell);
        return;
      }

      const cell = document.createElement("div");
      cell.className = "cell slot empty day-" + col.dayIndex + (col.isDayEnd ? " day-end" : "");
      cell.dataset.dayIndex = col.dayIndex;
      cell.dataset.role = col.role;

      // ✅ serve a applySelectionUI per capire che tipo di cella è
      cell.dataset.kind = row.kind;

      if (row.kind === "slot") {
        cell.dataset.timeLabel = row.timeLabel; // singola mezz’ora
      } else if (row.kind === "range" || row.kind === "rangeHeader") {
        cell.dataset.rangeId = row.rangeId;
      }

      const timeLabels = (row.kind === 'range' || row.kind === 'rangeHeader')
        ? segmentToSlots(row.seg)
        : [row.timeLabel];

      // ✅ PER IL COLORE SELEZIONE: sulle fasce salvo tutte le mezz’ore coperte
      if (row.kind === "range" || row.kind === "rangeHeader") {
        cell.dataset.timeLabels = timeLabels.join(",");
      } else {
        delete cell.dataset.timeLabels;
      }

      const ids = unionAssignedOverLabels(weekKey, col.dayIndex, col.role, timeLabels);
      const sig = ids.slice().sort().join('|');
      const sigKey = `${col.dayIndex}|${col.role}`;
      const prevSig = prevSigByCol.get(sigKey) || '';
      const suppress = sig && sig === prevSig;

      if (ids.length){
        cell.classList.remove("empty");
        cell.classList.add("filled");
        if (!suppress){
          cell.classList.add('merged-start');
          cell.innerHTML = ids.map(id => `<span class="badge badge-${roleCss(col.role)}">${getEmployeeById(id)?.label || id}</span>`).join("");
        } else {
          cell.classList.add('merged-cont');
          cell.innerHTML = ``;
        }
      } else {
        cell.innerHTML = `<span style="opacity:.4">—</span>`;
      }
      prevSigByCol.set(sigKey, sig);

      // ✅ selezione con drag: funziona sia su mezz'ore (slot) sia su fasce (range/rangeHeader)
      if (row.kind === "slot" || row.kind === "range" || row.kind === "rangeHeader") {
        cell.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();

          // se inizi a trascinare, sopprimiamo il click “assegna fascia”
          window._suppressNextRangeClick = true;

          isSelecting = true;
          sel.dayIndex = col.dayIndex;
          sel.role = col.role;
          sel.rowStart = rIdx;
          sel.rowEnd = rIdx;
          sel.labels = labelsForRowSpan(sel.rowStart, sel.rowEnd);
          applySelectionUI();
        });

        cell.addEventListener("mouseenter", () => {
          if (!isSelecting) return;
          if (sel.dayIndex !== col.dayIndex) return;
          if (sel.role !== col.role) return;

          sel.rowEnd = rIdx;
          sel.labels = labelsForRowSpan(sel.rowStart, sel.rowEnd);
          applySelectionUI();
        });
      } else {
        // click su fascia -> picker su tutta la fascia
        cell.title = "Clicca per assegnare su tutta la fascia";
        cell.style.cursor = "pointer";
        cell.addEventListener("click", (e) => {
          e.stopPropagation();

          // ✅ se arriviamo da drag-select, non aprire anche il picker “a click”
          if (window._suppressNextRangeClick) {
            window._suppressNextRangeClick = false;
            return;
          }
          window._suppressNextRangeClick = false;
          openEmployeePicker({ weekKey, dayIndex: col.dayIndex, role: col.role, timeLabels });
        });
      }

      grid.appendChild(cell);
    });
  });
}

/* ---------- MODAL: PICKER MULTI-DIPENDENTE ---------- */
let activeModalEl = null;

function closeModal(){
  activeModalEl?.remove();
  activeModalEl = null;
}

function nextLabelExclusive(labels){
  if (!labels.length) return "";
  const last = labels[labels.length-1];
  const idx = HALF_HOURS.indexOf(last);
  const next = HALF_HOURS[idx+1];
  return next || "24:00";
}

function openEmployeePicker({ weekKey, dayIndex, role, timeLabels }){
  closeModal();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeModal();
  });

  const modal = document.createElement("div");
  modal.className = "modal";

  const head = document.createElement("div");
  head.className = "modal-head";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = `${DAYS[dayIndex]} – ${role} (${timeLabels[0]} → ${nextLabelExclusive(timeLabels)})`;
  const close = document.createElement("div");
  close.className = "modal-close";
  close.textContent = "✕";
  close.addEventListener("click", closeModal);
  head.appendChild(title);
  head.appendChild(close);

  const body = document.createElement("div");
  body.className = "modal-body";

  const wrap = document.createElement("div");
  wrap.className = "picker-wrap";

  const boxAll = document.createElement("div");
  boxAll.className = "picker-box";
  boxAll.innerHTML = `<div class="picker-title">Dipendenti</div>`
    + `<input class="picker-search" id="pickerSearch" type="text" placeholder="Cerca..." />`
    + `<div class="picker-list" id="pickerAll"></div>`;

  const boxSel = document.createElement("div");
  boxSel.className = "picker-box";
  boxSel.innerHTML = `<div class="picker-title">Selezionati</div><div class="picker-list" id="pickerSel"></div>`;

  wrap.appendChild(boxAll);
  wrap.appendChild(boxSel);
  body.appendChild(wrap);

  const foot = document.createElement("div");
  foot.className = "modal-foot";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn btn-ghost";
  btnCancel.textContent = "Annulla";
  btnCancel.addEventListener("click", closeModal);

  const btnClear = document.createElement("button");
  btnClear.className = "btn btn-ghost";
  btnClear.textContent = "Svuota";
  btnClear.addEventListener("click", () => {
    selected.clear();
    renderPickers();
  });

  const btnApply = document.createElement("button");
  btnApply.className = "btn";
  btnApply.textContent = "Applica";
  btnApply.addEventListener("click", async () => {
    const idsArr = Array.from(selected);

    // 1) memoria + 2) DB: salva per ogni mezz'ora (semplice, consistente)
    for (const t of timeLabels){
      setAssignedIdsFor(weekKey, dayIndex, role, t, idsArr);
      await saveSlotOverrideToDb(weekKey, dayIndex, role, t, idsArr);
    }

    recalcSegmentsFromAssignments(weekKey);

    closeModal();
    renderCalendar();
  });

  foot.appendChild(btnCancel);
  foot.appendChild(btnClear);
  foot.appendChild(btnApply);

  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  activeModalEl = overlay;

  const selected = new Set(unionAssignedOverLabels(weekKey, dayIndex, role, timeLabels));

  const allEl = modal.querySelector("#pickerAll");
  const selEl = modal.querySelector("#pickerSel");
  const searchEl = modal.querySelector("#pickerSearch");
  let searchQ = "";
  searchEl?.addEventListener("input", () => { searchQ = (searchEl.value || "").trim().toLowerCase(); renderPickers(); });

  function renderPickers(){
    allEl.innerHTML = "";
    selEl.innerHTML = "";

    employees
      .slice()
      .sort((a,b) => a.label.localeCompare(b.label, "it"))
      .filter(emp => !searchQ || emp.label.toLowerCase().includes(searchQ))
      .forEach(emp => {
        const chip = document.createElement("div");
        chip.className = "picker-item" + (selected.has(emp.id) ? " selected" : "");
        chip.textContent = emp.label;
        chip.addEventListener("click", () => {
          if (selected.has(emp.id)) selected.delete(emp.id);
          else selected.add(emp.id);
          renderPickers();
        });
        allEl.appendChild(chip);
      });

    Array.from(selected)
      .map(id => getEmployeeById(id))
      .filter(Boolean)
      .sort((a,b) => a.label.localeCompare(b.label, "it"))
      .forEach(emp => {
        const chip = document.createElement("div");
        chip.className = "picker-item selected";
        chip.textContent = emp.label;
        chip.title = "Click per rimuovere";
        chip.addEventListener("click", () => {
          selected.delete(emp.id);
          renderPickers();
        });
        selEl.appendChild(chip);
      });
  }

  renderPickers();
}

/* ---------- MODAL: SQUADRE SETTIMANA ---------- */
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
let _homeMouseupInited = false;

async function initHome(){
  initAccordions();

  currentWeekStart = getNextWeekMonday(new Date());
  expandedDays = new Set();    // tutto chiuso
  expandedRanges = new Set();  // fasce compresse

  const wk = weekKeyOf(currentWeekStart);
  window.currentWeekKey = wk;
  await retryUntil(
    async () => { await loadEmployeesFromDb(); },
    () => Array.isArray(employees) && employees.length > 0,
    { tries: 20, delayMs: 100 }
  );

  // anche se week è vuota “legittimamente”, la carichiamo comunque
  await loadWeekFromDb(wk);

  renderEmployees();
  renderWeekLabel();
  renderCalendar();
  renderDaySummary();
  // ✅ EXPORT: bottone "Elabora settimana"
  {
    const btn = document.getElementById("btnElaboraWeek");
    if (btn) {
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);

      clone.addEventListener("click", async () => {
        const wk2 = weekKeyOf(currentWeekStart);
        window.lastWeekKey = wk2;

        // se sei in PyWebView ok, altrimenti evita crash
        if (!window.pywebview?.api?.export_week) {
          alert("API non pronta: pywebview.api.export_week non disponibile.");
          return;
        }

        window.lastExportData = await window.pywebview.api.export_week(wk2);
        await loadView("export");
      });
    }
  }
  window.bindImportAvailability?.();
  window.bindAvailabilityViewer?.();
  document.getElementById("btnPrevWeek")?.addEventListener("click", async () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);
    window.currentWeekKey = wk2;
    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
    await renderDaySummary();
    initQuickAdd();
  });

  document.getElementById("btnNextWeek")?.addEventListener("click", async () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);
    window.currentWeekKey = wk2;
    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
    await renderDaySummary();
    initQuickAdd();
  });

  document.getElementById("btnToday")?.addEventListener("click", async () => {
    currentWeekStart = getNextWeekMonday(new Date());
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);
    window.currentWeekKey = wk2;
    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
    await renderDaySummary();
    initQuickAdd();
  });

  document.getElementById("btnTodayTop")?.addEventListener("click", async () => {
    currentWeekStart = getNextWeekMonday(new Date());
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);
    window.currentWeekKey = wk2;
    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
    await renderDaySummary();
    initQuickAdd();
  });

  document.getElementById("btnClear")?.addEventListener("click", async () => {
    const wk2 = weekKeyOf(currentWeekStart);

    Array.from(assignments.keys()).forEach(k => { if (k.startsWith(wk2 + "|")) assignments.delete(k); });
    clearSelection();

    await clearWeekOverridesOnDb(wk2);

    recalcSegmentsFromAssignments(wk2);
    renderCalendar();
    await renderDaySummary();
    initQuickAdd();
  });
  document.getElementById("btnPermManage")?.addEventListener("click", () => openPermanentModal());

  // mouseup globale: se stavi selezionando -> picker su quelle mezz'ore
  if (!_homeMouseupInited) {
    _homeMouseupInited = true;
    window.addEventListener("mousemove", (e) => {
      if (!isSelecting) return;
      const wrap = document.querySelector(".calendar-wrap");
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const threshold = 60;
      const speed = 14;
      if (e.clientY > rect.bottom - threshold) wrap.scrollTop += speed;
      else if (e.clientY < rect.top + threshold) wrap.scrollTop -= speed;
      if (e.clientX > rect.right - threshold) wrap.scrollLeft += speed;
      else if (e.clientX < rect.left + threshold) wrap.scrollLeft -= speed;
    });

    window.addEventListener("mouseup", () => {
      if (!isSelecting) return;
      if (sel.dayIndex === null || !sel.role || !sel.labels.length) { clearSelection(); return; }

      const weekKey = weekKeyOf(currentWeekStart);
      const timeLabels = sel.labels.slice();
      const dayIndex = sel.dayIndex;
      const role = sel.role;

      clearSelection();
      openEmployeePicker({ weekKey, dayIndex, role, timeLabels });
    });
  }
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

/* ---------- DIPENDENTI (CRUD) ---------- */
// (spostato in ./assets/employees.js)

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
  // Se non è PyWebView, parti subito
  const inPyWebView = typeof window.pywebview !== "undefined";
  if (!inPyWebView) {
    boot();
    return;
  }

  // PyWebView: aspetta davvero l'API (polling)
  const tick = () => {
    if (_booted) return;
    if (isPywebviewApiReady()) {
      boot();
      return;
    }
    setTimeout(tick, 50);
  };
  tick();
}

// 1) prova evento standard
window.addEventListener("pywebviewready", bootWhenReady);

// 2) fallback: comunque al DOMContentLoaded prova a partire quando pronto
window.addEventListener("DOMContentLoaded", bootWhenReady);