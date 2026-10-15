# Verifica locale del 15 ottobre 2026

Ricevuta della chiusura di sessione su `master`. Il perimetro comprende la guida utente, memoria e tracker, le direttive aggiornate e le modifiche locali preesistenti a DNS, redirect dei download e test di recupero/provenienza, incluse su richiesta esplicita dell'utente.

## Controlli

| Comando | Exit code | Esito |
| --- | --- | --- |
| `npm run test -- --silent=true` — primo passaggio | 1 | 2.717 test superati e uno fallito, in 313 file. Il test della preview Vite ha rilevato la porta assegnata raggiungibile su `127.0.0.2` invece del solo `127.0.0.1`. |
| `npx vitest run electron/core/infrastructure/process/managedDevServerRepository.test.ts` | 0 | Tutti e cinque i test superati senza modifiche al codice o riduzione dei controlli. |
| `npm run test -- --silent=true` — secondo passaggio completo | 0 | 2.718 test superati in 313 file, in 161,76 secondi. Nessun test applicativo escluso per ottenere il passaggio. |
| `.venv\Scripts\python.exe -m pytest -q` | 0 | 518 test superati e uno saltato; il caso symlink richiede i privilegi della piattaforma. |
| `npm run build` | 0 | TypeScript e bundle Renderer, Main e Preload compilati. |
| `npm run quality:static` | 0 | 98 registrazioni IPC validate, confini architetturali rispettati e 827 file controllati da Biome senza riscritture. |
| `pwsh -NoProfile -File scripts/lint_format.ps1 -Fast -SkipTests` | 0 | Formattazione, documentazione, JSON, typecheck, sintassi Python e smoke test Electron superati. Vitest è eseguito separatamente per evitare duplicazioni. |
| `npm run docs:check` | 0 | 56 file Markdown controllati, inclusa questa ricevuta. |
| `git diff --check` | 0 | Nessun errore di whitespace nei file già tracciati; verifica aggiuntiva su tutti i candidati del commit per file nuovi, UTF-8 senza BOM e LF. |

Il gate pre-commit locale è superato con la seconda esecuzione completa JavaScript, la suite Python, build e lint. Il primo fallimento resta documentato e il relativo approfondimento rimane aperto nel tracker: la riprova non ne dimostra la causa né lo considera risolto.

## Documentazione e diff

La [guida utente](./guida-utente.md) contiene 26 SVG statici con 192 nodi raggiungibili, al massimo 10 per figura, diramazioni etichettate e percorsi testuali equivalenti. Validazione XML, risorse esclusivamente locali e resa Chromium a 320, 768 e 1920 px superate; nessun testo fuori dai nodi né scorrimento orizzontale nell'anteprima. Gli script e le immagini di controllo restano esterni al repository.

Il diff completo è stato esaminato, incluse le aggiunte non ancora tracciate: nessun file temporaneo, log di debug, file ambiente o valore con forma di credenziale individuato nei candidati del commit. `.env.example` contiene esempi commentati e non è modificato. Le modifiche a DNS e redirect gestiscono rispettivamente risposte DNS vuote e chiusura/rimozione del file parziale prima del download successivo; i test aggiunti coprono ulteriori rifiuti e conservazione degli archivi.

Il primo fallimento Vite resta tracciato in `TEST-MANAGED-VITE-LOOPBACK-FLAKE-01` nel [tracker](../PROJECT_STATUS.json): il passaggio isolato non ne stabilisce la causa. L'assenza di Ruff nell'ambiente è stata rilevata con una sonda della versione; non sono state installate dipendenze. Il gate Python del repository usa la compilazione sintattica e pytest, entrambi eseguiti.

## Handoff e confini

Il prossimo P1 autonomo è `CODING-HISTORY-DUAL-FAILURE-EXPORT-01`: esportare la revisione rimasta in memoria quando falliscono sia lo storico canonico sia lo staging di recupero, con chiusura bloccata e readback indipendente in un profilo isolato. Il tracker conserva solo attività aperte, ordinate per priorità; la guida completata non viene aggiunta allo storico del tracker.

Nessuna nuova chiamata a modelli, migrazione personale, installazione o pubblicazione. Il Second Brain centrale resta in sola lettura: si propone di aggiungere al dossier OnlyRagV2 il riferimento alla guida offline e la regola di verificare i controlli effettivi oltre alle etichette i18n. Il push richiede una conferma esplicita successiva al riepilogo del commit.

## Riesame Dependabot

Verifica successiva alla ricevuta precedente, partendo da `master` con working tree pulito. L'API GitHub conferma tre avvisi aperti: [26 braces](https://github.com/dennidalpos/OnlyRagV2/security/dependabot/26), [27 http-cache-semantics](https://github.com/dennidalpos/OnlyRagV2/security/dependabot/27), [28 sprintf-js](https://github.com/dennidalpos/OnlyRagV2/security/dependabot/28).

Aggiornato solo `http-cache-semantics` da 4.2.0 a 4.3.0 mediante npm, senza modifica del manifest o nuove dipendenze. La nuova versione è fuori dall'intervallo dell'advisory, che non indica una versione corretta; il manutentore contesta il rapporto. Non si attribuisce alla 4.3.0 una correzione `max-stale` non dimostrata. [Fonti, percorsi e residui](./libraries.md#riesame-dependabot-del-15-ottobre-2026).

| Comando | Exit code | Esito |
| --- | --- | --- |
| `npm update http-cache-semantics --ignore-scripts --no-fund` | 0 | Un pacchetto aggiornato; URL e SHA-512 rigenerati da npm. |
| `npm ls http-cache-semantics` | 0 | Una sola versione, 4.3.0, nella catena electron-builder/app-builder-lib/@electron/get/got/cacheable-request. |
| `npm audit --json` | 1 | Da 16 pacchetti coinvolti (6 alti, 10 moderati) a 15 (5 alti, 10 moderati); rimangono gli advisory braces e sprintf-js. |
| `npm run test -- --silent=true` | 0 | 2.718 test superati in tutti i 313 file, in 170,09 secondi. |
| `.venv/Scripts/python.exe -m pytest -q` | 0 | 518 test superati, uno saltato, in 129,02 secondi. |
| `npm run build` | 0 | TypeScript e bundle Renderer, Main, worker e Preload compilati. |
| `npm run quality:static` | 0 | 98 handler IPC e 827 file verificati senza riscritture. |
| `node scripts/e2e/buildDownloadCachePolicy.mjs` | 0 | Tre gruppi PASS: cache HTTP disabilitata/cookie non riprodotti, riuso artefatto verificato, rifiuto cache corrotta/checksum errato. |
| `node scripts/e2e/dependencySprintfExposure.mjs` | 0 | Tre gruppi PASS: RangeError riprodotto nelle due copie vulnerabili, scanner YAML/script senza caricamento formatter, cinque operazioni logger con formato fisso e dati separati. |
| `node scripts/e2e/dependencyScannerIsolation.mjs` | 0 | Bundle nativo e worker ASAR Electron 43.7.4 passati; 200 file/550 KiB in 1.650 ms, heap terminale Node 56,0 MiB ed Electron 59,1 MiB. Non è una misura del picco di memoria. |
| `npm run docs:check` | 0 | 56 file Markdown verificati. |
| `git diff --check` | 0 | Diff completo esaminato: solo lockfile, tracker e due documenti; nessun residuo temporaneo o di debug. |

Gli avvisi braces e sprintf-js restano tracciati: le mitigazioni verificate non eliminano le dipendenze vulnerabili. Chiuso solo `DEPENDENCY-BUILD-CACHE-UPSTREAM-01`, per aggiornamento fuori intervallo e configurazione del downloader verificata. Nessun commit, push o cambiamento degli avvisi su GitHub; il remoto conserva il lock precedente fino a un push autorizzato. Nessuna modifica a dati personali o artefatti di distribuzione conservati.

## Esportazione dalla memoria con doppio errore di archiviazione

Completato `CODING-HISTORY-DUAL-FAILURE-EXPORT-01`. Il banner di errore consente **Esporta modifiche in memoria** verso una cartella scelta dall'utente. Il renderer attende le scritture pendenti e invia le revisioni non riconosciute tramite un nuovo IPC tipizzato, validato con lo schema sessione esistente. Main esporta la sessione normalizzata e SHA-256 in un file JSON versionato separato, con nome casuale, creazione esclusiva, flush e rilettura completa. Nessun accesso agli archivi interni è necessario per l'esportazione. Errori e annullamento non dichiarano successo; la copia esterna non cancella le revisioni pendenti né sblocca la chiusura.

`node scripts/e2e/codingHistoryMemoryExport.mjs` compila hook e banner di produzione in un fixture, montato nel processo Electron 43.7.4 con Main e Preload reali e profilo temporaneo isolato. Una sessione iniziale contiene log e coda; il test rende lo storico illeggibile e sostituisce la directory di recupero con un file. Entrambe le chiamate IPC di scrittura rifiutano la revisione. Il tentativo di chiusura della vera BrowserWindow viene bloccato; solo i dialoghi nativi sono sostituiti nel processo di test per raccogliere l'avviso e scegliere le destinazioni senza intervento umano.

Una destinazione inesistente produce errore nel banner e lascia intatta la revisione. L'esportazione successiva riesce: il processo Node esterno a Electron rilegge il file, confronta l'intera sessione con quella nel renderer (inclusi testo Unicode e coda) e ricalcola il digest. Le due sorgenti bloccate rimangono byte-identiche e il guard di chiusura continua a rifiutare. Ripristinando gli archivi, Retry salva la stessa revisione e consente la chiusura. Due gruppi PASS, exit 0; il profilo creato dal test viene rimosso dopo il successo.

Il test esistente `node scripts/e2e/codingHistoryDurability.mjs` passa, exit 0: conservazione dopo chiusura e terminazione Main, Export/Retry del journal dopo riavvio. Il gruppo mirato `npx vitest run src/hooks/useSessionHistory.test.tsx src/components/coding/CodingStorageFailureBanner.test.tsx electron/core/infrastructure/filesystem/sessionHistoryRecoveryJournal.test.ts electron/core/application/sessionHistoryAppService.test.ts` passa **42 test in 4 file**, exit 0. Include ultima revisione dopo debounce, blocco dopo export, retry senza perdita, destinazione annullata/non disponibile e indipendenza dagli archivi interni.

Durante lo sviluppo una nuova asserzione filesystem includeva erroneamente anche la lettura canonica tentata dallo staging precedente: il contatore viene ora azzerato al confine dell'export. TypeScript ha rifiutato due cast dei globali fixture/test, corretti con cast espliciti da `unknown`. Un successivo controllo di formato ha richiesto il wrapping JSX del percorso visualizzato. Nessun controllo di produzione è stato indebolito.

Fonti primarie allineate alle versioni in uso: [Electron 43.7.4, evento close e preventDefault](https://github.com/electron/electron/blob/v43.7.4/docs/api/browser-window.md#event-close), [Node 24.20.0, writeFile con flush e flag di apertura](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html#fspromiseswritefilefile-data-options). Le API Electron sono state consultate anche tramite API GitHub del tag esatto, dato il timeout della pagina web. La prova qualifica il sorgente desktop e il fixture dei componenti, non l'app installata, una perdita di alimentazione o un arresto Windows. Non introduce importazione automatica delle copie esportate.

Il tracker rimuove solo il task completato; il prossimo P1 autonomo è `TEST-WEB-DOWNLOAD-STREAM-FAILURE-01`. Le modifiche Dependabot preesistenti sono conservate. Nessun commit, push, installazione, modello reale, modifica di dati personali o scrittura nel Second Brain.

Controlli conclusivi aggiuntivi:

| Comando | Exit code | Esito |
| --- | --- | --- |
| `npm run test -- --silent=true` | 0 | 2.724 test superati in 314 file, in 159,64 secondi. |
| `.venv/Scripts/python.exe -m pytest -q` | 0 | 518 test superati, uno saltato, in 119,04 secondi. |
| `npm run build` | 0 | TypeScript e bundle Renderer/Main/worker/Preload compilati dopo la correzione dei cast. |
| `npm run typecheck` e successivo `npm run build` | 0 | Verifica finale dopo il wrapping JSX; il probe Electron ripetuto rifiuta anche un payload IPC senza sessione valida senza creare file. Entrambi i gruppi PASS confermati. |
| `npm run quality:static` | 0 | 99 handler IPC e 831 file; lint e formato passati. |
| `npm run audit:deadcode` | 0 | Entrambe le modalità Knip passate, inclusi i nuovi fixture. |
| `npm run docs:check` | 0 | 56 file Markdown validati. |
| `git diff --check` e controllo encoding | 0 | Diff e file nuovi esaminati; UTF-8 senza BOM e LF nei 23 file modificati/nuovi, nessun file temporaneo o di debug. |

## Chiusura della sessione successiva

L'utente ha richiesto il commit locale di tutte le modifiche della sessione su `master`, dopo nuova esecuzione di test completi, build e lint. Le precedenti indicazioni di assenza di commit descrivono le fasi di implementazione. Il push resta subordinato a una conferma esplicita successiva al riepilogo del commit.

Il tracker conserva **50 task aperti con ID unici**, ordinati per priorità, senza storico. Rimossi i soli task completati `CODING-HISTORY-DUAL-FAILURE-EXPORT-01` e `DEPENDENCY-BUILD-CACHE-UPSTREAM-01`. Non sono emersi nuovi residui autonomi da aggiungere: gli advisory braces/sprintf-js, la qualifica dell'app installata e i limiti di durata restano nelle voci esistenti. Il prossimo P1 è `TEST-WEB-DOWNLOAD-STREAM-FAILURE-01`, con criterio di verifica già presente.

`memory.md` annota l'indipendenza dell'export dagli archivi interni e il mantenimento del blocco di chiusura, oltre alla distinzione fra intervallo di un advisory e correzione dimostrata. Per il Second Brain si propongono, senza scrittura, la stessa decisione nel dossier `repos/OnlyRagV2/memory.md` e il principio di verifica degli advisory nel catalogo generale dei gotchas. Nessuna modifica del Second Brain è inclusa nel commit.

Diff completo e quattro file nuovi esaminati. I **24 file candidati** contengono solo codice, test, fixture ripetibili, lockfile, tracker e documentazione previsti; nessun temporaneo, log di debug o file ambiente. La scansione per forme comuni di credenziali non rileva corrispondenze; tutti i candidati sono UTF-8 senza BOM con LF. Nessun dato personale, installer, campagna modello o artefatto conservato è modificato.

Nuovo gate locale per il commit richiesto:

| Comando | Exit code | Esito |
| --- | --- | --- |
| `npm run test -- --silent=true` | 0 | 2.724 test superati in 314 file, in 191,70 secondi. |
| `.venv/Scripts/python.exe -m pytest -q` | 0 | 518 test superati e uno saltato, in 139,93 secondi. |
| `npm run build` | 0 | TypeScript e tutti i bundle compilati. |
| `npm run quality:static` | 0 | 99 handler IPC e 831 file; lint, formato e confini architetturali verificati. |
| `pwsh -NoProfile -File scripts/lint_format.ps1 -Fast -SkipTests` | 0 | Formato, documentazione, JSON, typecheck, sintassi Python e build/smoke Electron passati; Vitest eseguito separatamente. |
| `npm run docs:check` e `git diff --check` | 0 | 56 documenti verificati, nessun errore di whitespace. |
