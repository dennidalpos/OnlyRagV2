# Contratto IPC

Il contratto è un solo file, [`shared/ipc/ipcContract.ts`](../shared/ipc/ipcContract.ts): `IpcInvokeContract` dichiara per ogni canale request/response il `payload` (un oggetto, o `void` se il canale non ha input) e il `result`; `IpcSendContract` il messaggio Renderer→Main; `IpcEventContract` gli eventi Main→Renderer. `IPC_INVOKE_METHODS` e `IPC_EVENT_METHODS` associano ogni metodo di `window.electronAPI` al suo canale, e `IElectronAPI` ne è derivato. Nessun metodo accetta argomenti posizionali: un payload con soli campi facoltativi si può omettere.

[`electron/preload.ts`](../electron/preload.ts) costruisce i metodi dalle due mappe; restano scritti a mano solo `generateOllamaStream` (sottoscrive `ollama:chunk`/`ollama:done` per il suo `operationId`) e `respondAgentSkillInstall` (unico `send`). In Main `secureIpcMain.handle(channel, listener)` tipizza payload e risultato dell'handler dal contratto, e `RendererEventSink.send` tipizza gli eventi: un handler che restituisce una forma diversa da quella dichiarata non compila.

[`secureIpcMain.ts`](../electron/core/presentation/secureIpcMain.ts) accetta richieste solo dalla frame principale della finestra attendibile, rifiuta più di un argomento, valida il payload con lo schema zod del canale e passa all'handler il payload analizzato (campi normalizzati, chiavi sconosciute rimosse dagli oggetti non `passthrough`). La mappa degli schemi è tipizzata su tutti i canali del contratto, quindi un canale senza schema non compila; `npm run quality:static` verifica inoltre che le registrazioni non usino direttamente `ipcMain` e che ogni canale registrato abbia uno schema.

Il controllo statico verifica la presenza degli schemi, non la copertura di ogni campo. `agent:start-task` usa lo schema stretto [`agentTaskContract.ts`](../electron/core/domain/agent/agentTaskContract.ts), corrispondente al tipo condiviso `AgentTaskRequest`: campi sconosciuti, `sourceWorkspacePath` (riservato a Main), identità incompleta, profilo capability non valido e allegati malformati vengono rifiutati prima dell'handler. Le impostazioni ricevute da `agent:start-task`, `agent:plan-interview`, `agent:plan-generate` e `agent:export-ai-debug-bundle` passano da `sanitizeAppSettings`; Lo schema di `agent:plan-seed` rimuove le chiavi sconosciute delle milestone prima del salvataggio. `agent:plan-generate` analizza il piano precedente con lo schema completo `agentPlanSchema` (stesso file), che rimuove le chiavi sconosciute, e richiede tutte le liste del tipo `AgentPlan`. I canali `workspace:*` e `ingest:*` usano gli schemi di [`workspaceContract.ts`](../electron/core/domain/workspaceContract.ts) e [`sidecarContract.ts`](../electron/core/domain/sidecarContract.ts). Gli oggetti `skills:get-hub-skill-content` e `skills:save-custom` validano tutti i campi letti dal servizio (`downloadUrl` deve essere un URL) e lasciano passare solo metadati di visualizzazione.

## Canali request/response

| Prefisso | Canali registrati |
| --- | --- |
| `agent` | `approval-response`, `cancel-task`, `compact-context`, `export-ai-debug-bundle`, `get-plan-state`, `get-queue-status`, `logs-analyze`, `plan-cancel`, `plan-enrich-prompt`, `plan-generate`, `plan-interview`, `plan-seed`, `start-task` |
| `artifacts` | `delete`, `get`, `list`, `save` |
| `diagnostics` | `clear-logs`, `clear-agent-audit-log`, `get-log-filepath`, `get-logs`, `log-telemetry`, `open-logs-folder`, `run` |
| `dialog` | `open-directory`, `open-file` |
| `history` | `index`, `search` |
| `ingest` | `delete`, `export`, `file`, `get`, `list`, `page-preview`, `search`, `translate-inplace`, `update` |
| `ollama` | `cancel-pull`, `cancel-stream`, `check-model-updates`, `delete-model`, `generate-stream`, `get-generation-status`, `get-model-metrics`, `get-running-models`, `install-or-launch`, `pull-model`, `test-connection`, `unload-model` |
| `projects` | `list`, `register`, `remove`, `rename`, `touch` |
| `sessions` | `clear`, `delete`, `list`, `save` |
| `settings` | `get`, `save` |
| `sidecar` | `restart` |
| `skills` | `add-custom-source`, `get-hub-skill-content`, `install-from-hub`, `install-from-url`, `list-hub-all`, `list-hub-by-source`, `list-installed`, `list-sources`, `remove-custom-source`, `reset-original`, `save-custom`, `toggle-active`, `uninstall` |
| `system` | `check-disk-space`, `open-external`, `open-path` |
| `task` | `cancel` |
| `workspace` | `clear-standalone-scratch`, `execute-powershell`, `export-standalone-scratch`, `get-git-status-and-diff`, `get-standalone-scratch`, `init-git`, `inspect-guest-os`, `list-files`, `read-file`, `write-file` |

Registrazione: [`agentIpc.ts`](../electron/core/presentation/agentIpc.ts), [`workspaceIpc.ts`](../electron/core/presentation/workspaceIpc.ts), [`ollamaIpc.ts`](../electron/core/presentation/ollamaIpc.ts), [`sidecarIpc.ts`](../electron/core/presentation/sidecarIpc.ts), [`skillIpc.ts`](../electron/core/presentation/skillIpc.ts), [`settingsIpc.ts`](../electron/core/presentation/settingsIpc.ts), [`diagnosticsIpc.ts`](../electron/core/presentation/diagnosticsIpc.ts), [`systemIpc.ts`](../electron/core/presentation/systemIpc.ts), [`projectRegistryIpc.ts`](../electron/core/presentation/projectRegistryIpc.ts), [`sessionHistoryIpc.ts`](../electron/core/presentation/sessionHistoryIpc.ts), [`artifactIpc.ts`](../electron/core/presentation/artifactIpc.ts).

## Eventi Renderer

Eventi `on` esposti: `agent:approval-request`, `agent:change-metrics`, `agent:context-budget`, `agent:done`, `agent:log`, `agent:skill-install-request`, `agent:skills-matched`, `agent:step-update`, `agent:stream-thought`, `agent:stream-token`, `ingest:stream-progress`, `ingest:translate-progress`, `ollama:pull-progress`, `workspace:file-deleted`, `workspace:file-version`; `ollama:chunk` e `ollama:done` li consuma solo `generateOllamaStream`. Gli eventi di progresso `ingest:*` sono l'evento NDJSON del Sidecar validato da Main (`toIngestionProgressPayload`, `toTranslateProgressPayload` in [`sidecarContract.ts`](../electron/core/domain/sidecarContract.ts)): il record del documento dell'evento `done` non viene inoltrato (il documento arriva come risultato dell'invoke) e un evento fuori schema viene registrato come WARN e scartato. L'ingestion emette anche `error` e `cancelled`.

I comandi di esecuzione Agent Coding e tutti gli eventi `agent:*` della run includono l'identità immutabile `{ runId, conversationId, planRevisionId, workspaceId }`. Risposte di annullamento e approvazione vengono accettate solo per la stessa identità. Una voce `agent:log` può portare il campo facoltativo `localized` (`{ message?, detail? }` con chiavi `agentMain.*` e parametri, vedi [`agentMainText.ts`](../shared/domain/agent/agentMainText.ts)); `message` e `detail` restano sempre presenti come testo italiano, e Main redige i segreti anche nei parametri.

Nel flusso Agent Coding la richiesta di approvazione `git_commit` include `commitDiff` e i soli `commitPaths` attribuiti alla run. Una richiesta del gate dei tool porta `reasons` (`workspace_mutation`, `network_access`, `external_installation`, `guided_review`): un'unica revisione copre tutti i motivi, e il modale li mostra nella lingua dell'interfaccia.

Il payload di `workspace:write-file` porta anche `workspaceRoot`: il salvataggio editor applica lo stesso controllo realpath delle mutazioni Agent Coding.

Le run Agent Coding di progetto lavorano nel workspace dell'utente; lo standalone opera nel workspace persistente dedicato `userData/agent-scratch`. `agent:restore-checkpoint` (`{ workspacePath, checkpointId }`) riporta i file modificati da una run allo stato precedente; viene rifiutato mentre una run lavora nello stesso workspace.

`agent:start-task` restituisce `runId` e `queuePosition`; `agent:cancel-task` richiede quell'identità e non annulla altre run.

`ingest:list` restituisce solo i metadati dei documenti (`IngestedDocument`); `ingest:get` (`{ docId }`) restituisce `IngestedDocumentContent` con `extractedMarkdown`, oppure `null` se il documento non esiste o il Sidecar non risponde. `ingest:file` riceve un `taskId` generato dal Renderer. Il progresso porta lo stesso ID e `task:cancel` annulla solo quella ingestion.

`ollama:generate-stream` riceve `options.think` come booleano effettivo; `ingest:file` riceve `normalizationThink` e `ingest:translate-inplace` riceve `think`. Il valore predefinito nei trasporti è `false`.

Le operazioni `ollama:pull-model`, `ollama:delete-model` e `ollama:generate-stream` ricevono l'host configurato; Main ne fissa protocollo e destinazione per l'intera richiesta, anche con host concorrenti. Ogni stream ha un `operationId`: accompagna gli eventi `ollama:chunk` e `ollama:done`, isola i listener Renderer, consente a `ollama:cancel-stream` di annullare solo quella richiesta e permette alla UI di leggere da `ollama:get-generation-status` gli stati `queued`, `running`, `cancelling` e `failed`. Piano e intervista usano lo stesso scheduler con il loro `runId`.

`ollama:generate-stream` restituisce l'esito `{ success, error? }`: errori HTTP, di trasporto o timeout non diventano chunk testuali. Chat e Traduzione accettano come completata solo una risposta riuscita e non vuota; l'export della traduzione resta disabilitato per risultati parziali o falliti.

L'unico `send` Renderer→Main è `agent:skill-install-response`. I listener restituiscono una funzione di unsubscribe.
