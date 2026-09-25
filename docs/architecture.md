# Architettura

OnlyRag è una desktop app Windows composta da Renderer React, Preload Electron, Main Electron, Sidecar Python locale e Ollama locale/remoto.

```text
Renderer (src/) -> Preload (electron/preload.ts) -> IPC Main (electron/core/presentation/)
                                                        |
                              +-------------------------+------------------------+
                              |                         |                        |
                         Application                Domain                Infrastructure
                         use cases              regole pure              I/O e processi
                              |                         |                        |
                         Sidecar HTTP -------------- Ollama HTTP -------------- FS/PTY
                              |
                         FastAPI :8000 -> LanceDB
```

## Confini

- `src/` e `electron/` non si importano a vicenda.
- Il codice condiviso passa solo da `shared/types/` e `shared/domain/`.
- `electron/core/presentation/` registra gli IPC tramite `secureIpcMain`, che controlla frame mittente e schema degli argomenti per canale; `application/` coordina i casi d'uso senza importare `electron` né `node:fs`; `domain/` resta senza I/O e definisce le porte (`domain/ports/`); `infrastructure/` contiene HTTP, filesystem, processi e gli adapter Electron. `npm run quality:static` verifica queste regole di import. Application può importare direttamente gli adapter e i singleton di Infrastructure (oggi 48 moduli lo fanno): le porte in `domain/ports/` esistono solo dove serve un confine verificato (`HardwareProbePort`, imposto dal guard di layering) o una seconda implementazione reale, per esempio un doppio nei test (`RendererEventSink`, `TaskRunnerPort`). Non si aggiungono porte per simmetria; i test di Application sostituiscono gli adapter con `vi.mock`.
- `electron/preload.ts` espone l'unica API `window.electronAPI`; `nodeIntegration` è disabilitato e `contextIsolation`/sandbox sono attivi.
- Il Sidecar espone HTTP su `127.0.0.1:8000`; ogni operazione Ollama acquisisce l'endpoint configurato all'avvio e non condivide host mutabile. Il client supporta HTTP e HTTPS.
- Il modello di ogni generazione si risolve solo con `resolveConfiguredModel` ([`shared/domain/settings/configuredModel.ts`](../shared/domain/settings/configuredModel.ts)): scelta esplicita, poi il modello del ruolo (`chatModel`, `codingModel`, `translationModel`), poi `defaultModel`. Senza modello configurato il flusso si ferma con un errore esplicito (preflight `model` del Coding Agent, piano e intervista, chat, traduzione, `generateOllamaStream`) invece di indovinare un modello che potrebbe non essere installato; il Sidecar rifiuta con `422` una traduzione senza `model` e una normalizzazione LLM senza `normalization_model`.

## Flussi principali

1. Il Renderer invoca l'API tipizzata del Preload.
2. Un handler Presentation valida gli argomenti e delega all'Application service.
3. Il servizio usa Domain e adapter Infrastructure.
4. Il risultato torna via Promise IPC o evento IPC.

Per il coding agent il flusso è `plan/interview → plan → execution → verification → outcome`; per ingestion e traduzione il Main inoltra al Sidecar i dati o lo stream NDJSON.

## Risorse e ciclo di vita

- `taskQueueAppService` serializza i task agente.
- `ollamaGenerationScheduler` serializza a una richiesta le generazioni Main, identifica ogni operazione e pubblica attiva/coda per annullamenti mirati.
- `sidecarProcessManager` avvia, monitora e arresta il Sidecar; `orphanPortReclaim` gestisce residui autorizzati su `:8000`.
- `DisposableAgentWorkspace` crea un worktree/copia temporanea per ogni run; il journal protegge i singoli step al suo interno. La pubblicazione nel workspace utente è esplicita e verifica il baseline prima di copiare i file.

Verifiche: `npm run audit:cycles`, `npm run typecheck` e `npm run docs:check`.
