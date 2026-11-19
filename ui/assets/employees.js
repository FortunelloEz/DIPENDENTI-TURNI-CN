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
    showModalBanner(E, "", "");

  }

  function closeEmpModal(E) {
    E.backdrop.style.display = "none";
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
    const h = Number(emp.perm_target_hours ?? 40);
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

  function formatSkills(emp) {
    const s = emp.skills || {};
    const parts = ROLES.filter(r => s[r] != null).map(r => `${r}:${Number(s[r])}`);
    return parts.length ? parts.join(" • ") : "—";
  }

  function renderEmployeesTable(E, list) {
    E.tbody.innerHTML = "";

    if (!list || list.length === 0) {
      E.tbody.innerHTML = `<tr><td colspan="5" style="opacity:.70;padding:14px">Nessun dipendente trovato.</td></tr>`;
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
        <td><div class="emp-skills-wrap">${skillBadges || '<span style="opacity:.4">—</span>'}</div></td>
        <td class="emp-td-actions">
          <button class="btn emp-btn-edit" data-action="edit" data-id="${emp.id}" title="Modifica">✎ Modifica</button>
          <button class="btn emp-btn-del" data-action="del" data-id="${emp.id}" title="Elimina">Elimina</button>
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
            target_hours: Number(r.target_hours ?? 40)
          });
        });

        list.forEach(emp => {
          const p = permMap.get(Number(emp.id));
          emp.perm_day_off = p ? p.day_off : null;
          emp.perm_target_hours = p ? p.target_hours : 40;
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
    if (!name) return alert("Inserisci il nome del dipendente.");

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
      return alert("Seleziona almeno uno slot: Mattina o Pomeriggio.");
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
      alert("Seleziona un ruolo.");
      return;
    }

    if (Number.isNaN(value) || value < 0 || value > 10) {
          alert("Seleziona un valore valido tra 0 e 10.");
          return;
        }

        const ok = window.confirm(
          `Impostare ${value} su tutti i dipendenti per il ruolo "${role}"?\n\nQuesta operazione sovrascrive i valori esistenti.`
        );
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

    E.btnClose.onclick = () => closeEmpModal(E);
    E.btnCancel.onclick = () => closeEmpModal(E);
    E.backdrop.onmousedown = (e) => { if (e.target === E.backdrop) closeEmpModal(E); };
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
  function openDeleteModal(E, id, name) {
    const modal = document.getElementById("empDeleteModal");
    const text = document.getElementById("empDeleteText");
    const confirmBtn = document.getElementById("empDeleteConfirm");

    text.textContent = `Eliminare '${name}'?`;
    modal.classList.remove("hidden");

    const close = () => {
      modal.classList.add("hidden");
      confirmBtn.onclick = null;
    };

    document.getElementById("empDeleteCancel").onclick = close;
    document.getElementById("empDeleteClose").onclick = close;

    confirmBtn.onclick = async () => {
      try {
        await employeeDelete(id);
        await refreshEmployeesUI(E);
      } catch (err) {
        console.error(err);
        showBanner(E, `<b>Errore</b>: ${escapeHtml(err?.message || String(err))}`, "error");
      }
      close();
    };
  }
  // ---------------------------------------------------------
  // Bridge per import CSV: apri modal "Nuovo dipendente" e precompila nome.
  // Ritorna una Promise che si risolve quando il dipendente viene salvato.
  // ---------------------------------------------------------
  window.openEmployeeCreateModal = async function openEmployeeCreateModal(prefillName) {
    // assicurati che la view employees sia caricata, altrimenti initEmployees non trova i DOM id
    // NB: il modal esiste dentro employees.html, quindi deve essere nel DOM.
    const E = els();
    if (!E.backdrop || !E.inpName || !E.btnSave) {
      throw new Error("Modal dipendente non presente nel DOM. Apri la view 'Dipendenti' almeno una volta o includi il modal nella home.");
    }

    // Apri modal nuovo e precompila nome
    openEmpModal(E, "new", {});
    E.inpName.value = String(prefillName || "");

    // Ritorno promise risolta quando salvi con successo
    return new Promise((resolve, reject) => {
      const oldOnclick = E.btnSave.onclick;

      E.btnSave.onclick = async () => {
        try {
          await onSave(E);   // usa la tua logica esistente
          // se onSave va a buon fine chiude modal e refresha
          // ripristina handler
          E.btnSave.onclick = oldOnclick;
          resolve(true);
        } catch (err) {
          // onSave già mostra banner; qui non interrompiamo il flusso
          console.error(err);
          // non reject per non rompere l’esperienza; resti nel modal
        }
      };

      // se chiude il modal senza salvare, consideriamo annullato
      const oldClose = E.btnClose.onclick;
      E.btnClose.onclick = () => {
        E.btnClose.onclick = oldClose;
        E.btnSave.onclick = oldOnclick;
        closeEmpModal(E);
        reject(new Error("Creazione utente annullata."));
      };
    });
  };

  window.initEmployees = initEmployees;
})();


// =========================================================
// MODAL: INDETERMINATI SETTIMANA (lasciato COME NEL TUO FILE)
// =========================================================
function openPermanentModal(){
  const weekKey = weekKeyOf(currentWeekStart);
  window._permWeekKey = weekKey;
  closeModal();

  const permanents = (window.employees || []).filter(e => !!e.is_permanent);

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
  info.textContent = "Imposta giorni di riposo.";
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
    window._permWeekKey = weekKey;
    if (document.querySelector(".employees-page")) {
      // se sei nei dipendenti, refresh immediato
      window.initEmployees?.(); // oppure chiama direttamente refreshEmployeesUI se lo esponi
    }
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

