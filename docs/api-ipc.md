# Contratto IPC

Il Preload espone le funzioni in [`electron/preload.ts`](../electron/preload.ts). Le firme del Preload e i tipi in [`shared/types/index.ts`](../shared/types/index.ts) sono il contratto; gli handler stanno in Presentation.

[`secureIpcMain.ts`](../electron/core/presentation/secureIpcMain.ts) accetta richieste solo dalla frame principale della finestra attendibile e valida gli argomenti con uno schema per canale prima di invocare l'handler. I canali sconosciuti falliscono. `npm run quality:static` verifica che le registrazioni non usino direttamente `ipcMain` e che i canali registrati abbiano uno schema corrispondente.

Il controllo statico verifica la presenza degli schemi, non la copertura di ogni campo. `agent:start-task` usa lo schema stretto [`agentTaskContract.ts`](../electron/core/domain/agent/agentTaskContract.ts), corrispondente al tipo condiviso `AgentTaskRequest`: campi sconosciuti, `sourceWorkspacePath` (riservato a Main), identità incompleta, profilo capability non valido e allegati malformati vengono rifiutati prima dell'handler. Le impostazioni ricevute da `agent:start-task`, `agent:plan-interview`, `agent:plan-generate` e `agent:export-ai-debug-bundle` passano da `sanitizeAppSettings`; `agent:plan-seed` rimuove le chiavi sconosciute delle milestone prima di salvarle. `agent:plan-generate` valida il piano precedente con lo schema completo `agentPlanSchema` (stesso file) e l'handler lo riesegue per rimuovere le chiavi sconosciute; le liste assenti di un piano legacy diventano vuote. `projects:migrate-legacy` salva solo i campi dichiarati di `WorkspaceProject`. Gli oggetti `skills:get-hub-skill-content` e `skills:save-custom` validano tutti i campi letti dal servizio (`downloadUrl` deve essere un URL) e lasciano passare solo metadati di visualizzazione.

## Canali request/response

| Prefisso | Canali registrati |
| --- | --- |
| `agent` | `approval-response`, `cancel-task`, `export-ai-debug-bundle`, `get-plan-state`, `get-queue-status`, `logs-analyze`, `parse-tool-call`, `plan-cancel`, `plan-enrich-prompt`, `plan-generate`, `plan-interview`, `plan-seed`, `start-task` |
| `artifacts` | `delete`, `get`, `list`, `save` |
| `diagnostics` | `clear-logs`, `clear-agent-audit-log`, `get-log-filepath`, `get-logs`, `log-telemetry`, `open-logs-folder`, `run` |
| `dialog` | `open-directory`, `open-file` |
| `history` | `index`, `search` |
| `ingest` | `delete`, `export`, `file`, `list`, `page-preview`, `search`, `translate-inplace`, `update` |
| `ollama` | `cancel-pull`, `cancel-stream`, `check-model-updates`, `delete-model`, `generate-stream`, `get-generation-status`, `get-model-metrics`, `get-running-models`, `install-or-launch`, `pull-model`, `test-connection`, `unload-model` |
| `projects` | `list`, `migrate-legacy`, `register`, `remove`, `rename`, `touch` |
| `sessions` | `clear`, `delete`, `list`, `migrate-legacy`, `save` |
| `settings` | `get`, `save` |
| `sidecar` | `restart` |
| `skills` | `add-custom-source`, `get-hub-skill-content`, `install-from-hub`, `install-from-url`, `list-hub-all`, `list-hub-by-source`, `list-installed`, `list-sources`, `remove-custom-source`, `reset-original`, `save-custom`, `toggle-active`, `uninstall` |
| `system` | `check-disk-space`, `open-external`, `open-path` |
| `task` | `cancel` |
| `workspace` | `clear-standalone-scratch`, `download-file`, `execute-powershell`, `export-standalone-scratch`, `fetch-web`, `get-git-status-and-diff`, `get-standalone-scratch`, `grep-search`, `init-git`, `inspect-guest-os`, `list-files`, `read-file`, `replace-chunk`, `search-web`, `write-file` |

Registrazione: [`agentIpc.ts`](../electron/core/presentation/agentIpc.ts), [`workspaceIpc.ts`](../electron/core/presentation/workspaceIpc.ts), [`ollamaIpc.ts`](../electron/core/presentation/ollamaIpc.ts), [`sidecarIpc.ts`](../electron/core/presentation/sidecarIpc.ts), [`skillIpc.ts`](../electron/core/presentation/skillIpc.ts), [`settingsIpc.ts`](../electron/core/presentation/settingsIpc.ts), [`diagnosticsIpc.ts`](../electron/core/presentation/diagnosticsIpc.ts), [`systemIpc.ts`](../electron/core/presentation/systemIpc.ts), [`projectRegistryIpc.ts`](../electron/core/presentation/projectRegistryIpc.ts), [`sessionHistoryIpc.ts`](../electron/core/presentation/sessionHistoryIpc.ts), [`artifactIpc.ts`](../electron/core/presentation/artifactIpc.ts).

## Eventi Renderer

Eventi `on` esposti: `agent:approval-request`, `agent:change-metrics`, `agent:done`, `agent:log`, `agent:skill-install-request`, `agent:skills-matched`, `agent:step-update`, `agent:stream-thought`, `agent:stream-token`, `ingest:document-deleted`, `ingest:stream-progress`, `ingest:translate-progress`, `ollama:chunk`, `ollama:done`, `ollama:pull-progress`, `workspace:file-deleted`, `workspace:file-version`.

I comandi di esecuzione Agent Coding e tutti gli eventi `agent:*` della run includono l'identità immutabile `{ runId, conversationId, planRevisionId, workspaceId }`. Risposte di annullamento e approvazione vengono accettate solo per la stessa identità. Una voce `agent:log` può portare il campo facoltativo `localized` (`{ message?, detail? }` con chiavi `agentMain.*` e parametri, vedi [`agentMainText.ts`](../shared/domain/agent/agentMainText.ts)); `message` e `detail` restano sempre presenti come testo italiano, e Main redige i segreti anche nei parametri.

Nel flusso Agent Coding la richiesta di approvazione `git_commit` include `commitDiff` e i soli `commitPaths` attribuiti alla run.

`workspace:write-file` riceve anche `workspaceRoot`: il salvataggio editor applica lo stesso controllo realpath delle mutazioni Agent Coding.

Le run Agent Coding di progetto non ricevono il path utente: Main sostituisce il workspace con un worktree/copia temporanea e chiede il consenso `publish_workspace` prima di riportare le modifiche. Lo standalone opera invece nel workspace persistente dedicato `userData/agent-scratch`. Il consenso di pubblicazione usa `agent:approval-response` con la stessa identità immutabile della run.

`agent:start-task` restituisce `runId` e `queuePosition`; `agent:cancel-task` richiede quell'identità e non annulla altre run.

`ingest:list` restituisce solo i metadati dei documenti (`IngestedDocument`); `ingest:get` (docId) restituisce `IngestedDocumentContent` con `extractedMarkdown`, oppure `null` se il documento non esiste o il Sidecar non risponde. `ingest:file` riceve un `taskId` generato dal Renderer. Il progresso porta lo stesso ID e `task:cancel` annulla solo quella ingestion.

`ollama:generate-stream` riceve `options.think` come booleano effettivo; `ingest:file` riceve `normalizationThink` e `ingest:translate-inplace` riceve `think`. Il valore predefinito nei trasporti è `false`.

Le operazioni `ollama:pull-model`, `ollama:delete-model` e `ollama:generate-stream` ricevono l'host configurato; Main ne fissa protocollo e destinazione per l'intera richiesta, anche con host concorrenti. Ogni stream ha un `operationId`: accompagna gli eventi `ollama:chunk` e `ollama:done`, isola i listener Renderer, consente a `ollama:cancel-stream` di annullare solo quella richiesta e permette alla UI di leggere da `ollama:get-generation-status` gli stati `queued`, `running`, `cancelling` e `failed`. Piano e intervista usano lo stesso scheduler con il loro `runId`.

`ollama:generate-stream` restituisce l'esito `{ success, error? }`: errori HTTP, di trasporto o timeout non diventano chunk testuali. Chat e Traduzione accettano come completata solo una risposta riuscita e non vuota; l'export della traduzione resta disabilitato per risultati parziali o falliti.

L'unico `send` Renderer→Main è `agent:skill-install-response`. I listener restituiscono una funzione di unsubscribe.
