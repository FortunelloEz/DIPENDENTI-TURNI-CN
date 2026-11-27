# TurniCN — turni settimanali di Cascina Nascosta

App desktop **Windows** che crea i turni settimanali dei dipendenti partendo dalle disponibilità
raccolte con Google Moduli (CSV). Gira tutta in locale: niente cloud, niente account, niente rete.

Versione attuale: **6.3.0** (`cn_turni/__init__.py`).

---

## Cosa fa

- **Anagrafica dipendenti**: tipo di contratto (indeterminato / turnista), skill da 0 a 10 per ogni ruolo,
  ruolo preferito, fascia preferita (mattina / sera / indifferente), giorni lavorabili, alias del nome,
  ore massime al giorno, ore settimanali obiettivo.
- **Squadre (fabbisogni)**: quante persone servono per giorno, fascia e ruolo; modelli riutilizzabili e
  tipi di giornata (es. «sabato pieno») da applicare ai giorni.
- **Import delle disponibilità** da CSV: riconosce i nomi (anche con alias), chiede cosa fare con i nomi
  sconosciuti e con le celle ambigue, poi genera i turni in automatico.
- **Calendario settimanale** a mezz'ore, con dettaglio del giorno, gestione del singolo turno,
  scoperti per fascia e copia della settimana.
- **Assistente turni locale**: risponde a domande sulla settimana (scoperti, chi lavora, chi è libero,
  ore di una persona, giorno critico) e propone modifiche (sostituisci / aggiungi / togli) con anteprima
  e conferma prima di scrivere.
- **Export**: PDF normale (mattina e sera separate), PDF semplificato (un orario per giorno) ed Excel,
  con colori ruolo uguali al calendario.
- **Report**: ore e copertura della settimana e storico.
- **Impostazioni**: le regole di business modificabili (vedi sotto).
- **Guida all'uso** integrata nell'app.

### Schermate

| Route | Vista | Contenuto |
|-------|-------|-----------|
| `home` | `ui/views/home.html` | calendario della settimana, import CSV, assistente |
| `employees` | `ui/views/employees.html` | dipendenti e skill |
| `squads` | `ui/views/squads.html` | fabbisogni, modelli, tipi di giornata, indeterminati |
| `export` | `ui/views/export.html` | PDF ed Excel |
| `report` | `ui/views/report.html` | report settimana e storico |
| `settings` | `ui/views/settings.html` | impostazioni (generate da `app_settings.py`) |
| `guide` | `ui/views/guide.html` | guida in-app |

---

## Dominio

- **Settimana**: da martedì a domenica (il lunedì è chiusura; i giorni di apertura sono un'impostazione).
- **week_key**: data del lunedì (`YYYY-MM-DD`), usata dall'interfaccia.
  **week_id**: martedì della stessa settimana, chiave nel DB.
- **Fasce**: mattina 08:00–16:00, sera 16:00–24:00. Ogni turno è fatto di mezz'ore (`"08:00"`, `"08:30"` …).
- **Ruoli fissi**: Cassa, Runner, Bar, Comande, Accoglienza, Jolly — stessi colori in calendario, PDF ed Excel.
- **Indeterminati**: ore settimanali e giorno di riposo per settimana (finestra «Indeterminati»).
  **Turnisti**: lavorano solo dove hanno dato disponibilità.

---

## Algoritmo dei turni

Obiettivo: **massima copertura**, poi **squadra equilibrata** (alzare la skill più bassa: 6+7 è meglio di 10+1).

1. **Pianificazione base** (`services/auto_scheduler.py → build_plan`): prima gli indeterminati, poi i turnisti;
   i ruoli con meno candidati vengono riempiti per primi. Rispetta riposi, giorni lavorabili, fasce preferite,
   disponibilità del CSV e ore massime.
2. **Riempimento dei buchi** (`services/import_service.py`): per ogni mezz'ora scoperta sceglie il candidato con
   il miglior costo opportunità — forte dove è insostituibile, turni continui invece che sparsi, ore bilanciate.
3. **Bilanciamento esatto** (`services/balance_optimizer.py`): per giorno e fascia riassegna i ruoli con
   l'algoritmo ungherese. Priorità: più posti coperti → skill minima più alta → somma delle skill più alta →
   ruolo preferito → nessun cambio inutile. Verificato contro la soluzione ottima su 300 casi casuali (300/300).
4. **Pulizia**: toglie i pezzi più corti della durata minima e, se non consentiti, i turni spezzati;
   gli scoperti finali sono calcolati sul risultato finale.
5. **Salvataggio** in un'unica transazione SQLite.

---

## Impostazioni modificabili

Definite in `cn_turni/app_settings.py` (fonte unica: predefinito, limiti, testo di aiuto); la pagina
Impostazioni si costruisce da sola. Salvate nella tabella `settings` con chiave `cfg.<chiave>`.

| Chiave | Gruppo | Predefinito | Limiti | Effetto |
|--------|--------|-------------|--------|---------|
| `temp_max_daily_hours` | Turnisti | 10 ore | 4–16 | ore massime al giorno se la scheda non le indica |
| `perm_weekly_hours` | Indeterminati | 40 ore | 0–80 | ore settimanali se non indicate nella finestra «Indeterminati» |
| `perm_max_daily_hours` | Indeterminati | 8 ore | 4–16 | ore massime al giorno se la scheda non le indica |
| `perm_available_if_missing` | Indeterminati | sì | — | chi non compila il modulo è disponibile tutto il giorno |
| `min_rest_hours` | Regole per tutti | 0 ore | 0–16 | riposo minimo tra fine turno e turno del giorno dopo (0 = non controllato) |
| `min_shift_hours` | Regole per tutti | 2 ore | 0–8 | i pezzi di turno più corti non vengono creati |
| `allow_split_shifts` | Regole per tutti | sì | — | due turni separati nello stesso giorno |
| `open_days` | Regole per tutti | mar–dom | — | giorni inclusi nell'export |
| `retention_months` | Dati | 6 mesi | 0–60 | all'avvio cancella le settimane più vecchie, dopo un backup (0 = mai) |

---

## Architettura

```text
ui/ (HTML/CSS/JS vanilla)  ──pywebview js_api──▶  cn_turni/api.py (classe Api)
                                                     │
                                                     ├─ services/  (import, scheduling, bilanciamento,
                                                     │              export PDF/Excel, assistente)
                                                     ▼
                                                  cn_turni/db.py (classe Db) ──▶ SQLite
```

| Livello | Tecnologia |
|---------|-----------|
| Finestra | pywebview |
| Backend | Python 3.13 |
| Database | SQLite (`turni_cn.db`) |
| Frontend | HTML / CSS / JavaScript vanilla |
| PDF / Excel | reportlab / openpyxl |
| Packaging | PyInstaller (`TurniCN.spec`) + Inno Setup (`TurniCN.iss`) |

### Struttura

```text
cn_turni/
  main.py                avvio della finestra
  api.py                 metodi chiamati dall'interfaccia
  db.py                  schema SQLite e query (scritture collegate = una transazione)
  paths.py               percorsi: ./data in sviluppo, %APPDATA%\TurniCascina nell'exe
  app_settings.py        impostazioni modificabili
  services/
    auto_scheduler.py    pianificazione base
    import_service.py    CSV → piano → riempimento buchi → bilanciamento → salvataggio
    balance_optimizer.py bilanciamento esatto dei ruoli
    csv_availability.py  lettura del CSV (mezz'ore, orari oltre mezzanotte)
    export_service.py    dati dell'export (normale e semplificato)
    pdf_export.py        PDF
    excel_export.py      Excel
    assistant.py         assistente locale
  utils/                 date, errori, log
ui/
  index.html             barra laterale + contenitore delle viste
  assets/                logica JS (app.js core, ui_kit.js finestre/notifiche/scritture, una per vista)
  customization/         CSS; ui_kit.css è il design system, caricato per ultimo
  views/                 HTML delle schermate
tests/                   pytest
```

### Database (tabelle principali)

| Tabella | Contenuto |
|---------|-----------|
| `employees`, `employee_skills` | dipendenti, preferenze, limiti, skill per ruolo |
| `schedule_override` | turni: settimana, giorno, ruolo, mezz'ora, dipendenti |
| `squads_required`, `squads_templates` | fabbisogni e modelli |
| `day_type_presets`, `day_type_assignments` | tipi di giornata |
| `permanent_week` | ore e riposo degli indeterminati per settimana |
| `imported_files`, `availability_cache` | storico degli import e disponibilità |
| `settings` | impostazioni e preferenze |

### Sicurezza dei dati

- Tutte le scritture passano dal DB prima di aggiornare lo schermo; se falliscono, l'utente lo vede.
- Azioni distruttive sempre con conferma; la pulizia automatica delle settimane vecchie fa prima un backup.
- Il DB e i CSV contengono nomi ed email dei dipendenti: sono esclusi dal repository (`.gitignore`)
  e dall'installer (che include solo `ui/`).

---

## Sviluppo

```powershell
python -m venv .venv
.venv\Scripts\pip install pywebview openpyxl reportlab pytest pyinstaller
.venv\Scripts\python -m cn_turni.main     # avvio
python -m pytest -q                       # test
npm install; npx eslint ui/assets         # lint della UI
```

### Build dell'installer

```powershell
pyinstaller TurniCN.spec --noconfirm      # crea dist\TurniCN
# poi compila TurniCN.iss con Inno Setup
```

I dati dell'app installata stanno in `%APPDATA%\TurniCascina` (DB, backup, log, import, export).
