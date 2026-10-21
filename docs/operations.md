# Setup e operazioni

La [verifica locale del writer del 21 ottobre](./verification-tracker-completion-2026-10-21.md) comprende 24 interruzioni Node/Electron e readback in processi nuovi. I temporanei completi precedenti alla sostituzione restano separati dal canonico confermato; non sono promossi o eliminati automaticamente dopo un crash.

`node scripts/e2e/viteEditorWindows.mjs` verifica Vite ed editor Windows con server loopback e un editor sintetico posseduti. `ONLYRAG_LIVE_ROOT` sceglie la radice delle evidenze. Per conservare i profili di `chatDraftRecovery.mjs` impostare `ONLYRAG_RECOVERY_EVIDENCE` su una directory esistente dedicata; senza questa opzione le fixture riuscite vengono pulite. Nessuno dei due runner usa modelli reali.

Durante l'avvio di sviluppo il Sidecar mostra `Verifica...` finché preparazione Python e readiness non terminano. Con `.venv` assente il primo avvio può installare le dipendenze runtime; un fallimento concluso resta `Offline`. Dopo modifiche al Main process chiudere e riavviare `npm run dev`. [Diagnosi, correzione e prove native del 20 ottobre](./verification-sidecar-dev-startup-2026-10-20.md).

Eseguire i comandi da PowerShell nella radice del repository. Le versioni dichiarate sono Node [`24.19.0`](../.nvmrc), npm `>=11 <12` in [`package.json`](../package.json) e Python [`3.13.15`](../.python-version). Lo sviluppo richiede Ollama; l'endpoint locale predefinito è `http://127.0.0.1:11434`. Il manifest degli script e i loro effetti sono in [`package.json`](../package.json) e [`scripts/`](../scripts/).

## Comandi

| Scopo | Comando | Effetto e stato |
| --- | --- | --- |
| Setup | `npm run setup:dev` | Installa dipendenze e runtime di sviluppo; comando documentato dal manifest, non rieseguito in questa revisione. |
| Avvio | `npm run dev` | Avvia Vite/Electron e il Sidecar; può leggere il profilo di sviluppo. Non rieseguito qui. |
| Documentazione | `npm run docs:check` | Controlla link, ancoraggi Markdown e nomi degli script. Verificato in questa revisione. |
| Tipi/statico | `npm run typecheck`, `npm run quality:static` | Controlli sorgente; eseguire se cambiano contratti o codice. Non necessari per sole pagine Markdown. |
| Percorsi Python critici | `npm run quality:python` | 15 casi offline su ammissione, ricerca e persistenza. Esegue regressioni native esistenti in un subprocess isolato; errori, casi mancanti o saltati fanno fallire il gate. Incluso nel lint seriale anche con `-SkipTests`. [Qualifica e limiti](./verification-python-critical-2026-10-19.md). |
| Test mirati | `npx vitest run <percorso>`; `.venv\Scripts\python.exe -m pytest -q <percorso>` | Usare per problemi concreti, con fixture isolate. |
| Suite complete | `npm run test:fast -- --silent=true`; `.venv\Scripts\python.exe -m pytest -q` | Solo quando un problema o un gate di rilascio lo richiede; le ultime ricevute sono in [`verification-current.md`](./verification-current.md). |
| Build | `npm run build` | Genera bundle locali. L'ultima qualifica con recupero agente è nella [ricevuta del 20 ottobre](./verification-agent-crash-recovery-2026-10-20.md). |
| Recupero chat e bozze | `npm run test:e2e:chat-drafts` | Build e prova Electron isolata di interruzione, riavvio, revisione obsoleta e rifiuto della chiusura; nessuna generazione reale. |
| Recupero agente | `npm run test:e2e:agent-crash` | Build e arresto forzato dell'Electron posseduto, coda persistente e ripresa esplicita; servizi deterministici e profilo isolato. [Prova e limiti](./verification-agent-crash-recovery-2026-10-20.md). |
| OpenAPI | `npm run generate:openapi` | Rigenera il contratto dopo modifiche REST. Non rieseguito qui. |
| Installer | `npm run package:win` | Crea un nuovo candidato CPU in `release/cpu-*`; non installa né pubblica. Non rieseguito qui. |

Il workflow storico Windows in [`.github/workflows/ci.yml`](https://github.com/dennidalpos/OnlyRagV2/blob/683fa1dae0a4f0b5f1856707fb29cea869395276/.github/workflows/ci.yml) è ritirato: i controlli si eseguono localmente. Il runtime Electron può essere preparato con `node node_modules/electron/install.js`. Modelli e profili personali non sono gate di qualifica.

## Installazione manuale di Ollama

Il comando **Avvia / Installa Ollama** tenta di avviare `ollama.exe` locale. Se non parte, apre nel browser la [pagina ufficiale per Windows](https://ollama.com/download/windows). L'app non scarica né esegue l'installer: il browser gestisce redirect e download, e l'utente completa l'installazione. L'esito IPC distingue l'avvio del processo dall'apertura della pagina; nessuno dei due certifica che il server sia online. Ripetere la diagnostica dopo l'installazione. L'apertura usa l'[API `shell.openExternal` di Electron](https://www.electronjs.org/docs/latest/api/shell/) con URL costante, secondo le [indicazioni di sicurezza di Electron](https://www.electronjs.org/docs/latest/tutorial/security/#15-do-not-use-shellexternal-with-untrusted-content).

## Recupero agente e ricevute

Le ricevute dei task agente sono in `agent-task-recovery.json` sotto il `userData` effettivo. Non modificare l'archivio per forzare una ripresa: una ricevuta terminale impedisce il replay e un esito di azione ignoto richiede riconciliazione. Le richieste pendenti mantengono il contesto originale; le ricevute concluse conservano solo identità e data di accettazione. Archivi oltre 10.000 identità o 64 MiB rifiutano nuove ammissioni, senza scarti automatici. Le evidenze della suite Electron sono esterne al checkout, nel percorso stampato dalla prova; `ONLYRAG_RECOVERY_EVIDENCE` può sceglierlo esplicitamente. Lo scenario completo simula anche l'HTTP Sidecar, senza usare un eventuale servizio personale sulla porta ordinaria.

## Offline embedding store maintenance — 2026-10-10

[`scripts/rebuild_embeddings.py`](../scripts/rebuild_embeddings.py) espone `preview`, `prepare`, `activate` e `rollback`, sempre con `--root` esplicito. `prepare` richiede un encoder nativo selezionato, conserva backup, originali e candidato; `activate` cambia il puntatore versionato solo dopo readback. Operazioni fallite mantengono gli artefatti e restituiscono errore. Chiudere l'app prima della manutenzione, soprattutto per runtime precedenti che non condividono il lease. Nessun esempio di comando autorizza un rebuild personale. Contratto e limiti in [`retrieval.md`](./retrieval.md); prova datata in [`verification.md`](./verification.md#offline-embedding-store-rebuild--2026-10-10).

## Cleanup safety policy — 2026-10-10

[`clean_repo.ps1`](../scripts/clean_repo.ps1), [`clean_workspace.ps1`](../scripts/clean_workspace.ps1) e [`cleanup_policy.ps1`](../scripts/cleanup_policy.ps1) rifiutano percorsi non ammessi, reparse point, file tracciati e dati protetti. I modi Repo, TestResidues e Full richiedono `-DisposablePaths` con percorsi assoluti esaminati; Full esclude i profili. `-WhatIf` applica il preflight senza cancellare. `StopAppProcesses` rifiuta: chiudere l'app deliberatamente. Non classificare `.onlyrag`, `userdata_dev`, campagne live, checkpoint, backup o vecchi scratch come eliminabili dal nome. Il precedente task di smaltimento è ritirato; questo non autorizza a cancellare i file conservati. Nessuna pulizia reale è stata eseguita per questa revisione.

## Pulizia manuale dei log

Con app chiusa e dopo revisione dei file, usare `npm run clean:logs -- -DisposablePaths "<percorso assoluto del singolo log>" -ApplicationClosed -WhatIf` per il preflight; omettere `-WhatIf` per cancellare la selezione approvata. Il comando richiede file espliciti, senza cancellazione automatica per età o di intere directory. `-ApplicationClosed` è un'attestazione dell'operatore: lo script non rileva né arresta processi. Sono eleggibili solo i nomi applicativi e le generazioni specificate nella [policy verificata](./verification-log-cleanup-2026-10-19.md); log sconosciuti, evidenze, backup, originali e dati restano protetti. `npm run test:cleanup-logs` esegue 17 casi isolati. Le evidenze conservate restano protette; non esiste un obbligo aperto di smaltimento storico.

## Qualifica nativa dei progetti dell'agente

`npm run test:verification-native` usa i manifest di sei progetti fixture e tutti i relativi strumenti già disponibili. Il [wrapper PowerShell](../scripts/test_native_verification.ps1) accetta percorsi tool aggiuntivi e JDK senza cambiare il PATH persistente; `-PrepareDependencies` consente esplicitamente la preparazione Maven con rete. La verifica applicativa successiva resta offline. La [qualifica iniziale](./verification-native-projects-2026-10-19.md) conserva i dieci casi originari; le [regressioni del 20 ottobre](./verification-project-regressions-2026-10-20.md) portano il gruppo a sedici casi, includendo directory modificata, configurazioni Python sole e suite vuote/saltate. Nessun provisioning è richiesto dalla suite ordinaria.

## Disinstallazione e dati

Gli archivi `source-documents` sono protetti dalla policy di cleanup. La rimozione di un documento dall'indice conserva l'originale e l'estrazione; anche gli originali di ingestioni fallite restano da valutare separatamente. L'annullamento pulisce soltanto l'archivio della nuova ingestione posseduta dopo il rollback riuscito. [Ciclo di vita e verifica](./retrieval.md#ciclo-di-vita-degli-archivi-originali).

La configurazione NSIS ha `deleteAppDataOnUninstall: false` in [`package.json`](../package.json). L'installer locale è non firmato per default; `-RequireSignature` richiede una firma valida, mentre `-SkipSidecar` è rifiutato. Stato di licenze, sorgenti e aggiornamento in [`distribution.md`](./distribution.md).

## Verifiche UX locali

`npm run test:ux` costruisce la versione corrente ed esegue i [flussi UX deterministici](./verification-ux-targeted-2026-10-21.md) con profilo isolato e risposte IPC controllate. `npm run test:tooltips` verifica focus, modali e aiuti; le variabili `ONLYRAG_TOOLTIP_WIDTH` e `ONLYRAG_TOOLTIP_HEIGHT` selezionano dimensioni desktop da 1024×700 a 1920×1080. Nessuno dei due comandi richiede modelli reali o cambia le impostazioni personali.
