# Electron Main

Il processo Main è organizzato in quattro layer sotto [`electron/core/`](../electron/core/).

| Layer | Directory | Ruolo |
| --- | --- | --- |
| Presentation | `electron/core/presentation/` | Registra gli handler IPC e valida gli argomenti. |
| Application | `electron/core/application/` | Coordina casi d'uso, task, agent, Sidecar e Ollama. |
| Domain | `electron/core/domain/` e `shared/domain/` | Regole pure, contratti e algoritmi. |
| Infrastructure | `electron/core/infrastructure/` | HTTP, filesystem, PowerShell/PTY, processi e adapter Electron (`infrastructure/electron/`). |

Application e Domain non importano `electron` né `node:fs`: usano le porte in [`domain/ports/`](../electron/core/domain/ports/) (`RendererEventSink` per gli eventi verso il Renderer, `DesktopShellPort` per shell e finestre di dialogo, `HardwareProbePort` per GPU, memoria, stato Ollama e report diagnostico, `TaskRunnerPort` per l'annullamento dei task, `ISkillHubAdapter` per i protocolli degli hub di skill) e i repository di Infrastructure. Domain non importa layer esterni. [`check_layering.mjs`](../scripts/check_layering.mjs), eseguito da `npm run quality:static`, fa rispettare queste regole anche per `import()` dinamici e `require`. Application raggiunge le sonde di [`electron/diagnostics.ts`](../electron/diagnostics.ts) solo tramite l'adapter [`hardwareProbe.ts`](../electron/core/infrastructure/diagnostics/hardwareProbe.ts); `diagnostics:run` passa da `diagnosticsAppService.runDiagnostics`.

## Avvio

[`electron/main.ts`](../electron/main.ts):

1. importa per primo [`appIdentity.ts`](../electron/appIdentity.ts), che fissa il nome app (`onlyrag-v2`) e, con `ONLYRAG_E2E_TEST=1` e `ONLYRAG_E2E_USER_DATA`, una `userData` isolata prima che il logger apra `logs/app.log`; poi protegge la singola istanza;
2. registra gli handler IPC dopo `whenReady`;
3. in modalità smoke (`--smoke-test`) registra `[SMOKE_TEST_PASS]` ed esce prima di creare la finestra;
4. crea una `BrowserWindow` con `nodeIntegration: false`, `contextIsolation: true` e `sandbox: true`, poi avvia il Sidecar tranne nelle run E2E;
5. su `before-quit` blocca nuovi avvii, annulla task e agenti, arresta i server gestiti e il Sidecar, quindi attende persistenza, coda, browser e pulizia temporanei entro cinque secondi prima di richiamare `app.quit()`; richieste di uscita ripetute condividono la stessa attesa.

Ogni run agente conserva il sink della finestra/documento che l'ha avviata. `render-process-gone`, chiusura e navigazione principale invalidano quell'ownership: le run in coda sono rimosse, gli stream posseduti sono cancellati e le approvazioni pendenti sono rifiutate. Il vecchio sink non invia eventi a una finestra ricreata. Le modifiche restano sul disco con checkpoint; lo stato terminale viene salvato senza ripristino automatico. Errori o scadenza dello shutdown sono registrati e non attestano persistenza riuscita. Crash reale del Renderer e quit/riavvio passano in Electron isolato con modello HTTP controllato; arresto forzato del Main, logout e spegnimento Windows restano da qualificare in `AGENT-UNGRACEFUL-SHUTDOWN-RECOVERY-01`. Riferimenti Electron riletti il 2026-10-06: [render-process-gone](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone), [before-quit e limite Windows](https://www.electronjs.org/docs/latest/api/app#event-before-quit). [Verifica](./verification.md#agent-renderer-lifecycle--2026-10-06).

`TaskRunner` distingue i documenti sorgente dai residui temporanei registrati: annullamento, quit e crash preservano sempre i sorgenti e possono eliminare solo `temporaryResiduePath`.

Le run agente controllano l'esito delle scritture di snapshot e tracker: una mancata conferma blocca nuove azioni. Anche l'esito finale attende la persistenza prima di essere notificato al Renderer; checkpoint e dati precedenti restano conservati. [Verifica e limiti](./verification.md#agent-state-write-acknowledgement--2026-10-06).

Il ripristino di un checkpoint resta bloccato anche dopo Stop finché la run termina e rilascia il workspace; l'annullamento non autorizza un ripristino concorrente con un'operazione ancora in corso.

Adapter principali:

- [`ollamaHttpClient.ts`](../electron/core/infrastructure/http/ollamaHttpClient.ts): `/api/tags`, `/api/ps`, chat/generazione, pull ed eviction.
- [`sidecarHttpClient.ts`](../electron/core/infrastructure/http/sidecarHttpClient.ts): HTTP e NDJSON verso `:8000`.
- [`persistentPowerShellSession.ts`](../electron/core/infrastructure/process/persistentPowerShellSession.ts): comandi persistenti con output e exit code.
- [`sidecarProcessManager.ts`](../electron/core/infrastructure/process/sidecarProcessManager.ts): lifecycle e recupero del solo processo identificato dal marker di ownership.
- [`logger.ts`](../electron/core/infrastructure/logging/logger.ts) e [`logRedactor.ts`](../electron/logRedactor.ts): log redatto con buffer in memoria e rotazione di `userData/logs/app.log`.
- [`diagnostics.ts`](../electron/diagnostics.ts): probe Ollama, GPU (`nvidia-smi`), memoria e report diagnostico.
- [`rendererEventSinks.ts`](../electron/core/infrastructure/electron/rendererEventSinks.ts) e [`electronDesktopShell.ts`](../electron/core/infrastructure/electron/electronDesktopShell.ts): adapter Electron delle porte `RendererEventSink` e `DesktopShellPort`. `main.ts` passa all'agente un sink legato alla finestra principale; ingestion, traduzione e cancellazioni del workspace usano il broadcast verso tutte le finestre.

I contratti IPC sono in [`api-ipc.md`](./api-ipc.md); le dipendenze tra layer sono controllate da `npm run audit:cycles`.

Il registro progetti serializza lettura/modifica/scrittura per percorso anche tra istanze del repository nello stesso Main. Le letture attendono le mutazioni precedenti. Una scrittura non confermata rifiuta l'operazione attraverso gli IPC esistenti; una rimozione di un progetto già assente resta `false`. L'errore non blocca un successivo tentativo esplicito. Formato version-1 e protezione degli originali illeggibili restano invariati. [Verifica](./verification.md#project-registry-mutation-integrity--2026-10-06).

Il writer condiviso sostituisce il file solo con rename dello staging nello stesso percorso: mantiene cinque tentativi per lock Windows e rifiuta il salvataggio se falliscono, senza copiare sopra il file precedente. Le code per percorso vengono liberate su successo/errore, preservando la coda di una scrittura successiva. Errori di staging e pulizia sono propagati, anche insieme. Questo protegge l'originale dai fallimenti di sostituzione verificati; durabilità dopo kill/power loss e flush di file/directory restano in `STATE-WRITER-CRASH-DURABILITY-01`. [Verifica e limiti](./verification.md#atomic-state-writer--2026-10-06).

Il bundle Main usa la compressione Oxc senza rinominare gli identificatori. La rinomina predefinita collideva con un helper del compilatore TypeScript e impediva l'avvio Electron. Il build Main ha due entry: `main.js` e `typecheckWorker.js`, il worker thread del typecheck incrementale che segue ogni modifica agente a un file TypeScript ([`workspaceTypecheckWorkerClient.ts`](../electron/core/infrastructure/process/workspaceTypecheckWorkerClient.ts)); `ts.createProgram` non blocca più il thread principale, la cache dei `Program` per workspace vive nel worker e un timeout (60 s) o un crash producono solo l'assenza della diagnostica. Il compilatore TypeScript condiviso finisce in un chunk separato. Misure conservate della precedente revisione documentale, non della build corrente: `main.js` circa 4,9 MB e chunk circa 6,5 MB (11,4 MB in totale, contro 14,1 MB senza minificazione). Il worker si carica anche da `app.asar`. `npm run test:smoke`, gli E2E Electron, impostazioni e cold start verificano l'avvio del bundle.

Dopo l'avvio Main accetta come Sidecar il processo in ascolto su `:8000` solo se è il processo avviato o un suo discendente (fino a tre livelli): in sviluppo `.venv\Scripts\python.exe` è un launcher che esegue l'interprete base come processo figlio, ed è quel figlio ad aprire la porta. Il marker registra l'identità del processo in ascolto. Su Windows il recupero di `:8000` richiede il marker `sidecar-ownership.json` in `userData` e la corrispondenza di PID, percorso eseguibile e ora di avvio letti dal processo reale. Un listener sconosciuto o un PID riutilizzato lascia il Sidecar offline senza terminare il processo sulla porta. La prova con processi reali, incluso `sidecar.exe`, è `npm run test:e2e:sidecar-ownership`.
