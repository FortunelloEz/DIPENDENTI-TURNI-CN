// =========================
// Turni CN - DB ADAPTER (pywebview bridge + load/save)
// File "db": solo pywebview bridge + persistenza.
// Deve essere caricato PRIMA di app_core.js.
// =========================

/* ---------- Safe bridge helpers ---------- */
function hasApi(){
  return !!(window.pywebview && window.pywebview.api);
}
async function apiCall(method, ...args){
  try{
    if (!hasApi() || typeof window.pywebview.api[method] !== "function") return null;
    return await window.pywebview.api[method](...args);
  } catch (e){
    console.error(`[DB] api.${method} failed`, e);
    return null;
  }
}

/* ---------- Employees ---------- */
// Popola la variabile globale `employees` (definita in app_core.js)
async function loadEmployeesFromDb(){
  const rows = await apiCall("employees_list");
  if (!rows) { employees = []; return; }

  employees = rows.map(r => ({
    id: r.id,
    label: r.name,
    is_permanent: !!r.is_permanent,
    preferred_role: r.preferred_role || "",
    skills: r.skills || {}
  }));
}

/* ---------- Week: overrides + squads ---------- */
async function loadWeekFromDb(weekKey){
  // OVERRIDES: lista di righe (day_index, role, time_label, employee_ids[])
  const ovs = await apiCall("overrides_get_week", weekKey);

  // pulisco week corrente in memoria
  Array.from(assignments.keys()).forEach(k => { if (k.startsWith(weekKey + "|")) assignments.delete(k); });

  if (Array.isArray(ovs)){
    ovs.forEach(o => {
      const d = Number(o.day_index ?? o.dayIndex);
      const role = o.role;
      const t = o.time_label ?? o.timeLabel;
      const ids = Array.isArray(o.employee_ids) ? o.employee_ids : (o.employeeIds || []);
      setAssignedIdsFor(weekKey, d, role, t, ids);
    });
  }

  // SQUADS: dict {"0":{morning:{},evening:{}}, ...}
  const sq = await apiCall("squads_get_week", weekKey);
  if (sq && typeof sq === "object"){
    const base = {};
    DAYS.forEach((_, i) => base[i] = defaultSquadDay());

    Object.keys(sq).forEach(dayKey => {
      const d = Number(dayKey);
      base[d] = sq[dayKey] || defaultSquadDay();
    });

    squads.set(weekKey, base);
  }

  recalcSegmentsFromAssignments(weekKey);
}

/* ---------- Overrides SAVE helpers ---------- */
// Salva 1 slot (mezz'ora) al DB: usa overrides_set_many con un item.
async function saveSlotOverrideToDb(weekKey, dayIndex, role, timeLabel, ids){
  const items = [{ time_label: timeLabel, employee_ids: ids || [] }];
  await apiCall("overrides_set_many", weekKey, dayIndex, role, items);
}

// Utile se vuoi “salva tutto day+role” in futuro (non usato ora).
async function saveDayRoleOverridesToDb(weekKey, dayIndex, role){
  const items = [];
  HALF_HOURS.forEach(t => {
    if (timeToMin(t) < 8*60 || timeToMin(t) >= 24*60) return;
    items.push({ time_label: t, employee_ids: getAssignedIdsFor(weekKey, dayIndex, role, t) });
  });
  await apiCall("overrides_set_many", weekKey, dayIndex, role, items);
}

async function clearWeekOverridesOnDb(weekKey){
  await apiCall("overrides_clear_week", weekKey);
}

/* ---------- Squads SAVE ---------- */
async function saveSquadsToDb(weekKey, data){
  const payload = {};
  DAYS.forEach((_, dayIndex) => {
    payload[String(dayIndex)] = data?.[dayIndex] || defaultSquadDay();
  });
  await apiCall("squads_set_week", weekKey, payload);
}

/* ---------- Permanent week ---------- */
async function loadPermanentWeekFromDb(weekKey){
  return await apiCall("permanent_week_get", weekKey) || [];
}
async function savePermanentWeekToDb(weekKey, items){
  await apiCall("permanent_week_set", weekKey, items || []);
}
async function loadSquadsFromDb(weekKey){
  const sq = await apiCall("squads_get_week", weekKey);
  const base = {};
  DAYS.forEach((_, i) => base[i] = defaultSquadDay());

  if (sq && typeof sq === "object"){
    Object.keys(sq).forEach(dayKey => {
      const d = Number(dayKey);
      base[d] = sq[dayKey] || defaultSquadDay();
    });
  }

  squads.set(weekKey, base);
}