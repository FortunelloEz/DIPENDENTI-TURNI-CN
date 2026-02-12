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
function weekKeyOf(weekStartDate){
  const y = weekStartDate.getFullYear();
  const m = String(weekStartDate.getMonth()+1).padStart(2,"0");
  const d = String(weekStartDate.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
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
  const out = [];
  for (let i=a; i<=b; i++){
    out.push(...labelsForRow(_visibleRowsCache[i]));
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

  document.querySelectorAll(`.cell.slot[data-day-index="${dayIndex}"][data-role="${CSS.escape(role)}"]`).forEach(el => {
    const t = el.dataset.timeLabel;
    if (t && want.has(t)) el.classList.add("selected");
  });
}

function renderCalendar(){
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;

  clearSelection();

  const weekKey = weekKeyOf(currentWeekStart);
  const cols = buildDayColumns();

  grid.style.gridTemplateColumns = ["160px", ...cols.map(() => "minmax(140px, 1fr)")].join(" ");
  grid.innerHTML = "";

  /* ===== HEADER 1: GIORNI ===== */
  grid.appendChild(makeCell("Orario", "cell header"));

  DAYS.forEach((day, dayIndex) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + dayIndex);

    const span = expandedDays.has(dayIndex) ? ROLES.length : 1;
    const cell = makeCell(`${day}\n${formatDate(date)}`, "cell header day-toggle day-" + dayIndex + " day-end");
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
      const c = makeCell("", "cell header day-" + dayIndex + " day-end");
      c.innerHTML = `<span class="role-pill">Tutti i ruoli</span>`;
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
        cell.className = "cell slot day-collapsed empty day-" + col.dayIndex + (col.isDayEnd ? " day-end" : "");
        cell.dataset.dayIndex = col.dayIndex;

        cell.addEventListener("click", () => {
          expandedDays.add(col.dayIndex);
          renderCalendar();
        });

        const summary = buildCollapsedSummary(weekKey, col.dayIndex, row);
        if (summary.hasSomething){
          cell.classList.remove("empty");
          cell.classList.add("filled");
          cell.innerHTML = summary.html;
        } else {
          cell.innerHTML = `<span style="opacity:.4">—</span>`;
        }
        grid.appendChild(cell);
        return;
      }

      const cell = document.createElement("div");
      cell.className = "cell slot empty day-" + col.dayIndex + (col.isDayEnd ? " day-end" : "");
      cell.dataset.dayIndex = col.dayIndex;
      cell.dataset.role = col.role;
      if (row.kind === "slot") cell.dataset.timeLabel = row.timeLabel;
      if (row.kind === "range" || row.kind === "rangeHeader") cell.dataset.rangeId = row.rangeId;

      const timeLabels = (row.kind === 'range' || row.kind === 'rangeHeader')
        ? segmentToSlots(row.seg)
        : [row.timeLabel];

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

      // selezione su mezz'ore
      if (row.kind === "slot"){
        cell.addEventListener("mousedown", (e) => {
          e.preventDefault();
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

function openSquadsModal(){
  const weekKey = weekKeyOf(currentWeekStart);
  const data = getWeekSquad(weekKey);

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
  head.innerHTML = `<div class="modal-title">Squadra settimana (${weekKey})</div>`;
  const close = document.createElement("div");
  close.className = "modal-close";
  close.textContent = "✕";
  close.addEventListener("click", closeModal);
  head.appendChild(close);

  const body = document.createElement("div");
  body.className = "modal-body";

  const table = document.createElement("table");
  table.className = "squad-table";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.innerHTML = `<th style="width:140px">Giorno</th><th style="width:110px">Fascia</th>` + ROLES.map(r => `<th>${r}</th>`).join("");
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  DAYS.forEach((day, dayIndex) => {
    ["morning","evening"].forEach((band, bi) => {
      const tr = document.createElement("tr");
      const dayCell = bi === 0 ? `<td rowspan="2"><b>${day}</b></td>` : "";
      const bandLabelTxt = band === "morning" ? "Mattina" : "Pomeriggio";
      tr.innerHTML = `${dayCell}<td>${bandLabelTxt}</td>` + ROLES.map(role => {
        const v = data[dayIndex][band][role] ?? 0;
        return `<td><input class="squad-input" type="number" min="0" value="${v}" data-day="${dayIndex}" data-band="${band}" data-role="${role}"></td>`;
      }).join("");
      tbody.appendChild(tr);
    });
  });

  table.appendChild(tbody);
  body.appendChild(table);

  const foot = document.createElement("div");
  foot.className = "modal-foot";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn btn-ghost";
  btnCancel.textContent = "Chiudi";
  btnCancel.addEventListener("click", closeModal);

  const btnSave = document.createElement("button");
  btnSave.className = "btn";
  btnSave.textContent = "Salva";
  btnSave.addEventListener("click", async () => {
    modal.querySelectorAll("input.squad-input").forEach(inp => {
      const d = Number(inp.dataset.day);
      const band = inp.dataset.band;
      const role = inp.dataset.role;
      data[d][band][role] = Number(inp.value || 0);
    });
    squads.set(weekKey, data);

    await saveSquadsToDb(weekKey, data);

    closeModal();
  });

  foot.appendChild(btnCancel);
  foot.appendChild(btnSave);

  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  activeModalEl = overlay;
}

/* ---------- MODAL: INDETERMINATI SETTIMANA ---------- */
function openPermanentModal(){
  const weekKey = weekKeyOf(currentWeekStart);
  closeModal();

  const permanents = employees.filter(e => !!e.is_permanent);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });

  const modal = document.createElement("div");
  modal.className = "modal";

  const head = document.createElement("div");
  head.className = "modal-head";
  head.innerHTML = `<div class="modal-title">Indeterminati – settimana (${weekKey})</div>`;
  const close = document.createElement("div");
  close.className = "modal-close";
  close.textContent = "✕";
  close.addEventListener("click", closeModal);
  head.appendChild(close);

  const body = document.createElement("div");
  body.className = "modal-body";

  const info = document.createElement("div");
  info.style.opacity = ".85";
  info.style.marginBottom = "10px";
  info.textContent = "Imposta giorno di riposo e ore target (default 40) per ogni dipendente a tempo indeterminato.";
  body.appendChild(info);

  const table = document.createElement("table");
  table.className = "squad-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:260px">Dipendente</th>
        <th style="width:160px">Giorno riposo</th>
        <th style="width:140px">Ore target</th>
      </tr>
    </thead>
    <tbody id="permTbody"></tbody>
  `;
  body.appendChild(table);

  const tbody = table.querySelector("#permTbody");

  const days = ["(nessuno)","Lun","Mar","Mer","Gio","Ven","Sab","Dom"];

  (async () => {
    const rows = await loadPermanentWeekFromDb(weekKey);
    const map = new Map();
    (rows || []).forEach(r => {
      map.set(String(r.employee_id), {
        day_off: r.day_off,
        target_hours: r.target_hours ?? 40
      });
    });

    permanents
      .slice()
      .sort((a,b)=>a.label.localeCompare(b.label,"it"))
      .forEach(emp => {
        const s = map.get(String(emp.id)) || { day_off: null, target_hours: 40 };

        const tr = document.createElement("tr");
        const sel = document.createElement("select");
        sel.className = "squad-input";
        sel.dataset.emp = emp.id;
        sel.innerHTML = days.map((d,i)=>`<option value="${i===0 ? "" : (i-1)}">${d}</option>`).join("");
        sel.value = (s.day_off === null || s.day_off === undefined) ? "" : String(s.day_off);

        const hours = document.createElement("input");
        hours.type = "number";
        hours.min = "0";
        hours.className = "squad-input";
        hours.dataset.emp = emp.id;
        hours.value = String(Number(s.target_hours ?? 40));

        tr.innerHTML = `<td><b>${emp.label}</b></td>`;
        const tdDay = document.createElement("td");
        tdDay.appendChild(sel);
        const tdHours = document.createElement("td");
        tdHours.appendChild(hours);

        tr.appendChild(tdDay);
        tr.appendChild(tdHours);
        tbody.appendChild(tr);
      });
  })();

  const foot = document.createElement("div");
  foot.className = "modal-foot";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn btn-ghost";
  btnCancel.textContent = "Chiudi";
  btnCancel.addEventListener("click", closeModal);

  const btnSave = document.createElement("button");
  btnSave.className = "btn";
  btnSave.textContent = "Salva";
  btnSave.addEventListener("click", async () => {
    const items = [];
    tbody.querySelectorAll("tr").forEach(tr => {
      const selEl = tr.querySelector("select");
      const inp = tr.querySelector('input[type="number"]');
      items.push({
        employee_id: Number(selEl.dataset.emp),
        day_off: selEl.value === "" ? null : Number(selEl.value),
        target_hours: Number(inp.value || 40)
      });
    });
    await savePermanentWeekToDb(weekKey, items);
    closeModal();
  });

  foot.appendChild(btnCancel);
  foot.appendChild(btnSave);

  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  activeModalEl = overlay;
}

/* ---------- INIT HOME ---------- */
let _homeMouseupInited = false;

async function initHome(){
  initAccordions();

  currentWeekStart = getMondayOfCurrentWeek(new Date());
  expandedDays = new Set();    // tutto chiuso
  expandedRanges = new Set();  // fasce compresse

  const wk = weekKeyOf(currentWeekStart);

  await loadEmployeesFromDb();
  await loadWeekFromDb(wk);

  renderEmployees();
  renderWeekLabel();
  renderCalendar();

  document.getElementById("btnPrevWeek")?.addEventListener("click", async () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);

    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
  });

  document.getElementById("btnNextWeek")?.addEventListener("click", async () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);

    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
  });

  document.getElementById("btnToday")?.addEventListener("click", async () => {
    currentWeekStart = getMondayOfCurrentWeek(new Date());
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);

    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
  });

  document.getElementById("btnTodayTop")?.addEventListener("click", async () => {
    currentWeekStart = getMondayOfCurrentWeek(new Date());
    expandedRanges = new Set();
    const wk2 = weekKeyOf(currentWeekStart);

    await loadWeekFromDb(wk2);
    renderWeekLabel();
    renderCalendar();
  });

  document.getElementById("btnClear")?.addEventListener("click", async () => {
    const wk2 = weekKeyOf(currentWeekStart);

    Array.from(assignments.keys()).forEach(k => { if (k.startsWith(wk2 + "|")) assignments.delete(k); });
    clearSelection();

    await clearWeekOverridesOnDb(wk2);

    recalcSegmentsFromAssignments(wk2);
    renderCalendar();
  });

  document.getElementById("btnEditSquads")?.addEventListener("click", () => loadView("squads"));
  document.getElementById("btnPermManage")?.addEventListener("click", () => openPermanentModal());

  // mouseup globale: se stavi selezionando -> picker su quelle mezz'ore
  if (!_homeMouseupInited) {
    _homeMouseupInited = true;
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
async function initEmployees() {
  initAccordions();

  const btnNew = document.getElementById("btnEmpNew");
  const btnRefresh = document.getElementById("btnEmpRefresh");
  const tbody = document.getElementById("empTbody");

  const modal = document.getElementById("empModalBackdrop");
  const btnCancel = document.getElementById("empModalCancel");
  const btnSave = document.getElementById("empModalSave");
  const btnClose = document.getElementById("empModalClose");

  const inpName = document.getElementById("empName");
  const chkPerm = document.getElementById("empPermanent");
  const selRole = document.getElementById("empPreferredRole");
  const skillsGrid = document.getElementById("empSkillsGrid");

  let editingId = null;

  // griglia skill: una riga per ruolo (rank 1-5)
  skillsGrid.innerHTML = ROLES.map(role => `
    <div class="skill-row">
      <div class="skill-name">${role}</div>
      <input class="skill-rank" type="number" min="0" max="5" value="0" data-role="${role}">
      <div class="skill-hint">0=nessuna, 1–5=livello</div>
    </div>
  `).join("");

  function openModal(emp = null) {
    editingId = emp?.id ?? null;
    inpName.value = emp?.name ?? "";
    chkPerm.checked = !!emp?.is_permanent;
    selRole.value = emp?.preferred_role ?? "";

    const skills = emp?.skills || {};
    skillsGrid.querySelectorAll('input.skill-rank').forEach(inp => {
      const role = inp.dataset.role;
      inp.value = String(Number(skills?.[role] ?? 0));
    });

    modal.style.display = "flex";
  }

  function closeModal() {
    modal.style.display = "none";
    editingId = null;
  }

  function skillsToText(skills){
    const pairs = Object.entries(skills || {}).filter(([,v]) => Number(v) > 0);
    if (!pairs.length) return "";
    return pairs.map(([r,v]) => `${r}:${v}`).join(", ");
  }

  function renderRows(list) {
    tbody.innerHTML = "";
    for (const e of list) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${e.name}</td>
        <td>${e.is_permanent ? "SI" : "NO"}</td>
        <td>${e.preferred_role || ""}</td>
        <td>${skillsToText(e.skills)}</td>
        <td class="actions">
          <button class="btn small" data-act="edit">Modifica</button>
          <button class="btn small danger" data-act="del">Elimina</button>
        </td>
      `;

      tr.querySelector('[data-act="edit"]').addEventListener("click", () => openModal(e));
      tr.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (!confirm(`Eliminare ${e.name}?`)) return;
        await apiCall("employee_delete", e.id);
        await refresh();
      });

      tbody.appendChild(tr);
    }
  }

  async function refresh() {
    const list = await apiCall("employees_list");
    const mapped = (list || []).map(x => ({
      id: x.id,
      name: x.name,
      is_permanent: !!x.is_permanent,
      preferred_role: x.preferred_role || "",
      skills: x.skills || {}
    }));
    renderRows(mapped);
  }

  btnNew?.addEventListener("click", () => openModal(null));
  btnRefresh?.addEventListener("click", refresh);
  btnCancel?.addEventListener("click", closeModal);
  btnClose?.addEventListener("click", closeModal);

  btnSave?.addEventListener("click", async () => {
    const name = inpName.value.trim();
    if (!name) { alert("Nome obbligatorio"); return; }

    const skills = {};
    skillsGrid.querySelectorAll('input.skill-rank').forEach(inp => {
      const role = inp.dataset.role;
      const v = Number(inp.value || 0);
      if (v > 0) skills[role] = v;
    });

    const payload = {
      name,
      is_permanent: chkPerm.checked ? 1 : 0,
      preferred_role: selRole.value || null,
      skills
    };

    if (editingId) {
      await apiCall("employee_update", { id: editingId, ...payload });
    } else {
      await apiCall("employee_create", payload);
    }
    closeModal();
    await refresh();
  });

  modal?.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  await refresh();
}

/* ---------- BOOT ---------- */
bindNavigation();
loadView("home");
