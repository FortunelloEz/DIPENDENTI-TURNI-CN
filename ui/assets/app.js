async function api() {
  // pywebview: window.pywebview.api
  if (!window.pywebview || !window.pywebview.api) {
    throw new Error("pywebview API non disponibile. Avvia da app/main.py");
  }
  return window.pywebview.api;
}

const appEl = document.getElementById("app");

async function loadView(name) {
  const html = await fetch(`views/${name}.html`).then(r => r.text());
  appEl.innerHTML = html;

  if (name === "employees") await initEmployees();
  if (name === "availability") await initAvailability();
  if (name === "planner") await initPlanner();
  if (name === "settings") await initSettings();
}

document.querySelectorAll("[data-view]").forEach(btn => {
  btn.addEventListener("click", () => loadView(btn.dataset.view));
});

document.getElementById("btnPing").addEventListener("click", async () => {
  const a = await api();
  const res = await a.ping();
  alert(JSON.stringify(res, null, 2));
});

// ---- Employees ----
async function initEmployees() {
  const a = await api();
  const listEl = document.getElementById("employeesList");
  const nameEl = document.getElementById("empName");
  const skillsEl = document.getElementById("empSkills");

  async function refresh() {
    const rows = await a.employees_list();
    listEl.innerHTML = rows.map(e => `
      <tr>
        <td>${e.id}</td>
        <td>${e.name}</td>
        <td>${(e.skills || []).join(", ")}</td>
        <td><button data-del="${e.id}">Elimina</button></td>
      </tr>
    `).join("");

    listEl.querySelectorAll("[data-del]").forEach(b => {
      b.addEventListener("click", async () => {
        await a.employees_delete(parseInt(b.dataset.del));
        refresh();
      });
    });
  }

  document.getElementById("btnEmpAdd").addEventListener("click", async () => {
    const name = nameEl.value.trim();
    const skills = skillsEl.value.split(",").map(x => x.trim()).filter(Boolean);
    await a.employees_create({ name, skills, active: true });
    nameEl.value = "";
    skillsEl.value = "";
    refresh();
  });

  refresh();
}

// ---- Availability ----
async function initAvailability() {
  const a = await api();
  const fileEl = document.getElementById("excelPath");
  const outEl = document.getElementById("importOut");

  document.getElementById("btnImport").addEventListener("click", async () => {
    const path = fileEl.value.trim();
    const res = await a.availability_import_excel(path);
    outEl.textContent = JSON.stringify(res, null, 2);
  });

  document.getElementById("btnValidate").addEventListener("click", async () => {
    const res = await a.validate();
    outEl.textContent = JSON.stringify(res, null, 2);
  });
}

// ---- Planner ----
async function initPlanner() {
  const a = await api();
  const weekEl = document.getElementById("weekStart");
  const outEl = document.getElementById("plannerOut");
  const calEl = document.getElementById("calendar");
  const poolEl = document.getElementById("employeesPool");
  const infoEl = document.getElementById("wkInfo");

  function toISO(d) {
    const z = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
  }

  // calcola martedì della settimana corrente (mar-dom)
  function currentWeekStartTuesday() {
    const d = new Date();
    // JS: 0=dom,1=lun,2=mar...
    const dow = d.getDay();
    // vogliamo arrivare a martedì (2)
    const diff = (dow - 2 + 7) % 7;
    const tue = new Date(d);
    tue.setDate(d.getDate() - diff);
    return toISO(tue);
  }

  function keyForCell(day, start, end, skill) {
    return `${day}|${start}|${end}|${skill}`;
  }

  function createChip(name, employee_id, dragPayload) {
    const chip = document.createElement("div");
    chip.textContent = name;
    chip.className = "chip";
    chip.draggable = true;
    chip.dataset.employeeId = employee_id;

    chip.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("application/json", JSON.stringify(dragPayload));
    });

    return chip;
  }

  async function loadEmployeesPool() {
    const emps = await a.employees_list();
    poolEl.innerHTML = "";
    emps.forEach(e => {
      const payload = {
        type: "pool",
        employee_id: e.id,
        name: e.name
      };
      poolEl.appendChild(createChip(e.name, e.id, payload));
    });
  }

  function renderCalendar(resp) {
    const { grid, skills, processed, week_start } = resp;
    infoEl.textContent = processed ? "✅ già elaborata" : "🟡 non elaborata (slot vuoti)";

    // raggruppa per day + slot_label
    const groups = {};
    grid.forEach(cell => {
      const gk = `${cell.day}||${cell.slot_label}||${cell.start}||${cell.end}`;
      groups[gk] = groups[gk] || { day: cell.day, slot_label: cell.slot_label, start: cell.start, end: cell.end, cells: [] };
      groups[gk].cells.push(cell);
    });

    // ordina gruppi (day, poi lunch/dinner)
    const gList = Object.values(groups).sort((a,b) => {
      if (a.day !== b.day) return a.day.localeCompare(b.day);
      return a.start.localeCompare(b.start);
    });

    // table
    const tbl = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th style="min-width:120px;">Giorno</th>
        <th style="min-width:120px;">Fascia</th>
        ${skills.map(s => `<th>${s}</th>`).join("")}
      </tr>
    `;
    tbl.appendChild(thead);

    const tbody = document.createElement("tbody");

    gList.forEach(gr => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${gr.day}</td>
        <td>${gr.slot_label}<div class="small">${gr.start}-${gr.end}</div></td>
      `;

      // per ogni skill colonna
      skills.forEach(skill => {
        const cell = gr.cells.find(c => c.skill === skill);
        const td = document.createElement("td");
        td.className = "dropcell";
        td.dataset.day = gr.day;
        td.dataset.start = gr.start;
        td.dataset.end = gr.end;
        td.dataset.skill = skill;
        td.dataset.weekStart = week_start;

        // drop handling
        td.addEventListener("dragover", (ev) => ev.preventDefault());
        td.addEventListener("drop", async (ev) => {
          ev.preventDefault();
          const data = JSON.parse(ev.dataTransfer.getData("application/json"));

          // target
          const to = { day: td.dataset.day, start: td.dataset.start, end: td.dataset.end, skill: td.dataset.skill };

          try {
            if (data.type === "pool") {
              // assign from pool
              await a.schedule_assign({
                week_start: td.dataset.weekStart,
                day: to.day, start: to.start, end: to.end, skill: to.skill,
                employee_id: data.employee_id
              });
            } else if (data.type === "assigned") {
              // move from another cell
              await a.schedule_move({
                week_start: td.dataset.weekStart,
                from: data.from,
                to
              });
            }

            await reload(); // ricarica calendario da DB (source of truth)
          } catch (err) {
            outEl.textContent = String(err);
          }
        });

        // render assigned chips + placeholders required
        const assigned = (cell.assigned || []);
        const required = cell.required || 0;

        const box = document.createElement("div");
        box.className = "cellbox";

        assigned.forEach(a0 => {
          const payload = {
            type: "assigned",
            from: {
              day: cell.day,
              start: cell.start,
              end: cell.end,
              skill: cell.skill,
              employee_id: a0.employee_id
            }
          };
          const chip = createChip(a0.name, a0.employee_id, payload);

          // doppio click per unassign
          chip.addEventListener("dblclick", async () => {
            await a.schedule_unassign({
              week_start: td.dataset.weekStart,
              day: cell.day, start: cell.start, end: cell.end, skill: cell.skill,
              employee_id: a0.employee_id
            });
            await reload();
          });

          box.appendChild(chip);
        });

        // placeholders per "posti vuoti"
        const missing = Math.max(0, required - assigned.length);
        for (let i=0; i<missing; i++) {
          const ph = document.createElement("div");
          ph.className = "placeholder";
          ph.textContent = "—";
          box.appendChild(ph);
        }

        td.appendChild(box);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    tbl.appendChild(tbody);
    calEl.innerHTML = "";
    calEl.appendChild(tbl);

    outEl.textContent = "";
  }

  async function reload() {
    const week = weekEl.value.trim();
    const res = await a.schedule_get_week(week);
    if (!res.ok) {
      outEl.textContent = JSON.stringify(res, null, 2);
      return;
    }
    renderCalendar(res);
  }

  // buttons
  document.getElementById("btnReload").addEventListener("click", reload);

  document.getElementById("btnGenerate").addEventListener("click", async () => {
    const week = weekEl.value.trim();
    const res = await a.schedule_generate(week);
    outEl.textContent = JSON.stringify(res, null, 2);
    await reload();
  });

  document.getElementById("btnExport").addEventListener("click", async () => {
    const week = weekEl.value.trim();
    const res = await a.schedule_export_excel(week);
    outEl.textContent = JSON.stringify(res, null, 2);
  });

  // init default
  weekEl.value = currentWeekStartTuesday();
  await loadEmployeesPool();
  await reload();
}


// ---- Settings ----
async function initSettings() {
  const a = await api();
  const box = document.getElementById("settingsBox");
  const outEl = document.getElementById("settingsOut");

  const s = await a.settings_get();
  box.value = JSON.stringify(s, null, 2);

  document.getElementById("btnSettingsSave").addEventListener("click", async () => {
    const payload = JSON.parse(box.value);
    const res = await a.settings_save(payload);
    outEl.textContent = JSON.stringify(res, null, 2);
  });
}

// default
loadView("planner");

