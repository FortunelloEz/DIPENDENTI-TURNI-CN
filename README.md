# Progetto Turni – CN

Applicazione desktop **Windows (.exe)** per la gestione **ordinata, affidabile e flessibile** della **turnistica settimanale** di un’attività (es. ristorante), a partire dalle disponibilità dei dipendenti raccolte tramite **Google Moduli** ed esportate in **Excel**.

L’obiettivo non è solo “fare i turni”, ma costruire un sistema che:
- automatizzi dove conviene,
- lasci il controllo umano dove serve,
- **mantenga le modifiche manuali anche dopo rigenerazioni**,
- resti estendibile nel tempo senza rifare tutto.

---

## 🎯 Obiettivo

Lo scopo del progetto è realizzare uno strumento che permetta di:

- mantenere un’anagrafica strutturata dei dipendenti (ruoli, skill, preferenze)
- importare disponibilità settimanali da Excel in modo sicuro e ripetibile
- generare automaticamente una proposta di turni applicando regole chiare
- intervenire manualmente sui turni (calendario drag & drop) senza “rompere” la logica automatica
- produrre un Excel finale **pronto all’uso operativo** (turni per giorno e per persona + criticità)

---

## 🧠 Concetto chiave (filosofia del sistema)

La pianificazione è separata in **tre livelli**. Questa separazione è ciò che rende il sistema robusto e rigenerabile.

1. **Input – Disponibilità (raw)**
    - Dati grezzi importati da Excel
    - Non vengono mai modificati direttamente
    - Rappresentano “ciò che le persone hanno dichiarato”

2. **Generazione automatica (generated)**
    - Il motore calcola i turni applicando vincoli, priorità e scoring
    - Produce una proposta coerente e ripetibile
    - Può essere rigenerata in qualsiasi momento

3. **Override manuali (admin)**
    - Modifiche fatte dall’utente su calendario (drag & drop, edit, eccezioni)
    - Consentono anche multi-ruolo nella stessa giornata
    - Persistono e possono essere mantenute anche dopo rigenerazioni

---

## 🗓 Caratteristiche principali

- Pianificazione settimanale da **martedì a domenica**
- Suddivisione del tempo in **slot da 30 minuti**
- Orari sempre allineati a step di 30 minuti
- Due macro-fasce (configurabili):
    - **Mattina / Pranzo** (indicativamente 8–16)
    - **Sera** (indicativamente 16–24)
- Ruoli e skill configurabili (sala, cucina, cassa, comanda, ecc.)
- Gestione di **ruoli critici** in finestre orarie specifiche (es. comanda solo a pranzo)
- Ordine di priorità nella compilazione dei turni (giorni/fasce/ruoli)
- **Multi-ruolo vietato in automatico**, consentito solo via override admin
- Applicazione **100% locale**: SQLite + file Excel, nessuna dipendenza cloud

---

## 🔒 Decisioni critiche “blindate” (regole di comportamento)

Queste regole definiscono cosa succede nei casi limite e rendono il sistema implementabile senza ambiguità.

### 1) Modello override: *delta* che sostituisce lo slot
Gli override vengono gestiti come **layer separato** dal piano generato.

- Il calendario mostrato all’utente è la **vista “effective”**:
    - `effective = merge(generated, overrides)`
- Regola di merge:
    - se esiste un override per uno slot (o intervallo di slot), **l’override sostituisce** l’assegnazione generata in quello spazio
    - se non esiste override, vale la generazione automatica

Questo consente:
- rigenerazioni senza perdita di lavoro
- audit chiaro su cosa è stato cambiato manualmente

---

### 2) Rigenerazione: strategia standard consigliata
La rigenerazione dei turni richiede una decisione esplicita e deterministica. La soluzione migliore e più implementabile è:

- L’utente sceglie tra due modalità (toggle in UI + conferma):
    1. **Rigenera mantenendo override** *(default consigliato)*
    2. **Rigenera scartando override**

Comportamento:

**A) Mantieni override**
- cancella e ricalcola `schedule_generated`
- lascia intatto `schedule_override`
- ricostruisce `effective = merge(generated, overrides)`
- segnala in UI eventuali conflitti “nuovi” emersi rispetto ai dati aggiornati (vedi regole sotto)

**B) Scarta override**
- cancella `schedule_generated`
- cancella anche `schedule_override`
- rigenera da zero
- `effective` coincide col generato

---

### 3) Validazione in UI: vincoli hard sempre protetti
La UI non deve permettere di “rompere” il sistema.

**Regola:** durante drag & drop o editing manuale, la UI deve impedire o richiedere conferma solo in base al tipo di vincolo:

- **Vincoli hard (mai violabili)** → *azione bloccata*
    - sovrapposizione temporale della stessa persona
    - assegnazione a ruolo senza skill compatibile
    - violazione giorno libero “bloccante” (se configurato come hard)
    - inserimento fuori settimana o fuori griglia slot 30 min

- **Vincoli soft (preferenze / ottimizzazioni)** → *azione consentita ma segnalata*
    - preferenza ruolo non rispettata
    - spezzoni / continuità peggiorata
    - bilanciamento ore non ottimale

In pratica:
- hard = “non puoi farlo”
- soft = “puoi farlo ma te lo segnalo”

---

### 4) Drag & drop: gestione collisioni e sostituzioni
Quando si sposta un turno:

- Se si droppa su slot libero → viene creato override con la nuova assegnazione
- Se si droppa su slot occupato:
    - **swap** (scambio) non è automatico
    - comportamento standard:
        - se lo slot è occupato da assegnazione *generated* → l’override **sostituisce** quella assegnazione e quella persona viene “rimossa” da quello slot (buchi o riassegnazioni restano visibili)
        - se lo slot è occupato da *override* → stessa logica: l’ultimo override prevale e l’assegnazione precedente viene annullata per quello slot
- In ogni caso:
    - se la sostituzione lascia buchi, i buchi vengono evidenziati (non “riparati” automaticamente)

Motivo: è più prevedibile e riduce automazioni “magiche” che confondono.

---

### 5) Fabbisogni (copertura richiesta): formato minimo e chiaro
Il fabbisogno è definito nel modo più semplice e robusto da implementare:

- per ogni **giorno** e ogni **fascia (mattina/sera)** e ogni **ruolo**
- si definisce un intero: `required_headcount` (persone necessarie)

Esempio concettuale:
- Domenica / Pranzo:
    - sala: 3
    - cucina: 2
    - comanda: 1
- Domenica / Sera:
    - sala: 4
    - cucina: 2
    - comanda: 0 (se non previsto)

Questa struttura è:
- facile da capire
- facile da validare
- facile da esportare in report criticità

---

### 6) Ruoli critici: finestre orarie e precedenze
Un ruolo può essere marcato come **critico**, con:

- finestra temporale valida (es. 12:00–15:00)
- copertura minima obbligatoria (tipicamente 1)

Regola di generazione:
- i ruoli critici vengono assegnati **prima degli altri**, entro la finestra definita
- eventuali buchi su ruoli critici vengono evidenziati come “criticità alta”

---

### 7) Storico settimane: supportato (minimo)
Il sistema conserva lo storico in modo leggero e utile.

- ogni import è associato a una `week_id` (es. ISO week o data di inizio settimana)
- le tabelle `availability_raw`, `schedule_generated`, `schedule_override` sono tutte versionate per `week_id`
- l’utente può:
    - aprire una settimana passata
    - riesportarla
    - rigenerarla (con le stesse regole di override)

Questo evita perdita dati e consente confronto tra settimane.

---

### 8) Tie-break nello scoring: deterministico
In caso di punteggio identico tra candidati, si applica una cascata fissa e deterministica:

1. meno ore assegnate nella settimana corrente (`assigned_minutes_week` crescente)
2. maggiore livello di skill sul ruolo (se presente come scala)
3. minor numero di spezzoni già assegnati (`fragment_count` crescente)
4. ordine alfabetico `cognome+nome` (fallback finale)

Motivo: evita risultati “random” e facilita debug e fiducia dell’utente.

---
### 9) Disponibilità: formato standard e regole di normalizzazione

**Decisione**
- Le disponibilità importate vengono convertite in intervalli su griglia a **slot da 30 minuti**.
- Ogni riga importata deve essere normalizzata in:
    - `employee_id`
    - `week_id`
    - `day`
    - `start_time` / `end_time` (allineate ai 30 minuti)
    - opzionale `availability_type` (AVAILABLE / UNAVAILABLE) se in futuro si vuole gestire eccezioni

**Regole**
- Se un orario non è multiplo di 30 minuti → viene arrotondato:
    - `start_time` verso il basso
    - `end_time` verso l’alto
    - e viene generato un **warning** nel report di validazione
- Intervalli sovrapposti della stessa persona nello stesso giorno → vengono fusi (merge) automaticamente
- Intervalli incoerenti (end <= start) → **errore bloccante**

---

### 10) Settimana e calendario: definizione univoca di week_id

**Decisione**
- `week_id` è la data del **martedì** di quella settimana in formato `YYYY-MM-DD`.
- La settimana copre sempre: **martedì → domenica**.

**Motivo**
- È semplice da calcolare, leggibile e stabile (evita ambiguità ISO-week).

---

### 11) Regola “giorno libero”: default e configurabilità

**Decisione**
- Nel MVP, il **giorno libero è soft** (warning) e può diventare hard tramite setting.
- Per ogni dipendente si può indicare:
    - `preferred_day_off` (opzionale)
    - `day_off_is_hard` (boolean, default false)

**Comportamento**
- Se `day_off_is_hard=true` → qualunque assegnazione in quel giorno è **bloccata**
- Se `false` → assegnazione consentita ma segnalata come **warning**

---

### 12) Multi-ruolo: definizione precisa e limiti

**Decisione**
- In generazione automatica: **vietato**
- In override manuale: consentito con queste regole hard:
    - la stessa persona **non può** avere sovrapposizioni temporali
    - può avere più ruoli nello stesso giorno **solo su intervalli distinti**
    - può fare un massimo di **N cambi ruolo al giorno** (default: N=2) per evitare planner “spezzettati”

**Motivo**
- Mantiene turni realistici e limita la complessità operativa.

---

### 13) Export: formato minimo garantito e naming file

**Decisione**
- Export produce sempre 3 fogli:
    1. `Turni_Giorno` (giorno/fascia/ruolo/orario/persona)
    2. `Turni_Persona` (persona → elenco turni della settimana)
    3. `Buchi_Criticita` (slot non coperti + severità)

**Naming**
- `Turni_{week_id}.xlsx` (es: `Turni_2026-02-03.xlsx`)

**Nota**
- L’export usa i dati **effective** (merge di generated + override).

---

### 14) Politica di conflitto: cosa succede se cambiano le disponibilità dopo override

**Scenario**
- Importo nuove disponibilità o correggo l’anagrafica
- Mantengo override e rigenero

**Decisione**
- Gli override non vengono cancellati automaticamente, ma vengono marcati con uno stato:
    - `OK`
    - `CONFLICT` (se viola vincoli hard rispetto ai nuovi dati)
- La UI mostra una lista “Override in conflitto” con azioni:
    - “Rimuovi override”
    - “Modifica override”
    - “Apri nello slot”

**Motivo**
- Non perdi lavoro, ma non resti con dati invalidi “silenziosi”.

---

### 15) Audit e tracciamento: chi ha cambiato cosa (locale)

**Decisione MVP**
- Ogni override salva:
    - `created_at`, `updated_at`
    - `source` = `UI_DRAGDROP` | `UI_EDIT` | `API`
    - `note` (testo libero opzionale)

**Motivo**
- Serve per fiducia, debug e storicità anche in single-user locale.

---

## ✅ Risultato

Con le decisioni 9–15:
- la spec è **chiusa** per implementare l’MVP senza buchi
- i casi critici (import sporco, rigenerazione, conflitti) hanno comportamento deterministico
- UI e backend hanno regole chiare (blocchi hard vs warning soft)


## 🖥 UI – Planner settimanale (drag & drop)

Dopo la generazione automatica, l’utente opera su un calendario visuale.

Il planner consente di:
- visualizzare i turni per giorno, fascia e ruolo
- spostare turni con **drag & drop**
- aggiungere/modificare/rimuovere assegnazioni manuali
- assegnare multi-ruolo nella stessa giornata (solo in override)
- evidenziare buchi e criticità (con severità)
- scegliere rigenerazione con **mantieni/scarta override**

La UI mostra chiaramente:
- cosa è “generato” vs cosa è “override”
- eventuali warning (soft) e blocchi (hard)

---

## 🔄 Flusso di utilizzo tipico

1. **Configurazione iniziale**
    - ruoli, skill, fabbisogni, priorità, ruoli critici

2. **Gestione dipendenti**
    - profili, skill, preferenze (gradimenti)

3. **Import disponibilità**
    - caricamento Excel (Google Moduli)

4. **Validazione**
    - errori bloccanti + warning

5. **Generazione automatica**
    - vincoli hard + priorità + scoring
    - report buchi/criticità

6. **Modifica manuale (Planner)**
    - drag & drop e override persistenti
    - controllo vincoli hard / segnalazione soft

7. **Export finale**
    - Excel operativo + report criticità

---

## 🧠 Logica di generazione dei turni (Scheduler)

Il motore assegna dipendenti a slot seguendo una logica deterministica.

### Vincoli hard (mai violabili)
- disponibilità (raw o override disponibilità, se esiste)
- skill compatibile col ruolo
- no sovrapposizioni
- giorno libero (se marcato hard)
- divieto multi-ruolo automatico nello stesso slot/giorno (configurato come hard)

### Priorità
- ruoli critici prima
- ordine configurabile di giorni/fasce/ruoli

### Scoring (soft)
- livello skill
- gradimento persona–ruolo
- bilanciamento ore
- riduzione spezzoni

Algoritmo iniziale: **greedy + scoring**, con tie-break deterministico.

---

## 📥 Input – Disponibilità

Disponibilità da Google Moduli → Excel (.xlsx).

Il file viene:
- normalizzato
- validato
- salvato come `availability_raw` per `week_id`

Gli errori vengono segnalati prima della generazione.

---

## 📤 Output – Turni

L’export produce un Excel (.xlsx) con:

- foglio turni per giorno/fascia/ruolo
- foglio turni per dipendente
- foglio “buchi e criticità” con severità (alta per ruoli critici)

Output pronto per stampa e uso operativo.

---

## 📌 Ambito del progetto

### In scope
- pianificazione settimanale
- generazione automatica con regole e priorità
- override manuali persistenti
- export Excel

### Fuori scope
- paghe / payroll
- ferie automatiche “intelligenti”
- cloud sync
- multi-sede
- multi-utente concorrente

---

## 🏗 Architettura (visione d’insieme)

- **UI**: HTML / CSS / JavaScript (webview)
- **Backend**: Python
- **Database**: SQLite
- **Import / Export**: Excel (.xlsx)
- **Packaging**: PyInstaller → `.exe`

Componenti principali:
- UI (planner, drag & drop, form)
- API (bridge JS ↔ Python)
- Services (import/validate/schedule/overrides/export)
- Repository DB

---

## 📌 Note finali

- applicazione **100% locale**
- nessuna dipendenza cloud
- target iniziale: **Windows**
- struttura modulare pronta per evoluzioni future

Questo progetto non punta a essere “il gestionale definitivo”, ma **uno strumento solido che fa bene una cosa sola**.

## 🧱 Architettura a componenti

```text
┌──────────────────────────────────────────────────────────┐
│                        UI (HTML / JS)                    │
│  - Schermate: Persone | Import | Planner | Settings      │
│  - Calendario: drag&drop, edit slot, evidenza buchi      │
│  - Chiama API backend via bridge pywebview               │
└───────────────────────────────┬──────────────────────────┘
                                │ JS <-> Python (bridge)
                                v
┌──────────────────────────────────────────────────────────┐
│                  API Layer (app/api.py)                  │
│  Metodi esposti alla UI:                                 │
│  - employees.* (CRUD)                                    │
│  - settings.* (fabbisogni/priorità/finestre critiche)    │
│  - importExcel(), validateWeek()                         │
│  - generateSchedule(params)                              │
│  - getCalendarView(), saveOverride()                     │
│  - exportExcel(week)                                     │
└───────────────────────────────┬──────────────────────────┘
                                │ chiama servizi
                                v
┌──────────────────────────────────────────────────────────┐
│                Services (app/services)                   │
│  importer_excel  -> parse Excel -> availability_raw      │
│  validator       -> controlli + report                   │
│  scheduler       -> greedy/scoring -> schedule_generated │
│  overrides       -> merge gen + override (admin edits)   │
│  exporter_excel  -> produce .xlsx finale                 │
└───────────────────────────────┬──────────────────────────┘
                                │ usa repository DB
                                v
┌──────────────────────────────────────────────────────────┐
│                  DB Layer (app/db)                       │
│  connection.py (PRAGMA, conn)                             │
│  schema.py (create + migrations)                          │
│  repo_* (employees / availability / schedule / settings) │
└───────────────────────────────┬──────────────────────────┘
                                │
                                v
┌──────────────────────────────────────────────────────────┐
│                       SQLite DB                          │
│  employees, skills, employee_skills                      │
│  availability_raw, availability_override                 │
│  schedule_generated, schedule_override                   │
│  settings, imports_log                                   │
└──────────────────────────────────────────────────────────┘
```


## 📁 Struttura del progetto

```text
turni-cascina/
├── README.md
├── pyproject.toml                # Configurazione progetto Python (alternativa a requirements.txt)
├── requirements.txt              # Dipendenze Python
├── .gitignore                    # File esclusi dal versionamento
│
├── app/                          # Backend Python (logica applicativa)
│   ├── __init__.py
│   ├── main.py                   # Entry point: avvia pywebview e inizializza l’app
│   ├── api.py                    # Bridge JS ↔ Python (metodi chiamati dal frontend)
│   ├── paths.py                  # Gestione path (DB, asset, data) in dev/exe
│   ├── config.py                 # Configurazioni di default e caricamento settings
│   │
│   ├── db/                       # Layer di accesso al database (SQLite)
│   │   ├── __init__.py
│   │   ├── connection.py         # Connessione SQLite, PRAGMA e helper
│   │   ├── schema.py             # Creazione tabelle e migrazioni DB
│   │   ├── repo_employees.py     # CRUD dipendenti e skill
│   │   ├── repo_availability.py  # Disponibilità raw e override
│   │   ├── repo_schedule.py      # Turni generati e override manuali
│   │   └── repo_settings.py      # Settings applicativi e log import
│   │
│   ├── services/                 # Logica di business
│   │   ├── __init__.py
│   │   ├── importer_excel.py     # Import Excel → availability_raw + imports_log
│   │   ├── validator.py          # Validazione dati e report errori
│   │   ├── scheduler.py          # Motore di assegnazione turni (greedy + scoring)
│   │   ├── overrides.py          # Override admin e multi-ruolo
│   │   └── exporter_excel.py     # Export Excel finale
│   │
│   ├── domain/                   # Modelli di dominio e regole pure
│   │   ├── __init__.py
│   │   ├── models.py             # Dataclass (Employee, Skill, Slot, Assignment…)
│   │   ├── scoring.py            # Funzioni di punteggio
│   │   └── rules.py              # Vincoli hard/soft
│   │
│   └── utils/                    # Utility condivise
│       ├── __init__.py
│       ├── dates.py              # Settimane mar–dom, slot 30min, parsing orari
│       ├── logging.py            # Logging applicativo
│       └── errors.py             # Eccezioni custom
│
├── ui/                           # Frontend statico (caricato da pywebview)
│   ├── index.html                # Shell principale UI
│   ├── assets/
│   │   ├── app.css               # Stili UI
│   │   ├── app.js                # Logica frontend
│   │   └── vendor/               # Librerie JS locali (opzionale)
│   └── views/
│       ├── employees.html        # Gestione profili
│       ├── availability.html     # Import e validazione
│       ├── planner.html          # Calendario e override
│       └── settings.html         # Fabbisogni e priorità
│
├── data/                         # Dati runtime (dev; in exe → AppData)
│   ├── app.db                    # Database SQLite
│   ├── imports/                 # File importati
│   ├── exports/                 # File esportati
│   └── logs/                    # Log applicazione
│
├── assets/                       # Asset per packaging exe
│   ├── icon.ico                 # Icona applicazione
│   └── templates/
│       └── export_template.xlsx # Template Excel (opzionale)
│
└── build/                        # Build e packaging
    ├── build.ps1                # Script PowerShell build
    └── turni.spec               # Configurazione PyInstaller
```