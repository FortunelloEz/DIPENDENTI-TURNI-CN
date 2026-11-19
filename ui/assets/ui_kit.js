// =========================================================
// Turni CN — UI KIT condiviso
// Caricato PRIMA di tutti gli altri script (vedi index.html).
//
//   showToast(msg, type)        notifica breve: "ok" | "err" | "info"
//   uiConfirm(opts) -> bool     finestra di conferma dell'app (sostituisce confirm())
//   uiAlert(opts)               finestra di avviso dell'app (sostituisce alert())
//   apiWrite(method, ...args)   scrittura sul DB: LANCIA un errore leggibile se fallisce
//   infoTip(text)               HTML dell'icona (i) con spiegazione
//
// Le icone (i) statiche nell'HTML si scrivono così:
//   <button type="button" class="info-tip" data-tip="Spiegazione" aria-label="Informazioni">i</button>
// =========================================================

/* ---------- utilità ---------- */
function uiEscape(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Testo multi-riga -> paragrafi HTML sicuri. */
function uiParagraphs(text) {
  return String(text ?? "")
    .split(/\n{2,}|\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => `<p>${uiEscape(l)}</p>`)
    .join("");
}

/* ---------- NOTIFICHE (toast) ---------- */
const TOAST_ICON = { ok: "✓", err: "!", info: "i" };

function _toastStack() {
  let stack = document.getElementById("uiToastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "uiToastStack";
    stack.className = "ui-toast-stack";
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * Notifica breve in basso al centro. Gli errori restano più a lungo e si possono chiudere.
 * @param {string} msg
 * @param {"ok"|"err"|"info"} [type="ok"]
 */
function showToast(msg, type = "ok") {
  const kind = TOAST_ICON[type] ? type : "info";
  const t = document.createElement("div");
  t.className = `ui-toast ui-toast--${kind}`;
  t.innerHTML = `
    <span class="ui-toast-ic" aria-hidden="true">${TOAST_ICON[kind]}</span>
    <span class="ui-toast-msg">${uiEscape(msg)}</span>
    <button type="button" class="ui-toast-close" aria-label="Chiudi notifica">✕</button>`;
  _toastStack().appendChild(t);

  let timer = null;
  const close = () => {
    clearTimeout(timer);
    t.classList.remove("is-visible");
    setTimeout(() => t.remove(), 220);
  };
  t.querySelector(".ui-toast-close").addEventListener("click", close);
  requestAnimationFrame(() => t.classList.add("is-visible"));
  timer = setTimeout(close, kind === "err" ? 6000 : 2600);
}

/* ---------- FINESTRE: conferma e avviso ---------- */
let _uiDialogOpen = null;

function _uiDialog({ title, message, html, kind = "info", buttons }) {
  return new Promise((resolve) => {
    // una sola finestra di dialogo alla volta: la precedente si chiude come annullata
    if (_uiDialogOpen) _uiDialogOpen(null);
    window.uiHideTip?.();

    const prevFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "ui-dialog-overlay";
    overlay.innerHTML = `
      <div class="ui-dialog ui-dialog--${kind}" role="alertdialog" aria-modal="true"
           aria-labelledby="uiDialogTitle" aria-describedby="uiDialogMsg">
        <div class="ui-dialog-head">
          <span class="ui-dialog-ic" aria-hidden="true">${kind === "danger" ? "!" : kind === "error" ? "✕" : kind === "success" ? "✓" : "i"}</span>
          <h2 class="ui-dialog-title" id="uiDialogTitle">${uiEscape(title)}</h2>
        </div>
        <div class="ui-dialog-msg" id="uiDialogMsg">${html ?? uiParagraphs(message)}</div>
        <div class="ui-dialog-actions"></div>
      </div>`;

    const actions = overlay.querySelector(".ui-dialog-actions");
    let focusBtn = null;
    buttons.forEach((b) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `btn ${b.cls || ""}`.trim();
      el.textContent = b.label;
      el.addEventListener("click", () => done(b.value));
      actions.appendChild(el);
      if (b.focus) focusBtn = el;
    });

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(buttons.find((b) => b.cancel)?.value ?? null); }
      if (e.key === "Tab") {
        // focus intrappolato nella finestra
        const f = [...overlay.querySelectorAll("button")];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    }

    function done(value) {
      if (_uiDialogOpen !== done) return;
      _uiDialogOpen = null;
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.remove("is-visible");
      setTimeout(() => overlay.remove(), 180);
      try { prevFocus?.focus?.(); } catch (_) {}
      resolve(value);
    }

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) done(buttons.find((b) => b.cancel)?.value ?? null);
    });
    document.addEventListener("keydown", onKey, true);
    _uiDialogOpen = done;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add("is-visible");
      (focusBtn || actions.lastElementChild)?.focus();
    });
  });
}

/**
 * Conferma dell'app. Risolve true se l'utente conferma.
 * @param {string|{title?:string,message?:string,html?:string,confirmText?:string,cancelText?:string,danger?:boolean}} opts
 */
async function uiConfirm(opts) {
  const o = typeof opts === "string" ? { message: opts } : (opts || {});
  const danger = !!o.danger;
  const res = await _uiDialog({
    title: o.title || "Confermi?",
    message: o.message,
    html: o.html,
    kind: danger ? "danger" : "info",
    buttons: [
      // azione distruttiva: il fuoco parte da "Annulla", un Invio distratto non cancella nulla
      { label: o.cancelText || "Annulla", value: false, cls: "btn-ghost", cancel: true, focus: danger },
      { label: o.confirmText || "Conferma", value: true, cls: danger ? "btn-danger-solid" : "primary", focus: !danger },
    ],
  });
  return res === true;
}

/**
 * Avviso dell'app (un solo pulsante).
 * @param {string|{title?:string,message?:string,html?:string,kind?:"info"|"error"|"success"}} opts
 */
async function uiAlert(opts) {
  const o = typeof opts === "string" ? { message: opts } : (opts || {});
  const kind = o.kind || "info";
  const defaultTitle = kind === "error" ? "Operazione non riuscita" : kind === "success" ? "Fatto" : "Attenzione";
  await _uiDialog({
    title: o.title || defaultTitle,
    message: o.message,
    html: o.html,
    kind,
    buttons: [{ label: o.okText || "Ho capito", value: true, cls: "primary", cancel: true, focus: true }],
  });
}

/* ---------- SCRITTURE SUL DB ---------- */
/**
 * Chiama un metodo di scrittura dell'Api Python.
 * A differenza di apiCall (che per le letture restituisce null in caso d'errore),
 * qui un errore viene LANCIATO con un messaggio leggibile: chi chiama deve mostrarlo
 * e riallineare l'interfaccia a ciò che è davvero salvato.
 */
async function apiWrite(method, ...args) {
  const api = window.pywebview && window.pywebview.api;
  if (!api || typeof api[method] !== "function") {
    throw new Error("Collegamento con l'app non pronto: riprova tra qualche secondo.");
  }
  try {
    return await api[method](...args);
  } catch (e) {
    console.error(`[DB] scrittura ${method} non riuscita`, e);
    const detail = String(e?.message || e || "").replace(/^\w*Error:\s*/, "").trim();
    throw new Error(detail ? `Salvataggio non riuscito: ${detail}` : "Salvataggio non riuscito.", { cause: e });
  }
}

/* ---------- ICONA (i) CON SPIEGAZIONE ---------- */
/** HTML di un'icona (i). Il testo viene messo al sicuro. */
function infoTip(text, label = "Informazioni") {
  return `<button type="button" class="info-tip" data-tip="${uiEscape(text)}" aria-label="${uiEscape(label)}">i</button>`;
}

(function initInfoTips() {
  let bubble = null;
  let owner = null;
  let pinned = false;

  function ensureBubble() {
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "ui-tip-bubble";
      bubble.setAttribute("role", "tooltip");
      bubble.id = "uiTipBubble";
      document.body.appendChild(bubble);
    }
    return bubble;
  }

  function place(el) {
    const b = ensureBubble();
    const r = el.getBoundingClientRect();
    const bw = b.offsetWidth, bh = b.offsetHeight, gap = 10, margin = 10;
    let top = r.top - bh - gap;
    let below = false;
    if (top < margin) { top = r.bottom + gap; below = true; }
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - bw - margin));
    b.style.top = `${Math.round(top)}px`;
    b.style.left = `${Math.round(left)}px`;
    b.style.setProperty("--arrow-x", `${Math.round(r.left + r.width / 2 - left)}px`);
    b.classList.toggle("is-below", below);
  }

  function show(el) {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    owner = el;
    const b = ensureBubble();
    b.textContent = text;
    b.classList.add("is-visible");
    el.setAttribute("aria-describedby", "uiTipBubble");
    place(el);
  }

  function hide() {
    if (!bubble) return;
    bubble.classList.remove("is-visible");
    owner?.removeAttribute("aria-describedby");
    owner = null;
    pinned = false;
  }

  document.addEventListener("mouseover", (e) => {
    if (owner && !owner.isConnected) hide(); // l'elemento non c'è più (cambio pagina, ridisegno)
    const el = e.target.closest?.("[data-tip]");
    if (el && el !== owner && !pinned) show(el);
  });
  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el && el === owner && !pinned && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === owner && !pinned) hide();
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.(".info-tip");
    if (el) {
      // l'icona (i) non deve attivare il controllo che la contiene (label, riga cliccabile, ...)
      e.preventDefault();
      e.stopPropagation();
      if (owner === el && pinned) { hide(); return; }
      show(el);
      pinned = true;
      return;
    }
    if (pinned) hide();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && owner) hide(); });
  window.addEventListener("scroll", () => { if (owner) hide(); }, true);
  window.addEventListener("resize", () => { if (owner) hide(); });
  window.uiHideTip = hide;
})();
