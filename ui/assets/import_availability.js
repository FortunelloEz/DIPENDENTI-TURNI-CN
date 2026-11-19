// ui/assets/import_availability.js
// Import CSV disponibilità: scelta file, risoluzione nomi/celle, generazione turni,
// aggiornamento calendario e lista dei file caricati.

/* ---------- date leggibili ---------- */
/** "2026-05-25" (lunedì) -> "25/05 → 31/05" */
function _csvWeekText(weekKey) {
  if (!weekKey || typeof mondayDateFromWeekKey !== "function") return weekKey || "";
  return weekRangeText(mondayDateFromWeekKey(weekKey));
}
/** SQLite datetime('now') è in UTC ("2026-05-24 11:40:12"): lo mostro in ora locale. */
function _csvLocalDateTime(utcText) {
  if (!utcText) return "";
  const d = new Date(String(utcText).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- stato "import in corso" ---------- */
let _importBusy = false;
function _setImportBusy(busy) {
  _importBusy = busy;
  ["btnImportAvailability", "btnElaboraSelectedFile"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.toggle("is-busy", busy);
    if (busy) b.disabled = true;
    else if (id === "btnImportAvailability") b.disabled = false;
    else b.disabled = !window._selectedCsvFile;
  });
  document.getElementById("timelineWrap")?.classList.toggle("is-loading", busy);
}

// ── Bottone "Importa CSV": apre il selettore file di Windows, legge il file, avvia l'import ──
window.bindImportAvailability = function bindImportAvailability() {
  const btn = document.getElementById("btnImportAvailability");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
    if (_importBusy) return;
    const picked = await apiCall("imported_files_open_dialog");
    if (!picked || !picked.ok) return; // annullato dall'utente

    const content = await apiCall("imported_files_read_path", picked.path);
    if (!content?.ok) {
      await uiAlert({ kind: "error", title: "File non leggibile", message: content?.error || "Il file scelto non si può leggere." });
      return;
    }
    await _runImport(content.csv_text, picked.filename, picked.path, null);
  });
};

// ── Bottone "Elabora file selezionato": rilegge il file già in lista, senza selettore ──
window.bindElaboraSelectedFile = function bindElaboraSelectedFile() {
  const btn = document.getElementById("btnElaboraSelectedFile");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
    if (_importBusy) return;
    const selected = window._selectedCsvFile;
    if (!selected) {
      await uiAlert({ message: "Seleziona prima un file dalla lista «File CSV caricati»." });
      return;
    }
    const content = await apiCall("imported_files_get_content", selected.id);
    if (!content?.ok) {
      await uiAlert({
        kind: "error",
        title: "File non trovato",
        message: `${content?.error || "Il file non è più nella posizione in cui era stato importato."}\nSe è stato spostato, importalo di nuovo con «Importa CSV».`,
      });
      return;
    }
    await _runImport(content.csv_text, selected.filename, null, selected.week_key);
  });
};

// ── Funzione centrale di import — usata da entrambi i bottoni ──
async function _runImport(csvText, filename, filePath, forceWeekKey) {
  if (_importBusy) return;
  const api = window.pywebview?.api;
  if (!api) {
    await uiAlert({ kind: "error", message: "L'app non è ancora pronta. Riprova tra qualche secondo." });
    return;
  }
  const weekKey = forceWeekKey || weekKeyOf(currentWeekStart);

  // 0) L'import rigenera la settimana del CSV e SOSTITUISCE i turni salvati, anche quelli fatti a mano.
  try {
    const targetWeek = (await api.import_detect_week(weekKey, csvText)) || weekKey;
    const existing = await api.overrides_get_week(targetWeek);
    if (Array.isArray(existing) && existing.length > 0) {
      const ok = await uiConfirm({
        title: "Rigenerare i turni?",
        message: `La settimana ${_csvWeekText(targetWeek)} ha già dei turni salvati.\nL'import li rigenera e sostituisce anche le modifiche fatte a mano.`,
        confirmText: "Rigenera turni",
        danger: true,
      });
      if (!ok) return;
    }
  } catch (e) {
    console.warn("[Import] controllo turni esistenti non riuscito:", e);
  }

  _setImportBusy(true);
  try {
    let resolutions = null;
    let customResolutions = null;

    // 1) Prima chiamata
    let res = await api.import_availability_and_autofill(weekKey, csvText, null, null);

    // 2) Nomi sconosciuti → collega o crea dipendenti
    if (res && res.needs_resolution) {
      _setImportBusy(false);
      resolutions = await window.resolveUnknownUsersModal(res.unknown || [], res.employees || []);
      if (!resolutions) return;
      _setImportBusy(true);
      res = await api.import_availability_and_autofill(weekKey, csvText, resolutions, null);
    }

    // 3) Celle non interpretabili → orario scelto dall'utente
    if (res && res.needs_custom_slot_resolution) {
      _setImportBusy(false);
      customResolutions = await window.resolveCustomSlotsModal(res.custom_cells || []);
      if (!customResolutions) return;
      _setImportBusy(true);
      res = await api.import_availability_and_autofill(weekKey, csvText, resolutions, customResolutions);
    }

    if (!res || !res.ok) throw new Error(res?.error || "Il file non è stato elaborato.");

    const wk = res.week_key_used || weekKey;
    if (res.availability_preview) {
      window._lastAvailabilityPreview = res.availability_preview;
      try {
        await apiWrite("availability_save", wk, JSON.stringify(res.availability_preview));
      } catch (err) {
        // i turni sono salvati; manca solo l'anteprima disponibilità alla prossima apertura
        showToast("Turni salvati, ma l'anteprima disponibilità non è stata memorizzata", "err");
      }
    }

    currentWeekStart = mondayDateFromWeekKey(wk);
    window.currentWeekKey = wk;
    try { localStorage.setItem("lastWeekKey", wk); } catch (_) {}
    apiCall("settings_set", "lastWeekKey", wk);

    // Metadati in lista solo per un file nuovo (per una rielaborazione il record c'è già)
    if (filePath) {
      try { await importedFilesAdd(filename, filePath, wk); }
      catch (err) { showToast("Turni generati, ma il file non è stato aggiunto alla lista", "err"); }
    }

    await loadWeekFromDb(wk);
    recalcSegmentsFromAssignments(wk);
    renderEmployees();
    renderWeekLabel();
    renderCalendar();
    window.assistantRefresh?.();
    window.bindAvailabilityViewer?.();
    await window.renderCsvFilePanel?.();
    await renderDaySummary?.();

    // scoperti calcolati sul risultato finale (stessa regola dei pallini del calendario)
    const gaps = Array.isArray(res.deficits) ? res.deficits.length : 0;
    showToast(gaps
      ? `Turni generati per la settimana ${_csvWeekText(wk)} · ${gaps === 1 ? "1 fascia" : `${gaps} fasce`} con personale mancante`
      : `Turni generati per la settimana ${_csvWeekText(wk)} · tutto coperto`, gaps ? "info" : "ok");
  } catch (e) {
    console.error("[Import]", e);
    const detail = String(e?.message || e || "").replace(/^\w*Error:\s*/, "");
    await uiAlert({
      kind: "error",
      title: "Import non riuscito",
      message: `${detail || "Errore sconosciuto."}\nI turni già salvati non sono stati modificati.`,
    });
  } finally {
    _setImportBusy(false);
  }
}

// ── Pannello laterale con la lista dei file CSV caricati ──
window.renderCsvFilePanel = async function renderCsvFilePanel() {
  const list = document.getElementById("csvFileList");
  if (!list) return;

  const files = await importedFilesList();
  const elaboraBtn = document.getElementById("btnElaboraSelectedFile");

  // il file selezionato resta selezionato solo se esiste ancora
  if (window._selectedCsvFile && !files.some((f) => f.id === window._selectedCsvFile.id)) {
    window._selectedCsvFile = null;
  }
  if (elaboraBtn && !_importBusy) elaboraBtn.disabled = !window._selectedCsvFile;

  if (!files.length) {
    list.innerHTML = `
      <div class="csv-empty-hint">
        <div class="csv-empty-title">Nessun file caricato</div>
        <div>Usa <strong>Importa CSV</strong> per caricare le disponibilità della settimana.</div>
      </div>`;
    return;
  }

  list.innerHTML = "";
  files.forEach((f) => {
    const item = document.createElement("div");
    item.className = "csv-file-item";
    item.dataset.id = f.id;
    if (window._selectedCsvFile?.id === f.id) item.classList.add("selected");

    item.innerHTML = `
      <button type="button" class="csv-file-info" title="Seleziona «${uiEscape(f.filename)}»">
        <span class="csv-file-name">${uiEscape(f.filename)}</span>
        <span class="csv-file-meta">Sett. ${uiEscape(_csvWeekText(f.week_key))} · ${uiEscape(_csvLocalDateTime(f.imported_at))}</span>
      </button>
      <button type="button" class="csv-file-delete" aria-label="Rimuovi ${uiEscape(f.filename)} dalla lista" title="Rimuovi dalla lista (i turni non vengono toccati)">✕</button>
    `;

    item.querySelector(".csv-file-info").addEventListener("click", () => {
      document.querySelectorAll(".csv-file-item").forEach((el) => el.classList.remove("selected"));
      item.classList.add("selected");
      window._selectedCsvFile = { id: f.id, filename: f.filename, week_key: f.week_key };
      if (elaboraBtn && !_importBusy) elaboraBtn.disabled = false;
    });

    item.querySelector(".csv-file-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await importedFilesDelete(f.id);
        showToast(`«${f.filename}» rimosso dalla lista`);
      } catch (err) {
        showToast(err.message, "err");
      }
      await window.renderCsvFilePanel();
    });

    list.appendChild(item);
  });
};

// ── "Elimina tutti" nel pannello CSV ──
window.bindCsvPanelActions = function bindCsvPanelActions() {
  const btnClear = document.getElementById("btnClearAllFiles");
  if (!btnClear || btnClear.dataset.bound === "1") return;
  btnClear.dataset.bound = "1";

  btnClear.addEventListener("click", async () => {
    const files = await importedFilesList();
    if (!files.length) {
      showToast("La lista è già vuota", "info");
      return;
    }
    const ok = await uiConfirm({
      title: "Svuotare la lista dei file?",
      message: `${files.length === 1 ? "Il file viene rimosso" : `I ${files.length} file vengono rimossi`} dalla lista.\nI turni nel calendario e i file sul disco non vengono toccati.`,
      confirmText: "Svuota lista",
    });
    if (!ok) return;
    try {
      await importedFilesClear();
      showToast("Lista dei file svuotata");
    } catch (err) {
      showToast(err.message, "err");
    }
    window._selectedCsvFile = null;
    await window.renderCsvFilePanel();
  });
};
