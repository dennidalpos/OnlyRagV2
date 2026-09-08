# Riferimento Contratti IPC — OnlyRag V2

Questo documento definisce in modo esaustivo i canali di comunicazione Inter-Process Communication (IPC) tra il **Renderer Process** (React 19) e il **Main Process** (Electron). Ogni canale è registrato in [`electron/core/presentation/`](../electron/core/presentation/) e tipizzato in [`shared/types/index.ts`](../shared/types/index.ts).

---

## 1. Canali Coding Agent Studio (`agent:*`)
Registrati in [`agentIpc.ts`](../electron/core/presentation/agentIpc.ts).

| Canale IPC | Payload Input | Risposta | Descrizione |
| :--- | :--- | :--- | :--- |
| `agent:start-task` | `{ prompt, workspacePath, model?, contextFiles?, approvedPlan? }` | `{ success: boolean, sessionId: string }` | Avvia il ciclo agentico autonomo (Tool Calling Loop). |
| `agent:cancel-task` | `{ sessionId: string }` | `{ success: boolean }` | Interrompe immediatamente il task agentico in corso. |
| `agent:plan-seed` | `{ prompt, workspacePath }` | `AgentPlan` | Genera una bozza deterministica iniziale del piano. |
| `agent:plan-interview` | `(prompt, model?, settings, workspacePath?, previousDecisions?)` | `InterviewAnalysisResult` | Esegue l'intervista con fatti freschi del workspace e risposta Ollama vincolata da schema; errori di trasporto, incompletezza e schema restano distinti internamente. |
| `agent:plan-generate` | `(prompt, model?, settings, pendingResidueMilestones?, workspacePath?, previousDecisions?)` | `PlanGenerationResult` | Valida il piano JSON, include fatti e decisioni del progetto e deriva il Markdown canonico senza esporre il protocollo Ollama al Renderer. |
| `agent:plan-enrich-prompt`| `(prompt, answers, questions)` | `string` | Valida risposte, ID correnti e provenienza prima di arricchire il prompt. |
| `agent:plan-parse-text` | `{ rawPlanText }` | `AgentPlan` | Parser di salvataggio/riparazione piani in formato testo. |
| `agent:get-plan-state` | `{ sessionId, workspacePath }` | `AgentPlan \| null` | Recupera lo stato attuale del piano per la sessione. |
| `agent:get-queue-status` | `{}` | `{ pendingCount: number, running: boolean }` | Monitora lo stato della coda di prompt multi-step. |
| `agent:approval-response`| `{ approvalId, decision: 'approved' \| 'rejected', reason? }` | `{ success: boolean }` | Invia la decisione dell'utente su un'azione con richiesta di conferma. |
| `agent:parse-tool-call` | `{ rawText: string }` | `ParsedToolCall \| null` | Esegue il parsing formale di un blocco di invocazione tool. |
| `agent:logs-analyze` | `{ workspacePath, linesCount? }` | `SlmDiagnosticsReport` | Analizza i log della sessione SLM per evidenziare errori o loop. |
| `agent:export-ai-debug-bundle` | `{ sessionId, workspacePath }` | `{ bundlePath: string }` | Esporta il pacchetto diagnostico zip per analisi anomalie. |

---

## 2. Canali Workspace & File System (`workspace:*`)
Registrati in [`workspaceIpc.ts`](../electron/core/presentation/workspaceIpc.ts).

| Canale IPC | Payload Input | Risposta | Descrizione |
| :--- | :--- | :--- | :--- |
| `workspace:list-files` | `{ workspacePath: string }` | `string[]` | Elenca ricorsivamente i file ignorando pattern esclusi. |
| `workspace:read-file` | `{ filePath: string }` | `{ content: string, encoding: string }` | Legge in modo sicuro un file all'interno del workspace. |
| `workspace:write-file` | `{ filePath: string, content: string }` | `{ success: boolean, bytesWritten: number }` | Scrive atomica di un file nel workspace. |
| `workspace:replace-chunk` | `{ filePath, startLine, endLine, targetContent, replacementContent }` | `{ success: boolean }` | Sostituzione sicura di un singolo blocco di codice. |
| `workspace:multi-replace-chunks` | `{ filePath, chunks: Array<{...}> }` | `{ success: boolean }` | Sostituzioni multiple contigue validate in una transazione. |
| `workspace:grep-search` | `{ query, workspacePath, isRegex?, caseInsensitive? }` | `GrepSearchResult[]` | Ricerca testuale/regex ad alta velocità (ripgrep). |
| `workspace:download-file` | `{ url: string, destinationPath: string }` | `{ success: boolean, size: number }` | Scarica una risorsa remota nella directory del workspace. |
| `workspace:fetch-web` | `{ url: string }` | `{ content: string, status: number }` | Fetch HTTP di una pagina web con conversione in Markdown. |
| `workspace:search-web` | `{ query: string }` | `WebSearchResult[]` | Esegue query di ricerca web tramite provider configurato. |
| `workspace:inspect-guest-os` | `{}` | `GuestOsDiagnostics` | Rileva OS host, toolchain (Node, Python, Git) e PATH. |
| `workspace:get-project-map` | `{ workspacePath: string }` | `{ tree: string, fileCount: number }` | Genera l'albero sintetico per il contesto iniziale del prompt. |
| `workspace:execute-powershell` | `{ command: string, workspacePath: string }` | `{ stdout: string, stderr: string, exitCode: number }` | Esegue un comando shell all'interno della sessione persistente. |
| `workspace:get-git-status-and-diff` | `{ workspacePath: string }` | `GitStatusAndDiff` | Stato del working tree e diff unificato unificato per-hunk. |
| `workspace:init-git` | `{ workspacePath: string }` | `{ success: boolean }` | Inizializza un repository Git locale nel workspace. |
| `workspace:git-commit` | `{ workspacePath, message: string }` | `{ commitHash: string }` | Crea un commit git locale con messaggio formattato. |

---

## 3. Canali Progetti e Sessioni (`projects:*`, `sessions:*`)
Registrati in [`projectRegistryIpc.ts`](../electron/core/presentation/projectRegistryIpc.ts) e [`sessionHistoryIpc.ts`](../electron/core/presentation/sessionHistoryIpc.ts).

| Canale IPC | Payload Input | Risposta | Descrizione |
| :--- | :--- | :--- | :--- |
| `projects:list` | `{}` | `WorkspaceProject[]` | Elenco delle cartelle progetto registrate. |
| `projects:register` | `{ projectPath: string }` | `WorkspaceProject` | Aggiunge un nuovo percorso al registro progetti. |
| `projects:touch` | `{ projectId: string }` | `void` | Aggiorna il timestamp di ultimo accesso del progetto. |
| `projects:rename` | `{ projectId: string, newName: string }` | `void` | Rinomina l'alias visuale del progetto. |
| `projects:remove` | `{ projectId: string }` | `void` | Rimuove il progetto dal registro (preservando i file su disco). |
| `projects:migrate-legacy`| `{}` | `{ migratedCount: number }` | Migrazione una-tantum dei progetti salvati in localStorage. |
| `sessions:list` | `{ workspacePath: string }` | `AgentSessionSummary[]` | Elenco delle sessioni salvate per il workspace. |
| `sessions:save` | `{ session: AgentSessionRecord }` | `void` | Salvataggio atomico su disco dello stato di sessione. |
| `sessions:delete` | `{ sessionId: string, workspacePath: string }` | `void` | Eliminazione definitiva del file di stato della sessione. |
| `sessions:clear` | `{ workspacePath: string }` | `void` | Elimina tutti gli stati sessione associati al workspace. |
| `sessions:migrate-legacy`| `{ workspacePath: string }` | `{ migratedCount: number }` | Migrazione stati da localStorage a filesystem `.onlyrag/`. |

---

## 4. Canali Runtime Ollama (`ollama:*`)
Registrati in [`ollamaIpc.ts`](../electron/core/presentation/ollamaIpc.ts).

| Canale IPC | Payload Input | Risposta | Descrizione |
| :--- | :--- | :--- | :--- |
| `ollama:test-connection` | `{ url?: string }` | `{ success: boolean, version?: string }` | Verifica la disponibilità del server Ollama locale o remoto. |
| `ollama:get-running-models` | `{}` | `RunningModelInfo[]` | Rileva i modelli caldi attualmente residenti in VRAM (/api/ps). |
| `ollama:get-model-metrics` | `{ modelName: string }` | `OllamaModelMetrics` | Dettagli di quantizzazione e dimensione parametri (/api/tags). |
| `ollama:unload-model` | `{ modelName: string }` | `{ success: boolean }` | Forza l'eviction immediata dalla VRAM (`keep_alive: 0`). |
| `ollama:pull-model` | `{ modelName: string }` | `{ success: boolean }` | Avvia il download progressivo di un modello con streaming eventi. |
| `ollama:cancel-pull` | `{ modelName: string }` | `{ success: boolean }` | Annulla il pull in corso per il modello specificato. |
| `ollama:delete-model` | `{ modelName: string }` | `{ success: boolean }` | Rimuove fisicamente il modello dall'archivio locale di Ollama. |
| `ollama:check-model-updates` | `{ installedModels: string[] }` | `ModelUpdateInfo[]` | Confronta digest locali con il registry remoto di Ollama. |
| `ollama:generate-stream` | `{ model, prompt, options? }` | `EventEmitter` | Invia una richiesta di completamento streaming token. |
| `ollama:cancel-stream` | `{ requestId: string }` | `void` | Interrompe lo stream token generato in precedenza. |
| `ollama:benchmark-model` | `{ modelName: string }` | `ModelBenchmarkResult` | Esegue test di velocità di inferenza (tok/s) e latenza TTFT. |
| `ollama:install-or-launch` | `{}` | `{ launched: boolean }` | Tenta l'avvio automatico del servizio o daemon Ollama. |

---

## 5. Canali Diagnostica & Sistema (`diagnostics:*`, `system:*`, `dialog:*`, `task:*`)
Registrati in [`diagnosticsIpc.ts`](../electron/core/presentation/diagnosticsIpc.ts) e [`systemIpc.ts`](../electron/core/presentation/systemIpc.ts).

| Canale IPC | Payload Input | Risposta | Descrizione |
| :--- | :--- | :--- | :--- |
| `diagnostics:run` | `{}` | `DiagnosticsData` | Raccoglie telemetria completa hardware (GPU, RAM, CPU, VRAM). |
| `diagnostics:get-logs` | `{ limit?: number }` | `LogEntry[]` | Recupera gli ultimi record del log di sistema dal buffer. |
| `diagnostics:clear-logs` | `{}` | `void` | Svuota il buffer in memoria e azzera il file di log su disco. |
| `diagnostics:get-log-filepath`| `{}` | `string` | Restituisce il percorso assoluto del file `.log` attivo. |
| `diagnostics:open-logs-folder`| `{}` | `void` | Apre la cartella dei log nel file manager nativo del sistema operativo. |
| `diagnostics:log-telemetry` | `LogEntry` | `void` | Invia un evento dal Renderer per la scrittura nel logger unificato. |
| `diagnostics:get-http-metrics`| `{}` | `HttpTransportMetrics` | Statistiche di latenza, roundtrip e chiamate HTTP sidecar/ollama. |
| `system:check-disk-space` | `{ path?: string }` | `{ freeGB: number, totalGB: number }` | Verifica lo spazio libero prima di installazioni pesanti. |
| `system:open-external` | `{ url: string }` | `void` | Apre un URL nel browser predefinito di sistema. |
| `system:open-path` | `{ fullPath: string }` | `void` | Mostra il file o la directory in Esplora File. |
| `dialog:open-file` | `{ filters?: Array<{name, extensions}> }` | `string \| null` | Mostra la finestra di dialogo nativa per selezionare un file. |
| `dialog:open-directory` | `{}` | `string \| null` | Mostra la finestra di dialogo nativa per selezionare una cartella. |
| `task:cancel` | `{ taskId: string }` | `void` | Annulla un task asincrono in corso registrato nel task store. |
| `task:clean-residuals` | `{}` | `void` | Pulisce file temporanei rimasti orfani da task interrotti. |

---

## 6. Canali Sidecar & Ingestion RAG (`sidecar:*`, `ingest:*`, `history:*`)
Registrati in [`sidecarIpc.ts`](../electron/core/presentation/sidecarIpc.ts).

| Canale IPC | Payload Input | Risposta | Descrizione |
| :--- | :--- | :--- | :--- |
| `sidecar:status` | `{}` | `SidecarHealthInfo` | Restituisce lo stato del processo Python su porta :8000. |
| `sidecar:restart` | `{}` | `{ success: boolean }` | Termina l'istanza e la riavvia con reclaim della porta. |
| `ingest:file` | `{ filePath, options? }` | `IngestResponse` | Delega al sidecar l'estrazione e l'indicizzazione vettoriale. |
| `ingest:list` | `{}` | `IngestedDocument[]` | Restituisce la lista di documenti presenti in LanceDB. |
| `ingest:delete` | `{ docId: string }` | `void` | Elimina un documento e tutti i chunk vettoriali correlati. |
| `ingest:update` | `{ docId, markdownContent }` | `void` | Salva il Markdown modificato e rigenera i vettori in LanceDB. |
| `ingest:search` | `{ query, topK?, model?, docIds? }` | `VectorSearchResult[]` | Esegue la ricerca ibrida (vettoriale + BM25) su LanceDB. |
| `ingest:export` | `ExportDocumentParams` | `{ exportPath: string }` | Esporta il documento in PDF, DOCX, HTML o Markdown puro. |
| `ingest:translate-inplace` | `TranslateInplaceParams` | `IngestResponse` | Traduzione in-place preservando il layout geometrico. |
| `ingest:page-preview` | `{ docId, pageNum }` | `{ previewDataUrl: string }` | Genera l'anteprima raster di una pagina specifica. |
| `history:index` | `ExecutedPrompt` | `void` | Indicizza un prompt completato nella cronologia semantica. |
| `history:search` | `{ query: string, topK?: number }` | `PromptHistorySearchResult[]` | Ricerca semantica cross-progetto tra i prompt storici. |

---

## 7. Canali Skill Hub & Impostazioni (`skills:*`, `settings:*`, `artifacts:*`)
Registrati in [`skillIpc.ts`](../electron/core/presentation/skillIpc.ts), [`settingsIpc.ts`](../electron/core/presentation/settingsIpc.ts) e [`artifactIpc.ts`](../electron/core/presentation/artifactIpc.ts).

| Canale IPC | Payload Input | Risposta | Descrizione |
| :--- | :--- | :--- | :--- |
| `skills:list-installed` | `{}` | `SkillDefinition[]` | Elenco delle skill installate e attive nel workspace/globale. |
| `skills:list-hub-all` | `{}` | `HubSkillMetadata[]` | Catalogo di tutte le skill disponibili nell'Hub locale/remoto. |
| `skills:list-hub-by-source` | `{ sourceName: string }` | `HubSkillMetadata[]` | Filtra le skill disponibili per repository/sorgente specifica. |
| `skills:get-hub-skill-content`| `{ skillId: string }` | `{ content: string }` | Legge il contenuto raw di una skill prima dell'installazione. |
| `skills:install-from-hub` | `{ skillId: string }` | `{ success: boolean }` | Installa la skill verificando il checksum di provenienza. |
| `skills:install-from-url` | `{ url: string }` | `{ success: boolean }` | Scarica e installa una skill da repository esterno fidato. |
| `skills:uninstall` | `{ skillName: string }` | `{ success: boolean }` | Rimuove la cartella della skill dal file system locale. |
| `skills:toggle-active` | `{ skillName: string, active: boolean }` | `void` | Abilita o disabilita l'inclusione della skill nel prompt. |
| `skills:save-custom` | `{ name, content }` | `void` | Crea o aggiorna una skill definita dall'utente. |
| `skills:reset-original` | `{ skillName: string }` | `void` | Ripristina il file originale `SKILL.md` sovrascrivendo le modifiche. |
| `skills:list-sources` | `{}` | `SkillSource[]` | Elenco delle sorgenti Hub configurate. |
| `skills:add-custom-source` | `{ name, url }` | `void` | Aggiunge un endpoint custom per la scoperta di nuove skill. |
| `skills:remove-custom-source`| `{ name: string }` | `void` | Rimuove una sorgente personalizzata di skill. |
| `settings:get` | `{}` | `AppSettings` | Restituisce la configurazione applicativa persistita. |
| `settings:save` | `Partial<AppSettings>` | `void` | Aggiorna e salva le preferenze su file `.onlyrag/settings.json`. |
| `artifacts:list` | `{ sessionId: string }` | `ArtifactMetadata[]` | Elenco degli artifact generati per la sessione attiva. |
| `artifacts:get` | `{ artifactId: string }` | `ArtifactContent` | Recupera il contenuto e i metadati di un artifact. |
| `artifacts:save` | `ArtifactPayload` | `void` | Salva o aggiorna un artifact generato dall'agente. |
| `artifacts:delete` | `{ artifactId: string }` | `void` | Elimina l'artifact specificato dal disco. |
