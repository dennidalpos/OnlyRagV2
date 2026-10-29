# IPC Renderer ↔ Main

[`shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts) è la fonte di canali, payload, risultati ed eventi. [`electron/preload.ts`](../electron/preload.ts) genera `window.electronAPI` dalle mappe del contratto. Main registra gli handler tramite [`secureIpcMain.ts`](../electron/core/presentation/secureIpcMain.ts), che controlla il frame mittente, il numero di argomenti e lo schema del canale. `npm run quality:static` verifica registrazioni e schemi; non sostituisce i controlli di ogni campo.

## Canali request/response

I canali coprono agente, chat, documenti, modelli, progetti/sessioni, impostazioni, diagnostica, skill e workspace. Per l'elenco completo leggere il contratto; per aggiungere o cambiare un canale aggiornare contratto, schema, Preload/handler e chiamante, evitando una seconda enumerazione statica.

`sessions:delete` e `sessions:clear` restituiscono `refused`, `pending` o `complete`; le azioni di recupero hanno ID di operazione e non cancellano implicitamente le copie conservate. `ingest:file` accetta `taskId` e l'opzione Excel. Una normalizzazione da rivedere è un risultato rifiutato con `originalMarkdown` e problemi per pagina.

`ingest:update` richiede `expectedRevision`, la revisione originale della bozza (`ingestedAt`), anche dopo un aggiornamento della lista. `ingest:translate-inplace` richiede `taskId`, assegnato dal Renderer prima dell'invio. I vecchi payload senza questi campi vengono rifiutati: Renderer, Main e Sidecar devono essere aggiornati insieme. Il risultato di traduzione rappresenta un file con stato `translated`, non una nuova revisione indicizzata; `cancelled` è esposto soltanto dopo il terminale Sidecar.

## Eventi Renderer

`system:check-disk-space` restituisce `allowed: false`, `freeGB: null`, `missingGB: null` ed errore quando la misura del volume locale non è disponibile. `requiredGB` resta una stima dei pesi, con 2 GiB aggiunti nel confronto di ammissione. Main usa `OLLAMA_MODELS` oppure la destinazione locale predefinita; una directory ancora assente viene sondata dal suo antenato esistente, senza sostituire un altro volume. Errori di accesso e link non risolvibili rifiutano la misura. Il wizard blocca il download e offre **Riprova**, ignorando risposte di verifiche ormai obsolete. Questo controllo non misura lo storage di un host Ollama remoto.

`skills:toggle-active` restituisce `false` se la scrittura dell'attivazione non è confermata; il Renderer mantiene il valore precedente e mostra l'errore. I risultati di installazione/salvataggio distinguono il file skill salvato dall'attivazione non riuscita e permettono una riprova. `SkillDefinition.requiredModel` conserva il requisito nativo anche durante una modifica del corpo.

`agent:list-recoverable-tasks` espone solo riepiloghi delle richieste accettate e inattive; `agent:resume-task` richiede l'identità completa e carica in Main il payload originale validato. Il Renderer non può sostituire workspace, modello o permessi nel recupero. Identità concluse, archivi illeggibili ed esiti di azioni interrotte non confermati vengono rifiutati. [Qualifica offline](./verification-agent-crash-recovery-2026-10-20.md).

Eventi `agent:*`, `ingest:*`, `ollama:*` e `workspace:*` sono tipizzati nel contratto. Gli eventi agente portano l'identità della run; gli stream Ollama usano `operationId`; eventi Sidecar fuori schema vengono scartati. Un listener restituisce la funzione di unsubscribe. La traduzione e l'ingestion accettano solo risultati completi e confermati.

## Native upload bridge — 2026-10-06

Il payload `ingest:file` richiede `taskId` anche nel contratto TypeScript, coerentemente con lo schema runtime. Non viene creato implicitamente dal Preload.

`resolveNativeFilePath({ file })` è un metodo **locale del Preload**, non un canale IPC. Usa `webUtils.getPathForFile`; un `File` senza percorso su disco viene rifiutato dalla UI, senza fallback a `File.path` o al nome base. Main continua a validare il percorso nel payload `ingest:file`.

## Model/workload memory facts — 2026-10-02

`ollama:get-model-metrics` espone geometria e allocazione osservata solo quando i dati sono validi e legati allo stesso digest/contesto. La stima non autorizza la generazione. Dettagli in [`model-runtime-fit.md`](./model-runtime-fit.md).

## Distribution licenses — 2026-10-11

`system:open-distribution-licenses` non riceve un percorso dal Renderer; Main apre la directory di notice scelta per l'ambiente. Stato della distribuzione in [`distribution.md`](./distribution.md).

La superficie REST separata è in [`api-rest.md`](./api-rest.md); i residui di persistenza, cancellazione e qualifica sono nel `tracker` (SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`).

## Bozze documentali — 2026-10-16

`ingest:load-drafts` restituisce `{ revision, drafts }`; `ingest:save-drafts` richiede lo snapshot e la revisione attesa. Schemi condivisi in [`documentDraft.ts`](../shared/domain/documentDraft.ts): identità uniche, massimo 100 bozze, 10 milioni di caratteri per testo e 20 milioni complessivi includendo le basi originali. I limiti rifiutano la scrittura senza troncare la bozza in memoria; l’export resta separato. Main rifiuta chiamanti estranei e archivi illeggibili, conserva la copia precedente e verifica il readback. [Prove](./verification-chat-drafts-context-2026-10-16.md).

`chat:load-recovery` e `chat:save-recovery` usano lo snapshot validato di [`chatHistory.ts`](../shared/domain/chatHistory.ts), con identità di conversazione uniche e selezione esistente. Il Main conserva `chat-history-recovery.json` e copia precedente; gli schemi della cronologia localStorage vengono riusati. Il bootstrap precede le modifiche e un checkpoint rifiutato impedisce nuova generazione e chiusura normale.

## Riconciliazione delle run interrotte — 2026-10-20

`agent:inspect-task` riceve l’identità completa e restituisce prove come testo semplice, digest SHA-256 e disponibilità dell’abbandono. `agent:abandon-task` richiede la stessa identità e `evidenceDigest`: il Main rilegge lo stato e conserva richiesta/prove prima del successo. Sender, frame e payload passano per `secureIpcMain`; nessun percorso di archivio viene scelto dal Renderer. Archiviazione fallita o prove mutate non autorizzano il replay. [Qualifica](./verification-inflight-reconciliation-2026-10-20.md).
