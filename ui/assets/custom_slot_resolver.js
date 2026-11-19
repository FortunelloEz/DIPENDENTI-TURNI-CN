// ui/assets/custom_slot_resolver.js
// Durante l'import: celle del CSV con una disponibilità che l'app non sa leggere
// (es. "Dalle 11", "18-01", testo libero). Per ognuna l'utente indica l'orario
// oppure "non disponibile".

const _CSR_DAY_NAMES = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

/** "2026-05-31" -> "Domenica 31/05" (data locale, niente UTC) */
function _csrDayLabel(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso || "";
  const dt = new Date(y, m - 1, d);
  return `${_CSR_DAY_NAMES[dt.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/**
 * Suggerisce un orario dal testo della cella: è solo un punto di partenza, l'utente conferma.
 * "Dalle 11" -> 11–24 · "11-15" -> 11–15 · nessun numero -> 8–16
 */
function _csrSuggest(raw) {
  const nums = (String(raw || "").match(/\b\d{1,2}\b/g) || []).map(Number).filter(n => n >= 8 && n <= 24);
  const closing = /chius/i.test(raw || "");
  if (nums.length >= 2 && nums[1] > nums[0]) return { start: nums[0], end: nums[1] };
  if (nums.length >= 1 && nums[0] < 24) return { start: nums[0], end: 24 };
  return closing ? { start: 16, end: 24 } : { start: 8, end: 16 };
}

window.resolveCustomSlotsModal = function resolveCustomSlotsModal(customCells) {
  return new Promise((resolve) => {
    let idx = 0;
    const out = [];

    const overlay = document.createElement("div");
    overlay.className = "cn-overlay";
    const modal = document.createElement("div");
    modal.className = "cn-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    overlay.appendChild(modal);

    const hourOpt = (h, sel) =>
      `<option value="${h}"${h === sel ? " selected" : ""}>${h === 24 ? "Chiusura (24:00)" : `${String(h).padStart(2, "0")}:00`}</option>`;

    function render() {
      const c = customCells[idx];
      const sug = _csrSuggest(c.raw_text);
      const step = customCells.length > 1 ? `<span class="cn-step">${idx + 1} di ${customCells.length}</span>` : "";

      modal.innerHTML = `
        <div class="cn-head">
          <h3>Disponibilità da chiarire</h3>${step}
        </div>
        <p><strong>${uiEscape(c.csv_name)}</strong> ha scritto per <strong>${uiEscape(_csrDayLabel(c.iso_day))}</strong>:</p>
        <blockquote class="cn-quote">${uiEscape(c.raw_text || "(cella vuota)")}</blockquote>
        <p class="cn-muted">Indica l'orario in cui è disponibile. Ti proponiamo quello che si legge nel testo: controllalo prima di confermare.</p>

        <div class="cn-time-row">
          <label class="cn-field">
            <span>Dalle</span>
            <select class="cn-select" id="startHour">${Array.from({ length: 16 }, (_, i) => hourOpt(8 + i, sug.start)).join("")}</select>
          </label>
          <label class="cn-field">
            <span>Alle</span>
            <select class="cn-select" id="endHour">${Array.from({ length: 16 }, (_, i) => hourOpt(9 + i, sug.end)).join("")}</select>
          </label>
        </div>
        <div class="cn-error" id="csrError" hidden>L'ora di fine deve essere dopo l'ora di inizio.</div>

        <div class="cn-actions cn-actions--split">
          <button type="button" class="btn btn-ghost" id="btnCancel">Annulla import</button>
          <div class="cn-actions-right">
            <button type="button" class="btn" id="btnUnavailable">Non disponibile</button>
            <button type="button" class="btn primary" id="btnNext">Conferma orario</button>
          </div>
        </div>`;

      const errEl = modal.querySelector("#csrError");
      modal.querySelector("#btnCancel").addEventListener("click", () => finish(null));
      modal.querySelector("#btnUnavailable").addEventListener("click", () => {
        out.push({ csv_name: c.csv_name, iso_day: c.iso_day, unavailable: true });
        next();
      });
      modal.querySelector("#btnNext").addEventListener("click", () => {
        const start = parseInt(modal.querySelector("#startHour").value, 10);
        const end = parseInt(modal.querySelector("#endHour").value, 10);
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
          errEl.hidden = false;
          return;
        }
        out.push({ csv_name: c.csv_name, iso_day: c.iso_day, start_hour: start, end_hour: end, unavailable: false });
        next();
      });
      modal.querySelectorAll("select").forEach(s => s.addEventListener("change", () => { errEl.hidden = true; }));
      modal.querySelector("#btnNext").focus();
    }

    function next() {
      idx += 1;
      if (idx >= customCells.length) finish(out);
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
