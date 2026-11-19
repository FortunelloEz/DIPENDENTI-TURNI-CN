// =========================================================
// Turni CN — ASSISTENTE LOCALE
// Funziona sul PC, senza internet e senza chiavi: le risposte arrivano dal motore
// Python (cn_turni/services/assistant.py) che legge il database.
// Le modifiche sono SEMPRE un'anteprima: si scrive solo dopo «Conferma»
// (assistant_apply ricalcola la modifica sul DB del momento e la salva in una transazione).
// =========================================================

const AS_INFO_EXAMPLES = [
  "Cosa manca questa settimana?",
  "Qual è il giorno più critico?",
  "Chi lavora sabato?",
  "Chi è libero sabato sera?",
];
// esempi di modifica: vanno completati con i nomi, quindi finiscono nel campo di testo
const AS_EDIT_EXAMPLES = [
  "Sostituisci … con … sabato sera",
  "Aggiungi … in cassa domenica mattina",
  "Togli … da domenica",
];

const AS_ICONS = {
  spark: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  close: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  reset: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-4"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 4"/><path d="M20 20v-4h-4"/></svg>',
  send: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
};

let _asOpen = false;
let _asBusy = false;

function _asWeekKey() {
  return (typeof currentWeekStart !== "undefined" && currentWeekStart) ? weekKeyOf(currentWeekStart) : null;
}

/* ---------- costruzione del pannello ---------- */
function _asBuild() {
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "as-fab";
  fab.id = "asFab";
  fab.setAttribute("aria-controls", "asPanel");
  fab.setAttribute("aria-expanded", "false");
  fab.innerHTML = `${AS_ICONS.spark}<span>Assistente</span>`;

  const panel = document.createElement("aside");
  panel.className = "as-panel";
  panel.id = "asPanel";
  panel.setAttribute("aria-label", "Assistente turni");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <div class="as-head">
      <div class="as-head-ic" aria-hidden="true">${AS_ICONS.spark}</div>
      <div class="as-head-text">
        <div class="as-title">Assistente turni</div>
        <div class="as-sub">Sul tuo PC · senza internet</div>
      </div>
      <button type="button" class="as-hbtn" id="asReset" aria-label="Nuova conversazione" title="Nuova conversazione">${AS_ICONS.reset}</button>
      <button type="button" class="as-hbtn" id="asClose" aria-label="Chiudi l'assistente" title="Chiudi (Esc)">${AS_ICONS.close}</button>
    </div>
    <div class="as-ctx">
      <span>Settimana <strong id="asWeek">—</strong></span>
      ${infoTip("Risponde sulla settimana aperta in Home, leggendo i dati salvati. Non usa internet e non inventa: se un dato manca te lo dice. Le modifiche ti vengono sempre mostrate prima e si salvano solo se confermi.")}
    </div>
    <div class="as-msgs" id="asMsgs" aria-live="polite"></div>
    <form class="as-input" id="asForm" autocomplete="off">
      <textarea id="asInput" rows="1" placeholder="Scrivi una domanda… (Invio per inviare)" aria-label="Domanda per l'assistente"></textarea>
      <button type="submit" class="as-send" id="asSend" aria-label="Invia">${AS_ICONS.send}</button>
    </form>`;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  fab.addEventListener("click", () => (_asOpen ? asClose() : asOpen()));
  panel.querySelector("#asClose").addEventListener("click", asClose);
  panel.querySelector("#asReset").addEventListener("click", () => { _asWelcome(true); _asFocusInput(); });
  panel.querySelector("#asForm").addEventListener("submit", (e) => {
    e.preventDefault();
    _asSend(document.getElementById("asInput").value);
  });
  const input = panel.querySelector("#asInput");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _asSend(input.value); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });
  document.addEventListener("keydown", (e) => {
    // le finestre di conferma dell'app gestiscono Esc da sole (e.defaultPrevented)
    if (e.key === "Escape" && _asOpen && !e.defaultPrevented && !document.querySelector(".ui-dialog-overlay")) asClose();
  });
}

function asOpen() {
  _asOpen = true;
  document.getElementById("asPanel")?.classList.add("open");
  document.getElementById("asPanel")?.setAttribute("aria-hidden", "false");
  document.getElementById("asFab")?.setAttribute("aria-expanded", "true");
  document.getElementById("asFab")?.classList.add("is-hidden");
  window.assistantRefresh();
  if (!document.getElementById("asMsgs")?.children.length) _asWelcome(false);
  _asFocusInput();
}

function asClose() {
  _asOpen = false;
  document.getElementById("asPanel")?.classList.remove("open");
  document.getElementById("asPanel")?.setAttribute("aria-hidden", "true");
  const fab = document.getElementById("asFab");
  fab?.setAttribute("aria-expanded", "false");
  fab?.classList.remove("is-hidden");
  fab?.focus();
}

function _asFocusInput() {
  setTimeout(() => document.getElementById("asInput")?.focus(), 220);
}

/** Aggiorna la settimana mostrata (chiamata dal calendario quando cambia settimana o turni). */
window.assistantRefresh = function assistantRefresh() {
  const el = document.getElementById("asWeek");
  if (el) el.textContent = (typeof currentWeekStart !== "undefined" && currentWeekStart) ? weekRangeText(currentWeekStart) : "—";
};

/* ---------- messaggi ---------- */
function _asMsgs() { return document.getElementById("asMsgs"); }

function _asScroll() {
  const m = _asMsgs();
  if (m) m.scrollTop = m.scrollHeight;
}

function _asWelcome(reset) {
  const m = _asMsgs();
  if (!m) return;
  if (reset) m.innerHTML = "";
  const w = document.createElement("div");
  w.className = "as-welcome";
  w.innerHTML = `
    <div class="as-welcome-title">Ciao! Posso aiutarti con i turni.</div>
    <div class="as-welcome-text">Chiedimi cosa manca, chi è libero o quante ore fa qualcuno. Posso anche fare piccole modifiche: te le mostro sempre prima di salvarle.</div>
    <div class="as-chip-group">Informazioni</div>
    <div class="as-chips">${AS_INFO_EXAMPLES.map(t => `<button type="button" class="as-chip" data-send="${uiEscape(t)}">${uiEscape(t)}</button>`).join("")}</div>
    <div class="as-chip-group">Modifiche <span class="as-chip-hint">completa con i nomi</span></div>
    <div class="as-chips">${AS_EDIT_EXAMPLES.map(t => `<button type="button" class="as-chip as-chip--edit" data-fill="${uiEscape(t)}">${uiEscape(t)}</button>`).join("")}</div>`;
  w.querySelectorAll("[data-send]").forEach(b => b.addEventListener("click", () => _asSend(b.dataset.send)));
  w.querySelectorAll("[data-fill]").forEach(b => b.addEventListener("click", () => {
    const input = document.getElementById("asInput");
    input.value = b.dataset.fill;
    input.focus();
    const i = input.value.indexOf("…");
    if (i >= 0) input.setSelectionRange(i, i + 1); // il primo «…» è selezionato: si scrive subito il nome
  }));
  m.appendChild(w);
}

function _asAddUser(text) {
  const el = document.createElement("div");
  el.className = "as-msg as-msg--user";
  el.textContent = text;
  _asMsgs().appendChild(el);
  _asScroll();
}

/** Testo dell'assistente: righe che iniziano con «• » diventano un elenco; tutto è testo, mai HTML. */
function _asLinesHtml(lines) {
  let html = "";
  let inList = false;
  (lines || []).forEach(line => {
    const s = String(line);
    if (s.startsWith("• ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${uiEscape(s.slice(2))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${uiEscape(s)}</p>`;
    }
  });
  if (inList) html += "</ul>";
  return html;
}

function _asAddBot(res) {
  const el = document.createElement("div");
  el.className = "as-msg as-msg--bot";
  let html = "";
  if (res.title) html += `<div class="as-msg-title">${uiEscape(res.title)}</div>`;
  html += _asLinesHtml(res.lines);
  el.innerHTML = html;

  if (res.action) el.appendChild(_asActionCard(res.title, res.action));

  if (Array.isArray(res.suggestions) && res.suggestions.length) {
    const chips = document.createElement("div");
    chips.className = "as-chips as-chips--follow";
    res.suggestions.forEach(t => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "as-chip";
      b.textContent = t;
      b.addEventListener("click", () => _asSend(t));
      chips.appendChild(b);
    });
    el.appendChild(chips);
  }
  _asMsgs().appendChild(el);
  _asScroll();
}

function _asAddError(text) {
  const el = document.createElement("div");
  el.className = "as-msg as-msg--bot as-msg--err";
  el.innerHTML = `<p>${uiEscape(text)}</p>`;
  _asMsgs().appendChild(el);
  _asScroll();
}

/* ---------- anteprima di modifica ---------- */
function _asActionCard(title, action) {
  const card = document.createElement("div");
  card.className = "as-action";
  const danger = action.params?.type === "remove";
  card.innerHTML = `
    <div class="as-action-label">Anteprima · niente è ancora salvato</div>
    <ul class="as-action-list">${(action.preview || []).map(p => `<li>${uiEscape(p)}</li>`).join("")}</ul>
    ${(action.warnings || []).map(w => `<div class="as-warn">${AS_ICONS.warn}<span>${uiEscape(w)}</span></div>`).join("")}
    <div class="as-action-btns">
      <button type="button" class="btn btn-small btn-ghost" data-act="cancel">Annulla</button>
      <button type="button" class="btn btn-small ${danger ? "btn-danger-solid" : "primary"}" data-act="ok">${uiEscape(action.confirm || "Conferma")}</button>
    </div>`;

  const btns = card.querySelector(".as-action-btns");
  const finish = (cls, html) => {
    btns.outerHTML = `<div class="as-action-done ${cls}">${html}</div>`;
  };
  card.querySelector('[data-act="cancel"]').addEventListener("click", () => {
    finish("is-cancel", "Annullato: non ho modificato niente.");
  });
  card.querySelector('[data-act="ok"]').addEventListener("click", async (e) => {
    const okBtn = e.currentTarget;
    const weekKey = _asWeekKey();
    if (!weekKey) return;
    btns.querySelectorAll("button").forEach(b => { b.disabled = true; });
    okBtn.classList.add("is-busy");
    try {
      const res = await apiWrite("assistant_apply", weekKey, action);
      if (!res?.ok) {
        finish("is-err", uiEscape(res?.error || "Modifica non applicata."));
      } else {
        finish("is-ok", `${AS_ICONS.check}<span>${uiEscape(res.message)}</span>`);
        showToast(res.message);
      }
    } catch (err) {
      finish("is-err", uiEscape(err.message));
    }
    // in ogni caso lo schermo torna uguale a ciò che è salvato
    if (typeof resyncWeekFromDb === "function") await resyncWeekFromDb(weekKey);
    if (typeof renderDaySummary === "function") await renderDaySummary();
    _asScroll();
  });
  return card;
}

/* ---------- invio ---------- */
async function _asSend(raw) {
  const text = String(raw || "").trim();
  if (!text || _asBusy) return;
  const weekKey = _asWeekKey();
  const input = document.getElementById("asInput");
  input.value = "";
  input.style.height = "auto";
  _asAddUser(text);
  if (!weekKey) {
    _asAddError("Apri prima la Home: rispondo sulla settimana mostrata nel calendario.");
    return;
  }
  _asBusy = true;
  document.getElementById("asSend").disabled = true;
  const typing = document.createElement("div");
  typing.className = "as-typing";
  typing.innerHTML = "<span></span><span></span><span></span>";
  _asMsgs().appendChild(typing);
  _asScroll();
  try {
    const res = await window.pywebview.api.assistant_ask(weekKey, text);
    typing.remove();
    if (res?.ok) _asAddBot(res);
    else _asAddError("Non sono riuscito a rispondere. Riprova.");
  } catch (err) {
    typing.remove();
    console.error("[Assistente]", err);
    _asAddError("Non sono riuscito a leggere i dati. Riprova tra qualche secondo.");
  } finally {
    _asBusy = false;
    document.getElementById("asSend").disabled = false;
    input.focus();
  }
}

/* ---------- avvio ---------- */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _asBuild);
else _asBuild();
