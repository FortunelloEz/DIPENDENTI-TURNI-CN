// =========================
// Turni CN — REPORT PAGE (redesigned)
// Deps: app.js (DAYS, ROLES, ROLE_SHORT, roleCss, weekKeyOf, formatDate,
//        getMondayOfCurrentWeek), db_adapter.js (apiCall)
// =========================

const RPT_HIST_WEEKS = 8;

window.initReportPage = async function initReportPage() {
  const bodyEl = document.getElementById("rptBody");
  if (!bodyEl) return;
  bodyEl.innerHTML = `<div class="rpt-loading-state">Caricamento...</div>`;

  // Settimana prossima (lunedì di questa sett. + 7)
  const today   = new Date();
  const nextMon = new Date(getMondayOfCurrentWeek(today));
  nextMon.setDate(nextMon.getDate() + 7);
  const nextWeekEnd = new Date(nextMon);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
  const nextWeekKey = weekKeyOf(nextMon);

  // Ultime N settimane (inclusa la corrente)
  const currMon = getMondayOfCurrentWeek(today);
  const histWeekKeys = [];
  for (let i = RPT_HIST_WEEKS - 1; i >= 0; i--) {
    const d = new Date(currMon);
    d.setDate(d.getDate() - i * 7);
    histWeekKeys.push(weekKeyOf(d));
  }

  // Lista dipendenti (usa cache globale se disponibile)
  const empList = (typeof employees !== "undefined" && Array.isArray(employees) && employees.length > 0)
    ? employees.map(e => ({ id: e.id, name: e.label || e.name, is_permanent: e.is_permanent }))
    : (await apiCall("employees_list") || []);

  // Carica in parallelo: settimana prossima + storico
  const [nextOvRaw, ...histResults] = await Promise.all([
    apiCall("overrides_get_week", nextWeekKey),
    ...histWeekKeys.map(wk => apiCall("overrides_get_week", wk)),
  ]);

  // dayOvMap settimana prossima
  const nextDayOvMap = {};
  (nextOvRaw || []).forEach(ov => {
    if (!nextDayOvMap[ov.day_index]) nextDayOvMap[ov.day_index] = [];
    nextDayOvMap[ov.day_index].push(ov);
  });

  // Turni sett. prossima per dipendente
  const empNextShifts = {};
  empList.forEach(e => {
    empNextShifts[String(e.id)] = _rptBuildTurni(e.id, nextDayOvMap);
  });

  // Aggregazione storico: slot totali + conteggio ruoli
  const empTotalSlots = {};
  const empRoleCount  = {};
  empList.forEach(e => {
    empTotalSlots[String(e.id)] = 0;
    empRoleCount[String(e.id)]  = {};
  });

  histResults.forEach(ovRaw => {
    (ovRaw || []).forEach(ov => {
      (ov.employee_ids || []).forEach(id => {
        const k = String(id);
        if (empTotalSlots[k] === undefined) return;
        empTotalSlots[k]++;
        empRoleCount[k][ov.role] = (empRoleCount[k][ov.role] || 0) + 1;
      });
    });
  });

  // Media ore / settimana
  const empAvgHours = {};
  empList.forEach(e => {
    empAvgHours[String(e.id)] = (empTotalSlots[String(e.id)] * 0.5) / RPT_HIST_WEEKS;
  });

  // Ordina: prima chi lavora sett. prossima, poi per media ore decrescente
  const sorted = empList.slice().sort((a, b) => {
    const ak = String(a.id), bk = String(b.id);
    const aNext = (empNextShifts[ak]?.length > 0) ? 1 : 0;
    const bNext = (empNextShifts[bk]?.length > 0) ? 1 : 0;
    if (aNext !== bNext) return bNext - aNext;
    return (empAvgHours[bk] || 0) - (empAvgHours[ak] || 0);
  });

  // Render
  bodyEl.innerHTML = "";

  const nextLabel = `${formatDate(nextMon)} → ${formatDate(nextWeekEnd)}`;

  const listHeader = document.createElement("div");
  listHeader.className = "rpt-list-header";
  listHeader.innerHTML = `
    <span class="rpt-list-title">Dipendenti</span>
    <span class="rpt-list-subtitle">Sett. prossima: <strong>${nextLabel}</strong></span>
  `;
  bodyEl.appendChild(listHeader);

  sorted.forEach(emp => {
    const k          = String(emp.id);
    const nextShifts = empNextShifts[k] || [];
    const avgH       = empAvgHours[k] || 0;
    const topRoles   = _rptTopRoles(empRoleCount[k] || {});
    const hasNext    = nextShifts.length > 0;

    const card = document.createElement("div");
    card.className = "rpt-emp-card";
    card.dataset.name = (emp.name || "").toLowerCase();
    card.innerHTML = `
      <div class="rpt-emp-card-header">
        <div class="rpt-emp-card-left">
          <span class="rpt-emp-initial">${(emp.name || "?")[0].toUpperCase()}</span>
          <div class="rpt-emp-info">
            <span class="rpt-emp-name">${emp.name}</span>
            <div class="rpt-emp-tags">
              ${emp.is_permanent ? '<span class="rpt-perm-badge">Ind.</span>' : ""}
              ${hasNext ? '<span class="rpt-next-badge">Lavora sett. prossima</span>' : ""}
            </div>
          </div>
        </div>
        <div class="rpt-emp-card-right">
          ${avgH > 0
            ? `<span class="rpt-avg-hours">${avgH.toFixed(1)}<span class="rpt-avg-unit">h/sett.</span></span>`
            : `<span class="rpt-avg-hours rpt-avg-zero">—</span>`}
          <button class="rpt-expand-btn">▶</button>
        </div>
      </div>
      <div class="rpt-emp-card-body" style="display:none">
        <div class="rpt-detail-section">
          <div class="rpt-detail-section-title">📅 Settimana prossima (${nextLabel})</div>
          <div class="rpt-next-shifts">
            ${hasNext
              ? nextShifts.map(t => `
                  <div class="rpt-turno-item">
                    <span class="rpt-turno-day">${DAYS[t.dayIndex]}</span>
                    <span class="rpt-turno-icon">${t.shift === "morning" ? "☀️" : "🌙"}</span>
                    <span class="sm-role-badge sm-badge-${roleCss(t.role)}">${ROLE_SHORT[t.role] || t.role}</span>
                    <span class="rpt-turno-range">${t.range}</span>
                  </div>`).join("")
              : `<div class="rpt-no-turni">Nessun turno assegnato</div>`}
          </div>
        </div>
        <div class="rpt-detail-section">
          <div class="rpt-detail-section-title">📊 Storico ultime ${RPT_HIST_WEEKS} settimane</div>
          <div class="rpt-storico-summary">
            <div class="rpt-storico-stat">
              <span class="rpt-storico-stat-val">${avgH > 0 ? avgH.toFixed(1) + "h" : "—"}</span>
              <span class="rpt-storico-stat-label">media / settimana</span>
            </div>
            <div class="rpt-storico-roles">
              ${topRoles.length > 0
                ? topRoles.map(r => `<span class="sm-role-badge sm-badge-${roleCss(r)}">${r}</span>`).join("")
                : `<span class="rpt-no-turni">Nessun dato</span>`}
            </div>
          </div>
        </div>
      </div>
    `;

    const header = card.querySelector(".rpt-emp-card-header");
    const body   = card.querySelector(".rpt-emp-card-body");
    const btn    = card.querySelector(".rpt-expand-btn");
    let open = false;

    header.addEventListener("click", () => {
      open = !open;
      body.style.display = open ? "block" : "none";
      btn.textContent = open ? "▼" : "▶";
      card.classList.toggle("expanded", open);
    });

    bodyEl.appendChild(card);
  });

  // Ricerca dipendente
  const searchEl = document.getElementById("rptSearch");
  if (searchEl) {
    searchEl.value = "";
    searchEl.oninput = () => {
      const q = searchEl.value.trim().toLowerCase();
      document.querySelectorAll(".rpt-emp-card").forEach(c => {
        c.style.display = (!q || c.dataset.name.includes(q)) ? "" : "none";
      });
    };
  }
};

// =============================================
// UTILITY
// =============================================

function _rptBuildTurni(empId, dayOvMap) {
  const empStr = String(empId);
  const turni  = [];

  for (let di = 0; di < 7; di++) {
    const shiftRoleLabels = {};

    (dayOvMap[di] || []).forEach(ov => {
      if (!(ov.employee_ids || []).map(String).includes(empStr)) return;
      const h     = parseInt(ov.time_label.split(":")[0]);
      const shift = h < 16 ? "morning" : "evening";
      const key   = `${shift}|${ov.role}`;
      if (!shiftRoleLabels[key]) shiftRoleLabels[key] = [];
      shiftRoleLabels[key].push(ov.time_label);
    });

    Object.entries(shiftRoleLabels).forEach(([key, labels]) => {
      const [shift, role] = key.split("|");
      const sorted  = labels.slice().sort();
      const startH  = parseInt(sorted[0].split(":")[0]);
      const lastLbl = sorted[sorted.length - 1];
      const endH    = parseInt(lastLbl.split(":")[0]) + 1;
      const range   = endH >= 24 ? `${startH}–ch` : `${startH}–${endH}`;
      turni.push({ dayIndex: di, shift, role, range });
    });
  }

  turni.sort((a, b) => a.dayIndex - b.dayIndex || (a.shift === "morning" ? -1 : 1));
  return turni;
}

function _rptTopRoles(roleCount) {
  return Object.entries(roleCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([role]) => role);
}
