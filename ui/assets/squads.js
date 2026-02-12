// =========================
// Turni CN - SQUADS PAGE (dedicata)
// Dipendenze: app.js (DAYS/ROLES/currentWeekStart/defaultSquadDay/getWeekSquad/weekKeyOf/formatDate/getMondayOfCurrentWeek)
// + db_adapter.js (loadSquadsFromDb/saveSquadsToDb)
// =========================

let _squadsAutoSaveTimer = null;
let _undoSnapshot = null;

// evita doppio binding listeners se initSquadsPage viene richiamata
let _squadsDeleteUiBound = false;

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
        return `
          <td class="col-role">
            <input
              class="squad-input"
              type="number"
              min="0"
              step="1"
              value="${Number(v)}"
              data-week="${weekKey}"
              data-day="${dayIndex}"
              data-band="${band}"
              data-role="${role}"
            >
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

  table.querySelectorAll("input.squad-input").forEach(inp => {
    inp.addEventListener("input", () => {
      const d = Number(inp.dataset.day);
      const band = inp.dataset.band;
      const role = inp.dataset.role;
      const val = Number(inp.value || 0);

      const wkData = getWeekSquad(weekKey);
      wkData[d][band][role] = val;
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
}
