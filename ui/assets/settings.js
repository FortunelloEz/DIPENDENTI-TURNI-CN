// =========================================================
// Turni CN — pagina IMPOSTAZIONI
// Il modulo è costruito dalla descrizione del backend (cn_turni/app_settings.py):
// stessi nomi, limiti e testi; la validazione finale la fa sempre il backend.
// =========================================================

let _setSchema = [];
let _setSaved = {};     // valori salvati nel DB
let _setDraft = {};     // valori mostrati nel modulo

function _setEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Vero se ci sono modifiche non salvate (usato anche al cambio pagina). */
window.settingsHasUnsaved = function settingsHasUnsaved() {
  return !!document.querySelector(".settings-page") && !_setEqual(_setSaved, _setDraft);
};

function _setRefreshState() {
  const dirty = !_setEqual(_setSaved, _setDraft);
  document.getElementById("setDirty")?.toggleAttribute("hidden", !dirty);
  const save = document.getElementById("setSave");
  if (save) save.disabled = !dirty;
  const isDefault = _setSchema.every(s => _setEqual(_setDraft[s.key], s.default));
  const reset = document.getElementById("setReset");
  if (reset) reset.disabled = isDefault;
}

function _setDefaultText(s) {
  if (s.type === "bool") return s.default ? "attivo" : "spento";
  if (s.type === "days") return s.default.map(i => s.day_labels[i].slice(0, 3)).join(", ");
  return `${s.default} ${s.unit || ""}`.trim();
}

function _setFieldHtml(s) {
  const id = `set_${s.key}`;
  let control = "";
  if (s.type === "int") {
    control = `
      <div class="set-num">
        <button type="button" class="set-step" data-step="-1" aria-label="Diminuisci ${uiEscape(s.label)}">−</button>
        <input type="number" id="${id}" min="${s.min}" max="${s.max}" step="1" inputmode="numeric" aria-describedby="${id}_def">
        <button type="button" class="set-step" data-step="1" aria-label="Aumenta ${uiEscape(s.label)}">+</button>
        <span class="set-unit">${uiEscape(s.unit || "")}</span>
      </div>`;
  } else if (s.type === "bool") {
    control = `
      <label class="set-switch">
        <input type="checkbox" id="${id}" aria-describedby="${id}_def">
        <span class="set-switch-track" aria-hidden="true"></span>
        <span class="set-switch-text"></span>
      </label>`;
  } else if (s.type === "days") {
    control = `<div class="set-days" id="${id}" role="group" aria-label="${uiEscape(s.label)}">
      ${s.day_labels.map((d, i) => `<button type="button" class="set-day" data-day="${i}" aria-pressed="false">${uiEscape(d.slice(0, 3))}</button>`).join("")}
    </div>`;
  }
  return `
    <div class="set-row" data-key="${s.key}">
      <div class="set-label">
        <label for="${id}">${uiEscape(s.label)}</label>
        ${infoTip(s.help)}
        <div class="set-def" id="${id}_def">Predefinito: ${uiEscape(_setDefaultText(s))}</div>
      </div>
      <div class="set-control">${control}<div class="set-err" hidden></div></div>
    </div>`;
}

function _setFillControls() {
  _setSchema.forEach(s => {
    const el = document.getElementById(`set_${s.key}`);
    const v = _setDraft[s.key];
    if (!el) return;
    if (s.type === "int") el.value = v;
    else if (s.type === "bool") {
      el.checked = !!v;
      el.closest(".set-switch").querySelector(".set-switch-text").textContent = v ? "Attivo" : "Spento";
    } else if (s.type === "days") {
      el.querySelectorAll(".set-day").forEach(b => {
        const on = v.includes(Number(b.dataset.day));
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
  });
  _setRefreshState();
}

/** Controllo immediato con gli stessi limiti del backend: il messaggio compare sotto il campo. */
function _setValidate(s, value) {
  if (s.type === "int") {
    if (value === "" || !Number.isFinite(Number(value))) return "Inserisci un numero.";
    const n = Math.round(Number(value));
    if (n < s.min || n > s.max) return `Deve essere tra ${s.min} e ${s.max}.`;
  }
  if (s.type === "days" && (!value || value.length === 0)) return "Scegli almeno un giorno.";
  return "";
}

function _setShowError(key, msg) {
  const row = document.querySelector(`.set-row[data-key="${key}"]`);
  const err = row?.querySelector(".set-err");
  if (!err) return;
  err.textContent = msg;
  err.hidden = !msg;
  row.classList.toggle("has-error", !!msg);
}

function _setBind() {
  _setSchema.forEach(s => {
    const el = document.getElementById(`set_${s.key}`);
    if (!el) return;
    if (s.type === "int") {
      const commit = () => {
        const msg = _setValidate(s, el.value);
        _setShowError(s.key, msg);
        if (!msg) _setDraft[s.key] = Math.round(Number(el.value));
        _setRefreshState();
      };
      el.addEventListener("input", commit);
      el.closest(".set-num").querySelectorAll(".set-step").forEach(b => b.addEventListener("click", () => {
        const next = Math.min(s.max, Math.max(s.min, Math.round(Number(el.value || s.default)) + Number(b.dataset.step)));
        el.value = next;
        commit();
      }));
    } else if (s.type === "bool") {
      el.addEventListener("change", () => { _setDraft[s.key] = el.checked; _setFillControls(); });
    } else if (s.type === "days") {
      el.querySelectorAll(".set-day").forEach(b => b.addEventListener("click", () => {
        const d = Number(b.dataset.day);
        const cur = new Set(_setDraft[s.key]);
        cur.has(d) ? cur.delete(d) : cur.add(d);
        const next = [...cur].sort((x, y) => x - y);
        const msg = _setValidate(s, next);
        _setShowError(s.key, msg);
        if (!msg) _setDraft[s.key] = next;
        _setFillControls();
      }));
    }
  });

  document.getElementById("setSave").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const invalid = _setSchema.find(s => document.querySelector(`.set-row[data-key="${s.key}"].has-error`));
    if (invalid) { showToast(`Correggi «${invalid.label}» prima di salvare`, "err"); return; }
    btn.disabled = true;
    btn.classList.add("is-busy");
    try {
      const res = await apiWrite("app_settings_save", _setDraft);
      _setSaved = structuredClone(res.values);
      _setDraft = structuredClone(res.values);
      _setFillControls();
      showToast("Impostazioni salvate: valgono dal prossimo import");
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      btn.classList.remove("is-busy");
      _setRefreshState();
    }
  });

  document.getElementById("setReset").addEventListener("click", async () => {
    const ok = await uiConfirm({
      title: "Ripristinare i predefiniti?",
      message: "Tutte le impostazioni tornano ai valori predefiniti. Potrai salvarle o annullare prima di uscire.",
      confirmText: "Ripristina",
    });
    if (!ok) return;
    _setSchema.forEach(s => { _setDraft[s.key] = structuredClone(s.default); _setShowError(s.key, ""); });
    _setFillControls();
  });
}

window.initSettingsPage = async function initSettingsPage() {
  const body = document.getElementById("setBody");
  if (!body) return;
  const data = await apiCall("app_settings_get");
  if (!data || !Array.isArray(data.schema)) {
    body.innerHTML = `<div class="set-state set-state--err">Non riesco a leggere le impostazioni. Riprova tra qualche secondo.</div>`;
    return;
  }
  _setSchema = data.schema;
  _setSaved = structuredClone(data.values);
  _setDraft = structuredClone(data.values);

  const sections = [];
  _setSchema.forEach(s => {
    let sec = sections.find(x => x.name === s.section);
    if (!sec) sections.push(sec = { name: s.section, items: [] });
    sec.items.push(s);
  });
  body.innerHTML = sections.map(sec => `
    <section class="set-card">
      <h2 class="set-card-title">${uiEscape(sec.name)}</h2>
      ${sec.items.map(_setFieldHtml).join("")}
    </section>`).join("");
  _setFillControls();
  _setBind();
};
