// ui/assets/import_availability.js
// Gestisce import CSV availability (UI + chiamata API + refresh calendario + gestione lista file)

// ── Bottone "Importa CSV": apre picker Windows via Python, legge il file, avvia import ──
window.bindImportAvailability = function bindImportAvailability() {
  const btn = document.getElementById("btnImportAvailability");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
    // Apre il file dialog lato Python (tkinter) — restituisce path e filename
    const picked = await apiCall("imported_files_open_dialog");
    if (!picked || !picked.ok) return; // utente ha annullato

    // Legge il contenuto del CSV dal path reale su disco
    const content = await apiCall("imported_files_read_path", picked.path);
    if (!content?.ok) {
      alert("Errore lettura file: " + (content?.error || ""));
      return;
    }

    // Avvia il processo di import — salverà anche i metadati in DB
    await _runImport(content.csv_text, picked.filename, picked.path, null);
  });
};

// ── Bottone "Elabora file selezionato": legge dal path già salvato in DB, nessun picker ──
window.bindElaboraSelectedFile = function bindElaboraSelectedFile() {
  const btn = document.getElementById("btnElaboraSelectedFile");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
    const selected = window._selectedCsvFile;
    if (!selected) {
      alert("Seleziona prima un file dalla lista.");
      return;
    }

    // Legge il file direttamente dal path salvato — NESSUN picker Windows
    const content = await apiCall("imported_files_get_content", selected.id);
    if (!content?.ok) {
      alert("Impossibile leggere il file: " + (content?.error || "path non trovato su disco"));
      return;
    }

    // Ri-elabora usando la week_key già associata al file
    await _runImport(content.csv_text, selected.filename, null, selected.week_key);
  });
};

// ── Funzione centrale di import — usata da entrambi i bottoni ──
async function _runImport(csvText, filename, filePath, forceWeekKey) {
  try {
    const weekKey = forceWeekKey || weekKeyOf(currentWeekStart);
    let resolutions = null;
    let customResolutions = null;

    // 1) Prima chiamata
    let res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, null, null);

    // 2) Nomi sconosciuti → risolvi alias
    if (res && res.needs_resolution) {
      if (typeof window.resolveUnknownUsersModal !== "function")
        throw new Error("resolveUnknownUsersModal non disponibile (import_resolver.js non caricato).");
      resolutions = await window.resolveUnknownUsersModal(res.unknown || [], res.employees || []);
      if (!resolutions) return;
      res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, resolutions, null);
    }

    // 3) Celle custom → risolvi slot
    if (res && res.needs_custom_slot_resolution) {
      if (typeof window.resolveCustomSlotsModal !== "function")
        throw new Error("resolveCustomSlotsModal non disponibile (custom_slot_resolver.js non caricato).");
      customResolutions = await window.resolveCustomSlotsModal(res.custom_cells || []);
      if (!customResolutions) return;
      res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, resolutions, customResolutions);
    }

    if (!res || !res.ok) throw new Error(res?.error || "Import fallito");

    if (res.availability_preview) window._lastAvailabilityPreview = res.availability_preview;

    const wk = res.week_key_used || weekKey;
    if (typeof mondayDateFromWeekKey === "function") currentWeekStart = mondayDateFromWeekKey(wk);
    window.currentWeekKey = wk;

    // Salva metadati in DB solo se è un import nuovo (filePath presente).
    // Se è una ri-elaborazione di file già in lista, il record esiste già.
    if (filePath) {
      await importedFilesAdd(filename, filePath, wk);
    }

    await loadWeekFromDb(wk);
    renderEmployees();
    renderWeekLabel();
    renderCalendar();
    window.bindAvailabilityViewer?.();
    await window.renderCsvFilePanel?.();

    alert("Import completato ✅");
  } catch (e) {
    console.error(e);
    alert("Errore import: " + (e?.message || String(e)));
  }
}

// ── Renderizza il pannello laterale con la lista dei file CSV caricati ──
window.renderCsvFilePanel = async function renderCsvFilePanel() {
  const list = document.getElementById("csvFileList");
  if (!list) return;

  const files = await importedFilesList();

  if (!files || files.length === 0) {
    list.innerHTML = `<div class="csv-empty-hint">Nessun file caricato</div>`;
    const btn = document.getElementById("btnElaboraSelectedFile");
    if (btn) btn.disabled = true;
    window._selectedCsvFile = null;
    return;
  }

  list.innerHTML = "";
  files.forEach(f => {
    const item = document.createElement("div");
    item.className = "csv-file-item";
    item.dataset.id = f.id;

    const dateStr = f.imported_at ? f.imported_at.slice(0, 16).replace("T", " ") : "";

    item.innerHTML = `
      <div class="csv-file-info" title="${f.filename}">
        <div class="csv-file-name">${f.filename}</div>
        <div class="csv-file-meta">Sett. ${f.week_key} · ${dateStr}</div>
      </div>
      <button class="csv-file-delete" data-id="${f.id}" title="Rimuovi dalla lista">✕</button>
    `;

    // Click sulla parte info → seleziona il file e abilita "Elabora file selezionato"
    item.querySelector(".csv-file-info").addEventListener("click", () => {
      document.querySelectorAll(".csv-file-item").forEach(el => el.classList.remove("selected"));
      item.classList.add("selected");
      window._selectedCsvFile = { id: f.id, filename: f.filename, week_key: f.week_key };
      const btn = document.getElementById("btnElaboraSelectedFile");
      if (btn) btn.disabled = false;
    });

    // Click sulla X → elimina solo il record dalla lista (non tocca il calendario)
    item.querySelector(".csv-file-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      await importedFilesDelete(f.id);
      if (window._selectedCsvFile?.id === f.id) {
        window._selectedCsvFile = null;
        const btn = document.getElementById("btnElaboraSelectedFile");
        if (btn) btn.disabled = true;
      }
      await window.renderCsvFilePanel();
    });

    list.appendChild(item);
  });
};

// ── Bind del bottone "Elimina tutti" nel pannello CSV ──
window.bindCsvPanelActions = function bindCsvPanelActions() {
  const btnClear = document.getElementById("btnClearAllFiles");
  if (!btnClear || btnClear.dataset.bound === "1") return;
  btnClear.dataset.bound = "1";

  btnClear.addEventListener("click", async () => {
    if (!confirm("Eliminare tutti i file dalla lista? I dati nel calendario non verranno toccati.")) return;
    await importedFilesClear();
    window._selectedCsvFile = null;
    const btn = document.getElementById("btnElaboraSelectedFile");
    if (btn) btn.disabled = true;
    await window.renderCsvFilePanel();
  });
};