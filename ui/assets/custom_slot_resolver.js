// ui/assets/custom_slot_resolver.js
// Popup per risolvere celle CSV non interpretabili (slot custom)

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.resolveCustomSlotsModal = function resolveCustomSlotsModal(customCells) {
  return new Promise((resolve) => {
    let idx = 0;
    const out = [];

    const overlay = document.createElement("div");
    overlay.className = "cn-overlay";

    const modal = document.createElement("div");
    modal.className = "cn-modal";
    overlay.appendChild(modal);

    function render() {
      const c = customCells[idx];
      const title = `Disponibilità non chiara (${idx + 1}/${customCells.length})`;

      modal.innerHTML = `
        <h3>${escapeHtml(title)}</h3>

        <p>
          Per <b>${escapeHtml(c.csv_name)}</b> è stata inserita la voce custom:
        </p>

        <div class="cn-note" style="margin-bottom:12px;">
          <b>${escapeHtml(c.raw_text || "(vuoto)")}</b><br>
          Giorno: <b>${escapeHtml(c.iso_day)}</b>
        </div>

        <div class="cn-row" style="align-items:center; gap:10px;">
          <label style="min-width:120px;">Inizio</label>
          <select class="cn-select" id="startHour">
            ${[...Array(17)].map((_,i)=>8+i).map(h=>`<option value="${h}">${String(h).padStart(2,'0')}:00</option>`).join("")}
          </select>

          <label style="min-width:120px;">Fine</label>
          <select class="cn-select" id="endHour">
            ${[...Array(17)].map((_,i)=>8+i).map(h=>`<option value="${h}">${String(h).padStart(2,'0')}:00</option>`).join("")}
            <option value="24">CHIUSURA (24:00)</option>
          </select>
        </div>

        <div class="cn-row" style="margin-top:12px;">
          <button class="cn-btn" id="btnUnavailable">NON DISPONIBILE</button>
        </div>

        <div class="cn-actions" style="margin-top:12px;">
          <button class="cn-btn" id="btnCancel">Annulla import</button>
          <button class="cn-btn primary" id="btnNext">Conferma</button>
        </div>
      `;

      modal.querySelector("#btnCancel").onclick = () => finish(null);

      modal.querySelector("#btnUnavailable").onclick = () => {
        out.push({
          csv_name: c.csv_name,
          iso_day: c.iso_day,
          unavailable: true,
        });
        next();
      };

      modal.querySelector("#btnNext").onclick = () => {
        const start = parseInt(modal.querySelector("#startHour").value, 10);
        const end = parseInt(modal.querySelector("#endHour").value, 10);

        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
          alert("Range non valido: la fine deve essere maggiore dell'inizio.");
          return;
        }

        out.push({
          csv_name: c.csv_name,
          iso_day: c.iso_day,
          start_hour: start,
          end_hour: end,
          unavailable: false,
        });
        next();
      };
    }

    function next() {
      idx += 1;
      if (idx >= customCells.length) finish(out);
      else render();
    }

    function finish(result) {
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(result);
    }

    document.body.appendChild(overlay);
    render();
  });
};