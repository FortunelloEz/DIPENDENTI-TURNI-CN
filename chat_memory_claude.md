# MEMORIA CLAUDE — TurniCN
> Aggiorna questa sezione ogni volta che si fanno modifiche rilevanti.

---

## Cos'è il progetto

App desktop **Windows** per la gestione dei turni settimanali di **Cascina Nascosta**.
Distribuita come `.exe` (PyInstaller + Inno Setup), gira come finestra nativa via **pywebview**.

---

## Stack tecnologico

| Livello | Tecnologia |
|---------|-----------|
| Backend | Python 3.13, classe `Api` esposta a pywebview come `js_api` |
| DB | SQLite, gestito da `cn_turni/db.py` (classe `Db`) |
| Frontend | HTML/CSS/JS vanilla caricati da pywebview come file locali |
| PDF | reportlab (landscape A4) |
| Packaging | PyInstaller (`TurniCN.spec`) + Inno Setup (`TurniCN.iss`) |

---

## Struttura file chiave

```
cn_turni/
  main.py              entrypoint
  api.py               classe Api (tutti i metodi chiamabili da JS)
  db.py                classe Db (schema SQLite + queries)
  paths.py             singleton Paths (root, data_dir, db_path)
  app_settings.py      impostazioni modificabili: schema unico (predefiniti, limiti, testi) + validazione
  services/
    assistant.py       assistente locale: risposte dal DB, modifiche con anteprima + apply atomico
    auto_scheduler.py  build_plan: scheduling macro-slot morning/evening
    import_service.py  orchestrazione CSV → build_plan → fill-gap → swap → salva overrides
    csv_availability.py  parsing CSV disponibilità
    export_service.py  build_week_export / build_week_export_simple
    pdf_export.py      build_pdf_from_export / build_pdf_from_export_simple
    balance_optimizer.py  bilanciamento esatto dei ruoli per fascia (max-min skill, poi somma)

ui/
  index.html           shell: sidebar (brand, nav con icone SVG, versione) + <div id="view"> + script tags
  assets/
    ui_kit.js          UI KIT condiviso (caricato per primo): showToast, uiConfirm, uiAlert,
                       apiWrite (scritture che lanciano errore), infoTip + tooltip (i)
    app.js             CORE: routing, calendario, modali, stato UI globale, resyncWeekFromDb
    employees.js       CRUD dipendenti
    squads.js          fabbisogni settimanali + tipi giornata
    import_availability.js  flusso import CSV
    import_resolver.js      modal risoluzione nomi sconosciuti
    custom_slot_resolver.js  modal celle CSV ambigue
    availability_viewer.js   visualizzatore disponibilità post-import
    export.js          view export + PDF download (normale e semplificato)
    db_adapter.js      apiCall (letture, null se errore) + funzioni di load/save (le save usano apiWrite)
    assistant.js       Assistente locale (pannello, anteprima e conferma delle modifiche)
    report.js          Scheda Report (settimana + storico)
  views/ + customization/   HTML e CSS per ogni sezione
  customization/ui_kit.css  DESIGN SYSTEM, caricato per ultimo: token slate/blue-600, pulsanti, campi,
                            finestre, notifiche, (i), barra laterale

tests/
  test_balance_optimizer.py bilanciamento (6+7 meglio di 10+1, scelta del ruolo da lasciare scoperto)
  test_settings_rules.py    ogni impostazione cambia davvero il risultato
  test_assistant.py         assistente locale
  test_csv_availability.py  parser CSV (mezz'ore, "18-01", Capodanno)
  test_import_service.py    import end-to-end su DB temporaneo (alias, riposi, squadre, copia settimana)
  test_export_service.py    orari dell'export con mezz'ore

Lint UI: `npx eslint ui/assets` (eslint.config.mjs ricava le globali condivise dai file).
```

---

## Database SQLite — tabelle principali

| Tabella | Contenuto |
|---------|-----------|
| `employees` | name, is_permanent, preferred_role, slot_morning/evening, aliases, work_days, max_daily_hours, weekly_hours_target |
| `employee_skills` | employee_id, role, rank (0–10) |
| `schedule_override` | week_id, day_index, role, time_label, employee_ids (JSON) |
| `squads_required` | week_id, day_index, shift, role, required |
| `permanent_week` | week_id, employee_id, day_off (0..6), target_hours |
| `squads_templates` | template fabbisogni |
| `day_type_presets/assignments` | tipo giornata per giorno |
| `imported_files` | storico CSV: filename, file_path, week_key |
| `availability_cache` | cache CSV disponibilità (week_id, riga sentinella `_preview`) |
| `settings` | chiave/valore generici (es. `lastWeekKey`; `gemini_api_key` è un residuo non più usato) |

---

## Concetti chiave del dominio

- **week_key**: ISO del lunedì (es. `"2026-01-06"`) — usata in UI
- **week_id**: martedì della stessa settimana (week_key + 1 giorno) — chiave nel DB (evita ambiguità cambio anno)
- **slots**: `"morning"` (08:00–16:00) e `"evening"` (16:00–24:00)
- **time_label**: singole mezz'ore `"HH:MM"` — es. `"08:00"`, `"08:30"`, ..., `"23:30"`
- **ruoli fissi**: `["Cassa", "Runner", "Bar", "Comande", "Accoglienza", "Jolly"]`
- **by_cell**: `dict[tuple[int, str, str], list[int]]` keyed by `(day_index, time_label, role)` — struttura core post-build_plan
- **busy_by_time**: `dict[tuple[int, str], set[int]]` — evita doppia prenotazione stessa mezz'ora
- **daily_halfhours**: `dict[tuple[int, int], int]` — conta mezz'ore per (emp_id, day)

---

## Flusso principale: Import CSV → Calendario

```
[Utente clicca "Importa CSV"]
  → ImportService.import_availability_and_autofill()
      → parse_availability_csv → availability dict
      → se nomi sconosciuti → needs_resolution (alias/crea)
      → se celle ambigue   → needs_custom_slot_resolution
      → build_plan(week_days_iso, employees, permanent_settings, availability, squads_need)
          → Plan dict: {day → {slot → {role → [emp_id, ...]}}}
      → fill-gap loop (opportunity-cost scoring per mezz'ora)
      → two_opt_swap (post-assegnazione, massimo 50 swap)
      → db.overrides_bulk_save (unica transazione atomica)
      → ritorna ok + deficits + availability_preview
  → JS: loadWeekFromDb + renderCalendar
```

---

## Logica Auto-Scheduler (`auto_scheduler.py → build_plan`)

**Fase 1 — Permanenti:** per ogni giorno/slot/ruolo (scarsità prima), scegli candidato valido con `_candidate_priority` (preservation_margin, skill, preferred_role, meno alternative). Rispetta day_off, target_hours, work_days, slot_morning/evening, disponibilità CSV.

**Fase 2 — Determinati:** stesse regole senza target_hours. Indifferenti → slot con copertura peggiore (`_choose_slot_for_indifferent_budgeted`).

**Bilanciamento indifferenti:** `BALANCE_TOLERANCE=0.20`; emette `BalanceWarning` per giorni sbilanciati > 20%.

**Output:** `(Plan, List[NeedDeficit], List[BalanceWarning])`

---

## Fill-gap con scoring a costo opportunità (`import_service.py`)

Dopo `build_plan`, per ogni `(day, time_label)` con posti scoperti:
- Ordina ruoli per **scarsità candidati** (meno candidati = priorità più alta)
- Sceglie candidato con score `(preservation_margin, skill, continuity_adiacente, preferred, -weekly_hh, -daily_hh)`
- `preservation_margin = skill_ruolo − max(skill_altri_ruoli_scoperti)` → forti dove sono insostituibili
- `continuity = extends_back + extends_fwd` (adiacenza, non scatter)

**Fix critico (bug storico):** `squads_week_get` restituisce chiavi stringa `"0","1",...` ma il loop usa `d` intero. Fix necessario:
```python
squads_need = {int(k): v for k, v in (self.db.squads_week_get(week_id) or {}).items()}
```

---

## Bilanciamento dei ruoli (`balance_optimizer.py`) — sostituisce skill-upgrade e 2-opt (2026-11-19)

- Obiettivo dell'utente: a parità di copertura la squadra più EQUILIBRATA (6+7 meglio di 10+1).
- Per giorno e fascia: gruppi = persone con lo stesso orario esatto e un solo ruolo. Posti del gruppo =
  ruoli dei membri + posti ancora scoperti per tutto quell'orario. Candidati = membri + liberi che rispettano
  tutti i limiti (`_free_for` in import_service).
- Soluzione esatta: priorità 1) più posti coperti 2) skill minima più alta (soglia decrescente) 3) somma più alta
  4) mansione preferita 5) nessun cambio inutile. Algoritmo ungherese con colonne "posto vuoto".
- Verifica: confronto con la soluzione ottima su 300 casi casuali → 300/300 (prima 191/300; 81 casi con
  skill minima più bassa del necessario).
- Dopo il bilanciamento: pulizia dei pezzi < «Durata minima» e, se non consentiti, dei turni spezzati;
  poi scoperti calcolati sul risultato FINALE (`deficits` della risposta di import).

## Impostazioni (`app_settings.py`, pagina `settings`)

- Schema unico Python → la UI costruisce il modulo da `Api.app_settings_get`; `app_settings_save` valida tutto
  e salva in una transazione (`Db.settings_set_many`, chiavi `cfg.<chiave>`).
- Usate da: import (max ore/giorno turnisti e indeterminati, ore settimanali indeterminati, indeterminati assenti
  dal CSV, riposo minimo, durata minima, turni spezzati), export (giorni di apertura), avvio (conservazione mesi).
- Indeterminati: le ore settimanali vengono SOLO dalla finestra «Indeterminati» o dal predefinito; 0 ore = 0
  (prima diventava 40 sia in import sia in `permanent_week_set`).

## Export PDF (`export_service.py`, `pdf_export.py`, `api.py`)

**Normale** (`build_week_export` / `build_pdf_from_export`):
- 6 giorni (Mar–Dom), 2 colonne per giorno (MATTINA/SERA), colorazione per ruolo

**Semplificato** (`build_week_export_simple` / `build_pdf_from_export_simple`):
- 6 giorni, 1 colonna per giorno
- Range orario complessivo: unisce tutti i time_label del dipendente per quel giorno (ignora split mattina/sera) → es. "10-19"
- Ruolo dominante = quello con più mezz'ore
- Attivato da `btnExportPdfSimple` → `api.export_week_simple_pdf_save_dialog(week_key)`

---

## Assistente locale (`assistant.py` + `assistant.js`) — sostituisce la chat Gemini (2026-11-19)

- Nessun modello di linguaggio, nessuna rete, nessuna chiave. Motore in `cn_turni/services/assistant.py`,
  esposto da `Api.assistant_ask(week_key, text)` e `Api.assistant_apply(week_key, action)`.
- Capisce un insieme chiuso di richieste (scoperti, chi lavora, chi è libero, ore di una persona, giorno critico,
  riepilogo; sostituisci / aggiungi / togli). Riconoscimento: testo normalizzato (minuscolo, senza accenti),
  nomi per nome completo/alias → parola del nome → inizio di parola («leo»); parole comuni (es. «della») valgono
  come nome solo se non c'è un nome più sicuro; nomi ambigui → chiede quale.
- `ask` non scrive mai: per le modifiche restituisce anteprima + avvisi + `action.params` già risolti.
  `apply` ricalcola il piano sul DB attuale e scrive con `Db.overrides_set_cells` (una transazione).
  Rifiuta: persona non disponibile secondo il CSV, doppio ruolo nello stesso orario.
- UI: pannello costruito da `ui/assets/assistant.js` (stile `assistant.css`), aggiornato dal calendario con
  `window.assistantRefresh()`. Test: `tests/test_assistant.py`.
- La vecchia chiave Gemini eventualmente salvata resta nella tabella `settings` (`gemini_api_key`) ma non è più usata.

---ACTION---` nella risposta → card "Applica" → `overrides_set_many`

---

## Log modifiche per sessione

| Data | Cosa è stato fatto |
|------|--------------------|
| 2026-05-13 | Fix CSS duplicati, modal z-index, algoritmo auto_scheduler (effective_slot_hours, temp_slots_worked) |
| 2026-05-14 | Scheda Report, pulsante copia settimana, dot copertura calendario |
| 2026-05-14 | Chat AI Gemini (pannello, prompt suggeriti, follow-up chips, nuova conversazione) |
| 2026-05-14 | Fix responsive (breakpoint 900/700px) + fix persistenza lastWeekKey + overrides_bulk_save atomico |
| 2026-05-15 | "Sistema tutto": 10 bug fix + metodi atomici DB + migrazione schema imported_files |
| 2026-05-15 | Balance indifferenti (BALANCE_TOLERANCE, BalanceWarning, _choose_slot_for_indifferent_budgeted) |
| 2026-05-15 | weekly_hours_target, report redesign, chat onboarding key, azioni turno AI, modal inserimento rapido |
| 2026-05-17 | Fill-gap opportunity-cost, fix squads_need str→int, 3 miglioramenti contesto Gemini, 2-opt swap |
| 2026-05-17 | Export PDF semplificato: build_week_export_simple, build_pdf_from_export_simple, api + UI |
| 2026-05-24 | fix: skill-upgrade pass post fill-gap per rimpiazzare con dipendenti più qualificati (`skill_upgrade.py`) |
| 2026-05-24 | fix: modal dettaglio giorno usa `computeTimeSegmentsForDay` (segmenti specifici del giorno, non globali) |
| 2026-05-24 | fix: `hasAssigned` check nel day modal — nasconde segmenti senza fabbisogno né assegnazioni |
| 2026-05-24 | fix: export/import dialog — `Tk()` da thread API pywebview causava crash intermittente; sostituito con `webview.create_file_dialog` (thread-safe). Rimosso import tkinter. Commit: 18d67c6 e fba7057 |
| 2026-11-19 | Controllo completo: parser mezz'ore/Capodanno, vincoli indeterminati nel fill-gap, alias senza perdita dati, backup prima della retention, connessioni SQLite chiuse, export con mezz'ore, Domenica non più coperta nell'export, pulsante «Indeterminati» ripristinato, conferme su Svuota/Copia/Import |
| 2026-11-19 | Design system premium (`ui_kit.css`/`ui_kit.js`): sidebar nuova con icone e stato ridotto, gerarchia pulsanti, finestre e notifiche dell'app al posto di alert/confirm, icone (i) con spiegazioni, stati vuoti/caricamento/errore, `apiWrite` per tutte le scritture con riallineamento al DB, finestre import (nomi e orari) rifatte, Indeterminati senza rischio di cancellazione, Squadre lette sempre dalla tabella unica, media ore del Report corretta, guida in-app allineata all'app reale |
| 2026-11-19 | Rifinitura finestre interne: dettaglio giorno con riepilogo copertura (scoperti per fascia), gestione turno e scheda dipendente con conferma se si chiude senza salvare, preset tipi giornata con bozza unica (niente perdite cambiando scheda), Aggiungi/Rimuovi turno con icone SVG, giorno proposto utile e "già in turno: Ruolo orario", Disponibilità rifatta (gruppi libero/in turno, niente listener persi), eliminazione dipendente che libera i turni futuri e lascia lo storico come «Ex dipendente» (`employee_usage`/`employee_delete`), Esc chiude ogni finestra, X accessibili |
| 2026-11-19 | Chat Gemini sostituita da un assistente locale senza rete né chiavi (`assistant.py`/`assistant.js`): informazioni dal DB e modifiche con anteprima, conferma e scrittura atomica (`overrides_set_cells`); rimosso il codice Gemini (API chiave, cifratura, `chat_ai.*`) |
| 2026-11-19 | Algoritmo: bilanciamento esatto (300/300 ottimi), impostazioni modificabili (pagina Impostazioni), max ore/giorno turnisti (predef. 10), riposo minimo, durata minima, turni spezzati, giorni di apertura, conservazione; scoperti finali; fix «0 ore = 40» |
