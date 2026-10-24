# Pulizia del repository — 24 ottobre 2026

Base: `master`, `9b5508d28305d3cdc5dbe02729767345fdaf2395`. Checkout inizialmente pulito, nessun non tracciato ordinario o stash; ignorati `.venv/`, `node_modules/`, `logs/`, `userdata_dev/`. Un solo worktree e un solo branch locale/remoto effettivo (`git ls-remote --heads origin`). Nessun commit o push eseguito.

La successiva [consegna per cambio sessione](./session-handoff-cleanup-2026-10-24.md) registra la nuova autorizzazione a commit e push. Le indicazioni senza pubblicazione sotto descrivono la precedente fase di pulizia.

## Rimozioni dal codice e riallineamento dei test

La ricerca dei riferimenti comprende sorgenti, test, script, configurazioni e documenti, con controllo aggiuntivo AST TypeScript/Python e audit Knip normale/produzione. Eliminati:

- `EpisodicMemoryCompactor.toState`: usato soltanto da un test; la persistenza attiva usa `getEpisodes` e `getRecentFullLogs`. Il test conserva la verifica tramite l'accessore attivo.
- `GoalDecompositionPlanner.isAllVerified`: usato soltanto da un test; la chiusura attiva usa `getCompactState().isCompleted`. Asserzione riallineata.
- `SidecarAppService.removePromptHistoryForProject` e il campo privato `project_path`: nessun chiamante applicativo. La rimozione del progetto continua soltanto a deregistrarlo, senza eliminare sessioni o file; preservata la relativa regressione e la rimozione/ripristino per sessione. Contratto REST Python invariato.
- `TransactionalExecutionGuard.validateTaskCompletion`, l'interfaccia `VerificationRequirement` e il test esclusivo del metodo inattivo. Restano oscillazione filesystem e guardie attive di chiusura, evidenze, verifica e recupero nell'orchestratore.
- Risoluzione duplicata della directory dei due logger: ora usano `userDataRoot`, come gli altri repository. Electron mantiene il proprio profilo; in esecuzione headless il resolver usa `userdata_dev`, e i test il profilo isolato predisposto da `nodeSetup`.
- Fallback legacy di `SystemDiagnosticsLogger.clearLogs` che svuotava anche `cwd/logs/app.log` oltre al log attivo. La cancellazione opera ora soltanto sul file posseduto dal logger.

Due nuove regressioni controllano il percorso dei logger predefiniti e la conservazione di un log estraneo al profilo. Entrambe falliscono sul precedente logger e passano sul fix; 29 test mirati su tre file passano. I test sull'API attiva sono conservati; rimosso un solo caso dedicato alla guardia mai chiamata.

## Incidente sui log durante la verifica

La prima suite TypeScript ha esposto il fallback legacy descritto sopra: i due log del checkout hanno ricevuto dati sintetici e `logs/app.log` è stato successivamente svuotato da `clearLogs`. Prima della suite erano stati registrati hash e lunghezze, ma **non una copia dei byte**. Questa preparazione insufficiente ha impedito il recupero completo del log applicativo.

- `coding_agent_audit.log`: i 107.646 byte iniziali sono stati riconosciuti dall'hash SHA-256 `39DDDAB8C3A4D20FCD295E8F8B86F7F1DB734BD7BAD0F2CE3EBBDF900F10A315` e ripristinati integralmente dopo backup verificato del log completo con le aggiunte sintetiche (123.024 byte).
- `app.log`: inizialmente 35.873 byte, SHA-256 `84840FF888E2D12C7123B38AAC924153DBF488BB5B6A2216BD3450498AD3F8A8`; dopo la suite 292 byte. Nessuna copia corrispondente trovata nei 57 log esaminati nel repository, nei temporanei e nelle evidenze OnlyRag-Live. Il log residuo e la ricerca sono conservati; **contenuto originale non recuperato**. Nessuna ricostruzione con dati differenti è stata presentata come recupero. L'utente ha confermato di non avere un backup.
- I 66 file di `userdata_dev` sono invariati per insieme, lunghezza e SHA-256. La suite finale TypeScript viene eseguita in una copia isolata dei 1.243 file tracciati, verificati byte-identici; `node_modules` è condiviso tramite junction dichiarata, quindi non è una reinstallazione indipendente.

La correzione impedisce la stessa cancellazione estranea nelle future sessioni; non recupera retroattivamente il contenuto perduto. Il tracker mantiene un'attività separata per il recupero o una disposizione esplicita del proprietario, senza considerare il problema chiuso.

## Output e cache

Rimossi con `scripts/clean_repo.ps1`, dopo `Assert-CleanupSelection`, backup SHA-256 di ogni file e preflight `-WhatIf`: `dist/`, `dist-electron/`, `node_modules/.vite/`, `node_modules/.cache/`. Totale: **68 file, 20.532.566 byte**, quattro radici. Manifest e copie esatte fuori dal checkout. Nessun file tracciato incluso nella selezione.

La revisione automatica ha rifiutato prima dell'esecuzione il comando separato per rimuovere la copia sorgenti isolata, il runtime Python temporaneo e la directory vuota `node_modules/.vite-temp`: motivo restituito soltanto **blocked by policy**. Nessuna fase di quel comando è stata eseguita e nessuna rimozione alternativa è stata tentata. Restano `%TEMP%/onlyrag-cleanup-20261024/source` (con junction `node_modules` dichiarata), `test-venv` e `.vite-temp`; rimangono anche le fixture sintetiche prodotte dalle suite sotto `%TEMP%/onlyrag-{executor,orchestrator,audit}-test-*` e due directory XLS vuote. I loro nomi e contenuti sono inventariati, senza estendere la cancellazione ai dati/evidenze esterni.

## Elementi conservati

- `.venv/` e dipendenze installate: necessari ai comandi e ai worker; `braces` locale e relative licenze restano attivi. Nessun aggiornamento delle dipendenze.
- `.onlyrag/` vuoto, `userdata_dev/`, log residui e dati personali: stato protetto, nessuna cancellazione basata sul nome o sull'ignore.
- Asset ufficiali, otto screenshot, 26 diagrammi SVG, font e licenze, corpus/fixture, ricevute storiche, contratti OpenAPI e guardie sui formati legacy.
- `getJournal`, `commitJournal`, `disposeShellSessions` e altri punti di preparazione/ispezione necessari ai test; callback React, Vite, FastAPI e Pydantic, invocate dai rispettivi framework anche senza chiamanti testuali.
- Tutti i riferimenti interni Codex/Copilot: `git rev-list --count --all --not master` trova 41 commit non presenti in `master`. `git fsck --full --no-reflogs` termina con exit 0, nessun errore e 255 oggetti dangling: nessun prune/GC o cancellazione di ref. Nessun branch o worktree obsoleto da rimuovere.
- Evidenze esterne, backup, store e installazioni pregresse: nessuna pulizia estesa a quei percorsi.

## Verifiche e limiti

- `npm run test -- --reporter=dot --silent=true`: primo passaggio 3.037 test / 330 file verdi, prima della correzione logger; passaggio finale dopo la correzione logger **3.039 test / 330 file passati**, 210,37 secondi, nella copia sorgenti isolata.
- `pwsh -NoProfile -File scripts/test_sidecar_health.ps1`: **687 passati, un solo skip** per symlink directory non disponibile. Interprete `.venv` del checkout, pytest 9.1.1 in overlay esterno tramite `PYTHONPATH`, bytecode/cache pytest disabilitati. Il checkout `.venv` non contiene pytest ed è rimasto invariato.
- Primo tentativo Python in venv temporaneo: 675 passati, 12 falliti e un skip; quel layout non fornisce ai worker XLS il `purelib` del checkout né all'OCR le DLL CUDA previste. Fallimenti conservati, metodo corretto e suite completa ripetuta senza cambiare il runtime.
- Gate Python critico: 15 casi su otto controlli obbligatori, nessuno skip; eseguito con il Python temporaneo e le librerie runtime del checkout via `.pth` esterno.
- `npm run typecheck`, `quality:static` (891 file, 107 handler), `audit:deadcode` normale/produzione, `audit:cycles` (475 file, zero cicli), `format:check`, `docs:check`, `assets:check`, `npm run build`, smoke Electron con profilo isolato: esiti nel riepilogo finale sotto.
- `pwsh -NoProfile -File scripts/test_cleanup_policy.ps1`: 32 casi passati. `test_log_cleanup.ps1`: 17 casi passati.
- Non eseguiti modelli reali, installazioni, migrazioni personali, pubblicazioni o verifiche di qualità semantica. Il passaggio ordinario pnpm non soddisfa da solo il criterio del task che richiede cache vuota isolata e rete vietata: quel task resta aperto.

Esiti finali: tipi, statici, Knip normale/produzione, cicli, documentazione (124 Markdown), asset, build e smoke Electron tutti passati; diff e stato Git riesaminati. La perdita del log applicativo resta un limite materiale separato dalle suite verdi. L'utente ha confermato di non avere un backup; questa risposta non equivale a una disposizione sul contenuto perduto.

## Evidenze e recupero

Directory esterna: `%TEMP%/onlyrag-cleanup-20261024`. Contiene bundle `before.bundle` con tutti i ref, verificato da `git bundle verify`, patch finale, manifest SHA-256 degli output rimossi e dei dati preservati, ricevute dei log, output dei controlli e del tentativo Python fallito. Gli oggetti dangling rimangono nel `.git` originale; il bundle include i ref, non garantisce la copia degli oggetti irraggiungibili.

Per recuperare i sorgenti precedenti si può leggere il blob del commit base nel repository o nel bundle; i file rimossi di build/cache hanno copie esatte nel backup esterno. Questo backup non comprende i byte originali perduti di `app.log`.

Fonti ufficiali consultate: [configurazione Knip](https://knip.dev/reference/configuration) (schema della major 6, come Knip 6.32.3 installato) e [cache di pytest](https://docs.pytest.org/en/stable/how-to/cache.html). Le opzioni effettivamente usate sono state verificate con pytest 9.1.1; un audit statico privo di segnalazioni non costituisce prova di inutilizzo di tutti i percorsi dinamici.
