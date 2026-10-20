# Analisi dei residui del repository — 19 ottobre 2026

Audit sul checkout `master` inizialmente pulito, commit `ceef495a5efc52bfb100fd6600a542a3a789f060`. Esaminate direttive, dossier attivo SecondBrain, requisiti nelle guide, manifest, contratti, codice, test e tracker effettivi. L'inventario iniziale conta **1.131 file tracciati**. Si tratta di una ricognizione trasversale con controlli automatici estesi e approfondimenti mirati: **non è una revisione manuale riga per riga di tutto il repository**.

Il [tracker](../PROJECT_STATUS.json) passa da **36 a 40 attività aperte**: **22 autonome / 18 con decisione utente**, **5 P1 / 29 P2 / 6 P3**. Tutti i 36 ID precedenti, priorità, liste e testo originale dei criteri sono conservati; aggiunti soltanto quattro rilievi verificati. Lo schema resta `important_notes`, `todo_autonomous` (`id/p/task/verify`) e `todo_user_required` (`id/p/decision`). Problema, stato dell'evidenza, impatto, ambito, dipendenze e completamento sono espressi nei campi esistenti. Nessuna chiusura basata sulla sola esistenza di codice o sul verde delle suite.

La [ricevuta JSON](./repository-residue-audit-2026-10-19.json) conserva versioni, risultati, output dei controlli negativi e SHA-256 dei sorgenti coinvolti. I sei probe **passano perché riproducono i difetti**, non perché li correggono. I sorgenti/test/config applicativi restano invariati.

## Seguito autorizzato — 20 ottobre 2026

I quattro nuovi rilievi sono stati corretti e qualificati nel [lotto successivo](./verification-project-regressions-2026-10-20.md), poi rimossi dal tracker degli aperti. Le altre 36 attività sono identiche. Questo rapporto e la sua ricevuta conservano lo stato osservato durante l’audit: conteggio 40, hash e attesa del lock SecondBrain descrivono quella fase, senza attribuirle le correzioni successive.

## Aree esaminate e confini della verifica

| Area | Esame eseguito | Limite residuo |
| --- | --- | --- |
| Repository, requisiti e tracker | Direttive applicabili; dossier/indice PARA attivo; 1.131 path; manifest/toolchain; 36 voci e ricevute richiamate; stato Git iniziale pulito. | Nessuna assunzione che le ricevute storiche qualifichino byte o ambiente successivi. |
| Electron, IPC e sicurezza | Entry point/Preload, mittente IPC/schema, navigazione, sandbox/CSP; guard statico su 103 handler e layering; suite Node/DOM. | Spot check dei confini, non penetration test; nessuna nuova qualifica installata. |
| Ingestion, OCR, archivi e persistenza | Route/schema REST, ammissione/XLS, ricerca e provenienza; suite Python completa e gate critico; ricevute archivi, recupero e frozen. | Niente nuova esecuzione OCR frozen, parser rappresentativi installati, power loss o dati personali. |
| Ricerca RAG e storico semantico | Ricerca ibrida/reranker lessicale, embedding versionati dei chunk, wrapper raw dello storico e metadati dei record; test esistenti e ricevute prestazionali. | Nessuna nuova misura semantica/encoder reale o carico 100k; assenza della provenienza nello storico confermata staticamente, senza attribuirle una nuova campagna runtime. |
| Chat, bozze e impostazioni | Hook/archivi e test di revisione, budget e checkpoint; ricevute Electron/packaged già conservate. | Token reali, completezza semantica, installazione e interruzioni non rappresentate restano aperti. |
| Traduzione | Hook di ownership/cancellazione, marker e Sidecar; regressioni e ricevute di fedeltà dichiarate. | Nessuna nuova traduzione reale o revisione visiva di output installati. |
| Coding Agent | Scoperta progetti, resolver, runner, shell persistente, checkpoint/queue, skill e policy; sei probe reali Go/PowerShell e controlli Python isolati. | Non eseguiti TaskLab, estrazione/planning o altre campagne reali; nessuna generalizzazione dei probe a tutti gli ecosistemi. |
| Dipendenze e distribuzione | Manifest/lock, Knip, grafo, npm audit, versione braces dal registro e DOMPurify incorporato; inventario/ricevute dei candidati. | Niente `npm ci`, nuova build, estrazione/hash di tutti i payload, nuova scansione Python/native o qualifica dei diritti. |
| Operazioni e UI | Policy cleanup/log e script/regressioni; focus/modali e guide; suite DOM. | Nessuna cancellazione di residui reali, race avversaria, screen reader, zoom o qualifica desktop riavviato. |

## Nuovi rilievi confermati

### P1 — AGENT-VERIFICATION-CWD-BINDING-01

Il [runner](../electron/core/application/agentOrchestratorVerificationRunner.ts), righe 113–115, recupera la shell associata alla root e invia il comando senza vincolare la directory corrente. [getOrCreateShellSession](../electron/core/application/agentToolExecutorService.ts), righe 410–417, riutilizza la shell; [PersistentPowerShellSession](../electron/core/infrastructure/process/persistentPowerShellSession.ts) conserva intenzionalmente i cambi di directory.

Prova: modulo Go nella root con `TestAdd` che fallisce (`AUDIT_ROOT_FAIL`) e modulo figlio con test valido. Il comando diretto nella root restituisce **exit 1**. Dopo `Set-Location -LiteralPath 'child'` nella stessa shell, il runner restituisce **`verified`** per root e figlio; l'output registra due esecuzioni nel figlio. La root difettosa non viene più testata. Sono reali scoperta, runner, controlli del comando, shell e Go; il singleton delle shell è sostituito con una mappa di shell reali equivalente al riuso produttivo.

Impatto: falsa attestazione del progetto e possibile promozione della chiusura con root difettosa. Ambito: legare comando, directory realmente usata ed evidenza a ciascun target. Completamento: lo stesso caso deve fallire sulla root anche dopo `cd`, coprendo più progetti, cambi directory introdotti dagli script, timeout/annullamento e quoting dei percorsi. Nessuna chiamata modello/installazione necessaria. [Semantica ufficiale di Set-Location per PowerShell 5.1](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/set-location?view=powershell-5.1).

### P2 — AGENT-PYTHON-PROJECT-DISCOVERY-01

Il [resolver](../electron/core/domain/agent/projectVerificationResolver.ts) riconosce `[tool:pytest]` in `setup.cfg` e `[pytest]` in `tox.ini`. La [scoperta](../electron/core/infrastructure/filesystem/projectProfileDiscovery.ts), righe 13–25, 62 e 94, non include quei file fra i manifest né fra i segnali Python.

Quattro casi riprodotti: per ciascun formato un progetto standalone è omesso (`projects=[]`) pur avendo un comando valido nel resolver; in un workspace Go con quel progetto Python figlio, il runner restituisce **`verified`** controllando soltanto Go. L'esecuzione indipendente della fixture Python produce **un test fallito / exit 1** (`AUDIT_PYTHON_FAIL`). Impatto: verifica incompleta dei workspace e classificazione errata di progetti esistenti. Completamento: scoperta, linguaggi e controlli richiesti coerenti per root e progetti annidati; sezioni estranee non devono inventare verifiche. La [documentazione pytest](https://docs.pytest.org/en/stable/reference/customize.html) conferma le due sezioni; la prova usa il Python 3.13.15 e pytest installati, senza presumere supporto da una versione diversa.

### P2 — AGENT-VERIFICATION-EMPTY-TEST-EVIDENCE-01

Il runner determina `evidenceLevel` dal solo `kind` dei comandi (riga 47) e considera il loro exit code (riga 125), senza provare l'esecuzione di test. Un modulo Go con sorgente valido ma senza `_test.go` produce **`[no test files]` / exit 0** e viene restituito come **`verified`, `evidenceLevel: behavioral`**.

Impatto confermato: il livello dichiarato eccede l'evidenza osservata. Compilazione riuscita e prove comportamentali vanno distinte; non si richiede di inventare test per progetti che non ne dichiarano. Completamento: un'esecuzione vuota non produce evidenza comportamentale, un test effettivo passato/fallito resta distinguibile e gli eventuali requisiti comportamentali non vengono promossi con un controllo vuoto. Go è riprodotto; suite tutte saltate, Rust/Gradle e script custom sono **verifiche ancora necessarie**, non ulteriori difetti qui dimostrati. [Contratto ufficiale del comando go test](https://pkg.go.dev/cmd/go#hdr-Test_packages).

### P3 — DOCS-CURRENT-STATE-RECONCILIATION-01

Due contraddizioni correnti confermate: [agent-runtime.md](./agent-runtime.md), riga 9, rinvia ancora a un contratto nativo futuro nonostante resolver e [qualifica nativa](./verification-native-projects-2026-10-19.md) presenti; [ingestion.md](./ingestion.md), sezione Limiti aperti, tratta `SOURCE-ARCHIVE-LIFECYCLE-01` come pendente nonostante la [qualifica conclusa](./verification-source-archive-lifecycle-2026-10-19.md) e l'assenza dell'ID dal tracker aperto.

Impatto: riaprire lavoro concluso o attribuire capacità errate al runtime. Ambito: guide correnti/riferimenti a task ritirati; non riscrivere le ricevute storiche. Completamento: confronto semantico con codice/tracker, collegamento alle prove corrette e `docs:check`; un validatore di link non rileva questi errori di significato. L'aggiornamento di conteggio/riferimento all'audit non risolve queste due contraddizioni.

## Riconciliazione delle 36 attività precedenti

Ogni attività mantiene nel tracker il criterio originale e acquisisce evidenze, impatto, ambito e dipendenze. La presenza in `todo_autonomous` descrive la titolarità tecnica: **non autorizza** le sottofasi di installazione, modello o dati personali indicate nei criteri. Le qualifiche installate, semanticamente reali e di perdita di alimentazione restano distinte dalle prove sorgente/fixture.

| ID preservato | Priorità | Stato dell'evidenza | Riferimenti ricontrollati |
| --- | --- | --- | --- |
| `DISTRIBUTION-CURRENT-SOURCE-QUALIFICATION-01` | P2 | Qualifica residua | [build_package.ps1](../scripts/build_package.ps1), [verification-current-source-2026-10-19.md](../docs/verification-current-source-2026-10-19.md), [verification-release-inventory-2026-10-19.md](../docs/verification-release-inventory-2026-10-19.md) |
| `RAG-STRUCTURE-AWARE-CHUNKING-01` | P2 | Valutazione/decisione pendente | [ingest_service.py](../sidecar/services/ingest_service.py), [retrieval.md](../docs/retrieval.md), [content-acceptance.md](../docs/content-acceptance.md) |
| `CHAT-EFFECTIVE-CONTEXT-ALLOCATION-01` | P2 | Qualifica residua | [chatContextBudget.ts](../src/services/chatContextBudget.ts), [useChatEngine.ts](../src/hooks/useChatEngine.ts), [verification-chat-drafts-context-2026-10-16.md](../docs/verification-chat-drafts-context-2026-10-16.md) |
| `XLS-PARSER-MEMORY-ADMISSION-01` | P2 | Qualifica residua | [xls_process.py](../sidecar/infrastructure/xls_process.py), [test_xls_admission.py](../sidecar/tests/test_xls_admission.py), [verification-current-source-2026-10-19.md](../docs/verification-current-source-2026-10-19.md) |
| `RAG-INDEX-METADATA-EFFICIENCY-01` | P2 | Qualifica residua | [search_service.py](../sidecar/services/search_service.py), [retrievalEfficiency.py](../scripts/e2e/retrievalEfficiency.py), [verification-retrieval-efficiency-2026-10-18.md](../docs/verification-retrieval-efficiency-2026-10-18.md) |
| `HISTORY-EMBEDDING-CORRECTNESS-01` | P2 | Gap statico confermato; runtime reale da qualificare | [prompt_history_service.py](../sidecar/services/prompt_history_service.py), [embeddings.py](../sidecar/infrastructure/embeddings.py), [test_prompt_history_failures.py](../sidecar/tests/test_prompt_history_failures.py) |
| `SETTINGS-CLOSE-DURABILITY-01` | P2 | Qualifica residua | [main.ts](../electron/main.ts), [useSettingsPersistence.ts](../src/hooks/useSettingsPersistence.ts), [settingsCloseDurability.mjs](../scripts/e2e/settingsCloseDurability.mjs) |
| `CHAT-DURABLE-HISTORY-01` | P2 | Qualifica residua | [chatHistoryRepository.ts](../electron/core/infrastructure/filesystem/chatHistoryRepository.ts), [useChatHistory.ts](../src/hooks/useChatHistory.ts), [verification-current-source-2026-10-19.md](../docs/verification-current-source-2026-10-19.md) |
| `DOC-EDITOR-DRAFT-DURABILITY-01` | P2 | Qualifica residua | [documentDraftRepository.ts](../electron/core/infrastructure/filesystem/documentDraftRepository.ts), [useDocumentDrafts.ts](../src/hooks/useDocumentDrafts.ts), [verification-current-source-2026-10-19.md](../docs/verification-current-source-2026-10-19.md) |
| `TRANSLATION-INPLACE-UNMOUNT-CANCELLATION-01` | P2 | Qualifica residua | [useTranslation.ts](../src/hooks/useTranslation.ts), [translator.py](../sidecar/domain/translator.py), [useTranslationOwnership.test.tsx](../src/hooks/useTranslationOwnership.test.tsx) |
| `AGENT-UNGRACEFUL-SHUTDOWN-RECOVERY-01` | P2 | Qualifica residua | [agentOrchestratorSessionPersistence.ts](../electron/core/application/agentOrchestratorSessionPersistence.ts), [agentSessionStateRepository.ts](../electron/core/infrastructure/filesystem/agentSessionStateRepository.ts), [agentCheckpointStore.ts](../electron/core/infrastructure/filesystem/agentCheckpointStore.ts) |
| `STATE-WRITER-CRASH-DURABILITY-01` | P2 | Qualifica residua | [safeAtomicFileWriter.ts](../electron/core/infrastructure/filesystem/safeAtomicFileWriter.ts), [stateWriterCrashDurability.mjs](../scripts/e2e/stateWriterCrashDurability.mjs), [verification.md](../docs/verification.md) |
| `DEPENDENCY-BRACES-UPSTREAM-01` | P2 | Residuo attivo confermato | [package.json](../vendor/braces-3.0.4/package.json), [dependency-remediation-2026-10-16.md](../docs/dependency-remediation-2026-10-16.md), [libraries.md](../docs/libraries.md) |
| `RAG-EMBEDDING-REBUILD-QUALIFICATION-01` | P2 | Qualifica residua | [store_rebuild_service.py](../sidecar/services/store_rebuild_service.py), [rebuild_embeddings.py](../scripts/rebuild_embeddings.py), [test_store_rebuild.py](../sidecar/tests/test_store_rebuild.py) |
| `LEGACY-SESSION-COMPAT-01` | P3 | Residuo attivo confermato | [workspaceMetadataDirectory.ts](../electron/core/infrastructure/filesystem/workspaceMetadataDirectory.ts), [sessionHistoryRepository.ts](../electron/core/infrastructure/filesystem/sessionHistoryRepository.ts), [agent-runtime.md](../docs/agent-runtime.md) |
| `DISTRIBUTION-PACKAGE-SIZE-01` | P3 | Qualifica residua | [build_package.ps1](../scripts/build_package.ps1), [distribution-cpu-release.md](../docs/distribution-cpu-release.md), [verification-release-inventory-2026-10-19.md](../docs/verification-release-inventory-2026-10-19.md) |
| `DISTRIBUTION-UPDATE-PATH-01` | P3 | Qualifica residua | [installer.nsh](../installer/installer.nsh), [package.json](../package.json), [distribution.md](../docs/distribution.md) |
| `DEPENDENCY-MONACO-VENDORED-SANITIZER-01` | P3 | Versione incorporata confermata; esposizione da verificare | [CodingEditorContent.tsx](../src/components/coding/CodingEditorContent.tsx), [libraries.md](../docs/libraries.md), [package-lock.json](../package-lock.json) |
| `QUALITY-CONTENT-LIVE-QUALIFICATION-01` | P1 | Qualifica residua | [contentAcceptance.live.ts](../scripts/live/contentAcceptance.live.ts), [content-acceptance.md](../docs/content-acceptance.md), [verification-current.md](../docs/verification-current.md) |
| `LOCAL-MODEL-ROLE-QUALIFICATION-01` | P1 | Qualifica residua | [model-task-baselines.md](../docs/model-task-baselines.md), [modelRuntimeFit.live.ts](../scripts/live/modelRuntimeFit.live.ts), [modelRuntimeFit.ts](../shared/domain/hardware/modelRuntimeFit.ts) |
| `LIVE-MODEL-HARDWARE-01` | P1 | Qualifica residua | [taskLabSequence.live.ts](../scripts/live/taskLabSequence.live.ts), [reliability-audit-2026-10-01.md](../docs/reliability-audit-2026-10-01.md), [agent-runtime.md](../docs/agent-runtime.md) |
| `AGENT-REQUEST-LEDGER-LIVE-QUALIFICATION-01` | P1 | Qualifica residua | [planGenerationAppService.ts](../electron/core/application/planGenerationAppService.ts), [requestLedgerExtraction.live.ts](../scripts/live/requestLedgerExtraction.live.ts), [agent-runtime.md](../docs/agent-runtime.md) |
| `TRANSLATION-MARKERS-INSTALLED-01` | P2 | Qualifica residua | [translator.py](../sidecar/domain/translator.py), [test_translator.py](../sidecar/tests/test_translator.py), [translation.md](../docs/translation.md) |
| `DISTRIBUTION-COMPONENT-RIGHTS-QUALIFICATION-01` | P2 | Qualifica residua | [release_artifacts.py](../scripts/release_artifacts.py), [distribution-licenses.md](../docs/distribution-licenses.md), [distribution-agpl-proposal.md](../docs/distribution-agpl-proposal.md) |
| `DISTRIBUTION-PUBLIC-SOURCE-DELIVERY-01` | P2 | Qualifica residua | [distribution-agpl-proposal.md](../docs/distribution-agpl-proposal.md), [distribution.md](../docs/distribution.md), [build_package.ps1](../scripts/build_package.ps1) |
| `MODAL-ASSISTIVE-TECHNOLOGY-QUALIFICATION-01` | P2 | Qualifica residua | [Modal.tsx](../src/components/common/Modal.tsx), [modalFocus.ts](../src/lib/modalFocus.ts), [frontend.md](../docs/frontend.md) |
| `QWEN38-FULLTASK-01` | P2 | Valutazione/decisione pendente | [fullTaskRun.live.ts](../scripts/live/fullTaskRun.live.ts), [reliability-audit-2026-09-30.md](../docs/reliability-audit-2026-09-30.md), [model-task-baselines.md](../docs/model-task-baselines.md) |
| `RETAINED-RESIDUE-DISPOSAL-01` | P2 | Qualifica residua | [cleanup_policy.ps1](../scripts/cleanup_policy.ps1), [clean_workspace.ps1](../scripts/clean_workspace.ps1), [verification-log-cleanup-2026-10-19.md](../docs/verification-log-cleanup-2026-10-19.md) |
| `RAG-SEMANTIC-RERANKER-QUALIFICATION-01` | P2 | Valutazione/decisione pendente | [reranker.py](../sidecar/infrastructure/reranker.py), [retrieval.md](../docs/retrieval.md), [content-acceptance.md](../docs/content-acceptance.md) |
| `OLLAMA-RESOURCE-ADMISSION-01` | P2 | Qualifica residua | [ollamaGenerationScheduler.ts](../electron/core/infrastructure/http/ollamaGenerationScheduler.ts), [config.py](../sidecar/config.py), [model-runtime-fit.md](../docs/model-runtime-fit.md) |
| `AGENT-SESSION-LIVE-01` | P2 | Qualifica residua | [agentOrchestratorSessionSetup.ts](../electron/core/application/agentOrchestratorSessionSetup.ts), [taskQueueAppService.ts](../electron/core/application/taskQueueAppService.ts), [agent-runtime.md](../docs/agent-runtime.md) |
| `AGENT-SKILLS-LIVE-01` | P2 | Qualifica residua | [skillMatcher.ts](../electron/core/domain/skills/skillMatcher.ts), [skillAdherenceValidator.ts](../electron/core/domain/skills/skillAdherenceValidator.ts), [agent-runtime.md](../docs/agent-runtime.md) |
| `AGENT-NETWORK-LIVE-01` | P2 | Qualifica residua | [webToolService.ts](../electron/core/application/webToolService.ts), [networkApprovedPolicy.ts](../electron/core/domain/agent/networkApprovedPolicy.ts), [agent-runtime.md](../docs/agent-runtime.md) |
| `AGENT-OOM-LIVE-01` | P2 | Qualifica residua | [agentOrchestratorApplicationClosure.ts](../electron/core/application/agentOrchestratorApplicationClosure.ts), [ollamaGenerationScheduler.ts](../electron/core/infrastructure/http/ollamaGenerationScheduler.ts), [agent-runtime.md](../docs/agent-runtime.md) |
| `AGENT-THINKING-RUNAWAY-01` | P2 | Qualifica residua | [ollamaSessionRuntime.ts](../electron/core/domain/agent/ollamaSessionRuntime.ts), [agentOrchestratorSessionWatchdog.ts](../electron/core/application/agentOrchestratorSessionWatchdog.ts), [agent-runtime.md](../docs/agent-runtime.md) |
| `I18N-SIDECAR-MIGRATION-LIVE-01` | P3 | Qualifica residua | [store_rebuild_service.py](../sidecar/services/store_rebuild_service.py), [it.ts](../src/i18n/locales/it.ts), [translation.md](../docs/translation.md) |

Il gap di provenienza dello storico è già coperto da `HISTORY-EMBEDDING-CORRECTNESS-01`: i record di [prompt_history_service.py](../sidecar/services/prompt_history_service.py), righe 113–125, salvano il vettore senza digest/spazio; il wrapper raw/fallback in [embeddings.py](../sidecar/infrastructure/embeddings.py), righe 190–204, restituisce soltanto vettori/stato e la ricerca dello storico non passa uno spazio atteso. Questo approfondimento statico **non crea un duplicato**, non dimostra nuova qualità di scoring e non autorizza un rebuild personale. Le regressioni HTTP esistenti coprono errori espliciti, non la provenienza completa dello spazio.

Esclusi dall'apertura di nuovi task: `CHAT-DOCUMENT-COVERAGE-01`, `QUALITY-PYTHON-CRITICAL-PATHS-01`, `SOURCE-ARCHIVE-LIFECYCLE-01`, `PROJECT-VERIFICATION-NATIVE-QUALIFICATION-01`, `CLEANUP-LOGS-POLICY-ALIGNMENT-01` e `RELEASE-CANDIDATE-EVIDENCE-EXTRACTION-01`, con ricevute presenti. I nuovi casi avversari del verificatore hanno cause/criteri circoscritti e non annullano gli esiti dei dieci fixture nativi già conservati. Non riaperto il vecchio downloader Ollama: il codice corrente apre la pagina ufficiale in caso di avvio locale fallito e non scarica/esegue il setup. Nessun duplicato per `sprintf-js` già rimosso dal perimetro qualificato.

Knip passa nelle due modalità: nessun nuovo task per export/file TypeScript orfani rilevato dallo strumento. Questo esito non prova assenza di dead code Python. I match TODO/legacy sono stati contestualizzati: prompt/fixture negativi, profili hardware e compatibilità attive non sono automaticamente residui eliminabili. `migrate_chunk_context.py` è un rifiuto intenzionale senza apertura dello storage: la sua presenza protegge un percorso ritirato. Tablet/smartphone restano fuori target per decisione già registrata.

## Verifiche, ambiente e limiti

Ambiente osservato: Node 24.20.0, npm 11.19.0, Python 3.13.15, Vitest 4.1.11, Go 1.27.0 Windows/amd64. Node/npm rispettano gli intervalli del manifest; non è stata rieseguita la CI sul suo Node esatto 24.19.0.

| Comando/prova | Esito di questa sessione |
| --- | --- |
| `npm run quality:static` | Pass: 854 file, 103 handler IPC, layering/lint/formato; nessuna correzione automatica. |
| `npm run typecheck` | Pass. |
| `npm run audit:deadcode` | Knip standard e production passati. |
| `npm run audit:cycles` | Pass: 465 moduli nel grafo dichiarato, nessun ciclo. |
| `npm run test -- --reporter=dot --silent=true` | 2.911 passati in 320 file, 202,46 s. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | 598 passati / un symlink saltato, 176,72 s; junction Windows reali eseguite. |
| `npm run quality:python` | 15 casi / otto controlli richiesti passati, 4,09 s. |
| Config Vitest esterna con probe avversari | Sei riproduzioni confermate, 8,77 s; fixture e processi posseduti ripuliti. |
| `npm audit --json` | Zero segnalazioni dal registro in questo momento; non certifica fork, codice incorporato o librerie native. |
| Versioni residue | Registro braces 3.0.3; Monaco 0.56.0 incorpora DOMPurify 3.4.8 nei byte locali. Nessuna nuova prova di exploit o fix. |
| `npm run docs:check` | 76 pagine prima della scrittura; verifica finale riportata sotto. |
| Cleanup policy/log | Pass: 31 casi WhatIf e 17 casi di eliminazione reale isolata; hash dei file conservati verificati. |

La [CI dell'esatto ceef495](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39328778562) è stata riletta tramite API GitHub: `in_progress`, conclusione assente. Il verde locale non viene attribuito a quella esecuzione remota.

Non rieseguiti build, pacchettizzazione, runtime Electron/E2E, installazione/aggiornamento, nuove generazioni/embedding reali, migrazioni personali, screen reader/zoom, power loss, nuove estrazioni dei candidati o scansioni advisory Python/native. Le prove source/frozen precedenti sono riferimenti datati, non riesecuzioni attribuite a questa sessione. Il primo avvio del probe esterno è fallito nel caricamento per root Vitest su un volume diverso: corretto soltanto il config temporaneo; il secondo avvio esegue i sei casi. Una prova opzionale aggiuntiva dello storico, contenuta in un comando con cleanup, è stata rifiutata automaticamente prima dell'esecuzione (`blocked by policy`): nessuna fixture creata né risultato runtime attribuito allo storico. L'evidenza relativa rimane statica. Due invocazioni iniziali degli script cleanup con `-Fast` sono state rifiutate dal binding del parametro; gli script dichiarano `param()` e sono stati richiamati senza quell'opzione, senza modificare codice.

## Piano di intervento

1. **P1 offline:** correggere il vincolo directory del verificatore con controllo negativo root fallita/figlio valido e comando eseguito nella root attestata. È il primo intervento perché il falso verde può alterare la chiusura dei task.
2. **P2 offline:** completare discovery Python e classificazione delle esecuzioni senza test, ciascuna con regressioni autonome e verifiche incrociate del runner. Non basta ripetere le suite ordinarie che oggi passano.
3. **Residui offline e documentali:** riconciliare le guide dopo aver stabilito i confini corretti; qualificare il recupero agente interrotto e progettare la provenienza dello storico su copie isolate. Restano attivi compatibilità e fork finché i loro gate non sono soddisfatti.
4. **Candidato e installazione:** dopo eventuali correzioni runtime costruire/qualificare un candidato corrispondente ai nuovi byte. Riutilizzare le prove comuni per le diverse qualifiche installate, mantenendo i criteri distinti e attendendo le autorizzazioni pertinenti.
5. **Campagne P1 con l'utente:** contenuto/ledger, ruoli/hardware e sequenze TaskLab secondo dipendenze e budget già fissati. Conservare aspettative, spese e fallimenti; nessuna ripresa implicita.
6. **Consegna pubblica e smaltimento:** diritti/sorgenti/qualifica prima della pubblicazione autorizzata; residui conservati soltanto dopo decisione su ownership, recupero e retention. Nessuna di queste operazioni è eseguita dall'audit.

## Igiene e consegna

Residui preesistenti ignorati osservati: `.pytest_cache/`, `.venv/`, `build/`, `dist-electron/`, `dist/`, `logs/`, `node_modules/`, `release/`, cache `__pycache__` sotto scripts/sidecar e `userdata_dev/`. Sono dipendenze/build/cache/log/dati o candidati con ownership/retention da rispettare: **segnalati e conservati**, senza inferire eliminabilità dal nome. Non creati scratch o worktree nel checkout. Le suite possono aggiornare log/cache ignorati; non sono sorgenti o snapshot versionati e non vengono smaltiti in questa fase.

Backup del tracker e dei riferimenti documentali iniziali, log e sorgente/ricevuta del probe sono conservati fuori checkout in `%TEMP%/onlyrag-audit-d8004231b059486db7cb540f7e186a68`. Le fixture operative Go/Python e le shell del probe sono terminate/rimosse dal teardown; rimossi anche cache Vite e script/template di redazione temporanei. Il sorgente/config del probe rimane come evidenza riproducibile fuori checkout. Nessuna modifica a memoria privata IDE o memoria tecnica durevole: non è stata assunta una nuova decisione architetturale. Aggiornamento del dossier SecondBrain in attesa: un’altra sessione Write detiene `writer.lock`; nessun lock forzato o cancellato. Nessun commit/push, rilascio o correzione di codice.

Verifiche finali di consegna: `npm run docs:check` su 77 pagine, `npm run quality:static`, `git diff --check`, controllo JSON di schema/ID/priorità/criteri, hash dei sorgenti invariati e riesame di diff/`git status --ignored`. Nessuna nuova suite comportamentale dopo le sole modifiche documentali.
