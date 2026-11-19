// =========================
// Turni CN - DB ADAPTER (pywebview bridge + load/save)
// Deve essere caricato PRIMA di app.js.
// =========================

/* ---------- Safe bridge helpers ----------
   apiCall: LETTURE. Se qualcosa va storto restituisce null (la UI mostra lo stato vuoto).
   Le SCRITTURE usano apiWrite (ui_kit.js), che lancia un errore leggibile. */
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
  console.log(`[DB] loadWeekFromDb -> ${weekKey}`);

  const [ovs, sq, avail] = await Promise.all([
    apiCall("overrides_get_week", weekKey),
    apiCall("squads_get_week", weekKey),
    apiCall("availability_get", weekKey),
  ]);

  Array.from(assignments.keys()).forEach(k => { if (k.startsWith(weekKey + "|")) assignments.delete(k); });

  let loaded = 0;
  if (Array.isArray(ovs)){
    ovs.forEach(o => {
      const d = Number(o.day_index ?? o.dayIndex);
      const role = o.role;
      const t = o.time_label ?? o.timeLabel;
      const ids = Array.isArray(o.employee_ids) ? o.employee_ids : (o.employeeIds || []);
      setAssignedIdsFor(weekKey, d, role, t, ids);
      loaded++;
    });
  }
  console.log(`[DB] loadWeekFromDb ← ${weekKey}: ${loaded} slot caricati`);

  if (sq && typeof sq === "object"){
    const base = {};
    DAYS.forEach((_, i) => base[i] = defaultSquadDay());
    Object.keys(sq).forEach(dayKey => {
      base[Number(dayKey)] = sq[dayKey] || defaultSquadDay();
    });
    squads.set(weekKey, base);
  }

  if (avail?.ok && avail.data) {
    try { window._lastAvailabilityPreview = JSON.parse(avail.data); } catch (_) {}
  }

  recalcSegmentsFromAssignments(weekKey);
}

/* ---------- Overrides SAVE helpers ---------- */
async function clearWeekOverridesOnDb(weekKey){
  await apiWrite("overrides_clear_week", weekKey);
}

/* ---------- Squads SAVE ---------- */
async function saveSquadsToDb(weekKey, data){
  const payload = {};
  DAYS.forEach((_, dayIndex) => {
    payload[String(dayIndex)] = data?.[dayIndex] || defaultSquadDay();
  });
  await apiWrite("squads_set_week", weekKey, payload);
}

/* ---------- Permanent week ---------- */
async function loadPermanentWeekFromDb(weekKey){
  return await apiCall("permanent_week_get", weekKey) || [];
}
async function savePermanentWeekToDb(weekKey, items){
  await apiWrite("permanent_week_set", weekKey, items || []);
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
async function squadsTemplateList(){
  return await apiCall("squads_template_list");
}

async function squadsTemplateSave(name, payload){
  return await apiWrite("squads_template_save", name, payload);
}

async function squadsTemplateGet(name){
  return await apiCall("squads_template_get", name);
}

/* ---------- Imported Files ---------- */
async function importedFilesList(){
  return await apiCall("imported_files_list") || [];
}

async function importedFilesAdd(filename, filePath, weekKey){
  return await apiWrite("imported_files_add", filename, filePath, weekKey);
}
async function importedFilesGetContent(fileId){
  return await apiCall("imported_files_get_content", fileId);
}
async function importedFilesDelete(fileId){
  return await apiWrite("imported_files_delete", fileId);
}

async function importedFilesClear(){
  return await apiWrite("imported_files_clear");
}