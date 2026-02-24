// ui/js/import_resolver.js

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Apre il tuo form "Aggiungi dipendente".
 * - Prova prima una funzione globale (consigliato): window.openEmployeeCreateModal(name)
 * - Fallback: click su un bottone esistente (#btnEmpNew) se c'è
 */
function openEmployeeCreateUi(prefillName) {
  // 1) hook consigliato (mettilo tu in employees.js)
  if (typeof window.openEmployeeCreateModal === "function") {
    window.openEmployeeCreateModal(prefillName);
    return true;
  }

  // 2) fallback: prova a cliccare il pulsante +Aggiungi nella vista dipendenti, se presente nel DOM
  const btn = document.getElementById("btnEmpNew");
  if (btn) {
    btn.click();
    // se hai un input nome nel modal, qui NON posso precompilarlo senza conoscere gli id.
    // per ora apriamo il modal e l'utente inserisce il nome.
    return true;
  }

  alert("Non trovo il form di inserimento dipendente. Serve esporre window.openEmployeeCreateModal(name) in employees.js.");
  return false;
}

/**
 * Risolve una lista di nomi sconosciuti:
 * - "Aggiungi utente" -> apre form dipendente. Poi l'utente clicca "Ho salvato, continua".
 * - "Aggiungi alias" -> select dipendenti + conferma
 *
 * Ritorna:
 *   null (annullato)
 *   oppure resolutions = [{csv_name, action:"create"} | {csv_name, action:"alias", employee_id}]
 */
window.resolveUnknownUsersModal = function resolveUnknownUsersModal(unknownNames, employees) {
  return new Promise((resolve) => {
    let idx = 0;
    const resolutions = [];

    const overlay = document.createElement("div");
    overlay.className = "cn-overlay";

    const modal = document.createElement("div");
    modal.className = "cn-modal";
    overlay.appendChild(modal);

    const sortedEmployees = (employees || [])
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "it", { sensitivity: "base" }));

    function renderChoose() {
      const csvName = unknownNames[idx];
      const optionsHtml = sortedEmployees
        .map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`)
        .join("");

      modal.innerHTML = `
        <h3>Utente non trovato</h3>
        <p>
          Nel CSV c’è <b>${escapeHtml(csvName)}</b> ma non esiste nel DB.<br>
          Scegli cosa fare:
        </p>

        <div class="cn-row">
          <button class="cn-btn primary" id="btnCreate">Aggiungi utente</button>
          <button class="cn-btn" id="btnAlias">Aggiungi alias</button>
        </div>

        <div id="aliasBox" style="display:none; margin-top: 12px;">
          <p style="margin-bottom:8px;">Seleziona il dipendente a cui associare l’alias:</p>
          <div class="cn-row">
            <div class="cn-grow">
              <select class="cn-select" id="empSelect">${optionsHtml}</select>
            </div>
            <button class="cn-btn primary" id="btnConfirmAlias">Conferma</button>
          </div>
        </div>

        <div class="cn-actions">
          <button class="cn-btn danger" id="btnCancel">Annulla import</button>
        </div>
      `;

      const aliasBox = modal.querySelector("#aliasBox");

      modal.querySelector("#btnCreate").onclick = () => {
        // Step 1: apri form inserimento
        const ok = openEmployeeCreateUi(csvName);
        if (!ok) return;

        // Step 2: cambia vista del modal: "ho salvato"
        renderCreated(csvName);
      };

      modal.querySelector("#btnAlias").onclick = () => {
        aliasBox.style.display = "block";
      };

      modal.querySelector("#btnConfirmAlias").onclick = () => {
        const empId = parseInt(modal.querySelector("#empSelect").value, 10);
        resolutions.push({ csv_name: csvName, action: "alias", employee_id: empId });
        nextOrDone();
      };

      modal.querySelector("#btnCancel").onclick = () => finish(null);
    }

    function renderCreated(csvName) {
      modal.innerHTML = `
        <h3>Aggiungi utente</h3>
        <p>
          Ho aperto il form di inserimento dipendente.<br>
          Crea l’utente (almeno il nome) e salva.
        </p>

        <div class="cn-note">
          Nome da creare: <b>${escapeHtml(csvName)}</b>
        </div>

        <div class="cn-actions">
          <button class="cn-btn" id="btnBack">Indietro</button>
          <button class="cn-btn primary" id="btnContinue">Ho salvato, continua</button>
          <button class="cn-btn danger" id="btnCancel">Annulla import</button>
        </div>
      `;

      modal.querySelector("#btnBack").onclick = () => renderChoose();
      modal.querySelector("#btnCancel").onclick = () => finish(null);

      modal.querySelector("#btnContinue").onclick = () => {
        // registriamo la risoluzione come create
        resolutions.push({ csv_name: csvName, action: "create" });
        nextOrDone();
      };
    }

    function nextOrDone() {
      idx += 1;
      if (idx >= unknownNames.length) finish(resolutions);
      else renderChoose();
    }

    function finish(result) {
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(result);
    }

    document.body.appendChild(overlay);
    renderChoose();
  });
}
