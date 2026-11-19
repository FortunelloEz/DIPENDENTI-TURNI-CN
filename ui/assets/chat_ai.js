// =========================
// Turni CN — AI Chat Assistant
// Gemini 2.0 Flash — chiamata diretta dal browser, no backend Python
// =========================

const CHAT_GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const CHAT_SYSTEM_PROMPT =
`Sei un assistente di analisi turni per Cascina Nascosta. Il tuo unico compito è ragionare sui dati della settimana corrente che ti vengono passati nel contesto.

STRUTTURA DEL CONTESTO:
- dipendenti: lista con id, nome, tipo (indeterminato/determinato), ruolo_preferito, skill per ruolo (0-10), ore_settimana (ore già assegnate questa settimana).
- turni_assegnati: chi è in servizio per ogni giorno/fascia/ruolo (vista aggregata mattina/pomeriggio).
- fabbisogno_squadre: quante persone servono per ogni ruolo/giorno/fascia.
- disponibilita_csv: range orario di disponibilità di ogni dipendente per ogni giorno (es. "12-18"). Se non c'è CSV importato, il campo lo indica.
- slot_scoperti: buchi reali calcolati mezz'ora per mezz'ora. Ogni voce ha giorno, ruolo, fascia, dalle, alle, mancano (quante persone mancano). Usa questo campo come fonte primaria per identificare problemi.

REGOLE ASSOLUTE:
- Rispondi SOLO in italiano.
- Sii estremamente breve: massimo 3-5 righe per risposta. Niente elenchi lunghi, niente paragrafi.
- Usa i nomi reali dei dipendenti dal contesto, mai nomi inventati.
- NON suggerire mai di modificare skill, configurazioni, impostazioni o struttura del sistema. Il sistema è stabile e non si tocca.
- Ragiona SOLO sui dati esistenti: chi c'è, chi manca, chi è assegnato dove, quali slot sono scoperti.
- Per suggerire chi può coprire un buco, verifica che la disponibilita_csv di quella persona copra l'orario del buco. Non suggerire persone non disponibili.
- Se uno slot è scoperto, suggerisci chi (tra i presenti nel contesto con disponibilità compatibile) potrebbe coprirlo e perché, citando skill e ore già lavorate.
- Se la risposta è "tutto ok", dillo in una riga.
- Non fare analisi che non ti vengono chieste. Rispondi al punto.

AZIONI MODIFICHE TURNO:
Quando suggerisci una sostituzione CONCRETA e PRECISA (es. "sostituisci Mario con Paolo sabato mattina alla Cassa"), aggiungi alla fine della risposta il marcatore ---ACTION--- seguito da un oggetto JSON su una singola riga:
{"action":"replace","day":N,"shift":"morning","role":"Cassa","remove_id":N,"add_id":N}
- day: 0=Lun, 1=Mar, 2=Mer, 3=Gio, 4=Ven, 5=Sab, 6=Dom
- shift: "morning" (08-16) oppure "evening" (16-24)
- role: uno esatto tra Cassa, Runner, Bar, Comande, Accoglienza, Jolly
- remove_id e add_id: ID numerici presi dal campo "id" dei dipendenti nel contesto
Includi il blocco ---ACTION--- SOLO se la modifica è concreta, hai gli ID precisi, e vale per UN SOLO turno. Non inventare ID.`;

/* Prompt rapidi mostrati nella welcome screen */
const CHAT_OPENING_PROMPTS = [
  '📊 Analizza la settimana corrente',
  '⚠️ Ci sono problemi negli slot?',
  '👥 Chi è sottoutilizzato questa settimana?',
  '🔄 Suggerisci sostituzioni migliorative',
  '📅 Qual è il giorno più critico?',
  '✅ La copertura è sufficiente?',
];

/* Pool di follow-up contestuali mostrati dopo ogni risposta AI (si ruotano) */
const CHAT_FOLLOWUP_POOL = [
  '🔍 Approfondisci questo punto',
  '👤 Chi può coprire i ruoli scoperti?',
  '📅 Analizza un altro giorno della settimana',
  '⚡ Cosa è più urgente da sistemare?',
  '☀️ Dettaglio turno mattina (08–16)',
  '🌙 Dettaglio turno pomeriggio (16–24)',
  '⚖️ La distribuzione delle ore è equa?',
  '🔄 Come migliorare l\'organizzazione?',
  '✅ Cosa funziona bene questa settimana?',
  '⚠️ Quali sono i rischi principali?',
];

/* ---------- Stato interno ---------- */
let _chatHistory = [];      // { role: 'user'|'model', parts: [{text}] }
let _chatIsOpen  = false;
let _chatBusy    = false;
let _chatApiKey  = null;    // caricata dal DB in initChatAi, mai da localStorage

/* ==========================================================================
   CONTEXT BUILDER
   Assembla il contesto della settimana corrente dalle variabili globali di app.js
   ========================================================================== */

function _chatBuildContext() {
  try {
    if (typeof currentWeekStart === 'undefined' || !currentWeekStart) return null;

    const weekKey = weekKeyOf(currentWeekStart);
    const squadData = squads.get(weekKey);

    /* -- Ore lavorate per dipendente (conteggio mezz'ore dagli assignments) -- */
    const oreMap = {};
    DAYS.forEach((_, di) => {
      ROLES.forEach(role => {
        HALF_HOURS.forEach(t => {
          getAssignedIdsFor(weekKey, di, role, t).forEach(id => {
            oreMap[String(id)] = (oreMap[String(id)] || 0) + 0.5;
          });
        });
      });
    });

    /* -- Dipendenti (con ore settimana calcolate) -- */
    const dipendenti = (employees || []).map(e => ({
      id:              e.id,
      nome:            e.label,
      tipo:            e.is_permanent ? 'indeterminato' : 'determinato',
      ruolo_preferito: e.preferred_role || '—',
      skill:           e.skills || {},
      ore_settimana:   Math.round((oreMap[String(e.id)] || 0) * 10) / 10,
    }));

    /* -- Turni assegnati (raggruppa per giorno/fascia/ruolo) -- */
    const idx16 = HALF_HOURS.indexOf('16:00');
    const morningLabels = HALF_HOURS.slice(0, idx16);
    const eveningLabels = HALF_HOURS.slice(idx16);
    const turni = [];

    DAYS.forEach((dayName, di) => {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + di);
      const dataStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      ROLES.forEach(role => {
        const mIds = unionAssignedOverLabels(weekKey, di, role, morningLabels);
        const eIds = unionAssignedOverLabels(weekKey, di, role, eveningLabels);
        if (mIds.length) turni.push({
          giorno: dayName, data: dataStr, fascia: 'mattina (08-16)',
          ruolo: role,
          dipendenti: mIds.map(id => getEmployeeById(id)?.label || `ID:${id}`)
        });
        if (eIds.length) turni.push({
          giorno: dayName, data: dataStr, fascia: 'pomeriggio (16-24)',
          ruolo: role,
          dipendenti: eIds.map(id => getEmployeeById(id)?.label || `ID:${id}`)
        });
      });
    });

    /* -- Fabbisogno squadre -- */
    const fabbisogno = [];
    if (squadData) {
      DAYS.forEach((dayName, di) => {
        const day = squadData[di];
        if (!day) return;
        ['morning', 'evening'].forEach(slot => {
          const label = slot === 'morning' ? 'mattina (08-16)' : 'pomeriggio (16-24)';
          const entry = { giorno: dayName, fascia: label };
          ROLES.forEach(r => { entry[r] = day[slot]?.[r] || 0; });
          fabbisogno.push(entry);
        });
      });
    }

    /* -- Disponibilità CSV dettagliata: range orario per dipendente/giorno -- */
    const disponibilita_csv = [];
    const preview = window._lastAvailabilityPreview;
    if (preview && Array.isArray(preview.days) && preview.days.length) {
      preview.days.forEach(dayData => {
        const dayName = DAYS[dayData.day_index] ?? `G${dayData.day_index}`;
        (dayData.items || []).forEach(it => {
          if (it.name && it.range)
            disponibilita_csv.push({ nome: it.name, giorno: dayName, ore: it.range });
        });
      });
    }
    if (!disponibilita_csv.length)
      disponibilita_csv.push({ nota: 'Nessuna disponibilità CSV importata.' });

    /* -- Slot scoperti: buchi reali raggruppati per range consecutivo -- */
    const slot_scoperti = [];
    if (squadData) {
      const mHours = HALF_HOURS.filter(t => { const h = parseInt(t); return h >= 8  && h < 16; });
      const eHours = HALF_HOURS.filter(t => { const h = parseInt(t); return h >= 16 && h < 24; });

      DAYS.forEach((dayName, di) => {
        const day = squadData[di];
        if (!day) return;

        [['morning', 'mattina', mHours], ['evening', 'pomeriggio', eHours]].forEach(([slot, slotIt, labels]) => {
          ROLES.forEach(role => {
            const required = day[slot]?.[role] || 0;
            if (required <= 0) return;

            let gapStart = null;
            let minCov    = required;

            labels.forEach((t, idx) => {
              const covered = getAssignedIdsFor(weekKey, di, role, t).length;
              if (covered < required) {
                if (gapStart === null) { gapStart = t; minCov = covered; }
                else minCov = Math.min(minCov, covered);
              } else {
                if (gapStart !== null) {
                  const prevT = labels[idx - 1];
                  slot_scoperti.push({
                    giorno: dayName, ruolo: role, fascia: slotIt,
                    dalle: gapStart,
                    alle:  `${parseInt(prevT.split(':')[0]) + 1}:00`,
                    mancano: required - minCov,
                  });
                  gapStart = null; minCov = required;
                }
              }
            });
            if (gapStart !== null) {
              const lastT = labels[labels.length - 1];
              slot_scoperti.push({
                giorno: dayName, ruolo: role, fascia: slotIt,
                dalle: gapStart,
                alle:  `${parseInt(lastT.split(':')[0]) + 1}:00`,
                mancano: required - minCov,
              });
            }
          });
        });
      });
    }

    return {
      settimana:        weekKey,
      dipendenti,
      turni_assegnati:  turni,
      fabbisogno_squadre: fabbisogno,
      disponibilita_csv,
      slot_scoperti,
    };

  } catch (err) {
    console.warn('[ChatAI] buildContext error:', err);
    return null;
  }
}

/* ==========================================================================
   GEMINI API CALL
   ========================================================================== */

async function _chatCallGemini(userText) {
  const apiKey = _chatApiKey;
  if (!apiKey) throw Object.assign(new Error('Nessuna API key configurata.'), { code: 'NO_KEY' });

  const ctx = _chatBuildContext();
  const sysText = CHAT_SYSTEM_PROMPT +
    (ctx
      ? `\n\n--- CONTESTO SETTIMANA ${ctx.settimana} ---\n${JSON.stringify(ctx)}`
      : '\n\n[Contesto settimana non disponibile]');

  _chatHistory.push({ role: 'user', parts: [{ text: userText }] });

  // Sliding window: massimo 12 coppie user+model nel payload — evita payload enormi
  const MAX_TURNS = 12;
  let contents = _chatHistory;
  if (_chatHistory.length > MAX_TURNS * 2 + 1) {
    const tail = _chatHistory.slice(-(MAX_TURNS * 2 + 1));
    const firstUser = tail.findIndex(m => m.role === 'user');
    contents = firstUser > 0 ? tail.slice(firstUser) : tail;
  }

  let resp, data;
  try {
    // Chiave nell'header (non nell'URL): non finisce in log o cronologie delle richieste.
    resp = await fetch(CHAT_GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sysText }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
      })
    });
    data = await resp.json();
  } catch (netErr) {
    _chatHistory.pop();
    throw new Error('Errore di rete: ' + netErr.message);
  }

  if (!resp.ok) {
    _chatHistory.pop();
    throw new Error(data?.error?.message || `HTTP ${resp.status}`);
  }

  const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '(risposta vuota)';
  // Salva testo pulito in history (senza ---ACTION--- block, se presente)
  const actionIdx = aiText.indexOf('---ACTION---');
  const historyText = actionIdx !== -1 ? aiText.substring(0, actionIdx).trim() : aiText;
  _chatHistory.push({ role: 'model', parts: [{ text: historyText }] });
  return aiText;
}

/* ==========================================================================
   MARKDOWN RENDERER (minimale per risposte AI)
   ========================================================================== */

function _chatMd(raw) {
  const esc = s => s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>');

  const lines = raw.split('\n');
  let html = '';
  let inList = false;

  for (const line of lines) {
    // Heading
    if (/^#{1,3} /.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h4>${inline(esc(line.replace(/^#{1,3} /, '')))}</h4>`;
      continue;
    }
    // List item
    if (/^[-*•] /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(esc(line.replace(/^[-*•] /, '')))}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    // Empty line
    if (line.trim() === '') continue;
    // Paragraph
    html += `<p>${inline(esc(line))}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

/* ==========================================================================
   DOM HELPERS
   ========================================================================== */

function _chatNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function _chatAppendMsg(role, content, isHtml = false) {
  const msgs = document.getElementById('chatAiMessages');
  if (!msgs) return;
  // Rimuove la welcome screen se presente
  msgs.querySelector('.chat-welcome-wrap')?.remove();

  const wrap = document.createElement('div');
  wrap.className = `chat-msg chat-msg--${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  if (isHtml) bubble.innerHTML = content;
  else        bubble.textContent = content;
  wrap.appendChild(bubble);

  const ts = document.createElement('span');
  ts.className = 'chat-msg-time';
  ts.textContent = _chatNow();
  wrap.appendChild(ts);

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function _chatAppendError(msg) {
  const msgs = document.getElementById('chatAiMessages');
  if (!msgs) return;
  const el = document.createElement('div');
  el.className = 'chat-msg-error';
  el.textContent = msg;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function _chatSetBusy(on) {
  _chatBusy = on;
  const sendBtn = document.getElementById('chatAiSendBtn');
  const input   = document.getElementById('chatAiInput');
  const typing  = document.getElementById('chatAiTyping');
  if (sendBtn) sendBtn.disabled = on;
  if (input)   input.disabled   = on;
  if (typing)  typing.style.display = on ? 'flex' : 'none';
}

function _chatUpdateCtxBar() {
  const weekEl = document.getElementById('chatAiCtxWeek');
  const infoEl = document.getElementById('chatAiCtxInfo');
  if (weekEl && typeof currentWeekStart !== 'undefined' && currentWeekStart) {
    weekEl.textContent = weekKeyOf(currentWeekStart);
  }
  if (infoEl && Array.isArray(employees)) {
    const hasAvail = !!(window._lastAvailabilityPreview?.days?.length);
    const ctx = _chatBuildContext();
    const gaps = ctx?.slot_scoperti?.length || 0;
    const gapStr = gaps > 0 ? ` · ⚠️ ${gaps} slot scoperti` : '';
    infoEl.textContent = `${employees.length} dip.${hasAvail ? ' · CSV' : ''}${gapStr}`;
  }
}

/* ==========================================================================
   WELCOME SCREEN
   ========================================================================== */

function _chatShowWelcome() {
  const msgs = document.getElementById('chatAiMessages');
  if (!msgs || msgs.querySelector('.chat-welcome-wrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'chat-welcome-wrap';

  const w = document.createElement('div');
  w.className = 'chat-welcome';
  w.innerHTML = `
    <div class="chat-welcome-icon">🤖</div>
    <div class="chat-welcome-title">Come posso aiutarti?</div>
    <div class="chat-welcome-sub">
      Chiedimi di analizzare i turni, trovare slot scoperti,<br>
      suggerire sostituzioni o segnalare anomalie.
    </div>
  `;
  wrap.appendChild(w);

  const grid = document.createElement('div');
  grid.className = 'chat-opening-grid';
  CHAT_OPENING_PROMPTS.forEach(s => {
    const chip = document.createElement('button');
    chip.className = 'chat-opening-chip';
    chip.textContent = s;
    chip.addEventListener('click', e => { e.stopPropagation(); _chatSend(s); });
    grid.appendChild(chip);
  });
  wrap.appendChild(grid);

  msgs.appendChild(wrap);
}

/* ==========================================================================
   FOLLOW-UP SUGGESTIONS (dopo ogni risposta AI)
   ========================================================================== */

function _chatPickFollowups() {
  /* Ruota il pool di 4 in 4 ad ogni turno di conversazione */
  const turn   = Math.floor(_chatHistory.length / 2);
  const offset = (turn * 4) % CHAT_FOLLOWUP_POOL.length;
  const result = [];
  for (let i = 0; i < 4; i++) {
    result.push(CHAT_FOLLOWUP_POOL[(offset + i) % CHAT_FOLLOWUP_POOL.length]);
  }
  return result;
}

function _chatAppendFollowups() {
  const msgs = document.getElementById('chatAiMessages');
  if (!msgs) return;

  const wrap = document.createElement('div');
  wrap.className = 'chat-followups';

  _chatPickFollowups().forEach(s => {
    const chip = document.createElement('button');
    chip.className = 'chat-followup-chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      /* Marca la chip come usata e invia */
      chip.classList.add('chat-followup-chip--used');
      chip.disabled = true;
      _chatSend(s);
    });
    wrap.appendChild(chip);
  });

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

/* ==========================================================================
   RESET CONVERSAZIONE
   ========================================================================== */

function _chatReset() {
  _chatHistory = [];
  const msgs = document.getElementById('chatAiMessages');
  if (msgs) msgs.innerHTML = '';
  _chatShowWelcome();
  document.getElementById('chatAiInput')?.focus();
}

/* ==========================================================================
   FORM API KEY INLINE (mostrato nei messaggi se non c'è key)
   ========================================================================== */

function _chatShowKeyForm() {
  const msgs = document.getElementById('chatAiMessages');
  if (!msgs || msgs.querySelector('.chat-setup-form')) return;

  const form = document.createElement('div');
  form.className = 'chat-setup-form';
  form.innerHTML = `
    <div class="chat-setup-title">🔑 Configura Gemini AI</div>
    <div class="chat-setup-desc">
      Questa funzione usa <strong>Gemini AI di Google</strong>. Hai bisogno di una
      API key gratuita da
      <a href="https://aistudio.google.com/apikey" target="_blank" class="chat-setup-link">
        Google AI Studio →
      </a><br>
      <span style="opacity:.75;font-size:11px">La chiave viene salvata nel database locale dell'app, non inviata al backend Python.</span>
    </div>
    <input type="password" class="chat-setup-input" id="chatSetupKeyInput"
           placeholder="Incolla qui la tua API key (AIza...)" autocomplete="off" spellcheck="false" />
    <button class="chat-setup-save-btn" id="chatSetupSaveBtn">✓ Salva e inizia</button>
  `;
  msgs.appendChild(form);
  msgs.scrollTop = msgs.scrollHeight;

  form.querySelector('#chatSetupSaveBtn')?.addEventListener('click', async () => {
    const val = form.querySelector('#chatSetupKeyInput')?.value?.trim();
    if (!val) return;
    _chatApiKey = val;
    await apiCall('gemini_key_set', val);
    form.remove();
    _chatSyncSettingsInput();
    _chatAppendMsg('ai', '<p>✅ API key salvata. Ora puoi fare le tue domande!</p>', true);
  });
  form.querySelector('#chatSetupKeyInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') form.querySelector('#chatSetupSaveBtn')?.click();
  });
  form.querySelector('#chatSetupKeyInput')?.focus();
}

/* ==========================================================================
   SETTINGS PANEL (sezione collassabile in cima al pannello)
   ========================================================================== */

function _chatToggleSettings() {
  const section = document.getElementById('chatAiSettingsSection');
  if (!section) return;
  const isHidden = section.classList.toggle('hidden');
  if (!isHidden) {
    // Mostra key mascherata se presente
    _chatSyncSettingsInput();
    document.getElementById('chatAiKeyInput')?.focus();
  }
}

function _chatSyncSettingsInput() {
  const inp = document.getElementById('chatAiKeyInput');
  if (!inp) return;
  const has = !!_chatApiKey;
  inp.value       = has ? '•••••••••••••••••••' : '';
  inp.placeholder = has ? '(modifica per cambiare)' : 'AIza...';
  inp.dataset.hasKey = has ? '1' : '0';
}

/* ==========================================================================
   ACTION EXTRACTION — legge blocco ---ACTION--- dalla risposta AI
   ========================================================================== */

function _chatExtractAction(rawText) {
  const MARKER = '---ACTION---';
  const idx = rawText.indexOf(MARKER);
  if (idx === -1) return { text: rawText, action: null };
  const cleanText = rawText.substring(0, idx).trim();
  const jsonStr   = rawText.substring(idx + MARKER.length).trim();
  try {
    const action = JSON.parse(jsonStr);
    if (action && action.action === 'replace' &&
        typeof action.day === 'number' &&
        (action.shift === 'morning' || action.shift === 'evening') &&
        typeof action.role === 'string' &&
        action.remove_id != null && action.add_id != null) {
      return { text: cleanText, action };
    }
  } catch (_) {}
  return { text: cleanText, action: null };
}

function _chatAppendApplyBtn(action) {
  const msgs = document.getElementById('chatAiMessages');
  if (!msgs) return;

  const DAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const shiftIt = action.shift === 'morning' ? 'Mattina' : 'Pomeriggio';
  const remEmp  = (typeof getEmployeeById === 'function') ? getEmployeeById(action.remove_id) : null;
  const addEmp  = (typeof getEmployeeById === 'function') ? getEmployeeById(action.add_id)    : null;
  const remName = remEmp?.label || `#${action.remove_id}`;
  const addName = addEmp?.label || `#${action.add_id}`;
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const wrap = document.createElement('div');
  wrap.className = 'chat-action-wrap';
  wrap.innerHTML = `
    <div class="chat-action-summary">
      <strong>${DAYS_IT[action.day] || `Giorno ${action.day}`}</strong> · ${shiftIt} · ${esc(action.role)}<br>
      <span class="chat-action-remove">✖ ${esc(remName)}</span>
      <span class="chat-action-arrow">→</span>
      <span class="chat-action-add">✚ ${esc(addName)}</span>
    </div>
    <button class="chat-action-btn">✅ Applica questa modifica</button>
  `;

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;

  wrap.querySelector('.chat-action-btn')?.addEventListener('click', async () => {
    await _chatApplyAction(action, wrap);
  });
}

async function _chatApplyAction(action, wrapEl) {
  const btn = wrapEl.querySelector('.chat-action-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Applicazione...'; }

  try {
    const weekKey = (typeof weekKeyOf === 'function' && typeof currentWeekStart !== 'undefined')
      ? weekKeyOf(currentWeekStart) : null;
    if (!weekKey) throw new Error('Settimana corrente non disponibile.');

    const ovList = await apiCall('overrides_get_week', weekKey) || [];

    const shiftStart = action.shift === 'morning' ? 8 : 16;
    const shiftEnd   = action.shift === 'morning' ? 16 : 24;

    const relevantOvs = ovList.filter(ov => {
      if (ov.day_index !== action.day || ov.role !== action.role) return false;
      const h = parseInt((ov.time_label || '').split(':')[0]);
      return h >= shiftStart && h < shiftEnd;
    });

    if (relevantOvs.length === 0) {
      throw new Error('Nessun turno trovato per questo giorno/ruolo/fascia. Verifica che il turno esista nel calendario.');
    }

    const items = relevantOvs.map(ov => {
      let ids = [...(ov.employee_ids || [])];
      ids = ids.filter(id => String(id) !== String(action.remove_id));
      if (!ids.map(String).includes(String(action.add_id))) ids.push(action.add_id);
      return { time_label: ov.time_label, employee_ids: ids };
    });

    await apiCall('overrides_set_many', weekKey, action.day, action.role, items);

    if (typeof loadWeekFromDb === 'function') await loadWeekFromDb(weekKey);

    if (btn) { btn.textContent = '✓ Modificato'; btn.classList.add('chat-action-btn--done'); }
    if (typeof showToast === 'function') showToast('Turno modificato dall\'AI ✓', 'ok');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Applica questa modifica'; }
    if (typeof showToast === 'function') showToast('Errore: ' + err.message, 'err');
  }
}

/* ==========================================================================
   SEND MESSAGE
   ========================================================================== */

async function _chatSend(text) {
  text = (text || '').trim();
  if (!text || _chatBusy) return;

  if (!_chatApiKey) {
    _chatShowKeyForm();
    return;
  }

  // Svuota input e reset altezza
  const inputEl = document.getElementById('chatAiInput');
  if (inputEl) { inputEl.value = ''; inputEl.style.height = ''; }

  // Rimuovi i follow-up precedenti prima di inviare
  const msgs = document.getElementById('chatAiMessages');
  msgs?.querySelectorAll('.chat-followups').forEach(el => el.remove());

  _chatAppendMsg('user', text);
  _chatSetBusy(true);

  try {
    const rawReply = await _chatCallGemini(text);
    const { text: cleanReply, action } = _chatExtractAction(rawReply);
    _chatAppendMsg('ai', _chatMd(cleanReply), true);
    if (action) _chatAppendApplyBtn(action);
    _chatAppendFollowups();
  } catch (err) {
    if (err.code === 'NO_KEY') {
      _chatShowKeyForm();
    } else {
      _chatAppendError('Errore: ' + err.message);
      if (_chatHistory.length === 0) _chatShowWelcome();
    }
  } finally {
    _chatSetBusy(false);
    document.getElementById('chatAiMessages').scrollTop = 99999;
  }
}

/* ==========================================================================
   OPEN / CLOSE
   ========================================================================== */

async function _chatOpenPanel() {
  const panel = document.getElementById('chatAiPanel');
  if (!panel) return;
  panel.classList.add('open');
  _chatIsOpen = true;
  _chatUpdateCtxBar();

  // pywebview potrebbe non essere pronto al DOMContentLoaded; riprova ora
  if (!_chatApiKey) {
    _chatApiKey = await apiCall('gemini_key_get') || null;
    if (_chatApiKey) _chatSyncSettingsInput();
  }

  const msgs = document.getElementById('chatAiMessages');
  if (msgs && msgs.children.length === 0) {
    if (!_chatApiKey) {
      _chatShowKeyForm();
    } else {
      _chatShowWelcome();
    }
  }
  setTimeout(() => {
    const focus = !_chatApiKey
      ? document.getElementById('chatSetupKeyInput')
      : document.getElementById('chatAiInput');
    focus?.focus();
  }, 300);
}

function _chatClosePanel() {
  document.getElementById('chatAiPanel')?.classList.remove('open');
  document.getElementById('chatAiSettingsSection')?.classList.add('hidden');
  _chatIsOpen = false;
}

/* ==========================================================================
   PUBLIC API (chiamato da app.js dopo renderCalendar)
   ========================================================================== */

window.chatAiUpdateContext = function () {
  if (_chatIsOpen) _chatUpdateCtxBar();
};

/* ==========================================================================
   BIND EVENTS (chiamato dopo l'iniezione HTML)
   ========================================================================== */

function _chatBindEvents() {
  /* FAB toggle */
  document.getElementById('chatAiFab')?.addEventListener('click', () => {
    _chatIsOpen ? _chatClosePanel() : _chatOpenPanel();
  });

  /* Chiudi */
  document.getElementById('chatAiCloseBtn')?.addEventListener('click', _chatClosePanel);

  /* Impostazioni */
  document.getElementById('chatAiSettingsBtn')?.addEventListener('click', _chatToggleSettings);

  /* Nuova conversazione */
  document.getElementById('chatAiNewBtn')?.addEventListener('click', _chatReset);

  /* Salva key dalle impostazioni → DB cifrato */
  document.getElementById('chatAiKeySaveBtn')?.addEventListener('click', async () => {
    const inp = document.getElementById('chatAiKeyInput');
    const val = inp?.value?.trim();
    if (!val || val.startsWith('•')) return;
    _chatApiKey = val;
    await apiCall('gemini_key_set', val);
    document.getElementById('chatAiSettingsSection')?.classList.add('hidden');
    if (typeof showToast === 'function') showToast('API key Gemini salvata ✓', 'ok');
  });

  /* Rimuovi key → DB */
  document.getElementById('chatAiKeyDelBtn')?.addEventListener('click', async () => {
    _chatApiKey = null;
    await apiCall('gemini_key_delete');
    _chatSyncSettingsInput();
    document.getElementById('chatAiSettingsSection')?.classList.add('hidden');
    if (typeof showToast === 'function') showToast('API key rimossa', 'ok');
  });

  /* Pulsante Invia */
  document.getElementById('chatAiSendBtn')?.addEventListener('click', () => {
    _chatSend(document.getElementById('chatAiInput')?.value || '');
  });

  /* Textarea: Enter = invia, Shift+Enter = a capo */
  document.getElementById('chatAiInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _chatSend(e.target.value || '');
    }
  });

  /* Auto-resize textarea */
  document.getElementById('chatAiInput')?.addEventListener('input', function () {
    this.style.height = '';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  /* Click fuori dal pannello → chiudi */
  document.addEventListener('click', e => {
    if (!_chatIsOpen) return;
    const panel = document.getElementById('chatAiPanel');
    const fab   = document.getElementById('chatAiFab');
    /* composedPath() cattura il percorso DOM al momento del click, anche se
       l'elemento viene rimosso dal DOM prima che il bubbling arrivi qui */
    const path  = e.composedPath();
    if (panel && !path.includes(panel) && fab && !path.includes(fab)) {
      _chatClosePanel();
    }
  });

  /* Tasto Escape */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _chatIsOpen) _chatClosePanel();
  });
}

/* ==========================================================================
   INIT — fetcha il pannello HTML, lo inietta nel body, poi lega gli eventi
   ========================================================================== */

async function initChatAi() {
  try {
    const html = await fetch('./views/chat_ai_panel.html').then(r => r.text());
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);
  } catch (err) {
    console.error('[ChatAI] Impossibile caricare chat_ai_panel.html:', err);
    return;
  }
  _chatBindEvents();
  // Carica la API key dal DB una volta sola all'avvio — non dipende dall'apertura del pannello
  _chatApiKey = await apiCall('gemini_key_get') || null;
  if (_chatApiKey) console.log('[ChatAI] API key ripristinata dal DB');
}

/* Avvio */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatAi);
} else {
  initChatAi();
}
