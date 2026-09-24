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

1. imposta il nome app e protegge la singola istanza;
2. crea una `BrowserWindow` con `nodeIntegration: false`, `contextIsolation: true` e `sandbox: true`;
3. registra gli handler IPC;
4. avvia il Sidecar fuori dalla modalità smoke;
5. su `before-quit` annulla task, pulisce residui e arresta il Sidecar.

`TaskRunner` distingue i documenti sorgente dai residui temporanei registrati: annullamento, quit e crash preservano sempre i sorgenti e possono eliminare solo `temporaryResiduePath`.

Adapter principali:

- [`ollamaHttpClient.ts`](../electron/core/infrastructure/http/ollamaHttpClient.ts): `/api/tags`, `/api/ps`, chat/generazione, pull ed eviction.
- [`sidecarHttpClient.ts`](../electron/core/infrastructure/http/sidecarHttpClient.ts): HTTP e NDJSON verso `:8000`.
- [`persistentPowerShellSession.ts`](../electron/core/infrastructure/process/persistentPowerShellSession.ts): comandi persistenti con output e exit code.
- [`sidecarProcessManager.ts`](../electron/core/infrastructure/process/sidecarProcessManager.ts): lifecycle e reclaim della porta.
- [`logger.ts`](../electron/core/infrastructure/logging/logger.ts) e [`logRedactor.ts`](../electron/logRedactor.ts): log redatto con buffer in memoria e rotazione di `userData/logs/app.log`.
- [`diagnostics.ts`](../electron/diagnostics.ts): probe Ollama, GPU (`nvidia-smi`), memoria e report diagnostico.
- [`rendererEventSinks.ts`](../electron/core/infrastructure/electron/rendererEventSinks.ts) e [`electronDesktopShell.ts`](../electron/core/infrastructure/electron/electronDesktopShell.ts): adapter Electron delle porte `RendererEventSink` e `DesktopShellPort`. `main.ts` passa all'agente un sink legato alla finestra principale; ingestion, traduzione e cancellazioni del workspace usano il broadcast verso tutte le finestre.

I contratti IPC sono in [`api-ipc.md`](./api-ipc.md); le dipendenze tra layer sono controllate da `npm run audit:cycles`.

Il bundle Main usa la compressione Oxc senza rinominare gli identificatori. La rinomina predefinita collideva con un helper del compilatore TypeScript e impediva l'avvio Electron. Il file `dist-electron/main.js` misura circa 11,4 MB, contro 14,1 MB senza minificazione. `npm run test:smoke`, gli E2E Electron, impostazioni e cold start verificano l'avvio del bundle.

Su Windows il recupero di `:8000` richiede il marker `sidecar-ownership.json` in `userData` e la corrispondenza di PID, percorso eseguibile e ora di avvio letti dal processo reale. Un listener sconosciuto o un PID riutilizzato lascia il Sidecar offline senza terminare il processo sulla porta. La prova con processi reali, incluso `sidecar.exe`, è `npm run test:e2e:sidecar-ownership`.
