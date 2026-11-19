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
/** Pallino colorato del tipo giornata (stile in ui_kit.css: .dt-dot--leggera/normale/pesante). */
function dayTypeDot(tn) {
  return tn ? `<span class="dt-dot dt-dot--${String(tn).toLowerCase()}" aria-hidden="true"></span>` : "";
}

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

function dayTypesLoad() {
  return _dayTypesCache || dayTypesDefault();
}

async function dayTypesSaveToDb(data) {
  await apiWrite("day_type_presets_set", data);
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
  try {
    await apiWrite("day_type_assignments_set", dayIndex, typeName);
  } catch (err) {
    showToast(err.message, "err");
  }
  await renderDayTypesSection(weekKey);
}

// Render della sezione "Tipi giornata" (riga per giorno, 3 bottoni preset + badge tipo attivo)
async function renderDayTypesSection(weekKey) {
  const container = document.getElementById("dayTypesBody");
  if (!container) return;

  // legge assegnazioni correnti da DB
  let currentAssignments = {};
  try {
    currentAssignments = await apiCall("day_type_assignments_get") || {};
  } catch(e) {}

    const rows = DAYS.map((day, dayIndex) => {
      const currentType = currentAssignments[dayIndex] || currentAssignments[String(dayIndex)] || null;

      const btns = DAY_TYPE_NAMES.map(tn => {
        const activeClass = currentType === tn ? " dt-preset-btn--active" : "";
        return `<button type="button" class="btn btn-small dt-preset-btn${activeClass}" data-day="${dayIndex}" data-type="${tn}" aria-pressed="${currentType === tn}">${dayTypeDot(tn)}${tn}</button>`;
      }).join("");

      const badge = currentType
        ? `<span class="dt-current-badge">${dayTypeDot(currentType)}${currentType}</span>`
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

// Modal modifica preset — si lavora su una BOZZA delle tre schede:
// cambiare scheda non perde nulla, "Salva preset" salva tutto insieme,
// chiudere con modifiche non salvate chiede conferma.
let _dayTypeEditCurrentType = DAY_TYPE_NAMES[0];
let _dtDraft = null;
let _dtDirty = false;

function openDayTypeEditModal() {
  const m = document.getElementById("dayTypeEditModal");
  if (!m) return;
  _dtDraft = deepClone(dayTypesLoad());
  _dtDirty = false;
  _dayTypeEditCurrentType = DAY_TYPE_NAMES[0];
  renderDayTypeEditTabs();
  renderDayTypeEditContent();
  m.classList.remove("hidden");
}

async function closeDayTypeEditModal() {
  if (_dtDirty) {
    const ok = await uiConfirm({
      title: "Uscire senza salvare?",
      message: "Le modifiche ai preset non salvate andranno perse.",
      confirmText: "Esci senza salvare",
      cancelText: "Continua a modificare",
      danger: true,
    });
    if (!ok) return;
  }
  _dtDraft = null;
  _dtDirty = false;
  document.getElementById("dayTypeEditModal")?.classList.add("hidden");
}

function renderDayTypeEditTabs() {
  const tabs = document.getElementById("dayTypeEditTabs");
  if (!tabs) return;
  tabs.innerHTML = DAY_TYPE_NAMES.map(tn => {
    const active = tn === _dayTypeEditCurrentType ? " active" : "";
    return `<button type="button" class="dt-tab${active}" data-type="${tn}" aria-pressed="${active ? "true" : "false"}">
      <span class="dt-dot dt-dot--${tn.toLowerCase()}" aria-hidden="true"></span>${tn}</button>`;
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
  if (!content || !_dtDraft) return;
  const preset = _dtDraft[_dayTypeEditCurrentType];

  const bands = [
    { key: "morning", label: "Mattina (08–16)" },
    { key: "evening", label: "Pomeriggio (16–24)" },
  ];

  content.innerHTML = bands.map(({ key, label }) => `
    <div class="dt-edit-band">
      <div class="dt-edit-band-label">${label}</div>
      <div class="dt-edit-cells">${ROLES.map(role => `
        <div class="dt-edit-cell">
          <div class="dt-edit-role">${role}</div>
          <div class="dt-edit-controls">
            <button type="button" class="dt-stepper" data-band="${key}" data-role="${role}" data-delta="-1" aria-label="Togli una persona: ${role}, ${label}">−</button>
            <span class="dt-edit-val" id="dte_${key}_${role}">${preset[key][role] ?? 0}</span>
            <button type="button" class="dt-stepper" data-band="${key}" data-role="${role}" data-delta="1" aria-label="Aggiungi una persona: ${role}, ${label}">+</button>
          </div>
        </div>`).join("")}
      </div>
    </div>`).join("");

  content.querySelectorAll(".dt-stepper").forEach(btn => {
    btn.addEventListener("click", () => {
      const { band, role } = btn.dataset;
      const next = Math.max(0, Number(preset[band][role] || 0) + Number(btn.dataset.delta));
      preset[band][role] = next;
      document.getElementById(`dte_${band}_${role}`).textContent = next;
      _dtDirty = true;
    });
  });
}

async function saveDayTypeEditModal() {
  if (!_dtDraft) return;
  const btn = document.getElementById("dayTypeEditSave");
  btn?.classList.add("is-busy");
  if (btn) btn.disabled = true;
  try {
    await dayTypesSaveToDb(_dtDraft);
    // la memoria della pagina si aggiorna solo dopo il salvataggio riuscito
    _dayTypesCache = deepClone(_dtDraft);
    _dtDirty = false;
    await closeDayTypeEditModal();
    setSquadsStatus("Preset salvati", "chip-ok");
    showToast("Preset Leggera, Normale e Pesante salvati");
  } catch (e) {
    showToast(e.message, "err");
  } finally {
    btn?.classList.remove("is-busy");
    if (btn) btn.disabled = false;
  }
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
function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}

function setUndoEnabled(enabled){
  const b = document.getElementById("btnSquadsUndo");
  if (b) b.disabled = !enabled;
}

/** DELETE template (API) */
async function squadsTemplateDelete(name){
  return apiWrite("squads_template_delete", name);
}

async function refreshTemplatesUI(){
  const sel = document.getElementById("squadsTemplateSelect");
  if (!sel) return;

  const names = (await squadsTemplateList()) || [];
  sel.innerHTML = names.length
    ? names.map(n => `<option value="${uiEscape(n)}">${uiEscape(n)}</option>`).join("")
    : `<option value="">Nessun template salvato</option>`;
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
  label.innerHTML = `Fabbisogno per giorno e fascia ${infoTip("Numero di persone che servono per ogni ruolo, nella fascia del mattino (8–16) e del pomeriggio (16–24). La tabella vale per tutte le settimane: ogni import di disponibilità usa questi valori. Le modifiche si salvano da sole.")}`;
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
      setSquadsStatus("Non salvato", "chip-bad");
      showToast(`${e.message} La tabella mostra di nuovo i valori salvati.`, "err");
      // lo schermo torna uguale al DB
      await reloadSquadsFromDbForWeek(weekKey);
      buildSquadsTable(weekKey, getWeekSquad(weekKey));
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
  t.textContent = `Il template «${name}» viene eliminato. La tabella del fabbisogno attuale non cambia.`;
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
      showToast(`Template «${name}» eliminato`);
    } catch (e) {
      setSquadsStatus("Non eliminato", "chip-bad");
      showToast(e.message, "err");
    }
  });
}

async function initSquadsPage(){

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

    // un nome già esistente SOSTITUISCE quel template: lo si chiede prima
    const existing = (await squadsTemplateList()) || [];
    if (existing.some(n => n.toLowerCase() === name.toLowerCase())) {
      const ok = await uiConfirm({
        title: "Sostituire il template?",
        message: `Esiste già un template «${name}». Salvando, i suoi valori vengono sostituiti con quelli attuali.`,
        confirmText: "Sostituisci",
        danger: true,
      });
      if (!ok) return;
    }
    try{
      await squadsTemplateSave(name, payload);
      closeTplModal();
      setSquadsStatus("Template salvato", "chip-ok");
      showToast(`Template «${name}» salvato`);
      await refreshTemplatesUI();
      const sel = document.getElementById("squadsTemplateSelect");
      if (sel) sel.value = name;
    }catch(e){
      setSquadsStatus("Non salvato", "chip-bad");
      showToast(e.message, "err");
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
      if (!tpl || typeof tpl !== "object") throw new Error(`Il template «${templateName}» non si può leggere.`);

      // sovrascrivo week corrente
      squads.set(weekKey, tpl);
      buildSquadsTable(weekKey, getWeekSquad(weekKey));

      // salvo a DB subito
      setSquadsStatus("Salvataggio…", "chip-warn");
      await saveSquadsToDb(weekKey, getWeekSquad(weekKey));
      setSquadsStatus(`Applicato: ${templateName}`, "chip-ok");
      showToast(`Template «${templateName}» applicato`);
    }catch(e){
      setSquadsStatus("Non applicato", "chip-bad");
      showToast(e.message, "err");
      await reloadSquadsFromDbForWeek(weekKey);
      buildSquadsTable(weekKey, getWeekSquad(weekKey));
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
        setSquadsStatus("Modifica annullata", "chip-ok");
      }catch(e){
        setSquadsStatus("Non salvato", "chip-bad");
        showToast(e.message, "err");
        await reloadSquadsFromDbForWeek(weekKey);
        buildSquadsTable(weekKey, getWeekSquad(weekKey));
      }
    });

    // Day-type presets
    _dayTypesCache = await dayTypesLoadFromDb();
    // Day-type presets
    await renderDayTypesSection(weekKey);
    bindDayTypeEditModal();
  }