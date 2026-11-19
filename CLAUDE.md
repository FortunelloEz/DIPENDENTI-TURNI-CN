# TurniCN — regole fisse del progetto

App desktop Windows (pywebview + SQLite + HTML/CSS/JS vanilla) che crea i turni settimanali
dei dipendenti di Cascina Nascosta. Obiettivo core: **rendere semplice e sicura la creazione dei turni**.
Standard richiesto: **app premium, zero bug**, cura di ogni dettaglio (ombre, testi, allineamenti,
fluidità, animazioni eleganti), chiarezza prima di tutto.

## Il processo — a ogni messaggio che chiede lavoro

Otto passi in ordine fisso, senza saltarne:

1. **Studia** — leggere il codice vero (file, chi lo usa, moduli collegati), non supporre.
2. **Analizza** — comportamento atteso e tutti i percorsi: vuoto, errore, prima apertura e riapertura,
   finestra grande e piccola (1024 → 1920 px), dati reali e settimana senza dati.
3. **Confronta** — almeno due soluzioni serie, si sceglie la migliore, non la più corta.
4. **Implementa fino in fondo** — niente «poi lo finiamo». Se la modifica è strutturale o cambia
   cosa vede l'utente, si aggiorna anche la guida in-app (`ui/views/guide.html`).
5. **Audit** — controllo ostile, con le prove (vedi sotto).
6. **Migliora** — i buchi trovati si chiudono prima di consegnare.
7. **Testa** — `python -m pytest`, `npx eslint` sui file JS toccati, e per l'interfaccia la verifica
   dell'effetto vero nel browser (screenshot: popover tagliati, z-index, sovrapposizioni).
8. **Consegna** — commit e push solo a processo completo.

Vietato il «lavoretto»: funziona solo nel caso felice; testo dell'interfaccia che promette più di quello
che fa il codice; soluzioni copiate a mano invece di riusare quelle del repo; lasciare all'utente il
compito di scoprire i buchi. Le decisioni di funzionamento non si chiedono all'utente: si sceglie la
soluzione più prudente, che non perde dati, e la si dichiara nella consegna.

## Il controllo ostile

Da revisore che cerca come si rompe, non da autore. Prove da cercare sempre:

- salvataggi senza `await`, o senza gestione dell'errore (l'utente deve sapere se non è salvato);
- cancellare prima di scrivere (DELETE + INSERT fuori transazione, o con sorgente vuota);
- date in UTC: mai `toISOString()` per ricavare un giorno; usare le funzioni locali del repo
  (`weekKeyOf`, `formatDate`, `mondayDateFromWeekKey` in `app.js`; `date`/`timedelta` in Python);
- stato dell'interfaccia diverso da quello salvato nel DB;
- aree cliccabili sotto i 40 px (pulsanti, icone, chip rimovibili);
- i quattro stati di ogni schermata e finestra: **vuoto, caricamento, errore, successo**;
- azioni distruttive senza conferma.

## Regole tecniche fisse

- **Design system**: `ui/customization/ui_kit.css`, caricato per ULTIMO in `index.html`, è la fonte
  unica di token (slate + blue-600, ombre, raggi, movimento), pulsanti, campi, finestre, notifiche,
  icona (i), barra laterale. Si usano i token (`var(--slate-500)`, `var(--blue-600)`…), non colori sparsi;
  card e campi hanno sfondo bianco pieno (niente `rgba(255,255,255,.0x)`, residuo del vecchio tema scuro).
  Colori ruolo fissi (Cassa, Runner, Bar, Comande, Accoglienza, Jolly) uguali in calendario, export, PDF, Excel.
- **Pulsanti**: ogni pulsante ha un ruolo del design system: `btn` (secondario), `btn primary` (uno per
  area), `btn btn-ghost`, `btn btn-danger` (tenue), `btn-danger-solid` (solo conferme distruttive),
  `btn-small`, `btn-icon`. Niente varianti di colore per singola pagina. Icone: SVG al tratto con classe
  `ic` (stesso set della barra laterale), non emoji.
- **Finestre e messaggi**: mai `alert()`/`confirm()` nativi. Si usano `uiConfirm()`, `uiAlert()`,
  `showToast()` di `ui_kit.js`. Azioni distruttive: `uiConfirm({ danger: true })`, che parte con il fuoco su «Annulla».
- **Spiegazioni**: dove un controllo non è ovvio si mette l'icona (i): `infoTip(testo)` in JS, oppure
  `<button type="button" class="info-tip" data-tip="…">i</button>` nell'HTML. Il testo descrive ciò che
  il codice fa davvero (verificarlo prima di scriverlo).
- **Aree cliccabili** (app desktop con mouse): 40 px per i pulsanti normali, almeno 32 px per i controlli
  compatti nelle barre dense; icone piccole con area estesa via `::after` (come `.info-tip`).
- **Persistenza**: i dati dell'utente stanno in SQLite tramite `Api` (`cn_turni/api.py` → `cn_turni/db.py`),
  mai in `localStorage` (ammesso solo per preferenze di vista: barra ridotta, ultima settimana).
  Letture: `apiCall()` (restituisce null se fallisce). Scritture: `apiWrite()` (lancia un errore leggibile),
  con `await`, `showToast(err.message, "err")` e riallineamento dello schermo al DB (`resyncWeekFromDb`
  o ricarica della tabella): prima si scrive nel DB, poi si aggiorna lo schermo. Più scritture collegate =
  una sola transazione. Mai salvare prima di aver caricato i valori esistenti (si sovrascriverebbero con vuoto).
- **Navigazione**: ogni schermata ha la sua route (`data-route` in `ui/index.html`, vista in `ui/views/`).
- **Dati sensibili**: il DB e i CSV contengono nomi ed email dei dipendenti: non vanno nel repository
  né nell'installer (`TurniCN.spec` include solo `ui/`).
- **Documentazione**: dopo una modifica strutturale si aggiornano la guida in-app e
  `chat_memory_claude.md` (note di progetto).

## Consegna — formato fisso A–G

- **A. Mappa dei file** toccati e perché.
- **B. Difetti trovati**, con `file:riga`.
- **C. Fix** applicati.
- **D. Design**: soluzioni confrontate e scelta.
- **E. Prove**: test, lint, screenshot, cosa è stato verificato davvero.
- **F. Cosa resta fuori**, e perché.
- **G. Verità**: «lo userei ogni giorno senza paura di perdere dati?»

## Comandi

- Test: `python -m pytest -q`
- Lint JS: `npx eslint ui/assets` (config in `eslint.config.mjs`)
- Avvio: `.venv/Scripts/python -m cn_turni.main`
- Prova visiva della UI senza pywebview: vedi la memoria di progetto (server finto + Chrome headless su
  una copia del DB, mai sul DB vero).
