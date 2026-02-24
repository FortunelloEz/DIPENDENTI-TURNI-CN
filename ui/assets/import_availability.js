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
        const file = input.files?.[0];
        if (!file) return;

        const csvText = await file.text();
        const weekKey = weekKeyOf(currentWeekStart);

        // 1) prima chiamata: se ci sono nomi sconosciuti, backend risponde needs_resolution
        let res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, null);

        if (res && res.needs_resolution) {
          if (typeof window.resolveUnknownUsersModal !== "function") {
            throw new Error("resolveUnknownUsersModal non disponibile (import_resolver.js non caricato).");
          }

          const resolutions = await window.resolveUnknownUsersModal(res.unknown || [], res.employees || []);
          if (!resolutions) return; // annullato dall'utente

          // 2) seconda chiamata: con le risoluzioni applica import + autofill
          res = await window.pywebview.api.import_availability_and_autofill(weekKey, csvText, resolutions);
        }

        if (!res || !res.ok) {
          throw new Error(res?.error || "Import fallito");
        }

        // ✅ refresh immediato (senza cambiare scheda)
        await loadWeekFromDb(weekKey);
        renderEmployees();
        renderWeekLabel();
        renderCalendar();

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
