// =========================
// Turni CN - SQUADS PAGE (dedicata)
// Dipendenze: app.js (DAYS/ROLES/currentWeekStart/defaultSquadDay/getWeekSquad/weekKeyOf/formatDate/getMondayOfCurrentWeek)
// + db_adapter.js (loadSquadsFromDb/saveSquadsToDb)
// =========================

let _squadsAutoSaveTimer = null;

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
  const end = new Date(currentWeekStart);
  end.setDate(end.getDate() + 6);
  label.textContent = `Settimana: ${formatDate(currentWeekStart)} → ${formatDate(end)}`;
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
      const dayCell = bi === 0 ? `<td rowspan="2"><b>${day}</b></td>` : "";
      const tds = ROLES.map(role => {
        const v = (data?.[dayIndex]?.[band]?.[role] ?? 0);
        return `
          <td>
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

      rows.push(`<tr>${dayCell}<td>${bandLabelTxt}</td>${tds}</tr>`);
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

async function initSquadsPage(){
  initAccordions();

  if (!currentWeekStart) currentWeekStart = getMondayOfCurrentWeek(new Date());

  if (!Array.isArray(employees) || employees.length === 0){
    await loadEmployeesFromDb();
  }

  const weekKey = weekKeyOf(currentWeekStart);
  renderSquadsWeekLabel();
  await reloadSquadsFromDbForWeek(weekKey);

  document.getElementById("btnSquadsPrevWeek")?.addEventListener("click", async () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    const wk2 = weekKeyOf(currentWeekStart);
    renderSquadsWeekLabel();
    await reloadSquadsFromDbForWeek(wk2);
  });

  document.getElementById("btnSquadsNextWeek")?.addEventListener("click", async () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    const wk2 = weekKeyOf(currentWeekStart);
    renderSquadsWeekLabel();
    await reloadSquadsFromDbForWeek(wk2);
  });

  document.getElementById("btnSquadsToday")?.addEventListener("click", async () => {
    currentWeekStart = getMondayOfCurrentWeek(new Date());
    const wk2 = weekKeyOf(currentWeekStart);
    renderSquadsWeekLabel();
    await reloadSquadsFromDbForWeek(wk2);
  });

  document.getElementById("btnSquadsReload")?.addEventListener("click", async () => {
    const wk2 = weekKeyOf(currentWeekStart);
    await reloadSquadsFromDbForWeek(wk2);
  });
}