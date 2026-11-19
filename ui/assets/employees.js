// =========================================================
// employees.js - Dipendenti (CRUD) + modale Indeterminati
// Obiettivo: pagina Dipendenti NON più vuota + bottoni sempre funzionanti
// Strategia:
//   1) Render immediato da window.employees (se già popolato dal calendario/picker)
//   2) Refresh da DB con loader "che già ti funziona" (loadEmployeesFromDb) se presente
//   3) Fallback su pywebview.api.employees_list() (0 argomenti) o apiCall
// Compatibile PyWebView (script classici, NO import/export)
// =========================================================

(function () {
  const ROLES = ["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"];
  window.employees = window.employees || [];

  function $(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }

  function escapeHtml(s) {
    s = String(s ?? "");
    return s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
  }

  function normalizeUpper(s) { return String(s || "").trim().toUpperCase(); }

  function els() {
    return {
      btnNew: $("btnEmpNew"),
      btnBulkSkill: $("btnEmpBulkSkill"),
      tbody: $("empTbody"),
      panel: q(".employees-page .emp-panel"),
      empSearch: $("empSearch"),

      backdrop: $("empModalBackdrop"),
      title: $("empModalTitle"),
      btnClose: $("empModalClose"),
      btnCancel: $("empModalCancel"),
      btnSave: $("empModalSave"),

      inpName: $("empName"),
      chkPermanent: $("empPermanent"),
      chkMorning: $("empSlotMorning"),
      chkEvening: $("empSlotEvening"),
      selPreferred: $("empPreferredRole"),
      skillsGrid: $("empSkillsGrid"),
      inpAlias: $("empAlias"),
      workDaysGrid: $("empWorkDaysGrid"),
      inpMaxDailyHours: $("empMaxDailyHours"),
      inpWeeklyHours: $("empWeeklyHours"),

      bulkModal: $("empBulkModal"),
      btnBulkClose: $("empBulkClose"),
      btnBulkCancel: $("empBulkCancel"),
      bulkRole: $("empBulkRole"),
      bulkValue: $("empBulkValue"),
      btnBulkApply: $("btnEmpBulkApply"),
    };
  }
  function ensureModalBanner(E) {
    if (!E.backdrop) return null;
    const body = E.backdrop.querySelector(".modal-body");
    if (!body) return null;

    let b = body.querySelector(".emp-modal-banner");
    if (!b) {
      b = document.createElement("div");
      b.className = "emp-modal-banner";
      b.style.padding = "10px 12px";
      b.style.borderRadius = "12px";
      b.style.marginBottom = "10px";
      b.style.fontSize = "13px";
      b.style.opacity = ".92";
      b.style.display = "none";
      body.prepend(b); // in alto nel popup
    }
    return b;
  }

  function showModalBanner(E, msg, kind) {
    const b = ensureModalBanner(E);
    if (!b) return;
    if (!msg) { b.style.display = "none"; b.innerHTML = ""; return; }

    b.style.display = "block";
    if (kind === "error") {
      b.style.background = "rgba(239,68,68,.10)";
      b.style.border = "1px solid rgba(239,68,68,.25)";
    } else {
      b.style.background = "rgba(2,132,199,.08)";
      b.style.border = "1px solid rgba(2,132,199,.18)";
    }
    b.innerHTML = msg;
  }

  function ensureBanner(E) {
    if (!E.panel) return null;
    let b = E.panel.querySelector(".emp-banner");
    if (!b) {
      b = document.createElement("div");
      b.className = "emp-banner";
      b.style.padding = "10px 12px";
      b.style.borderRadius = "12px";
      b.style.marginBottom = "10px";
      b.style.fontSize = "13px";
      b.style.opacity = ".92";
      b.style.display = "none";
      E.panel.prepend(b);
    }
    return b;
  }

  function showBanner(E, msg, kind) {
    const b = ensureBanner(E);
    if (!b) return;
    if (!msg) { b.style.display = "none"; b.innerHTML = ""; return; }

    b.style.display = "block";
    if (kind === "error") {
      b.style.background = "rgba(239,68,68,.10)";
      b.style.border = "1px solid rgba(239,68,68,.25)";
    } else {
      b.style.background = "rgba(2,132,199,.08)";
      b.style.border = "1px solid rgba(2,132,199,.18)";
    }
    b.innerHTML = msg;
  }

  async function waitFor(fn, timeoutMs = 3500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const v = fn();
        if (v) return v;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 60));
    }
    return null;
  }

  // ---- API wrappers ----
  async function listFromDbAdapterIfAny() {
    if (typeof window.loadEmployeesFromDb === "function") {
      try {
        const rows = await window.loadEmployeesFromDb();
        return Array.isArray(rows) ? rows : null;
      } catch (e) {
        console.error("[employees] loadEmployeesFromDb error:", e);
        return null;
      }
    }
    return null;
  }

  async function listFromPywebviewIfAny() {
    const api = await waitFor(() => window.pywebview && window.pywebview.api && window.pywebview.api.employees_list, 12000);
    if (api) {
      return await window.pywebview.api.employees_list();
    }
    return null;
  }

  async function listFromApiCallIfAny() {
    if (typeof window.apiCall === "function") {
      // IMPORTANT: employees_list senza payload
      return await window.apiCall("employees_list");
    }
    return null;
  }

  async function employeesList() {
    const a = await listFromDbAdapterIfAny();
    if (Array.isArray(a) && a.length) return a;

    const b = await listFromPywebviewIfAny();
    if (Array.isArray(b) && b.length) return b;

    const c = await listFromApiCallIfAny();
    if (Array.isArray(c) && c.length) return c;

    // se sono tutti vuoti, torna comunque un array (priorità: a > b > c)
    if (Array.isArray(a)) return a;
    if (Array.isArray(b)) return b;
    if (Array.isArray(c)) return c;

    throw new Error("Nessun canale API disponibile per employees_list.");
  }


  async function employeeCreate(payload) {
    const api = await waitFor(() => window.pywebview && window.pywebview.api && window.pywebview.api.employee_create, 12000);
    if (!api) throw new Error("pywebview.api.employee_create non disponibile.");
    return await window.pywebview.api.employee_create(payload);
  }

  async function employeeUpdate(payload) {
    const api = await waitFor(() => window.pywebview && window.pywebview.api && window.pywebview.api.employee_update, 12000);
    if (!api) throw new Error("pywebview.api.employee_update non disponibile.");
    return await window.pywebview.api.employee_update(payload);
  }

  async function employeeDelete(empId) {
    const api = await waitFor(() => window.pywebview && window.pywebview.api && window.pywebview.api.employee_delete, 12000);
    if (!api) throw new Error("pywebview.api.employee_delete non disponibile.");
    // Api.employee_delete(emp_id:int) => PASSARE INT
    return await window.pywebview.api.employee_delete(Number(empId));
  }
  async function employeesBulkSetSkill(role, value) {
    const api = await waitFor(
      () => window.pywebview && window.pywebview.api && window.pywebview.api.employees_bulk_set_skill,
      12000
    );
    if (!api) throw new Error("pywebview.api.employees_bulk_set_skill non disponibile.");
    return await window.pywebview.api.employees_bulk_set_skill(String(role), Number(value));
  }
  // ---- Skills grid ----
  function renderSkillsGrid(E, skills) {
    const map = skills || {};
    E.skillsGrid.innerHTML = "";
    ROLES.forEach(role => {
      const row = document.createElement("div");
      row.className = "skill-row";

      // default corretto: 0 = ruolo non copribile
      const current = Number(map[role] ?? 0);

      row.innerHTML = `
        <div class="skill-role">${escapeHtml(role)}</div>
        <select class="skill-rank" data-role="${escapeHtml(role)}">
          ${[0,1,2,3,4,5,6,7,8,9,10].map(n =>
                      `<option value="${n}" ${n===current?"selected":""}>${n}</option>`
                    ).join("")}
        </select>
      `;
      E.skillsGrid.appendChild(row);
    });
  }

  function readSkillsFromGrid(E) {
    const out = {};
    E.skillsGrid.querySelectorAll("select[data-role]").forEach(sel => {
      const role = sel.getAttribute("data-role");
      if (role) out[role] = Number(sel.value || 0);
    });
    return out;
  }
  function renderWorkDays(E, workDaysStr) {
      if (!E.workDaysGrid) return;
      const active = new Set(
        (workDaysStr || "").split(",").map(s => s.trim()).filter(Boolean)
      );
      E.workDaysGrid.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.checked = active.has(cb.value);
      });
    }

    function readWorkDays(E) {
      if (!E.workDaysGrid) return "";
      const checked = [];
      E.workDaysGrid.querySelectorAll("input[type=checkbox]").forEach(cb => {
        if (cb.checked) checked.push(cb.value);
      });
      return checked.join(",");
    }

  // ---- Modal CRUD ----
  let _editingId = null;

  function openEmpModal(E, mode, emp) {
    _editingId = (mode === "edit") ? Number(emp.id) : null;
    E.backdrop.style.display = "flex";
    E.title.textContent = (mode === "edit") ? "Modifica dipendente" : "Nuovo dipendente";

    const isNew = (mode === "new");
    E.inpName.value = emp?.name ? String(emp.name) : "";
    E.chkPermanent.checked = !!emp?.is_permanent;
    E.chkMorning.checked = (emp?.slot_morning ?? 1) ? true : false;
    E.chkEvening.checked = (emp?.slot_evening ?? 1) ? true : false;
    E.selPreferred.value = emp?.preferred_role || "";
    E.inpAlias.value = emp?.aliases ? String(emp.aliases) : "";

    // Default nuovo dipendente: skill 5 su tutti i ruoli, giorni Mar-Dom
    const defaultSkills = isNew
      ? Object.fromEntries(ROLES.map(r => [r, 5]))
      : (emp?.skills || {});
    const defaultWorkDays = isNew ? "1,2,3,4,5,6" : (emp?.work_days || "");

    renderSkillsGrid(E, defaultSkills);
    renderWorkDays(E, defaultWorkDays);
    if (E.inpMaxDailyHours) {
      E.inpMaxDailyHours.value = (emp?.max_daily_hours != null) ? String(emp.max_daily_hours) : "";
    }
    if (E.inpWeeklyHours) {
      E.inpWeeklyHours.value = (emp?.weekly_hours_target != null) ? String(emp.weekly_hours_target) : "";
    }
    applyHoursFieldsState(E);
    if (E.chkPermanent && E.chkPermanent.dataset.hoursBound !== "1") {
      E.chkPermanent.dataset.hoursBound = "1";
      E.chkPermanent.addEventListener("change", () => applyHoursFieldsState(E));
    }
    showModalBanner(E, "", "");
    // stato iniziale del modulo: serve a capire se ci sono modifiche non salvate alla chiusura
    E._formSnap = empFormSnapshot(E);
    setTimeout(() => E.inpName?.focus(), 50);
  }

  function empFormSnapshot(E) {
    return [...E.backdrop.querySelectorAll("input, select")]
      .map(el => (el.type === "checkbox" ? el.checked : el.value))
      .join("|");
  }

  /** Chiusura da X, Annulla, clic fuori o Esc: se ci sono modifiche non salvate si chiede conferma. */
  async function requestCloseEmpModal(E) {
    if (E._formSnap !== undefined && empFormSnapshot(E) !== E._formSnap) {
      const ok = await uiConfirm({
        title: "Chiudere senza salvare?",
        message: "Le modifiche alla scheda del dipendente non sono state salvate e andranno perse.",
        confirmText: "Chiudi senza salvare",
        cancelText: "Continua a modificare",
        danger: true,
      });
      if (!ok) return;
    }
    closeEmpModal(E);
  }

  // Predefiniti delle Impostazioni, letti una volta per apertura della pagina Dipendenti
  let _empCfg = null;
  async function loadEmpCfg() {
    const data = await apiCall("app_settings_get");
    _empCfg = data?.values || null;
  }

  /**
   * Coerenza con l'algoritmo:
   * - «Ore max al giorno» vuoto = predefinito delle Impostazioni (turnisti / indeterminati)
   * - «Ore settimanali» non vale per gli indeterminati: per loro conta la finestra «Indeterminati»
   *   (il valore non viene cancellato, solo ignorato finché la persona è indeterminata)
   */
  function applyHoursFieldsState(E) {
    const perm = !!E.chkPermanent?.checked;
    if (E.inpMaxDailyHours && _empCfg) {
      const def = perm ? _empCfg.perm_max_daily_hours : _empCfg.temp_max_daily_hours;
      E.inpMaxDailyHours.placeholder = `Vuoto = ${def} h`;
    }
    if (E.inpWeeklyHours) {
      E.inpWeeklyHours.disabled = perm;
      E.inpWeeklyHours.placeholder = perm ? "Da «Indeterminati»" : "Vuoto = nessun limite";
      E.inpWeeklyHours.title = perm
        ? "Per gli indeterminati valgono le ore della finestra «Indeterminati» della settimana"
        : "";
    }
  }

  function closeEmpModal(E) {
    E.backdrop.style.display = "none";
    E._formSnap = undefined;
    _editingId = null;
  }

  function openBulkModal(E) {
    if (E.bulkModal) E.bulkModal.classList.remove("hidden");
  }

  function closeBulkModal(E) {
    if (E.bulkModal) E.bulkModal.classList.add("hidden");
  }

  // ---- Render table ----
  function formatPermInfo(emp) {
    const days = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
    const d = (emp.perm_day_off === null || emp.perm_day_off === undefined) ? "—" : (days[Number(emp.perm_day_off)] || "—");
    const h = Number(emp.perm_target_hours ?? _empCfg?.perm_weekly_hours ?? 40);
    return `Riposo: ${d} · Ore Settimana: ${h}`;
  }
  function formatSlots(emp) {
    const m = emp.slot_morning ? "Mattina" : null;
    const e = emp.slot_evening ? "Pomeriggio" : null;
    if (m && e) return "Mattina + Pomeriggio";
    if (m) return "Mattina";
    if (e) return "Pomeriggio";
    return "—";
  }


  function renderEmployeesTable(E, list) {
    E.tbody.innerHTML = "";

    if (!list || list.length === 0) {
      const q = (document.getElementById("empSearch")?.value || "").trim();
      E.tbody.innerHTML = q
        ? `<tr><td colspan="5" class="emp-empty"><strong>Nessun dipendente corrisponde a «${escapeHtml(q)}».</strong><br>Controlla il nome o svuota la ricerca.</td></tr>`
        : `<tr><td colspan="5" class="emp-empty"><strong>Ancora nessun dipendente.</strong><br>Aggiungi il primo con «Aggiungi dipendente». Puoi anche importare un CSV: i nomi nuovi si possono creare durante l'import.</td></tr>`;
      return;
    }

    list.forEach((emp, idx) => {
      const tr = document.createElement("tr");

      // avatar iniziali + colore deterministico
      const initials = emp.name.split(" ").slice(0,2).map(w => w[0]?.toUpperCase() || "").join("");
      let h = 0;
      for (let i = 0; i < emp.name.length; i++) h = (h * 31 + emp.name.charCodeAt(i)) & 0xffff;
      const hues = [210, 160, 280, 20, 340, 140, 50, 190];
      const avatarColor = `hsl(${hues[h % hues.length]}, 55%, 48%)`;

      // badge skill: solo ruoli con skill > 0
      const skills = emp.skills || {};
      const skillBadges = ROLES
        .filter(r => (skills[r] ?? 0) > 0)
        .map(r => `<span class="emp-skill-badge">${escapeHtml(r)} <b>${skills[r]}</b></span>`)
        .join("");

      // badge permanente
      const permBadge = emp.is_permanent
        ? `<span class="emp-badge emp-badge--perm">Indeterminato</span>`
        : `<span class="emp-badge emp-badge--temp">Turnista</span>`;

      // slot badge
      const slotText = formatSlots(emp);

      tr.innerHTML = `
        <td class="emp-td-name">
          <div class="emp-row-identity">
            <div class="emp-avatar-sm" style="background:${avatarColor}">${escapeHtml(initials)}</div>
            <div>
              <div class="emp-name-main">${escapeHtml(emp.name)}</div>
              <div class="emp-name-sub">${escapeHtml(slotText)}</div>
            </div>
          </div>
        </td>
        <td>${permBadge}${emp.is_permanent ? `<div class="emp-perm-info">${escapeHtml(formatPermInfo(emp))}</div>` : ""}</td>
        <td>${escapeHtml(emp.preferred_role || "—")}</td>
        <td><div class="emp-skills-wrap">${skillBadges || `<span class="emp-no-skill" data-tip="Senza nessuna skill la persona non viene mai assegnata. Apri «Modifica» e indica almeno un ruolo.">Nessuna skill · mai assegnato</span>`}</div></td>
        <td class="emp-td-actions">
          <button class="btn btn-small emp-btn-edit" data-action="edit" data-id="${emp.id}" aria-label="Modifica ${escapeHtml(emp.name)}">Modifica</button>
          <button class="btn btn-small btn-danger emp-btn-del" data-action="del" data-id="${emp.id}" aria-label="Elimina ${escapeHtml(emp.name)}">Elimina</button>
        </td>
      `;
      E.tbody.appendChild(tr);
    });

    E.tbody.querySelectorAll("button[data-action]").forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute("data-id"));
        const action = btn.getAttribute("data-action");
        const emp = (window.employees || []).find(e => Number(e.id) === id);

        try {
          if (action === "edit") {
            if (!emp) return;
            openEmpModal(E, "edit", emp);
            return;
          }
          if (action === "del") {
            if (!emp) return;
            openDeleteModal(E, emp.id, emp.name);
            return;
          }
        } catch (err) {
          console.error(err);
          showBanner(E, `<b>Errore</b>: ${escapeHtml(err?.message || String(err))}`, "error");
        }
      };
    });
  }

  async function refreshEmployeesUI(E) {
    showBanner(E, "", "");
    const rows = await employeesList();

    const list = (rows || [])
      .map(r => ({ ...r, label: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));

    // --- aggiunta: carica giorno riposo + ore target per la settimana corrente ---
    try {
      if (typeof window.loadPermanentWeekFromDb === "function" &&
          typeof window.weekKeyOf === "function") {

        // currentWeekStart è un `let` globale di app.js: NON è window.currentWeekStart.
        // Prima la settimana selezionata, poi quella dell'ultima modifica indeterminati.
        const curStart = (typeof currentWeekStart !== "undefined") ? currentWeekStart : null;
        const weekKey =
          (curStart ? window.weekKeyOf(curStart) : null) ||
          window._permWeekKey;

        if (!weekKey) throw new Error("Week non disponibile (currentWeekStart non inizializzato).");

        const permRows = await window.loadPermanentWeekFromDb(weekKey);

        const permMap = new Map();
        (permRows || []).forEach(r => {
          permMap.set(Number(r.employee_id), {
            day_off: (r.day_off === null || r.day_off === undefined) ? null : Number(r.day_off),
            target_hours: Number(r.target_hours ?? _empCfg?.perm_weekly_hours ?? 40)
          });
        });

        list.forEach(emp => {
          const p = permMap.get(Number(emp.id));
          emp.perm_day_off = p ? p.day_off : null;
          emp.perm_target_hours = p ? p.target_hours : (_empCfg?.perm_weekly_hours ?? 40);
        });
      }
    } catch (e) {
      console.warn("[employees] perm settings load failed:", e);
      // non bloccare la pagina: se fallisce, mostri solo "Sì"
    }

    window.employees = list;
    renderFiltered(E);
  }

  function renderFiltered(E) {
    const q = (E.empSearch?.value || "").trim().toLowerCase();
    const list = window.employees || [];
    const filtered = q
      ? list.filter(e => e.name.toLowerCase().includes(q))
      : list;
    renderEmployeesTable(E, filtered);
  }

  async function onSave(E) {
    const name = normalizeUpper(E.inpName.value);
    if (!name) {
      showModalBanner(E, "<b>Manca il nome.</b> Inserisci nome e cognome del dipendente.", "error");
      E.inpName.focus();
      return;
    }

    const payload = {
          name,
          aliases: (E.inpAlias.value || "").trim(),
          is_permanent: !!E.chkPermanent.checked,
          preferred_role: E.selPreferred.value || null,
          slot_morning: E.chkMorning.checked ? 1 : 0,
          slot_evening: E.chkEvening.checked ? 1 : 0,
          skills: readSkillsFromGrid(E),
          work_days: readWorkDays(E),
          max_daily_hours: E.inpMaxDailyHours?.value !== "" ? Number(E.inpMaxDailyHours.value) : null,
          weekly_hours_target: E.inpWeeklyHours?.value !== "" ? Number(E.inpWeeklyHours.value) : null,
          };

    if (!payload.slot_morning && !payload.slot_evening) {
      showModalBanner(E, "<b>Scegli almeno una fascia oraria:</b> Mattina o Pomeriggio.", "error");
      return;
    }

    try {
      if (_editingId == null) await employeeCreate(payload);
      else await employeeUpdate({ id: _editingId, ...payload });

      closeEmpModal(E);
      await refreshEmployeesUI(E);
    } catch (err) {
        console.error(err);
        const msg = String(err?.message || err);

        if (msg.toLowerCase().includes("esiste già un dipendente")) {
          showModalBanner(
            E,
            `<b>Nome già esistente.</b><br>
             Esiste già un dipendente con questo nome.<br>
             <span style="opacity:.75">Scegli un nome diverso.</span>`,
            "error"
          );

          E.inpName.focus();
          E.inpName.style.borderColor = "rgba(239,68,68,.55)";
          setTimeout(() => (E.inpName.style.borderColor = ""), 1200);
          return;
        }

        // altri errori: mostrali nel popup
        showModalBanner(E, `<b>Errore</b>: ${escapeHtml(msg)}`, "error");
      }
  }
  async function onBulkApply(E) {
    const role = E.bulkRole?.value || "";
    const value = Number(E.bulkValue?.value ?? 0);

    if (!role) {
      await uiAlert({ message: "Scegli il ruolo da aggiornare." });
      return;
    }

    if (Number.isNaN(value) || value < 0 || value > 10) {
          await uiAlert({ message: "Il valore della skill deve essere compreso tra 0 e 10." });
          return;
        }

        const ok = await uiConfirm({
          title: "Aggiornare la skill di tutti?",
          message: `Tutti i dipendenti avranno skill ${value} nel ruolo «${role}».\nI valori attuali di quel ruolo vengono sostituiti.`,
          confirmText: "Aggiorna tutti",
          danger: true,
        });
        if (!ok) return;

        try {
          const res = await employeesBulkSetSkill(role, value);
          closeBulkModal(E);
          await refreshEmployeesUI(E);
          showBanner(
            E,
            `<b>Aggiornamento completato.</b><br><span style="opacity:.75">Ruolo: ${escapeHtml(role)} · Valore: ${value} · Dipendenti aggiornati: ${Number(res?.updated || 0)}</span>`,
            "info"
          );
        } catch (err) {
          console.error(err);
          showBanner(E, `<b>Errore</b>: ${escapeHtml(err?.message || String(err))}`, "error");
        }
      }
  // ---- init (sempre bind anche se refresh fallisce) ----
  async function initEmployees() {
    const E = els();

    // Se la view non è quella giusta, non fare nulla (ma spiegalo chiaramente)
    if (!E.btnNew || !E.tbody || !E.backdrop){
      console.warn("[employees] elementi mancanti. Attesi ID: btnEmpNew, empTbody, empModalBackdrop");
      return;
    }
    loadEmpCfg();

    // 1) Bind bottoni SEMPRE
    E.btnNew.onclick = () => openEmpModal(E, "new", {});
    const btnPermManage = document.getElementById("btnPermManage");
    if (btnPermManage) {
      btnPermManage.onclick = () => openPermanentModal();
    }

    if (E.btnBulkSkill) {
      E.btnBulkSkill.onclick = () => openBulkModal(E);
    }
    if (E.btnBulkApply) {
      E.btnBulkApply.onclick = async () => { await onBulkApply(E); };
    }
    if (E.btnBulkClose) {
      E.btnBulkClose.onclick = () => closeBulkModal(E);
    }
    if (E.btnBulkCancel) {
      E.btnBulkCancel.onclick = () => closeBulkModal(E);
    }
    if (E.bulkModal) {
      E.bulkModal.onmousedown = (ev) => { if (ev.target === E.bulkModal) closeBulkModal(E); };
    }

    if (E.empSearch) {
      E.empSearch.addEventListener("input", () => renderFiltered(E));
    }

    E.btnClose.onclick = () => requestCloseEmpModal(E);
    E.btnCancel.onclick = () => requestCloseEmpModal(E);
    E.backdrop.onmousedown = (e) => { if (e.target === E.backdrop) requestCloseEmpModal(E); };
    E.btnSave.onclick = async () => { await onSave(E); };

    renderSkillsGrid(E, {});

    // 2) Render immediato da window.employees (così non è mai vuoto)
    renderFiltered(E);

    // 3) Refresh da DB (se fallisce, almeno vedi un errore in pagina)
    try {
      await refreshEmployeesUI(E);
    } catch (err) {
      console.error(err);
      showBanner(
        E,
        `<b>Non riesco a leggere dal DB.</b><br><span style="opacity:.75">${escapeHtml(err?.message || String(err))}</span>`,
        "error"
      );
    }
  }
  async function openDeleteModal(E, id, name) {
    // conseguenze reali, lette dal DB: quanti turni futuri vengono liberati e se c'è storico
    const usage = await apiCall("employee_usage", Number(id)) || {};
    const fut = Number(usage.future_slots || 0);
    const lines = [`«${name}» viene tolto dall'anagrafica.`];
    if (fut > 0) {
      const weeks = Number(usage.future_weeks || 0);
      lines.push(`Ha turni in ${weeks === 1 ? "1 settimana" : `${weeks} settimane`} da questa in avanti (${(fut / 2).toLocaleString("it-IT")} ore): vengono tolti e quelle fasce restano da coprire.`);
    }
    if (Number(usage.past_weeks || 0) > 0) {
      lines.push("Nelle settimane passate i suoi turni restano come storico, con «Ex dipendente» al posto del nome.");
    }
    lines.push("L'operazione non si può annullare.");

    const ok = await uiConfirm({
      title: "Eliminare il dipendente?",
      message: lines.join("\n"),
      confirmText: "Elimina dipendente",
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await employeeDelete(id);
      const freed = Number(res?.freed_slots || 0);
      showToast(freed ? `«${name}» eliminato · ${(freed / 2).toLocaleString("it-IT")} ore di turno liberate` : `«${name}» eliminato`);
    } catch (err) {
      showToast(`Eliminazione non riuscita: ${String(err?.message || err).replace(/^\w*Error:\s*/, "")}`, "err");
    }
    await refreshEmployeesUI(E);
    await loadEmployeesFromDb();
  }

  window.initEmployees = initEmployees;
})();


// =========================================================
// MODAL: INDETERMINATI SETTIMANA (lasciato COME NEL TUO FILE)
// =========================================================
function openPermanentModal(){
  const weekKey = weekKeyOf(currentWeekStart);
  window._permWeekKey = weekKey;
  closeModal();

  const permanents = (window.employees || [])
    .filter(e => !!e.is_permanent)
    .sort((a, b) => a.label.localeCompare(b.label, "it"));
  const DAY_NAMES = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });

  const modal = document.createElement("div");
  modal.className = "modal perm-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "permModalTitle");
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title" id="permModalTitle">Indeterminati della settimana</div>
        <div class="perm-sub">Settimana ${uiEscape(weekRangeText(currentWeekStart))} · quella aperta in Home</div>
      </div>
      <button type="button" class="modal-close" aria-label="Chiudi">✕</button>
    </div>
    <div class="modal-body">
      <p class="perm-hint">
        Il <strong>giorno di riposo</strong> esclude la persona da quel giorno.
        Le <strong>ore settimanali</strong> sono il massimo che l'algoritmo può assegnarle (0–80; 0 = nessuna ora, es. ferie;
        vuoto = <span class="perm-def-hours">40</span>, il predefinito delle Impostazioni).
        Valgono per la generazione dei turni di questa settimana.
      </p>
      <div class="perm-list" id="permList"><div class="perm-state">Caricamento…</div></div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn btn-ghost" data-act="close">Chiudi</button>
      <button type="button" class="btn primary" data-act="save" disabled>Salva</button>
    </div>`;

  const list = modal.querySelector("#permList");
  const btnSave = modal.querySelector('[data-act="save"]');
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.querySelector('[data-act="close"]').addEventListener("click", closeModal);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  activeModalEl = overlay;
  _escKeyHandler = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", _escKeyHandler);

  if (!permanents.length) {
    list.innerHTML = `
      <div class="perm-state">
        <strong>Nessun dipendente a tempo indeterminato.</strong><br>
        Apri la scheda di un dipendente con «Modifica» e attiva «Tempo indeterminato».
      </div>`;
    btnSave.remove();
    return;
  }

  let defHours = 40;
  (async () => {
    // ore predefinite dalle Impostazioni (stesso valore usato dall'algoritmo)
    const cfg = await apiCall("app_settings_get");
    defHours = Number(cfg?.values?.perm_weekly_hours ?? 40);
    modal.querySelectorAll(".perm-def-hours").forEach(el => { el.textContent = `${defHours} ore`; });
    const rows = await apiCall("permanent_week_get", weekKey);
    if (!Array.isArray(rows)) {
      // lettura fallita: NON si offre il salvataggio, che sostituirebbe i dati con valori vuoti
      list.innerHTML = `<div class="perm-state perm-state--err">Impossibile leggere le impostazioni salvate. Chiudi e riprova.</div>`;
      return;
    }
    const map = new Map(rows.map(r => [String(r.employee_id), r]));

    list.innerHTML = "";
    permanents.forEach(emp => {
      const saved = map.get(String(emp.id));
      const row = document.createElement("div");
      row.className = "perm-row";
      row.innerHTML = `
        <div class="perm-name">${uiEscape(emp.label)}</div>
        <label class="perm-field">
          <span>Riposo</span>
          <select data-emp="${emp.id}" aria-label="Giorno di riposo di ${uiEscape(emp.label)}">
            <option value="">Nessuno</option>
            ${DAY_NAMES.map((d, i) => `<option value="${i}">${d}</option>`).join("")}
          </select>
        </label>
        <label class="perm-field">
          <span>Ore settimanali</span>
          <input type="number" min="0" max="80" step="1" inputmode="numeric"
                 aria-label="Ore settimanali di ${uiEscape(emp.label)}" placeholder="${defHours}">
        </label>`;
      const sel = row.querySelector("select");
      sel.value = (saved?.day_off === null || saved?.day_off === undefined) ? "" : String(saved.day_off);
      row.querySelector("input").value = String(Number(saved?.target_hours ?? defHours));
      list.appendChild(row);
    });
    btnSave.disabled = false; // si salva solo dopo aver caricato i valori esistenti
  })();

  btnSave.addEventListener("click", async () => {
    const items = [...list.querySelectorAll(".perm-row")].map(row => {
      const sel = row.querySelector("select");
      const inp = row.querySelector("input");
      // ore settimanali: intero tra 0 e 80, vuoto = 40
      const raw = inp.value === "" ? defHours : Math.round(Number(inp.value));
      return {
        employee_id: Number(sel.dataset.emp),
        day_off: sel.value === "" ? null : Number(sel.value),
        target_hours: Number.isFinite(raw) ? Math.min(80, Math.max(0, raw)) : defHours,
      };
    });
    btnSave.disabled = true;
    btnSave.classList.add("is-busy");
    try {
      await savePermanentWeekToDb(weekKey, items);
    } catch (err) {
      showToast(err.message, "err");
      btnSave.disabled = false;
      btnSave.classList.remove("is-busy");
      return;
    }
    closeModal();
    showToast("Riposi e ore degli indeterminati salvati");
    if (document.querySelector(".employees-page")) window.initEmployees?.();
  });
}

