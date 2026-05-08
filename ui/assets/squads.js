// =========================
// Turni CN - SQUADS PAGE (dedicata)
// Dipendenze: app.js (DAYS/ROLES/currentWeekStart/defaultSquadDay/getWeekSquad/weekKeyOf/formatDate/getMondayOfCurrentWeek)
// + db_adapter.js (loadSquadsFromDb/saveSquadsToDb)
// =========================

let _squadsAutoSaveTimer = null;
let _undoSnapshot = null;
let _squadsDeleteUiBound = false;
let _dayTypesCache = null;
// =========================
// TIPI GIORNATA (day-type presets)
// Storage: localStorage (preferenze UI, non dati operativi)
// =========================

const DAY_TYPE_NAMES = ["Leggera", "Normale", "Pesante"];
const DAY_TYPE_ICONS = { "Leggera": "🟢", "Normale": "🟡", "Pesante": "🔴" };

function dayTypesDefault() {
  // Per ogni tipo: { morning: {role: qty}, evening: {role: qty} }
  const empty = () => Object.fromEntries(ROLES.map(r => [r, 0]));
  return {
    "Leggera":  { morning: empty(), evening: empty() },
    "Normale":  { morning: empty(), evening: empty() },
    "Pesante":  { morning: empty(), evening: empty() },
  };
}
async function dayTypesLoadFromDb() {
  try {
    const saved = await apiCall("day_type_presets_get");
    const defaults = dayTypesDefault();

    DAY_TYPE_NAMES.forEach(tn => {
      if (!saved[tn]) saved[tn] = defaults[tn];

      ["morning", "evening"].forEach(band => {
        if (!saved[tn][band]) saved[tn][band] = defaults[tn][band];

        ROLES.forEach(role => {
          if (saved[tn][band][role] === undefined) {
            saved[tn][band][role] = 0;
          }
        });
      });
    });

    return saved;
  } catch (e) {
    console.error("Errore caricamento day type presets:", e);
    return dayTypesDefault();
  }
}

function dayTypesSave(data) {
  _dayTypesCache = data;
  return dayTypesSaveToDb(data);
}
function dayTypesLoad() {
  return _dayTypesCache || dayTypesDefault();
}

async function dayTypesSaveToDb(data) {
  await apiCall("day_type_presets_set", data);
}

// Applica un tipo giornata a un giorno specifico nella tabella corrente
async function applyDayType(weekKey, dayIndex, typeName) {
  const types = dayTypesLoad();
  const preset = types[typeName];
  if (!preset) return;

  const wkData = getWeekSquad(weekKey);
  ["morning","evening"].forEach(band => {
    ROLES.forEach(role => {
      wkData[dayIndex][band][role] = preset[band][role] ?? 0;
    });
  });
  squads.set(weekKey, wkData);
  buildSquadsTable(weekKey, wkData);
  scheduleSquadsAutosave(weekKey);

  // salva assegnazione giorno→tipo a DB
  await apiCall("day_type_assignments_set", dayIndex, typeName);
  await renderDayTypesSection(weekKey);
}

// Render della sezione "Tipi giornata" (riga per giorno, 3 bottoni preset + badge tipo attivo)
async function renderDayTypesSection(weekKey) {
  const container = document.getElementById("dayTypesBody");
  if (!container) return;

  const types = dayTypesLoad();
  const wkData = getWeekSquad(weekKey);

  // legge assegnazioni correnti da DB
  let currentAssignments = {};
  try {
    currentAssignments = await apiCall("day_type_assignments_get") || {};
  } catch(e) {}

    const rows = DAYS.map((day, dayIndex) => {
      const currentType = currentAssignments[dayIndex] || currentAssignments[String(dayIndex)] || null;

      const btns = DAY_TYPE_NAMES.map(tn => {
        const icon = DAY_TYPE_ICONS[tn] || "";
        const activeClass = currentType === tn ? " dt-preset-btn--active" : "";
        return `<button class="btn btn-small dt-preset-btn${activeClass}" data-day="${dayIndex}" data-type="${tn}">${icon} ${tn}</button>`;
      }).join("");

      const badge = currentType
        ? `<span class="dt-current-badge">${DAY_TYPE_ICONS[currentType]} ${currentType}</span>`
        : `<span class="dt-current-badge dt-current-badge--empty">—</span>`;

      return `
        <div class="dt-day-box">
          <div class="dt-row">
            <div class="dt-day-label"><b>${day}</b>${badge}</div>
            <div class="dt-btns">${btns}</div>
          </div>
        </div>
      `;
    }).join("");

  container.innerHTML = rows;

  container.querySelectorAll(".dt-preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const dayIndex = Number(btn.dataset.day);
      const typeName = btn.dataset.type;
      _undoSnapshot = deepClone(getWeekSquad(weekKey));
      setUndoEnabled(true);
      applyDayType(weekKey, dayIndex, typeName);
    });
  });
}

// Modal modifica preset
let _dayTypeEditCurrentType = DAY_TYPE_NAMES[0];

function openDayTypeEditModal() {
  const m = document.getElementById("dayTypeEditModal");
  if (!m) return;
  _dayTypeEditCurrentType = DAY_TYPE_NAMES[0];
  renderDayTypeEditTabs();
  renderDayTypeEditContent();
  m.classList.remove("hidden");
}

function closeDayTypeEditModal() {
  document.getElementById("dayTypeEditModal")?.classList.add("hidden");
}

function renderDayTypeEditTabs() {
  const tabs = document.getElementById("dayTypeEditTabs");
  if (!tabs) return;
  tabs.innerHTML = DAY_TYPE_NAMES.map(tn => {
    const active = tn === _dayTypeEditCurrentType ? "active" : "";
    const icon = DAY_TYPE_ICONS[tn] || "";
    return `<button class="dt-tab ${active}" data-type="${tn}">${icon} ${tn}</button>`;
  }).join("");

  tabs.querySelectorAll(".dt-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      _dayTypeEditCurrentType = btn.dataset.type;
      renderDayTypeEditTabs();
      renderDayTypeEditContent();
    });
  });
}

function renderDayTypeEditContent() {
  const content = document.getElementById("dayTypeEditContent");
  if (!content) return;

  const types = dayTypesLoad();
  const preset = types[_dayTypeEditCurrentType];

  const bands = [
    { key: "morning", label: "Mattina (08–16)" },
    { key: "evening", label: "Pomeriggio (16–24)" },
  ];

  const rows = bands.map(({ key, label }) => {
    const cells = ROLES.map(role => {
      const v = preset[key][role] ?? 0;
      return `
        <div class="dt-edit-cell">
          <div class="dt-edit-role">${role}</div>
          <div class="dt-edit-controls">
            <button class="dt-stepper" data-band="${key}" data-role="${role}" data-delta="-1">−</button>
            <span class="dt-edit-val" id="dte_${key}_${role}">${v}</span>
            <button class="dt-stepper" data-band="${key}" data-role="${role}" data-delta="1">+</button>
          </div>
        </div>
      `;
    }).join("");
    return `
      <div class="dt-edit-band">
        <div class="dt-edit-band-label">${label}</div>
        <div class="dt-edit-cells">${cells}</div>
      </div>
    `;
  }).join("");

  content.innerHTML = rows;

  // stepper +/-
  content.querySelectorAll(".dt-stepper").forEach(btn => {
    btn.addEventListener("click", () => {
      const band = btn.dataset.band;
      const role = btn.dataset.role;
      const delta = Number(btn.dataset.delta);
      const el = document.getElementById(`dte_${band}_${role}`);
      if (!el) return;
      const newVal = Math.max(0, Number(el.textContent) + delta);
      el.textContent = newVal;
    });
  });
}

function saveDayTypeEditModal() {
  const types = dayTypesLoad();
  const preset = types[_dayTypeEditCurrentType];

  ["morning","evening"].forEach(band => {
    ROLES.forEach(role => {
      const el = document.getElementById(`dte_${band}_${role}`);
      if (el) preset[band][role] = Math.max(0, Number(el.textContent) || 0);
    });
  });

  dayTypesSave(types)
    .then(() => {
      // ❌ NON chiudere il modal
      // closeDayTypeEditModal();

      setSquadsStatus(`Preset "${_dayTypeEditCurrentType}" salvato`, "chip-ok");
    })
    .catch((e) => {
      console.error(e);
      setSquadsStatus("Errore salvataggio preset", "chip-bad");
    });
}

function bindDayTypeEditModal() {
  document.getElementById("btnEditDayTypes")?.addEventListener("click", openDayTypeEditModal);
  document.getElementById("dayTypeEditClose")?.addEventListener("click", closeDayTypeEditModal);
  document.getElementById("dayTypeEditCancel")?.addEventListener("click", closeDayTypeEditModal);
  document.getElementById("dayTypeEditSave")?.addEventListener("click", saveDayTypeEditModal);
  document.getElementById("dayTypeEditModal")?.addEventListener("click", (e) => {
    if (e.target?.id === "dayTypeEditModal") closeDayTypeEditModal();
  });
}
// Tabella squadre unica (non per settimana)
const SQUADS_GLOBAL_KEY = weekKeyOf(getMondayOfCurrentWeek(new Date()));
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

function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}

function setUndoEnabled(enabled){
  const b = document.getElementById("btnSquadsUndo");
  if (b) b.disabled = !enabled;
}

/** DELETE template (API) */
async function squadsTemplateDelete(name){
  return apiCall("squads_template_delete", name);
}

async function refreshTemplatesUI(){
  const sel = document.getElementById("squadsTemplateSelect");
  if (!sel) return;

  const names = await squadsTemplateList();
  sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join("");
  sel.disabled = names.length === 0;

  const bApply = document.getElementById("btnSquadsApplyTemplate");
  if (bApply) bApply.disabled = (names.length === 0);

  const bDel = document.getElementById("btnSquadsDeleteTemplate");
  if (bDel) bDel.disabled = (names.length === 0);
}

function setSquadsStatus(txt, kind){
  const el = document.getElementById("squadsSaveStatus");
  if (!el) return;
  el.textContent = txt;
  el.classList.remove("chip-ok","chip-warn","chip-bad");
  if (kind) el.classList.add(kind);
}

function renderSquadsWeekLabel(){
  const label = document.getElementById("squadsWeekLabel");
  if (!label) return;
  label.textContent = "Squadre: tabella unica (valida per tutte le settimane)";
}

function buildSquadsTable(weekKey, data){
  const table = document.getElementById("squadsTable");
  if (!table) return;

  const thead = `
    <thead>
      <tr>
        <th style="width:140px">Giorno</th>
        <th style="width:110px">Fascia</th>
        ${ROLES.map(r => `<th>${r}</th>`).join("")}
      </tr>
    </thead>
  `;

  const rows = [];
  DAYS.forEach((day, dayIndex) => {
    ["morning","evening"].forEach((band, bi) => {
      const bandLabelTxt = band === "morning" ? "Mattina" : "Pomeriggio";
      const dayCell = bi === 0 ? `<td class="col-day" rowspan="2"><b>${day}</b></td>` : "";
      const tds = ROLES.map(role => {
              const v = (data?.[dayIndex]?.[band]?.[role] ?? 0);
              const cellId = `sq_${dayIndex}_${band}_${role}`;
              return `
                <td class="col-role">
                  <div class="sq-stepper" data-week="${weekKey}" data-day="${dayIndex}" data-band="${band}" data-role="${role}">
                    <button class="sq-step sq-minus" tabindex="-1">−</button>
                    <span class="sq-val" id="${cellId}">${Number(v)}</span>
                    <button class="sq-step sq-plus" tabindex="-1">+</button>
                  </div>
                </td>
              `;
            }).join("");

      const dayClass = (dayIndex % 2 === 0) ? "day-a" : "day-b";
      const bandClass = (band === "morning") ? "band-morning" : "band-evening";

      rows.push(`
        <tr class="${dayClass} ${bandClass}">
          ${dayCell}
          <td class="col-band">${bandLabelTxt}</td>
          ${tds}
        </tr>
      `);
    });
  });

  table.innerHTML = `${thead}<tbody>${rows.join("")}</tbody>`;

  table.querySelectorAll(".sq-stepper").forEach(stepper => {
      const d    = Number(stepper.dataset.day);
      const band = stepper.dataset.band;
      const role = stepper.dataset.role;
      const cellId = `sq_${d}_${band}_${role}`;

      stepper.querySelector(".sq-minus").addEventListener("click", () => {
        const el = document.getElementById(cellId);
        if (!el) return;
        const newVal = Math.max(0, Number(el.textContent) - 1);
        el.textContent = newVal;
        const wkData = getWeekSquad(weekKey);
        wkData[d][band][role] = newVal;
        squads.set(weekKey, wkData);
        scheduleSquadsAutosave(weekKey);
      });

      stepper.querySelector(".sq-plus").addEventListener("click", () => {
        const el = document.getElementById(cellId);
        if (!el) return;
        const newVal = Number(el.textContent) + 1;
        el.textContent = newVal;
        const wkData = getWeekSquad(weekKey);
        wkData[d][band][role] = newVal;
        squads.set(weekKey, wkData);
        scheduleSquadsAutosave(weekKey);
      });
    });
}

function scheduleSquadsAutosave(weekKey){
  setSquadsStatus("Modifiche in corso…", "chip-warn");

  if (_squadsAutoSaveTimer) clearTimeout(_squadsAutoSaveTimer);

  _squadsAutoSaveTimer = setTimeout(async () => {
    try{
      setSquadsStatus("Salvataggio…", "chip-warn");
      await saveSquadsToDb(weekKey, getWeekSquad(weekKey));
      setSquadsStatus("Salvato", "chip-ok");
    }catch(e){
      console.error(e);
      setSquadsStatus("Errore salvataggio", "chip-bad");
    }
  }, 400);
}

async function reloadSquadsFromDbForWeek(weekKey){
  // preferisco una load dedicata (solo squads) se esiste, altrimenti fallback su loadWeekFromDb
  if (typeof loadSquadsFromDb === "function") {
    await loadSquadsFromDb(weekKey);
  } else {
    await loadWeekFromDb(weekKey);
  }
  buildSquadsTable(weekKey, getWeekSquad(weekKey));
  setSquadsStatus("Pronto", null);
}

function openTplModal(){
  const m = document.getElementById("tplModal");
  const inp = document.getElementById("tplName");
  if (!m || !inp) return;
  inp.value = "";
  m.classList.remove("hidden");
  setTimeout(() => inp.focus(), 0);
}

function closeTplModal(){
  const m = document.getElementById("tplModal");
  if (!m) return;
  m.classList.add("hidden");
}

/* ---------- MODALE DELETE TEMPLATE (custom, no window.confirm) ---------- */
function openDeleteTplModal(name){
  const m = document.getElementById("tplDeleteModal");
  const t = document.getElementById("tplDeleteText");
  if (!m || !t) return;

  m.dataset.tplName = name;
  t.textContent = `Eliminare il template "${name}"?`;
  m.classList.remove("hidden");
}

function closeDeleteTplModal(){
  document.getElementById("tplDeleteModal")?.classList.add("hidden");
}

function bindDeleteTplUIOnce(){
  if (_squadsDeleteUiBound) return;
  _squadsDeleteUiBound = true;

  document.getElementById("btnSquadsDeleteTemplate")?.addEventListener("click", () => {
    const sel = document.getElementById("squadsTemplateSelect");
    const name = sel?.value;
    if (!name) return;
    openDeleteTplModal(name);
  });

  document.getElementById("tplDeleteClose")?.addEventListener("click", closeDeleteTplModal);
  document.getElementById("tplDeleteCancel")?.addEventListener("click", closeDeleteTplModal);

  // click fuori -> chiudi
  document.getElementById("tplDeleteModal")?.addEventListener("click", (e) => {
    if (e.target?.id === "tplDeleteModal") closeDeleteTplModal();
  });

  document.getElementById("tplDeleteConfirm")?.addEventListener("click", async () => {
    const m = document.getElementById("tplDeleteModal");
    const name = m?.dataset?.tplName;
    if (!name) return;

    try {
      setSquadsStatus("Eliminazione…", "chip-warn");
      await squadsTemplateDelete(name);
      closeDeleteTplModal();
      await refreshTemplatesUI();
      setSquadsStatus("Template eliminato", "chip-ok");
    } catch (e) {
      console.error("DELETE TEMPLATE ERROR:", e);
      setSquadsStatus("Errore eliminazione", "chip-bad");
    }
  });
}

async function initSquadsPage(){
  initAccordions();

  // Tabella unica: non dipende dalla settimana
  const weekKey = SQUADS_GLOBAL_KEY;

  if (!Array.isArray(employees) || employees.length === 0){
    await loadEmployeesFromDb();
  }

  renderSquadsWeekLabel();
  await reloadSquadsFromDbForWeek(weekKey);

  await refreshTemplatesUI();
  setUndoEnabled(false);

  bindDeleteTplUIOnce();

  document.getElementById("tplClose")?.addEventListener("click", closeTplModal);
  document.getElementById("tplCancel")?.addEventListener("click", closeTplModal);

  // click fuori dal riquadro -> chiudi
  document.getElementById("tplModal")?.addEventListener("click", (e) => {
    if (e.target?.id === "tplModal") closeTplModal();
  });

  document.getElementById("tplSave")?.addEventListener("click", async () => {
    const payload = getWeekSquad(weekKey);

    const nameEl = document.getElementById("tplName");
    const name = (nameEl?.value || "").trim();
    if (!name){
      setSquadsStatus("Inserisci un nome", "chip-warn");
      nameEl?.focus();
      return;
    }

    try{
      await squadsTemplateSave(name, payload);
      closeTplModal();
      setSquadsStatus("Template salvato", "chip-ok");
      await refreshTemplatesUI();
    }catch(e){
      console.error(e);
      setSquadsStatus("Nome già usato", "chip-bad");
    }
  });

  document.getElementById("btnSquadsSaveTemplate")?.addEventListener("click", () => {
    openTplModal();
  });

  document.getElementById("btnSquadsApplyTemplate")?.addEventListener("click", async () => {
    const sel = document.getElementById("squadsTemplateSelect");
    const templateName = sel?.value;
    if (!templateName) return;

    try{
      // snapshot per CTRL+Z
      _undoSnapshot = deepClone(getWeekSquad(weekKey));
      setUndoEnabled(true);

      const tpl = await squadsTemplateGet(templateName);

      // sovrascrivo week corrente
      squads.set(weekKey, tpl);
      buildSquadsTable(weekKey, getWeekSquad(weekKey));

      // salvo a DB subito
      setSquadsStatus("Salvataggio…", "chip-warn");
      await saveSquadsToDb(weekKey, getWeekSquad(weekKey));
      setSquadsStatus(`Applicato: ${templateName}`, "chip-ok");
    }catch(e){
      console.error(e);
      setSquadsStatus("Errore applicazione", "chip-bad");
    }
  });

  document.getElementById("btnSquadsUndo")?.addEventListener("click", async () => {
      if (!_undoSnapshot) return;

      try{
        squads.set(weekKey, deepClone(_undoSnapshot));
        buildSquadsTable(weekKey, getWeekSquad(weekKey));

        setSquadsStatus("Ripristino…", "chip-warn");
        await saveSquadsToDb(weekKey, getWeekSquad(weekKey));

        _undoSnapshot = null;
        setUndoEnabled(false);
        setSquadsStatus("Annullato", "chip-ok");
      }catch(e){
        console.error(e);
        setSquadsStatus("Errore annulla", "chip-bad");
      }
    });

    // Day-type presets
    _dayTypesCache = await dayTypesLoadFromDb();
    // Day-type presets
    await renderDayTypesSection(weekKey);
    bindDayTypeEditModal();
  }