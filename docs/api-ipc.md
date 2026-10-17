# IPC Renderer ↔ Main

[`shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts) è la fonte di canali, payload, risultati ed eventi. [`electron/preload.ts`](../electron/preload.ts) genera `window.electronAPI` dalle mappe del contratto. Main registra gli handler tramite [`secureIpcMain.ts`](../electron/core/presentation/secureIpcMain.ts), che controlla il frame mittente, il numero di argomenti e lo schema del canale. `npm run quality:static` verifica registrazioni e schemi; non sostituisce i controlli di ogni campo.

## Canali request/response

I prefissi attivi comprendono `agent`, `artifacts`, `diagnostics`, `dialog`, `history`, `ingest`, `ollama`, `projects`, `sessions`, `settings`, `sidecar`, `skills`, `system`, `task` e `workspace`. Per aggiungere o cambiare un canale aggiornare contratto, schema, Preload/handler e chiamante; non copiare una lista statica dalla documentazione.

`sessions:delete` e `sessions:clear` restituiscono `refused`, `pending` o `complete`; le azioni di recupero hanno ID di operazione e non cancellano implicitamente le copie conservate. `ingest:file` accetta `taskId` e l'opzione Excel. Una normalizzazione da rivedere è un risultato rifiutato con `originalMarkdown` e problemi per pagina.

`ingest:update` richiede `expectedRevision`, la revisione originale della bozza (`ingestedAt`), anche dopo un aggiornamento della lista. `ingest:translate-inplace` richiede `taskId`, assegnato dal Renderer prima dell'invio. I vecchi payload senza questi campi vengono rifiutati: Renderer, Main e Sidecar devono essere aggiornati insieme. Il risultato di traduzione rappresenta un file con stato `translated`, non una nuova revisione indicizzata; `cancelled` è esposto soltanto dopo il terminale Sidecar.

## Eventi Renderer

Eventi `agent:*`, `ingest:*`, `ollama:*` e `workspace:*` sono tipizzati nel contratto. Gli eventi agente portano l'identità della run; gli stream Ollama usano `operationId`; eventi Sidecar fuori schema vengono scartati. Un listener restituisce la funzione di unsubscribe. La traduzione e l'ingestion accettano solo risultati completi e confermati.

## Native upload bridge — 2026-10-06

`resolveNativeFilePath({ file })` è un metodo **locale del Preload**, non un canale IPC. Usa `webUtils.getPathForFile`; un `File` senza percorso su disco viene rifiutato dalla UI, senza fallback a `File.path` o al nome base. Main continua a validare il percorso nel payload `ingest:file`.

## Model/workload memory facts — 2026-10-02

`ollama:get-model-metrics` espone geometria e allocazione osservata solo quando i dati sono validi e legati allo stesso digest/contesto. La stima non autorizza la generazione. Dettagli in [`model-runtime-fit.md`](./model-runtime-fit.md).

## Distribution licenses — 2026-10-11

`system:open-distribution-licenses` non riceve un percorso dal Renderer; Main apre la directory di notice scelta per l'ambiente. Stato della distribuzione in [`distribution.md`](./distribution.md).

La superficie REST separata è in [`api-rest.md`](./api-rest.md); i residui di persistenza, cancellazione e qualifica sono nel [`tracker`](../PROJECT_STATUS.json).

## Bozze documentali — 2026-10-16

`ingest:load-drafts` restituisce `{ revision, drafts }`; `ingest:save-drafts` richiede lo snapshot e la revisione attesa. Schemi condivisi in [`documentDraft.ts`](../shared/domain/documentDraft.ts): identità uniche, massimo 100 bozze, 10 milioni di caratteri per testo e 20 milioni complessivi includendo le basi originali. I limiti rifiutano la scrittura senza troncare la bozza in memoria; l’export resta separato. Main rifiuta chiamanti estranei e archivi illeggibili, conserva la copia precedente e verifica il readback. [Prove](./verification-chat-drafts-context-2026-10-16.md).

`chat:load-recovery` e `chat:save-recovery` usano lo snapshot validato di [`chatHistory.ts`](../shared/domain/chatHistory.ts), con identità di conversazione uniche e selezione esistente. Il Main conserva `chat-history-recovery.json` e copia precedente; gli schemi della cronologia localStorage vengono riusati. Il bootstrap precede le modifiche e un checkpoint rifiutato impedisce nuova generazione e chiusura normale.
