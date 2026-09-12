# Electron Main

Il processo Main è organizzato in quattro layer sotto [`electron/core/`](../electron/core/).

| Layer | Directory | Ruolo |
| --- | --- | --- |
| Presentation | `electron/core/presentation/` | Registra gli handler IPC e valida gli argomenti. |
| Application | `electron/core/application/` | Coordina casi d'uso, task, agent, Sidecar e Ollama. |
| Domain | `electron/core/domain/` e `shared/domain/` | Regole pure, contratti e algoritmi. |
| Infrastructure | `electron/core/infrastructure/` | HTTP, filesystem, PowerShell/PTY e processi. |

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
- [`diagnostics.ts`](../electron/diagnostics.ts) e [`logRedactor.ts`](../electron/logRedactor.ts): log e redazione.

I contratti IPC sono in [`api-ipc.md`](./api-ipc.md); le dipendenze tra layer sono controllate da `npm run audit:cycles`.
