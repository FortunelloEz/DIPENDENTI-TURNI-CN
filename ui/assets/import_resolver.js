// ui/assets/import_resolver.js
// Durante l'import: nomi del CSV che non corrispondono a nessun dipendente.
// Per ogni nome l'utente sceglie se collegarlo a un dipendente esistente (alias)
// o crearlo come nuovo dipendente (lo crea il backend durante l'import).

/**
 * Ritorna:
 *   null (import annullato)
 *   oppure [{csv_name, action:"create"} | {csv_name, action:"alias", employee_id}]
 */
window.resolveUnknownUsersModal = function resolveUnknownUsersModal(unknownNames, employees) {
  return new Promise((resolve) => {
    let idx = 0;
    const resolutions = [];

    const overlay = document.createElement("div");
    overlay.className = "cn-overlay";
    const modal = document.createElement("div");
    modal.className = "cn-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    overlay.appendChild(modal);

    const sortedEmployees = (employees || [])
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "it", { sensitivity: "base" }));

    function render() {
      const csvName = unknownNames[idx];
      const step = unknownNames.length > 1 ? `<span class="cn-step">${idx + 1} di ${unknownNames.length}</span>` : "";
      const options = sortedEmployees
        .map(e => `<option value="${e.id}">${uiEscape(e.name)}</option>`)
        .join("");

      modal.innerHTML = `
        <div class="cn-head">
          <h3>Nome non riconosciuto</h3>${step}
        </div>
        <p>Nel CSV c'è <strong>${uiEscape(csvName)}</strong>, che non corrisponde a nessun dipendente. Chi è?</p>

        <div class="cn-choice">
          <div class="cn-choice-title">È un dipendente già presente</div>
          <div class="cn-choice-desc">Il nome del CSV viene salvato come suo alias: dal prossimo import verrà riconosciuto da solo.</div>
          ${sortedEmployees.length ? `
          <div class="cn-row">
            <select class="cn-select" id="empSelect" aria-label="Dipendente a cui collegare ${uiEscape(csvName)}">${options}</select>
            <button type="button" class="btn primary" id="btnAlias">Collega</button>
          </div>` : `<div class="cn-choice-desc"><em>Non ci sono ancora dipendenti in anagrafica.</em></div>`}
        </div>

        <div class="cn-choice">
          <div class="cn-choice-title">È una persona nuova</div>
          <div class="cn-choice-desc">
            Viene creato il dipendente «${uiEscape(csvName)}» <strong>senza skill</strong>: in questo import non riceverà turni.
            Completa poi la sua scheda in «Dipendenti» e rielabora il file.
          </div>
          <div class="cn-row">
            <button type="button" class="btn" id="btnCreate">Crea nuovo dipendente</button>
          </div>
        </div>

        <div class="cn-actions">
          <button type="button" class="btn btn-ghost" id="btnCancel">Annulla import</button>
        </div>`;

      modal.querySelector("#btnAlias")?.addEventListener("click", () => {
        const empId = parseInt(modal.querySelector("#empSelect").value, 10);
        if (!empId) return;
        resolutions.push({ csv_name: csvName, action: "alias", employee_id: empId });
        nextOrDone();
      });
      modal.querySelector("#btnCreate").addEventListener("click", () => {
        resolutions.push({ csv_name: csvName, action: "create" });
        nextOrDone();
      });
      modal.querySelector("#btnCancel").addEventListener("click", () => finish(null));
      (modal.querySelector("#empSelect") || modal.querySelector("#btnCreate"))?.focus();
    }

    function nextOrDone() {
      idx += 1;
      if (idx >= unknownNames.length) finish(resolutions);
      else render();
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
    }

    function finish(result) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    }

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    render();
  });
};
