// ui/assets/availability_viewer.js
// Mostra disponibilità per giorno come lista: "NOME : 18–24" (basata su window._lastAvailabilityPreview)

const AV_DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

function avEscape(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function avCloseOverlay(){
  document.getElementById("avOverlay")?.remove();
}

function avOpenDay(dayIndex){
  const preview = window._lastAvailabilityPreview;
  if (!preview || !Array.isArray(preview.days) || !preview.days.length){
    alert("Nessuna disponibilità disponibile. Importa prima un CSV.");
    return;
  }

  const day = preview.days.find(d => Number(d.day_index) === Number(dayIndex));
  if (!day){
    alert("Giorno non trovato nella preview disponibilità.");
    return;
  }

  const items = Array.isArray(day.items) ? day.items : [];

  const overlay = document.createElement("div");
  overlay.id = "avOverlay";
  overlay.className = "av-overlay";

  const modal = document.createElement("div");
  modal.className = "av-modal";

  modal.innerHTML = `
    <div class="av-head">
      <div class="av-title">Disponibilità — ${avEscape(AV_DAYS[dayIndex])} (${avEscape(day.iso_day)})</div>
      <button class="av-x" id="avCloseBtn">✕</button>
    </div>

    <div class="av-body-list">
      ${
        items.length
          ? items.map(it => `
              <div class="av-row">
                <div class="av-name">${avEscape(it.name)}</div>
                <div class="av-range">${avEscape(it.range)}</div>
              </div>
            `).join("")
          : `<div class="av-empty">Nessuno</div>`
      }
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById("avCloseBtn")?.addEventListener("click", avCloseOverlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) avCloseOverlay();
  });
}

function avRenderButtons(){
  const host = document.getElementById("availabilityActions");
  if (!host) return;

  // evita doppio render
  if (host.dataset.built === "1") return;
  host.dataset.built = "1";

  host.innerHTML = `
    <div class="av-toolbar">
      <div class="av-toolbar-title">Vedi disponibilità:</div>
      <div class="av-toolbar-btns" id="avBtns"></div>
    </div>
  `;

  const btns = host.querySelector("#avBtns");
  AV_DAYS.forEach((d, i) => {
    const b = document.createElement("button");
    b.className = "btn btn-small btn-ghost av-btn";
    b.textContent = d;
    b.addEventListener("click", () => avOpenDay(i));
    btns.appendChild(b);
  });
}

window.bindAvailabilityViewer = function bindAvailabilityViewer(){
  avRenderButtons();
};