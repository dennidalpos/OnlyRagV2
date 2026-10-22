# Passaggio di sessione: rinnovo asset media dal vivo e guida social — 22 ottobre 2026

Il proprietario richiede esplicitamente il salvataggio del lavoro, l'aggiornamento del tracker, il commit sul branch principale e il push per cambio sessione. Verificati repository pubblico `dennidalpos/OnlyRagV2`, remoto `origin`, default e branch corrente `master`, base `6d2abfa34d3d43a18412b4f3f6e0bf5c63652907`, allineata 0/0 dopo `git fetch origin`.

## Lavoro salvato

1. **Eliminazione vecchi asset media non referenziati**:
   - Rimosso il vecchio asset media raster `assets/onlyrag_poster_banner.jpg` (680.381 byte, SHA-256 `9ADEAF3AA491CE6406B225BCF178D0E159E2B0007184601E8BE76014A3965146`), con backup verificato e manifest salvato fuori dal checkout in `%TEMP%\onlyrag-old-media-backup-20261022`.
   - Preservati tutti gli asset di branding attivi dell'applicazione (`assets/icon.ico`, `assets/icon.png`, `assets/onlyrag-icon.svg`, `public/icon.png`, `public/onlyrag-icon.svg` validati da `npm run assets:check`) e i 26 diagrammi vettoriali in `docs/assets/flussi-utente/*.svg`.

2. **Cattura schermate dal vivo in formato uniforme PNG**:
   - Eseguita l'applicazione desktop Electron dal vivo tramite harness isolato `ONLYRAG_E2E_USER_DATA` con dati realistici in lingua italiana (senza invocare modelli LLM esterni o alterare i dati di sviluppo).
   - Generate 8 schermate uniformi ad alta definizione (`1600x940`) in formato PNG nella cartella [`assets/screenshots/`](../assets/screenshots/):
     1. `01-prima-pagina-ingestione.png` (Prima pagina / Ingestione: caricamento documenti, badge OCR GPU ON, anteprima e editor Markdown);
     2. `02-setup-wizard-modelli.png` (Setup Wizard Hardware & Modelli a 3 step con rilevamento VRAM/RAM);
     3. `03-ricerca-vettoriale.png` (Inspector Vettoriale LanceDB con punteggio di pertinenza semantica);
     4. `04-rag-chat-fonti.png` (RAG & Chat multi-documento con citazioni [S1][S2], estratti e punteggi);
     5. `05-traduzione-markdown.png` (Document Translation Studio: editor bilingue affiancato con streaming sincrono ed esportazione);
     6. `06-traduzione-layout-preservato.png` (Traduzione geometrica con layout preservato per PDF/DOCX);
     7. `07-coding-agent-studio.png` (AI Coding Agent Studio: esploratore file workspace, timeline agente con prove di test e Monaco Editor);
     8. `08-impostazioni-e-modelli.png` (Impostazioni e configurazione: lingua IT/EN, a capo automatico, cartelle di output e wizard hardware).

3. **Guida pratica non tecnica per l'utente finale e post social**:
   - Redatta la guida pratica non tecnica e i post social pronti per la pubblicazione in [`assets/social_posts.txt`](../assets/social_posts.txt) (in italiano e inglese).

4. **Pulizia e integrità**:
   - Rimossi i file temporanei di build (`dist/`, `dist-electron/`) tramite policy del repository (`scripts/clean_repo.ps1`).
   - Verificata l'integrità dei dati: tutti i 66 file in `userdata_dev` sono risultati 100% byte-identici per SHA-256.

## Tracker e ripresa

[`PROJECT_STATUS.json`](../PROJECT_STATUS.json) conserva schema e storico delle note importanti. Restano aperte **quattro attività autonome (tre P2 e una P3) e zero attività con decisione utente**:

| Attività autonoma | Priorità | Condizione di ripresa |
| --- | --- | --- |
| `DEPENDENCY-BRACES-UPSTREAM-01` | P2 | Valutare una release upstream $> 3.0.3$ quando pubblicata su npm (al 2026-10-22 `latest` è ancora `3.0.3` del 2024-09-18), eseguendo i gate parser/AST, `npm ci`, YAML/proxy e ASAR. |
| `DEVSERVER-LOOPBACK-PROBE-STABILITY-01` | P2 | Mantenere invariate le guardie loopback/PID finché il rifiuto storico intermittente non viene riprodotto e attribuito con evidenze socket/listener/PID (100 nuovi casi nativi passati il 22 ottobre senza riproduzione). |
| `TEST-PNPM-OFFLINE-PREPARATION-01` | P2 | Rendere deterministico il ramo `pnpm` di `persistentPowerShellSession.test.ts` quando l'installazione `pnpm` dell'host (WinGet `12.14.0`) non ha una cache locale pre-popolata per risolvere `packageManager` in modalità `--offline`. |
| `OCR-RUNTIME-EFFECTIVE-PROVIDER-01` | P3 | Riportare in `get_ocr_runtime_info` e `/health` il provider RapidOCR effettivamente inizializzato anche quando `_get_rapidocr_engine` ripiega su CPU dopo un errore di inizializzazione CUDA. |

## Gate e verifiche della consegna

- `npm run assets:check` → **PASS** (tutti gli asset iconografici e SVG verificati).
- `npm run docs:check` (123 file Markdown, inclusi i 26 diagrammi Mermaid) → **PASS**.
- `npm run quality:static` (891 file, 107 handler IPC) → **PASS**.
- `npm run typecheck` (`tsc --noEmit`) → **PASS**.
- `npm run format:check` → **PASS**.
- Integrità `userdata_dev`: 66/66 file identici SHA-256 → **PASS**.
- Backup pre-commit salvato in `%TEMP%\onlyrag-media-publication-20261022\`.

## Conservazione e limiti

Nessuna chiamata a modelli generativi reali, build/installazione di nuovi pacchetti installer, migrazione di dati o profili personali, smaltimento di prove storiche o pubblicazione Git del repository SecondBrain.
