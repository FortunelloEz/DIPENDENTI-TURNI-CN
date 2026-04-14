// ui/assets/import_availability.js
// Gestisce solo l'import CSV availability (UI + chiamata API + refresh calendario)

// Nota: dipende da funzioni/variabili globali definite in app.js:
// - weekKeyOf, currentWeekStart
// - loadWeekFromDb, renderEmployees, renderWeekLabel, renderCalendar
// - window.pywebview.api.import_availability_and_autofill

window.bindImportAvailability = function bindImportAvailability() {
  const btn = document.getElementById("btnImportAvailability");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = async () => {
      try {
        const file = input.files && input.files.length ? input.files[0] : null;
        if (!file) {
          alert("Seleziona un file CSV.");
          return;
        }
        const csvText = await file.text();
        const weekKey = weekKeyOf(currentWeekStart);

        let resolutions = null;
        let customResolutions = null;

        // 1) prima chiamata
        let res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, null, null);
        // 2) se ci sono nomi sconosciuti → risolvi alias
        if (res && res.needs_resolution) {
          if (typeof window.resolveUnknownUsersModal !== "function") {
            throw new Error("resolveUnknownUsersModal non disponibile (import_resolver.js non caricato).");
          }
          resolutions = await window.resolveUnknownUsersModal(res.unknown || [], res.employees || []);
          if (!resolutions) return;

          res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, resolutions, null);
        }

        // 3) se ci sono celle custom → risolvi slot custom
        if (res && res.needs_custom_slot_resolution) {
          if (typeof window.resolveCustomSlotsModal !== "function") {
            throw new Error("resolveCustomSlotsModal non disponibile (custom_slot_resolver.js non caricato).");
          }
          customResolutions = await window.resolveCustomSlotsModal(res.custom_cells || []);
          if (!customResolutions) return;

          res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, resolutions, customResolutions);
        }

        if (!res || !res.ok) {
          throw new Error(res?.error || "Import fallito");
        }

        // salva preview disponibilità per il viewer
        if (res.availability_preview) {
          window._lastAvailabilityPreview = res.availability_preview;
        }

        // refresh UI
        const wk = res.week_key_used || weekKey;
        await loadWeekFromDb(wk);
        renderEmployees();
        renderWeekLabel();
        renderCalendar();

        // (ri)render bottoni viewer
        window.bindAvailabilityViewer?.();

        alert("Import completato ✅");
      } catch (e) {
        console.error(e);
        alert("Errore import: " + (e?.message || String(e)));
      } finally {
        input.remove();
      }
    };

    input.click();
  });
}
