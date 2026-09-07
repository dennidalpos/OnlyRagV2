# Electron Main Process — OnlyRag V2

Il processo principale di Electron implementa rigorosamente il pattern **Clean Architecture a 4 Livelli** all'interno di [`electron/core/`](../electron/core/), garantendo totale disaccoppiamento tra logica di presentazione IPC, casi d'uso applicativi, regole di business pure e adapter di infrastruttura.

---

## 1. Struttura dei Layer

```
Presentation Layer (electron/core/presentation/)
       │
       ▼
Application Layer (electron/core/application/)
       │
       ▼
Domain Layer (electron/core/domain/ & shared/domain/)
       │
       ▼
Infrastructure Layer (electron/core/infrastructure/)
```

### 1.1. Presentation Layer (`electron/core/presentation/`)
* **Responsabilità**: Registrazione dei canali `ipcMain.handle`, validazione degli argomenti in ingresso, gestione della sicurezza IPC e serializzazione delle risposte verso il Renderer.
* **Moduli Chiave**: [`agentIpc.ts`](../electron/core/presentation/agentIpc.ts), [`workspaceIpc.ts`](../electron/core/presentation/workspaceIpc.ts), [`sidecarIpc.ts`](../electron/core/presentation/sidecarIpc.ts), [`ollamaIpc.ts`](../electron/core/presentation/ollamaIpc.ts), [`diagnosticsIpc.ts`](../electron/core/presentation/diagnosticsIpc.ts), [`systemIpc.ts`](../electron/core/presentation/systemIpc.ts).
* Per l'elenco completo dei 96 canali registrati, consultare [`api-ipc.md`](./api-ipc.md).

### 1.2. Application Layer (`electron/core/application/`)
* **Responsabilità**: Orchestrazione dei casi d'uso ad alto livello senza dettagli tecnologici diretti:
  * [`agentOrchestratorAppService.ts`](../electron/core/application/agentOrchestratorAppService.ts): Gestisce il ciclo di vita completo del Coding Agent Studio, loop guards, emissione eventi e coordinamento dei tool.
  * [`agentToolExecutorService.ts`](../electron/core/application/agentToolExecutorService.ts): Esecuzione sicura dei tool atomici (`write_file`, `replace_chunk`, `run_command`, `git_commit`, `grep_search`).
  * [`ollamaAppService.ts`](../electron/core/application/ollamaAppService.ts) & [`ollamaModelUpdateAppService.ts`](../electron/core/application/ollamaModelUpdateAppService.ts): Gestione download, aggiornamenti, benchmark ed eviction dei modelli.
  * [`projectRegistryAppService.ts`](../electron/core/application/projectRegistryAppService.ts): Gestione persistente delle cartelle progetto e metadati `.onlyrag/`.

### 1.3. Domain Layer (`electron/core/domain/` e `shared/domain/`)
* **Responsabilità**: Logica pura di business indipendente da qualsiasi framework o I/O.
* **Componenti Puri Condivisi**: La logica condivisa tra Main e Renderer risiede in [`shared/domain/`](../shared/domain/) (es. `verificationCommandSafety.ts`, `milestoneDeliverableResolver.ts`, `hardwareProfileTiers.ts`, `contextWindowCalculator.ts`).
* **Componenti Dominio Main**: [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts), [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts), [`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts), [`episodicMemoryCompactor.ts`](../electron/core/domain/agent/episodicMemoryCompactor.ts), [`toolParser.ts`](../electron/core/domain/agent/toolParser.ts).

### 1.4. Infrastructure Layer (`electron/core/infrastructure/`)
* **Responsabilità**: Implementazione concreta dell'I/O (chiamate HTTP, processi di sistema, file system):
  * [`sidecarHttpClient.ts`](../electron/core/infrastructure/http/sidecarHttpClient.ts): Client HTTP centralizzato verso FastAPI `:8000`.
  * [`ollamaHttpClient.ts`](../electron/core/infrastructure/http/ollamaHttpClient.ts): Client HTTP unificato verso Ollama `:11434` (eviction via `keep_alive: 0`, query unificate `/api/tags` e `/api/ps`).
  * [`persistentPowerShellSession.ts`](../electron/core/infrastructure/process/persistentPowerShellSession.ts): Sessione PowerShell persistente con capture degli stream stdout/stderr, codici di uscita ed isolamento ambiente.
  * [`sidecarProcessManager.ts`](../electron/core/infrastructure/process/sidecarProcessManager.ts): Gestione del ciclo di vita del processo Python (avvio, monitoraggio PID, reclaim della porta orfana `:8000`).

---

## 2. Regole di Isolamento Architetturale

1. **Zero Import Incrociati**: `src/` (Renderer) non importa MAI codice da `electron/`. `electron/` non importa MAI codice da `src/`.
2. **Ponte Unico `shared/`**: Tutti i tipi, le interfacce contrattuali e la logica pura condivisa transitano unicamente da [`shared/types/`](../shared/types/) e [`shared/domain/`](../shared/domain/).
3. **Verifica Continua**: Rispettata con zero cicli architetturali verificati via `npm run audit:cycles` (dpdm e skott).

---

## 3. Diagnostica, Logging e Redaction

- **Logger Unificato** ([`diagnostics.ts`](../electron/diagnostics.ts)): Gestisce il buffer di log in memoria e la persistenza rotativa su file `.log` in `logs/`.
- **Log Redactor** ([`logRedactor.ts`](../electron/logRedactor.ts)): Sanifica automaticamente i log prima della scrittura su disco, mascherando URL sensibili, token e percorsi assoluti dell'utente per garantire privacy totale.
